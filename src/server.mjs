import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.mjs';
import { CodexAppServer, CodexRpcError } from './codex-client.mjs';
import { DynamicToolHost } from './dynamic-tool-host.mjs';
import { OfficialSchemaRegistry } from './schema-registry.mjs';
import { pruneStateArtifacts } from './state-maintenance.mjs';
import {
  SessionStore, SlidingRateLimit, isLoopbackHost, json, parseCookies,
  readJson, safeEqualText, sameOrigin, secureHeaders,
} from './security.mjs';
import { PLATFORM_ONLY_SERVER_REQUESTS, protocolSupportSummary } from '../public/protocol-support.js';
import { MCP_APPS_EXTENSION, MCP_APPS_MIME } from '../public/mcp-app-core.js';

const APP_VERSION = '0.4.0';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const schemaDir = path.join(config.stateDir, config.experimental ? 'schema-experimental' : 'schema-stable');
fs.mkdirSync(config.stateDir, { recursive: true, mode: 0o700 });
const stateMaintenance = pruneStateArtifacts(config.stateDir);
if (stateMaintenance.removed.length) console.log(`Removed ${stateMaintenance.removed.length} stale schema swap artifact(s)`);

if (config.requireAuth && !config.token) {
  console.error('CWEB_TOKEN is required when CWEB_REQUIRE_AUTH=1. Run scripts/install-linux.sh or set a strong token.');
  process.exit(2);
}
if (!isLoopbackHost(config.host) && !config.requireAuth) {
  console.error('Refusing non-loopback bind while authentication is disabled.');
  process.exit(2);
}
if (config.dynamicToolsFile && !config.experimental) {
  console.error('CWEB_DYNAMIC_TOOLS_FILE requires CWEB_EXPERIMENTAL=1 because thread/start.dynamicTools is an official experimental field.');
  process.exit(2);
}
if (config.publicOrigin) {
  let parsed;
  try { parsed = new URL(config.publicOrigin); } catch { parsed = null; }
  if (!parsed || !['http:', 'https:'].includes(parsed.protocol) || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
    console.error('CWEB_PUBLIC_ORIGIN must be an exact http(s) origin with no path, query, fragment, or credentials.');
    process.exit(2);
  }
}

let registry;
try {
  registry = new OfficialSchemaRegistry({
    dir: schemaDir, codexBin: config.codexBin, experimental: config.experimental,
    refresh: process.env.CWEB_SCHEMA_REFRESH !== '0',
  });
} catch (error) {
  console.error(`Failed to load official Codex schemas: ${error.message}`);
  process.exit(3);
}

let dynamicToolHost;
try { dynamicToolHost = DynamicToolHost.load(config.dynamicToolsFile); }
catch (error) {
  console.error(`Failed to load Dynamic Tool Host configuration: ${error.message}`);
  process.exit(2);
}

if (dynamicToolHost.size) {
  const descriptor = registry.getRequest('thread/start');
  if (!config.experimental || !descriptor?.paramsSchema?.properties?.dynamicTools) {
    console.error('Loaded official protocol does not expose experimental thread/start.dynamicTools; refusing to advertise configured Dynamic Tools.');
    process.exit(3);
  }
}

const MCP_REQUIRED_METHODS = ['mcpServerStatus/list', 'mcpServer/resource/read', 'mcpServer/tool/call'];
if (config.mcpAppsEnabled) {
  const missing = MCP_REQUIRED_METHODS.filter((method) => !registry.getRequest(method));
  if (missing.length) {
    console.error(`Loaded official protocol cannot support MCP Apps Host; missing methods: ${missing.join(', ')}`);
    process.exit(3);
  }
}

const clientCapabilities = {
  extensions: {
    ...(config.mcpAppsEnabled ? { [MCP_APPS_EXTENSION]: { mimeTypes: [MCP_APPS_MIME] } } : {}),
  },
  ...(config.notificationOptOut.length ? { optOutNotificationMethods: config.notificationOptOut } : {}),
};

const codex = new CodexAppServer({
  codexBin: config.codexBin, cwd: config.workspace, experimental: config.experimental,
  capabilities: clientCapabilities, timeoutMs: config.rpcTimeoutMs, maxPending: config.maxPendingRpc,
  maxServerRequests: config.maxPendingRpc, maxStdinBufferBytes: config.maxStdinBufferBytes,
  maxLineBytes: config.maxJsonlLineBytes,
});

