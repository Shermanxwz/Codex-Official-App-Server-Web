import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.mjs';
import { CodexAppServer, CodexRpcError } from './codex-client.mjs';
import { OfficialSchemaRegistry } from './schema-registry.mjs';
import {
  SessionStore, SlidingRateLimit, isLoopbackHost, json, parseCookies,
  readJson, safeEqualText, sameOrigin, secureHeaders,
} from './security.mjs';

const APP_VERSION = '0.3.0';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const schemaDir = path.join(config.stateDir, config.experimental ? 'schema-experimental' : 'schema-stable');
fs.mkdirSync(config.stateDir, { recursive: true, mode: 0o700 });

if (config.requireAuth && !config.token) {
  console.error('CWEB_TOKEN is required when CWEB_REQUIRE_AUTH=1. Run scripts/install-linux.sh or set a strong token.');
  process.exit(2);
}
if (!isLoopbackHost(config.host) && !config.requireAuth) {
  console.error('Refusing non-loopback bind while authentication is disabled.');
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
    dir: schemaDir,
    codexBin: config.codexBin,
    experimental: config.experimental,
    refresh: process.env.CWEB_SCHEMA_REFRESH !== '0',
  });
} catch (error) {
  console.error(`Failed to load official Codex schemas: ${error.message}`);
  process.exit(3);
}

const clientCapabilities = {
  ...(config.notificationOptOut.length ? { optOutNotificationMethods: config.notificationOptOut } : {}),
};

const codex = new CodexAppServer({
  codexBin: config.codexBin,
  cwd: config.workspace,
  experimental: config.experimental,
  capabilities: clientCapabilities,
  timeoutMs: config.rpcTimeoutMs,
  maxPending: config.maxPendingRpc,
  maxServerRequests: config.maxPendingRpc,
  maxStdinBufferBytes: config.maxStdinBufferBytes,
  maxLineBytes: config.maxJsonlLineBytes,
});

const sessions = new SessionStore();
const loginRate = new SlidingRateLimit(6, 60_000);
const sseClients = new Set();
let fatalCodexError = null;
let restartTimer = null;
let restartAttempt = 0;
let eventSequence = 0;

const MACHINE_ONLY_SERVER_REQUESTS = new Set([
  'attestation/generate',
  'account/chatgptAuthTokens/refresh',
]);

const CODING_PROFILE_DENY = [
  /^account\/(login|logout|chatgptAuthTokens)/,
  /^config\/(value\/write|batchWrite|mcpServer\/reload)/,
  /^externalAgentConfig\/import/,
  /^feedback\/upload/,
  /^plugin\/(install|uninstall|share\/save)/,
  /^remoteControl\//,
];

const ADMIN_PROFILE_DENY = [
  /^command\/exec(?:\/|$)/,
];

function methodRisk(method) {
  const name = String(method || '');
  if (
    /\/(list|read|status|installed|detect|searchOccurrences)$/.test(name)
    || /^(model\/list|account\/read|config\/read|configRequirements\/read|server\/diagnostics)$/.test(name)
  ) return 'read';
  if (
    /\/(delete|uninstall|revoke|terminate)$/.test(name)
    || /^command\/exec(?:\/|$)/.test(name)
    || /^config\/(value\/write|batchWrite)$/.test(name)
  ) return 'danger';
  if (
    /\/(create|update|write|install|import|move|start|resume|fork|interrupt|enable|disable|call|upload|login|logout|archive|unarchive)$/.test(name)
  ) return 'write';
  return 'standard';
}

function accessAllows(method) {
  const profile = config.accessProfile;
  if (profile === 'full') return true;
  if (profile === 'read') return methodRisk(method) === 'read';
  if (profile === 'coding') return !CODING_PROFILE_DENY.some((pattern) => pattern.test(method));
  if (profile === 'admin') return !ADMIN_PROFILE_DENY.some((pattern) => pattern.test(method));
  return false;
}

function eventFrame(type, payload) {
  const event = { type, payload, at: Date.now(), sequence: ++eventSequence };
  const text = JSON.stringify(event);
  if (Buffer.byteLength(text) <= config.eventMaxBytes) return { event, frame: `id: ${event.sequence}\ndata: ${text}\n\n` };
  const compact = {
    type: 'eventOversize',
    payload: { originalType: type, method: payload?.method || null, bytes: Buffer.byteLength(text) },
    at: Date.now(), sequence: event.sequence,
  };
  return { event: compact, frame: `id: ${compact.sequence}\ndata: ${JSON.stringify(compact)}\n\n` };
}

