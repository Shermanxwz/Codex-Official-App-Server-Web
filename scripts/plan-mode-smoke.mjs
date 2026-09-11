import crypto from 'node:crypto';
import { buildCollaborationMode } from '../public/plan-mode-state.js';

const base = new URL(process.env.CWEB_GATEWAY_URL || 'http://127.0.0.1:4173');
const origin = String(process.env.CWEB_GATEWAY_ORIGIN || base.origin);
const token = String(process.env.CWEB_GATEWAY_TOKEN || '');
const timeoutMs = Math.max(30_000, Math.min(120_000, Number(process.env.CWEB_GATEWAY_TIMEOUT_MS) || 60_000));

if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || (base.pathname && base.pathname !== '/')) {
  throw new Error('CWEB_GATEWAY_URL must be an exact http(s) origin');
}
if (new URL(origin).origin !== origin) throw new Error('CWEB_GATEWAY_ORIGIN must be a canonical exact origin');
if (token.length < 32) throw new Error('CWEB_GATEWAY_TOKEN is required and must contain at least 32 characters');

let cookie = '';
let threadId = '';
let deleted = false;
let stream = null;

function url(pathname) { return new URL(pathname, base).href; }
async function fetchWithTimeout(pathname, options = {}, duration = timeoutMs) {
  return fetch(url(pathname), { redirect: 'error', ...options, signal: AbortSignal.timeout(duration) });
}
async function json(response) { try { return await response.json(); } catch { return {}; } }
async function rpc(method, params = {}, duration = timeoutMs) {
  const response = await fetchWithTimeout('/api/rpc', {
    method: 'POST', headers: { 'content-type': 'application/json', origin, cookie },
    body: JSON.stringify({ method, params }),
  }, duration);
  const value = await json(response);
  if (!response.ok) throw new Error(`${method} failed with HTTP ${response.status}: ${value.error || value.message || 'unknown error'}`);
  return value.result;
}
function rows(result) { return Array.isArray(result) ? result : result?.data || result?.items || []; }
function notificationThreadId(event) {
  const params = event?.payload?.params || {};
  return String(params.threadId || params.thread?.id || params.threadSettings?.threadId || '');
}
function notificationMode(event) {
  const params = event?.payload?.params || {};
  const candidate = params.threadSettings?.collaborationMode
    ?? params.threadSettings?.collaboration_mode
    ?? params.collaborationMode
    ?? params.collaboration_mode;
  return candidate === null ? 'default' : String(candidate?.mode || '');
}
function createSse(response) {
  const reader = response.body.getReader(), decoder = new TextDecoder();
  const events = [], waiters = [];
  let buffer = '', closed = false, failure = null;
  function publish(event) {
    events.push(event); if (events.length > 2_048) events.shift();
    for (const waiter of [...waiters]) {
      if (!waiter.predicate(event)) continue;
      waiters.splice(waiters.indexOf(waiter), 1); clearTimeout(waiter.timer); waiter.resolve(event);
    }
  }
  function finish(error = null) {
    closed = true; failure = error;
    for (const waiter of waiters.splice(0)) { clearTimeout(waiter.timer); waiter.reject(error || new Error('SSE stream closed')); }
  }
  void (async () => {
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) { finish(); return; }
        buffer += decoder.decode(chunk.value, { stream: true });
        for (;;) {
          const boundary = buffer.indexOf('\n\n'); if (boundary < 0) break;
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
      const existing = events.find(predicate); if (existing) return Promise.resolve(existing);
      if (closed) return Promise.reject(failure || new Error(`SSE stream closed before ${label}`));
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, reject, timer: null };
        waiter.timer = setTimeout(() => { const index = waiters.indexOf(waiter); if (index >= 0) waiters.splice(index, 1); reject(new Error(`Timed out waiting for ${label}`)); }, duration);
        waiters.push(waiter);
      });
    },
    async close() { try { await reader.cancel(); } catch { /* already closed */ } },
  };
}

try {
  const login = await fetchWithTimeout('/api/login', {
    method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ token }),
  });
  const setCookie = login.headers.get('set-cookie') || '';
  cookie = setCookie.split(';', 1)[0];
  if (!login.ok || !cookie) throw new Error(`Gateway login failed with HTTP ${login.status}`);

  const metaResponse = await fetchWithTimeout('/api/meta', { headers: { cookie } });
  const meta = await json(metaResponse);
  if (!metaResponse.ok || meta.status !== 'ready') throw new Error('Gateway meta is not ready');
  const methodsResponse = await fetchWithTimeout('/api/methods', { headers: { cookie } });
  const methods = await json(methodsResponse);
  if (!methods.requests?.some((item) => item.method === 'thread/settings/update')) throw new Error('Official thread/settings/update is unavailable');

  const eventsResponse = await fetchWithTimeout('/api/events', { headers: { cookie } }, 30_000);
  if (!eventsResponse.ok) throw new Error(`Gateway SSE failed with HTTP ${eventsResponse.status}`);
  stream = createSse(eventsResponse);
  await stream.waitFor((event) => event.type === 'connected', 'SSE connected', 30_000);

  const models = await rpc('model/list', {}), model = rows(models)[0]?.id || meta.model || 'gpt-5';
  const started = await rpc('thread/start', {
    cwd: meta.workspace, approvalPolicy: 'never', sandbox: 'read-only', historyMode: 'paginated',
    serviceName: `codex_plan_mode_smoke_${crypto.randomUUID().slice(0, 8)}`,
  });
  threadId = String((started?.thread || started)?.id || '');
  if (!threadId) throw new Error('Plan-mode smoke thread/start returned no thread id');

  const waitForMode = (mode) => stream.waitFor((event) => event.type === 'notification'
    && event.payload?.method === 'thread/settings/updated'
    && notificationThreadId(event) === threadId
    && notificationMode(event) === mode, `thread/settings/updated(${mode})`, 30_000);
  await rpc('thread/settings/update', { threadId, collaborationMode: buildCollaborationMode('plan', model, null) });
  const planEvent = await waitForMode('plan');
  await rpc('thread/settings/update', { threadId, collaborationMode: buildCollaborationMode('default', model, null) });
  const defaultEvent = await waitForMode('default');
  await rpc('thread/delete', { threadId }); deleted = true;

  console.log(JSON.stringify({ ok: true, target: base.origin, threadId, model, transitions: {
    plan: planEvent.payload.method, default: defaultEvent.payload.method,
  }, cleanup: 'thread/delete + logout' }, null, 2));
  console.log('PLAN_MODE_CLOSED_LOOP_SMOKE_OK');
} finally {
  if (threadId && !deleted) { try { await rpc('thread/delete', { threadId }, 30_000); } catch (error) { console.error(`WARNING: plan-mode smoke cleanup failed: ${error.message}`); } }
  if (stream) await stream.close();
  if (cookie) { try { await fetchWithTimeout('/api/logout', { method: 'POST', headers: { origin, cookie } }, 30_000); } catch { /* session expires independently */ } }
}