const sessions = new SessionStore();
const loginRate = new SlidingRateLimit(6, 60_000);
const sseClients = new Set();
let fatalCodexError = null;
let restartTimer = null;
let restartAttempt = 0;
let eventSequence = 0;
const MACHINE_ONLY_SERVER_REQUESTS = new Set(PLATFORM_ONLY_SERVER_REQUESTS);

const CODING_PROFILE_DENY = [
  /^account\/(login|logout|chatgptAuthTokens)/,
  /^config\/(value\/write|batchWrite|mcpServer\/reload)/,
  /^externalAgentConfig\/import/,
  /^feedback\/upload/,
  /^plugin\/(install|uninstall|share\/save)/,
  /^remoteControl\//,
];
const ADMIN_PROFILE_DENY = [/^command\/exec(?:\/|$)/];

function methodRisk(method) {
  const name = String(method || '');
  if (/\/(list|read|status|installed|detect|searchOccurrences)$/.test(name) || /^(model\/list|account\/read|config\/read|configRequirements\/read|server\/diagnostics)$/.test(name)) return 'read';
  if (/\/(delete|uninstall|revoke|terminate)$/.test(name) || /^command\/exec(?:\/|$)/.test(name) || /^config\/(value\/write|batchWrite)$/.test(name)) return 'danger';
  if (/\/(create|update|write|install|import|move|start|resume|fork|interrupt|enable|disable|call|upload|login|logout|archive|unarchive)$/.test(name)) return 'write';
  return 'standard';
}

function accessAllows(method) {
  if (config.accessProfile === 'full') return true;
  if (config.accessProfile === 'read') return methodRisk(method) === 'read';
  if (config.accessProfile === 'coding') return !CODING_PROFILE_DENY.some((pattern) => pattern.test(method));
  if (config.accessProfile === 'admin') return !ADMIN_PROFILE_DENY.some((pattern) => pattern.test(method));
  return false;
}

function eventFrame(type, payload) {
  const event = { type, payload, at: Date.now(), sequence: ++eventSequence };
  const text = JSON.stringify(event);
  if (Buffer.byteLength(text) <= config.eventMaxBytes) return { event, frame: `id: ${event.sequence}\ndata: ${text}\n\n` };
  const compact = { type: 'eventOversize', payload: { originalType: type, method: payload?.method || null, bytes: Buffer.byteLength(text) }, at: Date.now(), sequence: event.sequence };
  return { event: compact, frame: `id: ${compact.sequence}\ndata: ${JSON.stringify(compact)}\n\n` };
}

function writeSse(res, frame) {
  if (res.destroyed || res.writableEnded || res.writableLength > config.sseMaxBufferBytes) {
    sseClients.delete(res); res.destroy(); return false;
  }
  try { res.write(frame); return true; }
  catch { sseClients.delete(res); res.destroy(); return false; }
}

function pushEvent(type, payload) {
  const { frame } = eventFrame(type, payload);
  for (const res of [...sseClients]) writeSse(res, frame);
}

function rejectUnknownServerRequest(message) {
  try { codex.respondError(message.id, { code: -32601, message: `Server request is not present in the loaded official schema: ${message.method}` }); }
  catch { /* child may already be gone */ }
}

function rejectMachineOnlyServerRequest(message) {
  try {
    codex.respondError(message.id, { code: -32601, message: `Codex App Server Web does not advertise or implement the platform-only client capability required by ${message.method}` });
  } catch { /* child may already be gone */ }
  pushEvent('serverRequestUnsupported', { method: message.method, reason: 'platform-only-client-capability' });
}

function rejectDynamicToolRequest(message, reason) {
  const namespace = String(message.params?.namespace || 'codex_app');
  const tool = String(message.params?.tool || 'unknown');
  const configured = dynamicToolHost.size > 0;
  const detail = configured
    ? `Dynamic Tool is not registered: ${namespace}:${tool}`
    : `Dynamic Tool Host is not configured for ${namespace}:${tool}`;
  try { codex.respondError(message.id, { code: -32601, message: detail }); }
  catch { /* child may already be gone */ }
  pushEvent('serverRequestUnsupported', {
    method: message.method, reason, message: detail, namespace, tool,
  });
  return true;
}

