import fs from 'node:fs';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.mjs';
import { CodexAppServer, CodexRpcError } from './codex-client.mjs';
import { DynamicToolHost } from './dynamic-tool-host.mjs';
import { OfficialSchemaRegistry } from './schema-registry.mjs';
import { pruneStateArtifacts } from './state-maintenance.mjs';
import {
  SessionStore, SlidingRateLimit, canonicalExactOrigin, isLoopbackHost, json, parseCookies,
  readJson, safeEqualText, sameOrigin, secureHeaders,
} from './security.mjs';
import { PLATFORM_ONLY_SERVER_REQUESTS, protocolSupportSummary } from '../public/protocol-support.js';
import { MCP_APPS_EXTENSION, MCP_APPS_MIME } from '../public/mcp-app-core.js';

const APP_VERSION = '0.4.0';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const schemaDir = path.join(config.stateDir, config.experimental ? 'schema-experimental' : 'schema-stable');
const controlFile = path.join(config.stateDir, 'control.json');
fs.mkdirSync(config.stateDir, { recursive: true, mode: 0o700 });
const stateMaintenance = pruneStateArtifacts(config.stateDir);
if (stateMaintenance.removed.length) console.log(`Removed ${stateMaintenance.removed.length} stale schema swap artifact(s)`);