function writeSse(res, frame) {
  if (res.destroyed || res.writableEnded || res.writableLength > config.sseMaxBufferBytes) {
    sseClients.delete(res);
    res.destroy();
    return false;
  }
  try { res.write(frame); return true; }
  catch { sseClients.delete(res); res.destroy(); return false; }
}

function pushEvent(type, payload) {
  const { frame } = eventFrame(type, payload);
  for (const res of [...sseClients]) writeSse(res, frame);
}

function rejectUnknownServerRequest(message) {
  try {
    codex.respondError(message.id, { code: -32601, message: `Server request is not present in the loaded official schema: ${message.method}` });
  } catch { /* child may already be gone */ }
}

function rejectMachineOnlyServerRequest(message) {
  try {
    codex.respondError(message.id, {
      code: -32601,
      message: `Codex App Server Web does not advertise or implement the platform-only client capability required by ${message.method}`,
    });
  } catch { /* child may already be gone */ }
  pushEvent('serverRequestUnsupported', { method: message.method, reason: 'platform-only-client-capability' });
}

codex.on('serverRequest', (message) => {
  if (!registry.getServerRequest(message.method)) {
    pushEvent('protocolMismatch', { direction: 'serverRequest', method: message.method });
    rejectUnknownServerRequest(message);
    return;
  }
  if (MACHINE_ONLY_SERVER_REQUESTS.has(message.method)) {
    rejectMachineOnlyServerRequest(message);
    return;
  }
  const bytes = Buffer.byteLength(JSON.stringify(message));
  if (bytes > config.eventMaxBytes) {
    try { codex.respondError(message.id, { code: -32602, message: `Server request exceeds Web client safety limit (${bytes} bytes)` }); } catch { /* ignore */ }
    pushEvent('serverRequestRejected', { method: message.method, reason: 'too-large', bytes });
    return;
  }
  pushEvent('serverRequest', message);
});

codex.on('notification', (message) => {
  if (!registry.getServerNotification(message.method)) {
    pushEvent('protocolMismatch', { direction: 'serverNotification', method: message.method });
    return;
  }
  pushEvent('notification', message);
});
codex.on('stderr', (line) => {
  const text = String(line).trim();
  if (text) console.error(`[codex] ${text.slice(0, 4000)}`);
});
codex.on('protocolError', (value) => pushEvent('protocolError', value));
codex.on('serverRequestsCleared', (value) => pushEvent('serverRequestsCleared', value));
codex.on('exit', (value) => pushEvent('codexExit', value));
codex.on('ready', (initialize) => {
  fatalCodexError = null;
  restartAttempt = 0;
  pushEvent('codexReady', { initialize });
});
codex.on('crash', (error) => {
  fatalCodexError = error.message;
  pushEvent('codexError', { message: error.message, code: error.code || null });
  scheduleCodexRestart();
});

function scheduleCodexRestart() {
  if (restartTimer) return;
  const delay = Math.min(config.restartMaxDelayMs, 1_000 * (2 ** Math.min(restartAttempt, 5)));
  restartAttempt += 1;
  restartTimer = setTimeout(async () => {
    restartTimer = null;
    try { await codex.start(); }
    catch (error) {
      fatalCodexError = error.message;
      pushEvent('codexRestartFailed', { message: error.message, attempt: restartAttempt });
      scheduleCodexRestart();
    }
  }, delay);
  restartTimer.unref();
}

function authenticated(req) {
  if (!config.requireAuth) return true;
  return sessions.has(parseCookies(req).cweb_session);
}

function requireAuth(req, res) {
  if (authenticated(req)) return true;
  json(res, 401, { error: 'AUTH_REQUIRED' });
  return false;
}

function requireOrigin(req, res) {
  if (sameOrigin(req, config.publicOrigin)) return true;
  json(res, 403, { error: 'ORIGIN_REJECTED' });
  return false;
}

function clientAddress(req) {
  return req.socket.remoteAddress || 'unknown';
}

function methodSummary(item) {
  return {
    method: item.method,
    title: item.title,
    description: item.description,
    paramsRef: item.paramsRef,
    managed: item.method === 'initialize' || item.method === 'initialized',
    risk: methodRisk(item.method),
    allowed: accessAllows(item.method),
  };
}