async function autoHandleServerRequest(message) {
  if (message.method === 'currentTime/read') {
    if (!config.experimental) return false;
    codex.respond(message.id, { currentTimeAt: Math.floor(Date.now() / 1000) });
    pushEvent('serverRequestAutoHandled', { method: message.method });
    return true;
  }
  if (message.method === 'item/tool/call') {
    if (dynamicToolHost.canHandle(message.params)) {
      const result = await dynamicToolHost.handle(message.params);
      if (result) codex.respond(message.id, result);
      else return false;
      pushEvent('serverRequestAutoHandled', { method: message.method, tool: message.params?.tool || null, namespace: message.params?.namespace || null });
      return true;
    }
    return rejectDynamicToolRequest(message, dynamicToolHost.size ? 'dynamic-tool-not-registered' : 'dynamic-tool-host-unconfigured');
  }
  return false;
}

codex.on('serverRequest', (message) => {
  if (!registry.getServerRequest(message.method)) {
    pushEvent('protocolMismatch', { direction: 'serverRequest', method: message.method });
    rejectUnknownServerRequest(message);
    return;
  }
  if (MACHINE_ONLY_SERVER_REQUESTS.has(message.method)) { rejectMachineOnlyServerRequest(message); return; }
  void autoHandleServerRequest(message).then((handled) => {
    if (handled) return;
    const bytes = Buffer.byteLength(JSON.stringify(message));
    if (bytes > config.eventMaxBytes) {
      try { codex.respondError(message.id, { code: -32602, message: `Server request exceeds Web client safety limit (${bytes} bytes)` }); } catch { /* ignore */ }
      pushEvent('serverRequestRejected', { method: message.method, reason: 'too-large', bytes });
      return;
    }
    pushEvent('serverRequest', message);
  }).catch((error) => {
    try { codex.respondError(message.id, { code: -32000, message: 'Gateway host failed to handle server request' }); } catch { /* ignore */ }
    pushEvent('serverRequestHostError', { method: message.method, message: error.message });
  });
});

codex.on('notification', (message) => {
  if (!registry.getServerNotification(message.method)) {
    pushEvent('protocolMismatch', { direction: 'serverNotification', method: message.method });
    return;
  }
  // Older Codex builds may still emit this after initialization even when the
  // client opted out. It is an internal aggregate, never a timeline item.
  if (message.method === 'turn/diff/updated') return;
  pushEvent('notification', message);
});
codex.on('stderr', (line) => { const text = String(line).trim(); if (text) console.error(`[codex] ${text.slice(0, 4000)}`); });
codex.on('protocolError', (value) => pushEvent('protocolError', value));
codex.on('transportError', ({ error }) => console.error(`[codex] transport error: ${error?.code || 'unknown'} ${error?.message || error}`));
codex.on('serverRequestsCleared', (value) => pushEvent('serverRequestsCleared', value));
codex.on('startError', ({ error, generation, pid, pendingMethods }) => {
  console.error(`[codex] start failed pid=${pid ?? 'unknown'} generation=${generation} code=${error?.code || 'unknown'} pending=${(pendingMethods || []).join(',') || 'none'}: ${error?.message || error}`);
});
codex.on('exit', (value) => {
  console.error(`[codex] child exited pid=${value.pid ?? 'unknown'} code=${value.code ?? 'null'} signal=${value.signal ?? 'null'} killed=${value.killed ? 'yes' : 'no'} pending=${(value.pendingMethods || []).join(',') || 'none'}`);
  pushEvent('codexExit', value);
});
codex.on('ready', (initialize) => { fatalCodexError = null; restartAttempt = 0; pushEvent('codexReady', { initialize }); });
codex.on('crash', (error) => { fatalCodexError = error.message; pushEvent('codexError', { message: error.message, code: error.code || null }); scheduleCodexRestart(); });