const DEFAULT_CONTROL_STATE = { webWriteEnabled: true };
function loadControlState() {
  try {
    const value = JSON.parse(fs.readFileSync(controlFile, 'utf8'));
    return {
      webWriteEnabled: value?.webWriteEnabled !== false,
    };
  } catch {
    return { ...DEFAULT_CONTROL_STATE };
  }
}
let controlState = loadControlState();
function controlSnapshot() {
  return {
    ...controlState,
    effectiveWebWriteEnabled: controlState.webWriteEnabled && config.accessProfile !== 'read',
  };
}
function saveControlState(next) {
  controlState = {
    webWriteEnabled: next?.webWriteEnabled !== false,
  };
  const temporary = `${controlFile}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(controlState)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, controlFile);
  try { fs.chmodSync(controlFile, 0o600); } catch { /* best effort on non-POSIX filesystems */ }
  return controlSnapshot();
}

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
  if (canonicalExactOrigin(config.publicOrigin) !== config.publicOrigin) {
    console.error('CWEB_PUBLIC_ORIGIN must be an exact http(s) origin with no path, query, fragment, or credentials.');
    process.exit(2);
  }
}
if (config.codexTransport === 'websocket') {
  let parsed;
  try { parsed = new URL(config.codexServerUrl); } catch { parsed = null; }
  if (!parsed || !['ws:', 'wss:'].includes(parsed.protocol) || !isLoopbackHost(parsed.hostname)
      || parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname && parsed.pathname !== '/')) {
    console.error('CWEB_CODEX_SERVER_URL must be a loopback ws(s) URL without credentials, query, fragment, or path.');
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
  transport: config.codexTransport, serverUrl: config.codexServerUrl,
  capabilities: clientCapabilities, timeoutMs: config.rpcTimeoutMs, maxPending: config.maxPendingRpc,
  maxServerRequests: config.maxPendingRpc, maxStdinBufferBytes: config.maxStdinBufferBytes,
  maxLineBytes: config.maxJsonlLineBytes,
});

// Sign the browser session with the private CWEB_TOKEN so a normal service
// restart does not invalidate the page's SSE cookie. The token never enters
// the Codex child environment; logout still records a bounded in-process
// revocation until the cookie expires.
const sessions = new SessionStore(12 * 60 * 60 * 1000, 256, config.token);
const loginRate = new SlidingRateLimit(6, 60_000);
// Each browser gets an independent bounded queue. A slow mobile connection
// must never make another Web tab lose its event stream.
const sseClients = new Map();
// A lost HTTP response must not turn a single accepted turn/start or turn/steer
// into a second upstream request when the client retries with the same official
// clientUserMessageId. This is an in-memory, bounded result cache: it never
// edits Codex history and expires well before a normal browser session.
const TURN_START_DEDUPE_TTL_MS = 10 * 60 * 1000;
const TURN_START_DEDUPE_MAX = 1024;
// No individual SSE frame may consume the entire per-client backpressure
// budget. Oversized official events are represented by compact metadata and
// recovered through authoritative reads.
const SSE_FRAME_SAFETY_MARGIN = 1024;
const sseEventMaxBytes = Math.max(1024, Math.min(
  config.eventMaxBytes,
  config.sseMaxBufferBytes - SSE_FRAME_SAFETY_MARGIN,
));
const turnStartDedupe = new Map();
// `turn/plan/updated` is an event snapshot, not a persisted Turn item. Keep
// only the currently active snapshots so a fresh Web tab can reconstruct the
// official plan after an SSE reconnect without replaying arbitrary history.
const OFFICIAL_PLAN_REPLAY_TTL_MS = 2 * 60 * 60 * 1000;
const OFFICIAL_PLAN_REPLAY_MAX = 256;
const OFFICIAL_PLAN_REPLAY_BYTES = 512 * 1024;
const OFFICIAL_PLAN_TERMINAL_METHODS = new Set(['turn/completed', 'turn/failed', 'turn/error', 'turn/interrupted', 'turn/aborted', 'turn/cancelled', 'turn/canceled', 'turn/stopped']);
const activeOfficialPlans = new Map();
let fatalCodexError = null;
let restartTimer = null;
let restartAttempt = 0;
let eventSequence = 0;
const runtimeBootId = randomUUID();
const runtimeStartedAt = Date.now();
const MACHINE_ONLY_SERVER_REQUESTS = new Set(PLATFORM_ONLY_SERVER_REQUESTS);

function turnStartDedupeKey(method, params) {
  if (method !== 'turn/start' && method !== 'turn/steer') return '';
  const threadId = String(params?.threadId || '');
  const clientUserMessageId = String(params?.clientUserMessageId || '');
  if (!threadId || !clientUserMessageId || clientUserMessageId.length > 256) return '';
  // `turn/start` and `turn/steer` use the same official client id field, but
  // are different operations. Never let a retry of one operation reuse the
  // in-flight promise of the other operation.
  return JSON.stringify([method, threadId, clientUserMessageId]);
}

function pruneTurnStartDedupe(now = Date.now()) {
  for (const [key, entry] of turnStartDedupe) if (entry.expiresAt <= now) turnStartDedupe.delete(key);
  while (turnStartDedupe.size > TURN_START_DEDUPE_MAX) turnStartDedupe.delete(turnStartDedupe.keys().next().value);
}

async function requestOfficial(method, params, signal = null) {
  const key = turnStartDedupeKey(method, params);
  if (!key) return codex.request(method, params, config.rpcTimeoutMs, signal);
  const now = Date.now();
  pruneTurnStartDedupe(now);
  const existing = turnStartDedupe.get(key);
  if (existing && existing.expiresAt > now) {
    turnStartDedupe.delete(key);
    turnStartDedupe.set(key, existing);
    return existing.promise;
  }
  // A browser disconnect must not cancel a turn request after the official
  // runtime may already have accepted it; the client-side message id and this
  // cache are the duplicate-submission boundary for turn/start and turn/steer.
  const entry = { expiresAt: now + TURN_START_DEDUPE_TTL_MS, promise: codex.request(method, params, config.rpcTimeoutMs) };
  turnStartDedupe.set(key, entry);
  pruneTurnStartDedupe(now);
  try { return await entry.promise; }
  catch (error) {
    if (turnStartDedupe.get(key) === entry) turnStartDedupe.delete(key);
    throw error;
  }
}

function officialPlanIdentity(message) {
  const params = message?.params || {};
  const threadId = String(params.threadId || params.thread?.id || params.turn?.threadId || '');
  const turnId = String(params.turnId || params.turn?.id || '');
  return { threadId, turnId, key: threadId && turnId ? `${threadId}:${turnId}` : '' };
}

function pruneOfficialPlanReplay(now = Date.now()) {
  for (const [key, entry] of activeOfficialPlans) if (entry.expiresAt <= now) activeOfficialPlans.delete(key);
  while (activeOfficialPlans.size > OFFICIAL_PLAN_REPLAY_MAX) activeOfficialPlans.delete(activeOfficialPlans.keys().next().value);
}

function rememberOfficialPlanReplay(message) {
  const { threadId, turnId, key } = officialPlanIdentity(message);
  if (!key || !Array.isArray(message?.params?.plan)) return;
  const snapshot = { method: 'turn/plan/updated', params: { ...message.params, threadId, turnId } };
  const bytes = Buffer.byteLength(JSON.stringify(snapshot));
  if (bytes > OFFICIAL_PLAN_REPLAY_BYTES) return;
  activeOfficialPlans.delete(key);
  activeOfficialPlans.set(key, { expiresAt: Date.now() + OFFICIAL_PLAN_REPLAY_TTL_MS, message: snapshot });
  pruneOfficialPlanReplay();
}

function forgetOfficialPlanReplay({ threadId = '', turnId = '' } = {}) {
  const thread = String(threadId || ''), turn = String(turnId || '');
  if (thread && turn) { activeOfficialPlans.delete(`${thread}:${turn}`); return; }
  if (thread) for (const key of activeOfficialPlans.keys()) if (key.startsWith(`${thread}:`)) activeOfficialPlans.delete(key);
  else if (turn) for (const key of activeOfficialPlans.keys()) if (key.endsWith(`:${turn}`)) activeOfficialPlans.delete(key);
}

function officialStatusKey(value) {
  return String(value?.type || value || '').toLowerCase().replace(/[\s_-]/g, '');
}

function observeOfficialPlanLifecycle(message) {
  const method = String(message?.method || ''), params = message?.params || {}, { threadId, turnId } = officialPlanIdentity(message);
  if (method === 'turn/plan/updated') { rememberOfficialPlanReplay(message); return; }
  if (OFFICIAL_PLAN_TERMINAL_METHODS.has(method)) { forgetOfficialPlanReplay({ threadId, turnId }); return; }
  if (method === 'thread/status/changed') {
    const status = params.status || params.state || params.thread?.status;
    if (status && !['active', 'running', 'inprogress', 'working', 'progress'].includes(officialStatusKey(status))) forgetOfficialPlanReplay({ threadId });
  }
}

function activeOfficialPlanNotifications(now = Date.now()) {
  pruneOfficialPlanReplay(now);
  const result = [], budget = OFFICIAL_PLAN_REPLAY_BYTES;
  let bytes = 0;
  for (const entry of activeOfficialPlans.values()) {
    const message = entry.message, size = Buffer.byteLength(JSON.stringify(message));
    if (bytes + size > budget) continue;
    result.push(message); bytes += size;
  }
  return result;
}

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
  if (/^(thread\/(name\/set|metadata\/update|goal\/(set|clear)))$/.test(name)) return 'write';
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

function methodAllowed(method) {
  return accessAllows(method) && (controlState.webWriteEnabled || methodRisk(method) === 'read');
}

function rejectWebWrite(res, method) {
  return json(res, 403, {
    error: 'WEB_WRITE_DISABLED',
    message: '网页写入已关闭；当前页面保持官方历史只读。',
    method,
  });
}

function isActiveWriterRpcError(error) {
  const text = [
    error?.message,
    error?.rpc?.message,
    error?.body?.message,
    error?.body?.rpc?.message,
    error?.body?.rpc?.data?.message,
  ].filter(Boolean).join(' ');
  return /already has an active writer|active writer|currently being written|another (?:official )?client|other official client|thread[^\n]{0,80}(?:being written|is active|has an active)/i.test(text);
}

function eventFrame(type, payload) {
  const event = { type, payload, at: Date.now(), sequence: ++eventSequence };
  const text = JSON.stringify(event);
  const bytes = Buffer.byteLength(text);
  if (bytes <= sseEventMaxBytes) return { event, frame: `id: ${event.sequence}\ndata: ${text}\n\n` };
  const compact = { type: 'eventOversize', payload: { originalType: type, method: payload?.method || null, bytes }, at: Date.now(), sequence: event.sequence };
  return { event: compact, frame: `id: ${compact.sequence}\ndata: ${JSON.stringify(compact)}\n\n` };
}

function removeSseClient(res, { destroy = false } = {}) {
  const client = sseClients.get(res);
  if (client?.drainListener) {
    try { res.off('drain', client.drainListener); } catch { /* response may already be closed */ }
    client.drainListener = null;
  }
  sseClients.delete(res);
  if (destroy && !res.destroyed) {
    try { res.destroy(); } catch { /* already closed */ }
  }
}

function failSseClient(res) {
  removeSseClient(res, { destroy: true });
  return false;
}

function resumeSseClient(client) {
  if (!sseClients.has(client.res)) return;
  client.drainListener = null;
  client.blocked = false;
  while (client.queue.length) {
    const frame = client.queue.shift();
    client.queuedBytes = Math.max(0, client.queuedBytes - Buffer.byteLength(frame));
    try {
      if (!client.res.write(frame)) {
        client.blocked = true;
        client.drainListener = () => resumeSseClient(client);
        client.res.once('drain', client.drainListener);
        return;
      }
    } catch {
      failSseClient(client.res);
      return;
    }
  }
}

function writeSse(res, frame) {
  const client = sseClients.get(res);
  if (!client || res.destroyed || res.writableEnded) return failSseClient(res);
  const bytes = Buffer.byteLength(frame);
  if (bytes > config.sseMaxBufferBytes) return failSseClient(res);
  if (client.blocked || res.writableNeedDrain || res.writableLength > config.sseMaxBufferBytes) {
    if (client.queuedBytes + bytes > config.sseMaxBufferBytes) return failSseClient(res);
    client.queue.push(frame);
    client.queuedBytes += bytes;
    if (!client.drainListener) {
      client.blocked = true;
      client.drainListener = () => resumeSseClient(client);
      res.once('drain', client.drainListener);
    }
    return true;
  }
  try {
    if (!res.write(frame)) {
      client.blocked = true;
      client.drainListener = () => resumeSseClient(client);
      res.once('drain', client.drainListener);
    }
    return true;
  } catch {
    return failSseClient(res);
  }
}

function pushEvent(type, payload) {
  const { frame } = eventFrame(type, payload);
  for (const res of [...sseClients.keys()]) writeSse(res, frame);
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
  // An unavailable dynamic tool is already answered with an official RPC
  // error. Do not surface the host's internal rejection as a fake approval or
  // a protocol card in the human-facing timeline. Configured-but-unregistered
  // tools remain auditable; an entirely unconfigured host stays invisible.
  if (configured) pushEvent('serverRequestUnsupported', {
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
    if (bytes > sseEventMaxBytes) {
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
  observeOfficialPlanLifecycle(message);
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
  activeOfficialPlans.clear();
  console.error(`[codex] child exited pid=${value.pid ?? 'unknown'} code=${value.code ?? 'null'} signal=${value.signal ?? 'null'} killed=${value.killed ? 'yes' : 'no'} pending=${(value.pendingMethods || []).join(',') || 'none'}`);
  pushEvent('codexExit', value);
});
codex.on('ready', (initialize) => { fatalCodexError = null; restartAttempt = 0; pushEvent('codexReady', { initialize }); });
codex.on('crash', (error) => { activeOfficialPlans.clear(); fatalCodexError = error.message; pushEvent('codexError', { message: error.message, code: error.code || null }); scheduleCodexRestart(); });

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
function methodSummary(item) { return { method: item.method, title: item.title, description: item.description, paramsRef: item.paramsRef, managed: item.method === 'initialize' || item.method === 'initialized', risk: methodRisk(item.method), allowed: methodAllowed(item.method) }; }

function requestDisconnectSignal(req, res) {
  const controller = new AbortController();
  const abort = () => { if (!res.writableEnded) controller.abort(); };
  req.once('aborted', abort);
  res.once('close', abort);
  if (req.aborted || res.destroyed) controller.abort();
  return {
    signal: controller.signal,
    cleanup: () => { req.off('aborted', abort); res.off('close', abort); },
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
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };
  res.writeHead(200, secureHeaders({ 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': 'no-store' }));
  fs.createReadStream(target).pipe(res);
  return true;
}

function jsonObjectParams(method, params) {
  if (params === undefined || params === null) return {};
  if (typeof params !== 'object' || Array.isArray(params)) {
    const error = new Error(`Official ${method} params must be a JSON object`);
    error.status = 400;
    error.code = 'INVALID_PARAMS_OBJECT';
    throw error;
  }
  return { ...params };
}

function jsonObjectBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    const error = new Error('JSON request body must be an object');
    error.status = 400;
    error.code = 'INVALID_JSON_OBJECT';
    throw error;
  }
  return body;
}

function methodEnvelope(body) {
  const value = jsonObjectBody(body);
  if (typeof value.method !== 'string' || !value.method.trim() || value.method.length > 256) {
    const error = new Error('JSON-RPC method must be a non-empty string of at most 256 characters');
    error.status = 400;
    error.code = 'INVALID_METHOD';
    throw error;
  }
  return value;
}

function managedParams(method, params) {
  const value = jsonObjectParams(method, params);
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
    const body = jsonObjectBody(await readJson(req, 64 * 1024));
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

  if (pathname === '/api/control' && req.method === 'GET') return json(res, 200, { control: controlSnapshot() });
  if (pathname === '/api/control' && req.method === 'POST') {
    if (!requireOrigin(req, res)) return;
    const body = jsonObjectBody(await readJson(req, 64 * 1024));
    const next = { ...controlState };
    if (typeof body.webWriteEnabled === 'boolean') next.webWriteEnabled = body.webWriteEnabled;
    const control = saveControlState(next);
    pushEvent('controlChanged', { control });
    return json(res, 200, { control });
  }

  if (pathname === '/api/meta' && req.method === 'GET') {
    let initializeResult = codex.initializeResult;
    try { initializeResult = await codex.start(); } catch (error) { fatalCodexError = error.message; scheduleCodexRestart(); }
    return json(res, 200, {
      app: 'codex-app-server-web', version: APP_VERSION, workspace: config.workspace,
      runtime: { bootId: runtimeBootId, startedAt: runtimeStartedAt },
      status: codex.isReady() && !fatalCodexError ? 'ready' : 'degraded', error: fatalCodexError,
      schema: registry.summary(), initializeResult, access: { profile: config.accessProfile }, control: controlSnapshot(), protocolSupport: protocolSupportSummary(),
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
        officialAppServerOnly: true, directCodexStateMutation: false, privateProtocol: false, transport: config.codexTransport,
        persistentOfficialAppServer: config.codexTransport === 'websocket',
        bidirectionalSchemaGate: true, codexEnvironmentSecretsStripped: true, accessPolicyGate: true,
        nativeItemTimeline: true, exactProtocolDispositionSeal: true, openaiFormNative: true,
        mcpAppsAdvertised: config.mcpAppsEnabled, mcpAppsDoubleIframeSandbox: true,
        dynamicToolsExperimentalOnly: true,
        singleWriterReadBoundary: true, webWriteControl: true,
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
    const client = { res, queue: [], queuedBytes: 0, blocked: false, drainListener: null };
    sseClients.set(res, client);
    const connected = eventFrame('connected', { pendingServerRequests: codex.pendingServerRequests().filter((item) => !MACHINE_ONLY_SERVER_REQUESTS.has(item.method)), activePlans: activeOfficialPlanNotifications(), codexReady: codex.isReady(), eventSequence, runtimeBootId, runtimeStartedAt });
    writeSse(res, connected.frame);
    // Comments keep proxies alive but are invisible to EventSource.onmessage.
    // Send a bounded gateway heartbeat as data as well, so every browser can
    // detect a half-open SSE socket without turning transport bookkeeping into
    // a human-facing conversation event.
    const heartbeat = setInterval(() => {
      const { frame } = eventFrame('heartbeat', { runtimeBootId });
      if (!writeSse(res, frame)) clearInterval(heartbeat);
    }, 15_000);
    heartbeat.unref?.();
    const cleanup = () => { clearInterval(heartbeat); removeSseClient(res); };
    res.once('close', cleanup);
    req.once('aborted', cleanup);
    return;
  }
  if (pathname === '/api/rpc' && req.method === 'POST') {
    if (!requireOrigin(req, res)) return;
    const body = methodEnvelope(await readJson(req, config.bodyLimit));
    const descriptor = registry.getRequest(body.method);
    if (!descriptor) return json(res, 400, { error: 'METHOD_NOT_IN_OFFICIAL_SCHEMA', method: body.method });
    if (body.method === 'initialize') return json(res, 400, { error: 'INITIALIZE_IS_MANAGED_BY_GATEWAY' });
    if (!methodAllowed(body.method)) {
      if (!controlState.webWriteEnabled && methodRisk(body.method) !== 'read') return rejectWebWrite(res, body.method);
      return json(res, 403, { error: 'METHOD_BLOCKED_BY_ACCESS_PROFILE', method: body.method, profile: config.accessProfile });
    }
    let result;
    const disconnect = body.method === 'turn/start' || body.method === 'turn/steer' ? null : requestDisconnectSignal(req, res);
    try { result = await requestOfficial(body.method, managedParams(body.method, body.params), disconnect?.signal); }
    catch (error) {
      // A thread owned by another official client is still perfectly readable.
      // Treat every active-writer collision as an explicit read-only conflict
      // instead of leaking the upstream RPC error as a misleading HTTP 502.
      if (isActiveWriterRpcError(error)) {
        return json(res, 409, {
          error: 'THREAD_READ_ONLY',
          message: '该会话正在其他官方客户端运行，网页将以只读方式加载；任务结束后即可继续发送。',
          threadId: String(body.params?.threadId || ''),
        });
      }
      error.requestMethod = body.method;
      throw error;
    } finally { disconnect?.cleanup(); }
    return json(res, 200, { result });
  }
  if (pathname === '/api/notify' && req.method === 'POST') {
    if (!requireOrigin(req, res)) return;
    const body = methodEnvelope(await readJson(req, config.bodyLimit));
    if (body.method === 'initialized') return json(res, 400, { error: 'INITIALIZED_IS_MANAGED_BY_GATEWAY' });
    if (!registry.getNotification(body.method)) return json(res, 400, { error: 'NOTIFICATION_NOT_IN_OFFICIAL_SCHEMA', method: body.method });
    if (!methodAllowed(body.method)) {
      if (!controlState.webWriteEnabled && methodRisk(body.method) !== 'read') return rejectWebWrite(res, body.method);
      return json(res, 403, { error: 'METHOD_BLOCKED_BY_ACCESS_PROFILE', method: body.method, profile: config.accessProfile });
    }
    await codex.notify(body.method, jsonObjectParams(body.method, body.params));
    return json(res, 200, { ok: true });
  }
  if (pathname === '/api/respond' && req.method === 'POST') {
    if (!requireOrigin(req, res)) return;
    const body = jsonObjectBody(await readJson(req, config.bodyLimit));
    const pending = codex.pendingServerRequests().find((item) => String(item.id) === String(body.id));
    if (!pending) return json(res, 404, { error: 'SERVER_REQUEST_NOT_PENDING' });
    if (!registry.getServerRequest(pending.method)) return json(res, 409, { error: 'SERVER_REQUEST_NOT_IN_OFFICIAL_SCHEMA' });
    if (MACHINE_ONLY_SERVER_REQUESTS.has(pending.method)) return json(res, 409, { error: 'PLATFORM_ONLY_SERVER_REQUEST', method: pending.method });
    if (!controlState.webWriteEnabled) return rejectWebWrite(res, `respond:${pending.method}`);
    if (Object.hasOwn(body, 'error')) {
      if (!body.error || typeof body.error !== 'object' || Array.isArray(body.error)) return json(res, 400, { error: 'INVALID_RESPONSE_ERROR' });
      codex.respondError(body.id, body.error);
    } else {
      // Preserve an intentional JSON null result. Omitting result remains a
      // compatibility shorthand for an empty object used by older clients.
      codex.respond(body.id, Object.hasOwn(body, 'result') ? body.result : {});
    }
    return json(res, 200, { ok: true });
  }
  return json(res, 404, { error: 'NOT_FOUND' });
}

function errorStatus(error) {
  if (Number(error.status)) return Number(error.status);
  if (error.code === 'CODEX_RPC_TIMEOUT') return 504;
  if (['CODEX_APP_SERVER_EXITED', 'CODEX_CLIENT_BUSY', 'CODEX_WEBSOCKET_DISCONNECTED', 'WEBSOCKET_UNAVAILABLE'].includes(error.code)) return 503;
  if (error instanceof CodexRpcError) {
    if (/no rollout found for thread id|thread not found|unknown thread/i.test(String(error.rpc?.message || error.message || ''))) return 404;
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
    if (res.destroyed || res.writableEnded) return;
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
  console.log(`Official transport: ${config.codexTransport}${config.codexTransport === 'websocket' ? ` ${config.codexServerUrl}` : ''}`);
  console.log(`MCP Apps Host: ${config.mcpAppsEnabled ? 'enabled' : 'disabled'}; Dynamic Tool Host: ${dynamicToolHost.size} configured`);
  try { await codex.start(); }
  catch (error) { fatalCodexError = error.message; console.error(`Codex App Server failed: ${error.message}`); scheduleCodexRestart(); }
});

function shutdown(signal) {
  console.log(`Shutting down (${signal})`);
  if (restartTimer) clearTimeout(restartTimer);
  pushEvent('webRestarting', { reason: 'service-shutdown', runtimeBootId });
  for (const res of [...sseClients.keys()]) {
    removeSseClient(res);
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
