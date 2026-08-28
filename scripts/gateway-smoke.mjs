import crypto from 'node:crypto';

const base = new URL(process.env.CWEB_GATEWAY_URL || 'http://127.0.0.1:4173');
const origin = String(process.env.CWEB_GATEWAY_ORIGIN || base.origin);
const token = String(process.env.CWEB_GATEWAY_TOKEN || '');
const runModelTurn = /^(1|true|yes)$/i.test(process.env.CWEB_GATEWAY_MODEL_TURN || '');
const timeoutMs = Math.max(30_000, Math.min(600_000, Number(process.env.CWEB_GATEWAY_TIMEOUT_MS) || 300_000));
const sentinel = `CWEB_GATEWAY_SMOKE_OK_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;

if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || (base.pathname && base.pathname !== '/')) {
  throw new Error('CWEB_GATEWAY_URL must be an exact http(s) origin');
}
if (new URL(origin).origin !== origin) throw new Error('CWEB_GATEWAY_ORIGIN must be a canonical exact origin');
if (!['127.0.0.1', '::1', 'localhost'].includes(base.hostname) && base.origin !== origin) {
  throw new Error('A non-loopback gateway URL must exactly match CWEB_GATEWAY_ORIGIN');
}
if (token.length < 32) throw new Error('CWEB_GATEWAY_TOKEN is required and must contain at least 32 characters');

let cookie = '';
let threadId = '';
let turnId = '';
let turnTerminal = false;
let deleted = false;
let stream = null;

function url(pathname) { return new URL(pathname, base).href; }

async function timedFetch(pathname, options = {}, duration = timeoutMs) {
  return fetch(url(pathname), {
    redirect: 'error',
    ...options,
    signal: AbortSignal.timeout(duration),
  });
}

async function streamFetch(pathname, options = {}, duration = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), duration);
  try { return await fetch(url(pathname), { redirect: 'error', ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function body(response) {
  try { return await response.json(); } catch { return {}; }
}

async function rpc(method, params = {}, duration = timeoutMs) {
  const response = await timedFetch('/api/rpc', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, cookie },
    body: JSON.stringify({ method, params }),
  }, duration);
  const value = await body(response);
  if (!response.ok) {
    const error = new Error(`${method} failed with HTTP ${response.status}: ${value.error || value.message || 'unknown error'}`);
    error.status = response.status;
    error.body = value;
    throw error;
  }
  return value.result;
}

function rows(result) {
  if (Array.isArray(result)) return result;
  return result?.data || result?.items || result?.turns || [];
}

function notificationThreadId(message) {
  const params = message?.params || {};
  return String(params.threadId || params.thread?.id || params.turn?.threadId || '');
}

function notificationTurnId(message) {
  const params = message?.params || {};
  return String(params.turnId || params.turn?.id || '');
}

function statusKey(value) {
  return String(value?.type || value || '').toLowerCase().replace(/[\s_-]/g, '');
}

async function delay(ms) { await new Promise((resolve) => setTimeout(resolve, ms)); }

function createSse(response) {
  const reader = response.body.getReader(), decoder = new TextDecoder();
  const events = [], waiters = [];
  let buffer = '', closed = false, failure = null;
  function publish(event) {
    events.push(event);
    if (events.length > 2_048) events.shift();
    for (const waiter of [...waiters]) {
      if (!waiter.predicate(event)) continue;
      waiters.splice(waiters.indexOf(waiter), 1);
      clearTimeout(waiter.timer);
      waiter.resolve(event);
    }
  }
  function finish(error = null) {
    closed = true; failure = error;
    for (const waiter of waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error || new Error('SSE stream closed'));
    }
  }
  void (async () => {
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) { finish(); return; }
        buffer += decoder.decode(chunk.value, { stream: true });
        for (;;) {
          const boundary = buffer.indexOf('\n\n');
          if (boundary < 0) break;
          const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
          if (data) publish(JSON.parse(data));
        }
      }
    } catch (error) { finish(error); }
  })();
  return {
    events,
    waitFor(predicate, label, duration = timeoutMs) {
      const existing = events.find(predicate);
      if (existing) return Promise.resolve(existing);
      if (closed) return Promise.reject(failure || new Error(`SSE stream closed before ${label}`));
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, reject, timer: null };
        waiter.timer = setTimeout(() => {
          const index = waiters.indexOf(waiter); if (index >= 0) waiters.splice(index, 1);
          reject(new Error(`Timed out waiting for ${label}`));
        }, duration);
        waiters.push(waiter);
      });
    },
    async close() { try { await reader.cancel(); } catch { /* already closed */ } },
  };
}

async function persistedItems(targetTurnId) {
  const collected = [];
  let cursor = null;
  for (let page = 0; page < 100; page += 1) {
    const result = await rpc('thread/items/list', {
      threadId, turnId: targetTurnId, limit: 100, sortDirection: 'asc', ...(cursor ? { cursor } : {}),
    });
    collected.push(...rows(result).map((entry) => entry?.item || entry));
    cursor = result?.nextCursor || result?.next_cursor || null;
    if (!cursor) return collected;
  }
  throw new Error('thread/items/list exceeded its 100-page gateway smoke bound');
}

async function persistedTurn(targetTurnId) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const turns = await rpc('thread/turns/list', { threadId, limit: 10, sortDirection: 'desc', itemsView: 'notLoaded' });
    const found = rows(turns).find((item) => String(item?.id || '') === targetTurnId);
    if (found) return found;
    await delay(500);
  }
  throw new Error('Gateway completed Turn is absent from thread/turns/list');
}

try {
  const login = await timedFetch('/api/login', {
    method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ token }),
  });
  const setCookie = login.headers.get('set-cookie') || '';
  cookie = setCookie.split(';', 1)[0];
  if (!login.ok || !cookie) throw new Error(`Gateway login failed with HTTP ${login.status}`);
  if (base.protocol === 'https:' && !/;\s*Secure/i.test(setCookie)) throw new Error('HTTPS gateway session cookie is missing Secure');
  for (const marker of [/;\s*HttpOnly/i, /;\s*SameSite=Strict/i]) if (!marker.test(setCookie)) throw new Error('Gateway session cookie is missing a sealed security attribute');

  const wrongOrigin = await timedFetch('/api/control', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://origin-rejection.invalid', cookie }, body: '{}',
  });
  if (wrongOrigin.status !== 403) throw new Error(`Wrong-origin write returned HTTP ${wrongOrigin.status}, expected 403`);

  const metaResponse = await timedFetch('/api/meta', { headers: { cookie } });
  const meta = await body(metaResponse);
  if (!metaResponse.ok || meta.status !== 'ready') throw new Error(`Gateway meta is not ready (HTTP ${metaResponse.status})`);
  if (meta.protocolSupport?.serverNotificationFallback !== 'official-event-log') throw new Error('Gateway is missing the official notification fallback seal');
  if (meta.contract?.persistentOfficialAppServer !== true) throw new Error('Gateway is not using the persistent official App Server');

  const methodsResponse = await timedFetch('/api/methods', { headers: { cookie } });
  const methods = await body(methodsResponse);
  if (!methodsResponse.ok || !methods.requests?.some((item) => item.method === 'thread/turns/list') || !methods.requests?.some((item) => item.method === 'thread/items/list')) {
    throw new Error('Gateway official method inventory is missing paginated history');
  }

  const eventsResponse = await streamFetch('/api/events', { headers: { cookie } }, 30_000);
  if (!eventsResponse.ok || !String(eventsResponse.headers.get('content-type')).startsWith('text/event-stream')) throw new Error(`Gateway SSE failed with HTTP ${eventsResponse.status}`);
  stream = createSse(eventsResponse);
  const connected = await stream.waitFor((event) => event.type === 'connected', 'SSE connected', 30_000);

  const account = await rpc('account/read', {}), models = await rpc('model/list', {});
  if (!account?.account && account?.requiresOpenaiAuth !== false) throw new Error('Gateway official account is not usable');
  if (!rows(models).length) throw new Error('Gateway official model/list returned no models');

  const started = await rpc('thread/start', {
    cwd: meta.workspace,
    approvalPolicy: 'never',
    sandbox: 'read-only',
    historyMode: 'paginated',
    serviceName: 'codex_app_server_web_gateway_smoke',
  });
  const thread = started?.thread || started;
  threadId = String(thread?.id || '');
  if (!threadId || thread?.historyMode !== 'paginated') throw new Error(`Gateway thread/start did not return paginated history (${thread?.historyMode || 'missing'})`);
  const read = await rpc('thread/read', { threadId, includeTurns: false });
  if ((read?.thread || read)?.historyMode !== 'paginated') throw new Error('Gateway thread/read lost paginated history mode');

  let modelTurn = null;
  if (runModelTurn) {
    const turn = await rpc('turn/start', {
      threadId,
      input: [{ type: 'text', text: `Reply with exactly ${sentinel}. Do not use tools or add any other text.` }],
      clientUserMessageId: `cweb-gateway-smoke-${crypto.randomUUID()}`,
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'readOnly' },
    });
    turnId = String(turn?.turn?.id || turn?.id || '');
    if (!turnId) throw new Error('Gateway turn/start returned no Turn id');
    const completed = await stream.waitFor((event) => event.type === 'notification'
      && event.payload?.method === 'turn/completed'
      && notificationThreadId(event.payload) === threadId
      && notificationTurnId(event.payload) === turnId, `turn/completed for ${turnId}`);
    turnTerminal = true;
    const status = statusKey(completed.payload?.params?.turn?.status || completed.payload?.params?.status);
    if (status && !['completed', 'success'].includes(status)) throw new Error(`Gateway model Turn ended with ${status}`);
    await persistedTurn(turnId);
    let items = [], agentText = '';
    for (let attempt = 0; attempt < 30; attempt += 1) {
      items = await persistedItems(turnId);
      agentText = items.filter((item) => item?.type === 'agentMessage').map((item) => String(item?.text || '')).join('\n');
      if (agentText.includes(sentinel)) break;
      await delay(500);
    }
    if (!agentText.includes(sentinel)) throw new Error('Gateway persisted assistant response did not contain the unique sentinel');
    modelTurn = { completed: true, persisted: true, items: items.length, agentMessageVerified: true };
  }

  const heartbeat = await stream.waitFor((event) => event.type === 'heartbeat', 'SSE heartbeat', 25_000);
  await rpc('thread/delete', { threadId }); deleted = true;
  console.log(JSON.stringify({
    ok: true,
    target: base.origin,
    cloudflare: Boolean(metaResponse.headers.get('cf-ray')),
    codexVersion: meta.schema?.codexVersion || meta.schema?.version || null,
    officialRequests: methods.requests.length,
    officialServerNotifications: methods.serverNotifications?.length || 0,
    accountType: account?.account?.type || 'configured',
    models: rows(models).length,
    historyMode: 'paginated',
    historyMethods: ['thread/turns/list', 'thread/items/list'],
    notificationFallback: meta.protocolSupport.serverNotificationFallback,
    sse: { connected: Boolean(connected), heartbeat: Boolean(heartbeat) },
    modelTurn,
    cleanup: 'thread/delete + logout',
  }, null, 2));
  console.log(runModelTurn ? 'GATEWAY_MODEL_TURN_SMOKE_OK' : 'GATEWAY_PROTOCOL_SMOKE_OK');
} finally {
  if (threadId && !deleted) {
    if (turnId && !turnTerminal) {
      try { await rpc('turn/interrupt', { threadId, turnId }, 30_000); } catch { /* best effort before thread cleanup */ }
    }
    try { await rpc('thread/delete', { threadId }, 30_000); } catch (error) { console.error(`WARNING: gateway smoke thread cleanup failed: ${error.message}`); }
  }
  if (stream) await stream.close();
  if (cookie) {
    try { await timedFetch('/api/logout', { method: 'POST', headers: { origin, cookie } }, 30_000); } catch { /* session expires independently */ }
  }
}