function scheduleCodexRestart() {
  if (restartTimer) return;
  const delay = Math.min(config.restartMaxDelayMs, 1_000 * (2 ** Math.min(restartAttempt, 5)));
  restartAttempt += 1;
  restartTimer = setTimeout(async () => {
    restartTimer = null;
    try { await codex.start(); }
    catch (error) { fatalCodexError = error.message; pushEvent('codexRestartFailed', { message: error.message, attempt: restartAttempt }); scheduleCodexRestart(); }
  }, delay);
  restartTimer.unref();
}

function authenticated(req) { return !config.requireAuth || sessions.has(parseCookies(req).cweb_session); }
function requireAuth(req, res) { if (authenticated(req)) return true; json(res, 401, { error: 'AUTH_REQUIRED' }); return false; }
function requireOrigin(req, res) { if (sameOrigin(req, config.publicOrigin)) return true; json(res, 403, { error: 'ORIGIN_REJECTED' }); return false; }
function clientAddress(req) { return req.socket.remoteAddress || 'unknown'; }
function methodSummary(item) { return { method: item.method, title: item.title, description: item.description, paramsRef: item.paramsRef, managed: item.method === 'initialize' || item.method === 'initialized', risk: methodRisk(item.method), allowed: accessAllows(item.method) }; }

