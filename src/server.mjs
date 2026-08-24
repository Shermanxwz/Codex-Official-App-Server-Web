import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.mjs';
import { CodexAppServer } from './codex-client.mjs';
import { OfficialSchemaRegistry } from './schema-registry.mjs';
import {
  SessionStore, SlidingRateLimit, isLoopbackHost, json, parseCookies,
  readJson, safeEqualText, sameOrigin, secureHeaders,
} from './security.mjs';

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

const codex = new CodexAppServer({
  codexBin: config.codexBin,
  cwd: config.workspace,
  experimental: config.experimental,
  timeoutMs: config.rpcTimeoutMs,
});
const sessions = new SessionStore();
const loginRate = new SlidingRateLimit(6, 60_000);
const sseClients = new Set();
const recentEvents = [];
let fatalCodexError = null;

function pushEvent(type, payload) {
  const event = { type, payload, at: Date.now() };
  recentEvents.push(event);
  if (recentEvents.length > 300) recentEvents.splice(0, recentEvents.length - 300);
  const frame = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of [...sseClients]) {
    try { res.write(frame); } catch { sseClients.delete(res); }
  }
}

codex.on('message', (message) => pushEvent(message.id !== undefined ? 'serverRequest' : 'notification', message));
codex.on('stderr', (line) => {
  const text = String(line).trim();
  if (text) console.error(`[codex] ${text.slice(0, 4000)}`);
});
codex.on('protocolError', (value) => pushEvent('protocolError', value));
codex.on('exit', (value) => pushEvent('codexExit', value));
codex.on('error', (error) => {
  fatalCodexError = error.message;
  pushEvent('codexError', { message: error.message });
});

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
    paramsSchema: item.paramsSchema,
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
    'Cache-Control': path.extname(target) === '.html' ? 'no-store' : 'public, max-age=3600',
  }));
  fs.createReadStream(target).pipe(res);
  return true;
}

async function api(req, res, pathname) {
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
    let initializeResult = null;
    try { initializeResult = await codex.start(); } catch (error) { fatalCodexError = error.message; }
    return json(res, 200, {
      app: 'codex-app-server-web',
      version: '0.1.0',
      workspace: config.workspace,
      status: fatalCodexError ? 'degraded' : 'ready',
      error: fatalCodexError,
      schema: registry.summary(),
      initializeResult,
      contract: {
        officialAppServerOnly: true,
        directCodexStateMutation: false,
        privateProtocol: false,
        transport: 'stdio',
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

  if (pathname === '/api/events' && req.method === 'GET') {
    res.writeHead(200, secureHeaders({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    }));
    res.write(`data: ${JSON.stringify({
      type: 'connected',
      payload: { pendingServerRequests: codex.pendingServerRequests(), recentEvents: recentEvents.slice(-100) },
      at: Date.now(),
    })}\n\n`);
    sseClients.add(res);
    const heartbeat = setInterval(() => {
      try { res.write(`: ping ${Date.now()}\n\n`); }
      catch { clearInterval(heartbeat); sseClients.delete(res); }
    }, 15_000);
    req.on('close', () => { clearInterval(heartbeat); sseClients.delete(res); });
    return;
  }

  if (pathname === '/api/rpc' && req.method === 'POST') {
    if (!requireOrigin(req, res)) return;
    const body = await readJson(req, config.bodyLimit);
    const descriptor = registry.getRequest(body.method);
    if (!descriptor) return json(res, 400, { error: 'METHOD_NOT_IN_OFFICIAL_SCHEMA', method: body.method });
    const result = await codex.request(body.method, body.params ?? {});
    return json(res, 200, { result });
  }

  if (pathname === '/api/notify' && req.method === 'POST') {
    if (!requireOrigin(req, res)) return;
    const body = await readJson(req, config.bodyLimit);
    if (body.method === 'initialized') return json(res, 400, { error: 'INITIALIZED_IS_MANAGED_BY_GATEWAY' });
    const descriptor = registry.getNotification(body.method);
    if (!descriptor) return json(res, 400, { error: 'NOTIFICATION_NOT_IN_OFFICIAL_SCHEMA', method: body.method });
    await codex.notify(body.method, body.params ?? {});
    return json(res, 200, { ok: true });
  }

  if (pathname === '/api/respond' && req.method === 'POST') {
    if (!requireOrigin(req, res)) return;
    const body = await readJson(req, config.bodyLimit);
    if (body.error) codex.respondError(body.id, body.error);
    else codex.respond(body.id, body.result ?? {});
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: 'NOT_FOUND' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await api(req, res, url.pathname);
    if (serveStatic(req, res, url.pathname)) return;
    res.writeHead(404, secureHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
    res.end('Not found');
  } catch (error) {
    console.error(error);
    json(res, Number(error.status) || 500, { error: error.code || 'INTERNAL_ERROR', message: error.message });
  }
});

server.listen(config.port, config.host, async () => {
  console.log(`Codex App Server Web listening on http://${config.host}:${config.port}`);
  console.log(`Codex: ${registry.version}`);
  console.log(`Official schema: ${registry.digest.slice(0, 16)} (${registry.requests.length} requests)`);
  try { await codex.start(); } catch (error) { console.error(`Codex App Server failed: ${error.message}`); }
});

function shutdown(signal) {
  console.log(`Shutting down (${signal})`);
  server.close(() => process.exit(0));
  codex.close();
  setTimeout(() => process.exit(1), 5_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