function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!relative || relative.includes('\0')) return false;
  const target = path.resolve(publicDir, relative);
  if (target !== publicDir && !target.startsWith(`${publicDir}${path.sep}`)) return false;
  let stat;
  try { stat = fs.statSync(target); } catch { return false; }
  if (!stat.isFile()) return false;
  const types = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8',
  };
  res.writeHead(200, secureHeaders({
    'Content-Type': types[path.extname(target)] || 'application/octet-stream',
    'Content-Length': stat.size,
    // Assets are not content-hashed; revalidate them so HTML/JS/CSS cannot drift across deployments.
    'Cache-Control': 'no-cache',
  }));
  fs.createReadStream(target).pipe(res);
  return true;
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
    return json(res, 200, { ok: true }, {
      'Set-Cookie': `cweb_session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}`,
    });
  }

  if (pathname === '/api/session' && req.method === 'GET') {
    return json(res, 200, { authenticated: authenticated(req), authRequired: config.requireAuth });
  }

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
      app: 'codex-app-server-web',
      version: APP_VERSION,
      workspace: config.workspace,
      status: codex.isReady() && !fatalCodexError ? 'ready' : 'degraded',
      error: fatalCodexError,
      schema: registry.summary(),
      initializeResult,
      access: {
        profile: config.accessProfile,
      },
      capabilities: {
        experimentalApi: config.experimental,
        extensions: {
          'openai/form': {},
          'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] },
        },
        optOutNotificationMethods: config.notificationOptOut,
        requestAttestation: false,
        platformOnlyServerRequests: [...MACHINE_ONLY_SERVER_REQUESTS],
      },
      contract: {
        officialAppServerOnly: true,
        directCodexStateMutation: false,
        privateProtocol: false,
        transport: 'stdio',
        bidirectionalSchemaGate: true,
        codexEnvironmentSecretsStripped: true,
        accessPolicyGate: true,
        nativeItemTimeline: true,
      },
    });
  }

  if (pathname === '/api/methods' && req.method === 'GET') {
    return json(res, 200, {
      requests: registry.requests.map(methodSummary),
      notifications: registry.notifications.map(methodSummary),
      serverRequests: registry.serverRequests.map(methodSummary),
      serverNotifications: registry.serverNotifications.map(methodSummary),
    });
  }

  if (pathname === '/api/method-schema' && req.method === 'GET') {
    const kind = url.searchParams.get('kind') || '';
    const method = url.searchParams.get('method') || '';
    const schema = registry.getSchemaBundle(kind, method);
    if (!schema) return json(res, 404, { error: 'OFFICIAL_METHOD_SCHEMA_NOT_FOUND' });
    return json(res, 200, { kind, method, schema });
  }

  if (pathname === '/api/events' && req.method === 'GET') {
    res.writeHead(200, secureHeaders({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    }));
    try { res.socket?.setNoDelay?.(true); } catch { /* ignore */ }
    const connected = eventFrame('connected', {
      pendingServerRequests: codex.pendingServerRequests().filter((item) => !MACHINE_ONLY_SERVER_REQUESTS.has(item.method)),
      codexReady: codex.isReady(),
      eventSequence,
    });
    writeSse(res, connected.frame);
    sseClients.add(res);
    const heartbeat = setInterval(() => {
      if (!writeSse(res, `: ping ${Date.now()}\n\n`)) clearInterval(heartbeat);
    }, 15_000);
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
    const result = await codex.request(body.method, body.params ?? {});
    return json(res, 200, { result });
  }

  if (pathname === '/api/notify' && req.method === 'POST') {
    if (!requireOrigin(req, res)) return;
    const body = await readJson(req, config.bodyLimit);
    if (body.method === 'initialized') return json(res, 400, { error: 'INITIALIZED_IS_MANAGED_BY_GATEWAY' });
    const descriptor = registry.getNotification(body.method);
    if (!descriptor) return json(res, 400, { error: 'NOTIFICATION_NOT_IN_OFFICIAL_SCHEMA', method: body.method });
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
    if (body.error) codex.respondError(body.id, body.error);
    else codex.respond(body.id, body.result ?? {});
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

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/healthz') return json(res, 200, { status: 'ok' });
    if (url.pathname === '/readyz') return json(res, codex.isReady() ? 200 : 503, { status: codex.isReady() ? 'ready' : 'not-ready' });
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (serveStatic(req, res, url.pathname)) return;
    res.writeHead(404, secureHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
    res.end('Not found');
  } catch (error) {
    console.error(error);
    json(res, errorStatus(error), {
      error: error.code || 'INTERNAL_ERROR',
      message: error.message,
      ...(error instanceof CodexRpcError ? { rpc: error.rpc } : {}),
    });
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
  try { await codex.start(); }
  catch (error) { fatalCodexError = error.message; console.error(`Codex App Server failed: ${error.message}`); scheduleCodexRestart(); }
});

function shutdown(signal) {
  console.log(`Shutting down (${signal})`);
  if (restartTimer) clearTimeout(restartTimer);
  server.close(() => process.exit(0));
  codex.close();
  const force = setTimeout(() => process.exit(1), 5_000);
  force.unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