function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!relative || relative.includes('\0')) return false;
  const target = path.resolve(publicDir, relative);
  if (target !== publicDir && !target.startsWith(`${publicDir}${path.sep}`)) return false;
  let stat;
  try { stat = fs.statSync(target); } catch { return false; }
  if (!stat.isFile()) return false;
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };
  res.writeHead(200, secureHeaders({ 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': 'no-cache' }));
  fs.createReadStream(target).pipe(res);
  return true;
}

function managedParams(method, params) {
  const value = params && typeof params === 'object' && !Array.isArray(params) ? { ...params } : {};
  if (method === 'thread/start' && dynamicToolHost.size) {
    if (value.dynamicTools !== undefined) {
      const error = new Error('thread/start.dynamicTools is managed by CWEB_DYNAMIC_TOOLS_FILE on this gateway');
      error.status = 409; error.code = 'DYNAMIC_TOOLS_MANAGED_BY_GATEWAY'; throw error;
    }
    value.dynamicTools = dynamicToolHost.specs;
  }
  return value;
}

async function api(req, res, url) {
  const pathname = url.pathname;
  if (pathname === '/api/login' && req.method === 'POST') {
    if (!requireOrigin(req, res)) return;
    if (!loginRate.allow(clientAddress(req))) return json(res, 429, { error: 'RATE_LIMITED' });
    const body = await readJson(req, 64 * 1024);
    if (!config.requireAuth || !safeEqualText(body.token || '', config.token)) return json(res, 401, { error: 'INVALID_TOKEN' });
    const session = sessions.create();
    const secure = config.publicOrigin.startsWith('https://') ? '; Secure' : '';
    return json(res, 200, { ok: true }, { 'Set-Cookie': `cweb_session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}` });
  }
  if (pathname === '/api/session' && req.method === 'GET') return json(res, 200, { authenticated: authenticated(req), authRequired: config.requireAuth });
  if (!requireAuth(req, res)) return;

  if (pathname === '/api/logout' && req.method === 'POST') {
    if (!requireOrigin(req, res)) return;
    sessions.delete(parseCookies(req).cweb_session);
    return json(res, 200, { ok: true }, { 'Set-Cookie': 'cweb_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }

  if (pathname === '/api/meta' && req.method === 'GET') {
    let initializeResult = codex.initializeResult;
    try { initializeResult = await codex.start(); } catch (error) { fatalCodexError = error.message; scheduleCodexRestart(); }
    return json(res, 200, {
      app: 'codex-app-server-web', version: APP_VERSION, workspace: config.workspace,
      status: codex.isReady() && !fatalCodexError ? 'ready' : 'degraded', error: fatalCodexError,
      schema: registry.summary(), initializeResult, access: { profile: config.accessProfile }, protocolSupport: protocolSupportSummary(),
      capabilities: {
        experimentalApi: config.experimental,
        extensions: { 'openai/form': {}, ...(config.mcpAppsEnabled ? { [MCP_APPS_EXTENSION]: { mimeTypes: [MCP_APPS_MIME] } } : {}) },
        optOutNotificationMethods: config.notificationOptOut, requestAttestation: false,
        mcpAppsHost: config.mcpAppsEnabled, mcpAppPermissions: config.mcpAppPermissions,
        dynamicToolHost: { enabled: dynamicToolHost.size > 0, tools: dynamicToolHost.size, experimentalRequired: true },
        currentTimeHost: config.experimental && Boolean(registry.getServerRequest('currentTime/read')),
        platformOnlyServerRequests: [...MACHINE_ONLY_SERVER_REQUESTS],
      },
      contract: {
        officialAppServerOnly: true, directCodexStateMutation: false, privateProtocol: false, transport: 'stdio',
        bidirectionalSchemaGate: true, codexEnvironmentSecretsStripped: true, accessPolicyGate: true,
        nativeItemTimeline: true, exactProtocolDispositionSeal: true, openaiFormNative: true,
        mcpAppsAdvertised: config.mcpAppsEnabled, mcpAppsDoubleIframeSandbox: true,
        dynamicToolsExperimentalOnly: true,
      },
    });
  }

  if (pathname === '/api/methods' && req.method === 'GET') {
    return json(res, 200, { requests: registry.requests.map(methodSummary), notifications: registry.notifications.map(methodSummary), serverRequests: registry.serverRequests.map(methodSummary), serverNotifications: registry.serverNotifications.map(methodSummary) });
  }
  if (pathname === '/api/method-schema' && req.method === 'GET') {
    const kind = url.searchParams.get('kind') || '', method = url.searchParams.get('method') || '';
    const schema = registry.getSchemaBundle(kind, method);
    if (!schema) return json(res, 404, { error: 'OFFICIAL_METHOD_SCHEMA_NOT_FOUND' });
    return json(res, 200, { kind, method, schema });
  }
  if (pathname === '/api/events' && req.method === 'GET') {
    res.writeHead(200, secureHeaders({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }));
    try { res.socket?.setNoDelay?.(true); } catch { /* ignore */ }
    const connected = eventFrame('connected', { pendingServerRequests: codex.pendingServerRequests().filter((item) => !MACHINE_ONLY_SERVER_REQUESTS.has(item.method)), codexReady: codex.isReady(), eventSequence });
    writeSse(res, connected.frame); sseClients.add(res);
    const heartbeat = setInterval(() => { if (!writeSse(res, `: ping ${Date.now()}\n\n`)) clearInterval(heartbeat); }, 15_000);
    req.on('close', () => { clearInterval(heartbeat); sseClients.delete(res); });
    return;
  }
  if (pathname === '/api/rpc' && req.method === 'POST') {
    if (!requireOrigin(req, res)) return;
    const body = await readJson(req, config.bodyLimit);
    const descriptor = registry.getRequest(body.method);
    if (!descriptor) return json(res, 400, { error: 'METHOD_NOT_IN_OFFICIAL_SCHEMA', method: body.method });
    if (body.method === 'initialize') return json(res, 400, { error: 'INITIALIZE_IS_MANAGED_BY_GATEWAY' });
    if (!accessAllows(body.method)) return json(res, 403, { error: 'METHOD_BLOCKED_BY_ACCESS_PROFILE', method: body.method, profile: config.accessProfile });
    let result;
    try { result = await codex.request(body.method, managedParams(body.method, body.params ?? {})); }
    catch (error) { error.requestMethod = body.method; throw error; }
    return json(res, 200, { result });
  }
  if (pathname === '/api/notify' && req.method === 'POST') {
    if (!requireOrigin(req, res)) return;
    const body = await readJson(req, config.bodyLimit);
    if (body.method === 'initialized') return json(res, 400, { error: 'INITIALIZED_IS_MANAGED_BY_GATEWAY' });
    if (!registry.getNotification(body.method)) return json(res, 400, { error: 'NOTIFICATION_NOT_IN_OFFICIAL_SCHEMA', method: body.method });
    if (!accessAllows(body.method)) return json(res, 403, { error: 'METHOD_BLOCKED_BY_ACCESS_PROFILE', method: body.method, profile: config.accessProfile });
    await codex.notify(body.method, body.params ?? {});
    return json(res, 200, { ok: true });
  }
  if (pathname === '/api/respond' && req.method === 'POST') {
    if (!requireOrigin(req, res)) return;
    const body = await readJson(req, config.bodyLimit);
    const pending = codex.pendingServerRequests().find((item) => String(item.id) === String(body.id));
    if (!pending) return json(res, 404, { error: 'SERVER_REQUEST_NOT_PENDING' });
    if (!registry.getServerRequest(pending.method)) return json(res, 409, { error: 'SERVER_REQUEST_NOT_IN_OFFICIAL_SCHEMA' });
    if (MACHINE_ONLY_SERVER_REQUESTS.has(pending.method)) return json(res, 409, { error: 'PLATFORM_ONLY_SERVER_REQUEST', method: pending.method });
    if (body.error) codex.respondError(body.id, body.error); else codex.respond(body.id, body.result ?? {});
    return json(res, 200, { ok: true });
  }
  return json(res, 404, { error: 'NOT_FOUND' });
}

function errorStatus(error) {
  if (Number(error.status)) return Number(error.status);
  if (error.code === 'CODEX_RPC_TIMEOUT') return 504;
  if (['CODEX_APP_SERVER_EXITED', 'CODEX_CLIENT_BUSY'].includes(error.code)) return 503;
  if (error instanceof CodexRpcError) {
    if (error.rpc?.code === -32602) return 400;
    if (error.rpc?.code === -32001) return 503;
    return 502;
  }
  return 500;
}

function compactRpcError(error) {
  if (!(error instanceof CodexRpcError)) return null;
  const raw = String(error.rpc?.message || error.message || '').trim();
  const beforeMarkup = raw.indexOf('<');
  const message = (beforeMarkup >= 0 ? raw.slice(0, beforeMarkup) : raw).replace(/\s+/g, ' ').trim();
  return { code: error.rpc?.code ?? null, message: (message || 'Codex upstream request failed').slice(0, 240) };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/healthz') return json(res, 200, { status: 'ok' });
    if (url.pathname === '/readyz') return json(res, codex.isReady() ? 200 : 503, { status: codex.isReady() ? 'ready' : 'not-ready' });
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (serveStatic(req, res, url.pathname)) return;
    res.writeHead(404, secureHeaders({ 'Content-Type': 'text/plain; charset=utf-8' })); res.end('Not found');
  } catch (error) {
    const rpcError = compactRpcError(error);
    const publicMessage = rpcError?.message || String(error.message || '').replace(/\s+/g, ' ').slice(0, 1200);
    const requestContext = error.requestMethod ? ` method=${error.requestMethod}` : '';
    console.error(`[request]${requestContext} ${error.code || (rpcError ? 'CODEX_RPC_ERROR' : 'INTERNAL_ERROR')}: ${publicMessage}`);
    json(res, errorStatus(error), { error: error.code || (rpcError ? 'CODEX_RPC_ERROR' : 'INTERNAL_ERROR'), message: publicMessage, ...(rpcError ? { rpc: rpcError } : {}) });
  }
});

server.headersTimeout = 10_000;
server.requestTimeout = 30_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 64;
server.maxRequestsPerSocket = 1_000;

server.listen(config.port, config.host, async () => {
  console.log(`Codex App Server Web listening on http://${config.host}:${config.port}`);
  console.log(`Codex: ${registry.version}`);
  console.log(`Official schema: ${registry.digest.slice(0, 16)} (${registry.requests.length} requests)`);
  console.log(`Access profile: ${config.accessProfile}`);
  console.log(`MCP Apps Host: ${config.mcpAppsEnabled ? 'enabled' : 'disabled'}; Dynamic Tool Host: ${dynamicToolHost.size} configured`);
  try { await codex.start(); }
  catch (error) { fatalCodexError = error.message; console.error(`Codex App Server failed: ${error.message}`); scheduleCodexRestart(); }
});

function shutdown(signal) {
  console.log(`Shutting down (${signal})`);
  if (restartTimer) clearTimeout(restartTimer);
  for (const res of [...sseClients]) {
    sseClients.delete(res);
    try { res.end(); } catch { try { res.destroy(); } catch { /* ignore */ } }
  }
  dynamicToolHost.close();
  server.close(() => process.exit(0));
  server.closeAllConnections?.();
  server.closeIdleConnections?.();
  codex.close();
  const force = setTimeout(() => process.exit(0), 5_000); force.unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
