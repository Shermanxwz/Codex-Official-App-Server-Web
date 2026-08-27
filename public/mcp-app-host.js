import {
  MCP_APPS_PROTOCOL_VERSION, buildGrantedPermissions, buildIframeAllow, jsonRpcEnvelope,
  normalizeResourceCsp, safeExternalUrl, toolVisibleToApp, validateMcpAppResource,
} from './mcp-app-core.js';
import { sandboxProxyDataUrl } from './mcp-sandbox-proxy.js';

const MAX_SESSIONS = 32;
const MAX_SESSION_REQUESTS = 32;
const MAX_INVENTORY_CACHE = 64;
const MAX_INVENTORY_ITEMS = 1000;
const MAX_INVENTORY_PAGES = 20;
const MAX_SLOT_HEIGHT = 1200;
const MCP_RPC_TIMEOUT_MS = 45_000;
const nativeFetch = window.fetch.bind(window);
const items = new Map();
const sessions = new Map();
const inventoryCache = new Map();
const inventoryInFlight = new Map();
const mountInFlight = new Map();
let eventSource = null;
let eventWatchdog = null;
let eventLastMessageAt = 0;
let metaPromise = null;

const css = document.createElement('link');
css.rel = 'stylesheet';
css.href = '/mcp-app.css';
document.head.append(css);

async function fetchWithTimeout(input, init = {}, timeoutMs = MCP_RPC_TIMEOUT_MS) {
  const callerSignal = init.signal;
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(callerSignal?.reason);
  if (callerSignal) {
    if (callerSignal.aborted) forwardAbort();
    else callerSignal.addEventListener('abort', forwardAbort, { once: true });
  }
  const timer = window.setTimeout(() => controller.abort(), Math.max(0, Number(timeoutMs) || MCP_RPC_TIMEOUT_MS));
  try { return await nativeFetch(input, { ...init, signal: controller.signal }); }
  finally { window.clearTimeout(timer); callerSignal?.removeEventListener('abort', forwardAbort); }
}

function rpc(method, params = {}, options = {}) {
  return fetchWithTimeout('/api/rpc', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params }),
    signal: options.signal,
  }, options.timeoutMs).then(async (response) => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(body.message || body.error || `HTTP ${response.status}`); error.status = response.status; error.body = body; throw error; }
    return body.result;
  });
}

function meta() {
  if (!metaPromise) metaPromise = fetchWithTimeout('/api/meta', { credentials: 'same-origin' }).then((r) => r.ok ? r.json() : {}).catch((error) => { metaPromise = null; return {}; });
  return metaPromise;
}

function permissionAllowMap(list) {
  return Object.fromEntries((Array.isArray(list) ? list : []).map((key) => [key, true]));
}

function resourceUri(item) {
  const value = item?.appContext?.resourceUri || item?.mcpAppResourceUri || null;
  return typeof value === 'string' && value.startsWith('ui://') ? value : null;
}

function callKey(item) { return String(item?.id || ''); }

function threadItems(thread) {
  const out = [];
  for (const turn of thread?.turns || []) for (const item of turn?.items || []) out.push(item);
  return out;
}

function captureThread(thread) {
  if (!thread?.id) return;
  for (const item of threadItems(thread)) captureItem(item, thread.id);
}

function captureItem(item, threadId) {
  if (item?.type !== 'mcpToolCall' || !item.id) return;
  const id = callKey(item);
  const prior = items.get(id);
  const record = { item: structuredClone(item), threadId: threadId || prior?.threadId || null };
  items.set(id, record);
  const session = sessions.get(id);
  if (session) {
    session.item = record.item;
    session.threadId = record.threadId;
    if (session.initialized) sendToolState(session);
    if (session.resourceUri !== resourceUri(item)) teardown(id, 'resource-changed');
  }
  scheduleMount(id);
}

function inspectRpcResponse(requestBody, body) {
  const method = requestBody?.method;
  const result = body?.result;
  if (!method || !result) return;
  if (method === 'thread/read' || method === 'thread/start' || method === 'thread/resume' || method === 'thread/fork') {
    captureThread(result.thread || result);
  }
}

window.fetch = async function cwebMcpAwareFetch(input, init) {
  const response = await nativeFetch(input, init);
  try {
    const url = new URL(typeof input === 'string' ? input : input?.url || '', location.href);
    if (url.pathname === '/api/session') {
      response.clone().json().then((body) => { if (!body.authRequired || body.authenticated) startEvents(); }).catch(() => {});
    } else if (url.pathname === '/api/login' && response.ok) {
      startEvents();
    } else if (url.pathname === '/api/rpc' && init?.body) {
      const requestBody = typeof init.body === 'string' ? JSON.parse(init.body) : null;
      response.clone().json().then((body) => inspectRpcResponse(requestBody, body)).catch(() => {});
    }
  } catch { /* observation must never affect product fetches */ }
  return response;
};

function startEvents() {
  if (eventSource) return;
  eventSource = new EventSource('/api/events', { withCredentials: true });
  eventLastMessageAt = Date.now();
  eventSource.onmessage = (event) => {
    eventLastMessageAt = Date.now();
    let envelope;
    try { envelope = JSON.parse(event.data); } catch { return; }
    if (envelope.type !== 'notification') return;
    const message = envelope.payload;
    if (!['item/started', 'item/completed'].includes(message?.method)) return;
    captureItem(message.params?.item, message.params?.threadId);
  };
  eventSource.onopen = () => { eventLastMessageAt = Date.now(); };
  eventSource.onerror = () => {};
  if (eventWatchdog) clearInterval(eventWatchdog);
  eventWatchdog = setInterval(() => {
    if (!eventSource || Date.now() - eventLastMessageAt <= 35_000) return;
    eventSource.close(); eventSource = null; startEvents();
  }, 5_000);
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) return CSS.escape(value);
  return String(value).replace(/[^A-Za-z0-9_-]/g, (char) => `\\${char.codePointAt(0).toString(16)} `);
}

function scheduleMount(id, attempt = 0) {
  queueMicrotask(() => {
    const card = document.querySelector(`[data-item-id="${cssEscape(id)}"]`);
    if (card) { mount(id, card).catch((error) => showError(card, error)); return; }
    if (attempt < 12) setTimeout(() => scheduleMount(id, attempt + 1), 50 * (attempt + 1));
  });
}

function showError(card, error) {
  let slot = card.querySelector('.mcp-app-slot');
  if (!slot) { slot = document.createElement('div'); slot.className = 'mcp-app-slot'; card.append(slot); }
  const node = document.createElement('div');
  node.className = 'mcp-app-error';
  node.textContent = `MCP App: ${error?.message || error}`;
  slot.replaceChildren(node);
}

async function paged(method, params, key) {
  const all = [];
  const seenCursors = new Set();
  let cursor = null;
  for (let page = 0; page < MAX_INVENTORY_PAGES; page += 1) {
    const result = await rpc(method, { ...params, ...(cursor ? { cursor } : {}), limit: 100 });
    const values = Array.isArray(result?.[key]) ? result[key] : [];
    all.push(...values.slice(0, Math.max(0, MAX_INVENTORY_ITEMS - all.length)));
    if (all.length >= MAX_INVENTORY_ITEMS || !result?.nextCursor) break;
    const next = String(result.nextCursor);
    if (seenCursors.has(next) || next === String(cursor || '')) break;
    seenCursors.add(next); cursor = result.nextCursor;
  }
  return all;
}

async function inventory(threadId, server) {
  const key = `${threadId || ''}\u0000${server}`;
  const cached = inventoryCache.get(key);
  if (cached && Date.now() - cached.at < 30_000) return cached.value;
  const pending = inventoryInFlight.get(key);
  if (pending) return pending;
  const task = (async () => {
    const servers = await paged('mcpServerStatus/list', { detail: 'full', ...(threadId ? { threadId } : {}) }, 'data');
    const value = servers.find((entry) => entry?.name === server) || null;
    if (!value) throw new Error(`MCP server is not available: ${server}`);
    inventoryCache.set(key, { at: Date.now(), value });
    while (inventoryCache.size > MAX_INVENTORY_CACHE) inventoryCache.delete(inventoryCache.keys().next().value);
    return value;
  })();
  inventoryInFlight.set(key, task);
  try { return await task; }
  finally { if (inventoryInFlight.get(key) === task) inventoryInFlight.delete(key); }
}

function listingUiMeta(serverInfo, uri) {
  const resource = (serverInfo?.resources || []).find((entry) => entry?.uri === uri);
  return resource?._meta?.ui || resource?.meta?.ui || {};
}

async function readUiResource(record, knownServerInfo = null) {
  const item = record.item;
  const uri = resourceUri(item);
  if (!uri) throw new Error('MCP tool call has no ui:// App resource');
  const params = {
    ...(record.threadId ? { threadId: record.threadId } : {}),
    originCallId: item.id,
    server: item.server,
    uri,
    ...(item.appContext?.connectorId ? { connectorId: item.appContext.connectorId } : {}),
  };
  const [result, serverInfo] = await Promise.all([rpc('mcpServer/resource/read', params), knownServerInfo ? Promise.resolve(knownServerInfo) : inventory(record.threadId, item.server)]);
  const content = (result?.contents || []).find((entry) => entry?.uri === uri);
  if (!content) throw new Error(`MCP App resource not returned: ${uri}`);
  const validated = validateMcpAppResource(content, uri);
  const listingMeta = listingUiMeta(serverInfo, uri);
  validated.meta = { ...listingMeta, ...validated.meta };
  return { validated, serverInfo };
}

function toolFromInventory(serverInfo, name) {
  const tool = serverInfo?.tools?.[name];
  if (!tool) throw new Error(`MCP tool is not in server inventory: ${name}`);
  return tool;
}

function post(session, message) {
  if (!session.frame?.contentWindow) return;
  session.frame.contentWindow.postMessage(message, '*');
}

function response(id, result) { return { jsonrpc: '2.0', id, result }; }
function rpcError(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }
function notification(method, params = {}) { return { jsonrpc: '2.0', method, params }; }

function theme() { return matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light'; }

function hostContext(session) {
  return {
    toolInfo: { id: session.item.id, tool: session.tool },
    theme: theme(), displayMode: 'inline', availableDisplayModes: ['inline'],
    containerDimensions: { maxWidth: session.slot.clientWidth || 1000, maxHeight: MAX_SLOT_HEIGHT },
    locale: navigator.language || 'en',
    timeZone: (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; } })(),
    userAgent: navigator.userAgent, platform: 'web',
    deviceCapabilities: { touch: navigator.maxTouchPoints > 0, hover: matchMedia?.('(hover:hover)')?.matches ?? false },
  };
}

function sendToolState(session) {
  if (!session.initialized) return;
  if (!session.inputSent) {
    post(session, notification('ui/notifications/tool-input', { arguments: session.item.arguments || {} }));
    session.inputSent = true;
  }
  if (!session.resultSent && session.item.result) {
    post(session, notification('ui/notifications/tool-result', session.item.result));
    session.resultSent = true;
  } else if (!session.resultSent && session.item.error) {
    post(session, notification('ui/notifications/tool-cancelled', { reason: session.item.error.message || 'MCP tool call failed' }));
    session.resultSent = true;
  }
}

async function callServerTool(session, params) {
  if (!recordThreadId(session)) throw new Error('MCP App tool calls require a thread id');
  const name = String(params?.name || '');
  const info = await inventory(session.threadId, session.item.server);
  const tool = toolFromInventory(info, name);
  if (!toolVisibleToApp(tool)) throw new Error(`MCP tool is not visible to apps: ${name}`);
  return rpc('mcpServer/tool/call', {
    threadId: session.threadId, server: session.item.server, tool: name,
    arguments: params?.arguments || {}, ...(params?._meta ? { _meta: params._meta } : {}),
  });
}

function recordThreadId(session) { return typeof session.threadId === 'string' && session.threadId.length > 0; }

async function readServerResource(session, params) {
  const uri = String(params?.uri || '');
  if (!uri) throw new Error('resources/read requires uri');
  const result = await rpc('mcpServer/resource/read', {
    ...(recordThreadId(session) ? { threadId: session.threadId } : {}), originCallId: session.item.id,
    server: session.item.server, uri,
    ...(session.item.appContext?.connectorId ? { connectorId: session.item.appContext.connectorId } : {}),
  });
  return { contents: result?.contents || [] };
}

async function handleRequest(session, message) {
  if (session.pending >= MAX_SESSION_REQUESTS) return rpcError(message.id, -32001, 'MCP App host request capacity reached');
  session.pending += 1;
  try {
    switch (message.method) {
      case 'ui/initialize': {
        if (message.params?.protocolVersion !== MCP_APPS_PROTOCOL_VERSION) return rpcError(message.id, -32602, `Unsupported MCP Apps protocol version: ${message.params?.protocolVersion}`);
        session.initializeSeen = true;
        return response(message.id, {
          protocolVersion: MCP_APPS_PROTOCOL_VERSION,
          hostInfo: { name: 'codex_app_server_web', version: '0.4.0' },
          hostCapabilities: {
            openLinks: {}, serverTools: { listChanged: false }, serverResources: { listChanged: false }, logging: {},
            sandbox: { permissions: session.permissions, csp: session.csp },
          },
          hostContext: hostContext(session),
        });
      }
      case 'ping': return response(message.id, {});
      case 'tools/list': return response(message.id, { tools: Object.values((await inventory(session.threadId, session.item.server)).tools || {}).filter(toolVisibleToApp) });
      case 'tools/call': return response(message.id, await callServerTool(session, message.params || {}));
      case 'resources/list': return response(message.id, { resources: (await inventory(session.threadId, session.item.server)).resources || [] });
      case 'resources/templates/list': return response(message.id, { resourceTemplates: (await inventory(session.threadId, session.item.server)).resourceTemplates || [] });
      case 'resources/read': return response(message.id, await readServerResource(session, message.params || {}));
      case 'ui/open-link': {
        const url = safeExternalUrl(message.params?.url);
        if (!url) return response(message.id, { isError: true });
        if (!window.confirm(`Open external link?\n${url}`)) return response(message.id, { isError: true });
        window.open(url, '_blank', 'noopener,noreferrer');
        return response(message.id, {});
      }
      case 'ui/request-display-mode': return response(message.id, { mode: 'inline' });
      default: return rpcError(message.id, -32601, `MCP App host method not implemented: ${message.method}`);
    }
  } catch (error) {
    return rpcError(message.id, -32000, String(error?.message || error).slice(0, 1024));
  } finally { session.pending -= 1; }
}

async function onMessage(session, event) {
  if (event.source !== session.frame.contentWindow || event.origin !== 'null') return;
  const message = jsonRpcEnvelope(event.data);
  if (!message || String(message.method || '').startsWith('ui/notifications/sandbox-')) return;
  if (message.id !== undefined && message.method) {
    post(session, await handleRequest(session, message));
    return;
  }
  if (!message.method) return;
  if (message.method === 'ui/notifications/initialized') {
    if (!session.initializeSeen) return;
    session.initialized = true;
    sendToolState(session);
  } else if (message.method === 'ui/notifications/size-changed') {
    const height = Number(message.params?.height);
    if (Number.isFinite(height)) session.slot.style.height = `${Math.max(160, Math.min(MAX_SLOT_HEIGHT, Math.round(height)))}px`;
  } else if (message.method === 'ui/notifications/request-teardown') {
    teardown(session.id, 'app-request');
  } else if (message.method === 'notifications/message') {
    console.debug('[mcp-app]', message.params?.level || 'log', message.params?.data || '');
  }
}

async function mountApp(id, card) {
  const record = items.get(id);
  if (!record || !resourceUri(record.item)) return;
  if (card.dataset.mcpAppVisibility === 'hidden') return;
  const existing = sessions.get(id);
  if (existing?.card === card && existing.resourceUri === resourceUri(record.item)) return;
  if (existing) teardown(id, 'remount');
  while (sessions.size >= MAX_SESSIONS) teardown(sessions.keys().next().value, 'capacity');

  const [metadata, serverInfo] = await Promise.all([meta(), inventory(record.threadId, record.item.server)]);
  if (!document.contains(card)) return;
  const tool = toolFromInventory(serverInfo, record.item.tool);
  if (!toolVisibleToApp(tool)) {
    // The inventory is the official authority for app visibility. Do not read
    // or render a UI resource for a tool that the server did not expose to
    // apps, even if an older timeline item still contains an appContext.
    card.dataset.mcpAppVisibility = 'hidden';
    return;
  }
  const { validated } = await readUiResource(record, serverInfo);
  let slot = card.querySelector('.mcp-app-slot');
  if (!slot) { slot = document.createElement('div'); slot.className = 'mcp-app-slot mcp-app-loading'; (card.querySelector('.activity-body') || card).append(slot); }
  const csp = normalizeResourceCsp(validated.meta?.csp || {});
  const permissions = buildGrantedPermissions(validated.meta?.permissions || {}, permissionAllowMap(metadata?.capabilities?.mcpAppPermissions));
  const frame = document.createElement('iframe');
  frame.className = 'mcp-app-proxy'; frame.title = validated.meta?.title || record.item.appContext?.appName || 'MCP App';
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  const allow = buildIframeAllow(permissions); if (allow) frame.setAttribute('allow', allow);
  const session = {
    id, card, slot, frame, item: record.item, threadId: record.threadId, resourceUri: validated.uri,
    csp, permissions, tool, pending: 0, initializeSeen: false, initialized: false, inputSent: false, resultSent: false,
    onMessage: null,
  };
  session.onMessage = (event) => { onMessage(session, event).catch(() => {}); };
  sessions.set(id, session);
  window.addEventListener('message', session.onMessage);
  slot.replaceChildren(frame); slot.classList.remove('mcp-app-loading');
  frame.src = sandboxProxyDataUrl(location.origin);
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('MCP App sandbox proxy did not become ready')), 10_000);
    const listener = (event) => {
      if (event.source !== frame.contentWindow || event.origin !== 'null') return;
      if (event.data?.method !== 'ui/notifications/sandbox-proxy-ready') return;
      clearTimeout(timer); window.removeEventListener('message', listener); resolve();
    };
    window.addEventListener('message', listener);
  });
  try {
    await ready;
    post(session, notification('ui/notifications/sandbox-resource-ready', { html: validated.html, csp, permissions }));
  } catch (error) {
    teardown(id, 'sandbox-failed');
    throw error;
  }
}

function mount(id, card) {
  const key = String(id || '');
  if (!key) return Promise.resolve();
  const pending = mountInFlight.get(key);
  if (pending) return pending;
  const task = mountApp(id, card);
  mountInFlight.set(key, task);
  return task.finally(() => { if (mountInFlight.get(key) === task) mountInFlight.delete(key); });
}

function teardown(id, reason) {
  const session = sessions.get(String(id));
  if (!session) return;
  sessions.delete(String(id));
  try {
    if (session.initialized) post(session, { jsonrpc: '2.0', id: `teardown-${Date.now()}`, method: 'ui/resource-teardown', params: {} });
  } catch { /* best effort */ }
  window.removeEventListener('message', session.onMessage);
  session.frame.remove();
  session.slot.remove();
  if (reason === 'removed') items.delete(String(id));
}

const observer = new MutationObserver(() => {
  for (const [id, session] of [...sessions]) if (!document.contains(session.card)) teardown(id, 'removed');
  for (const id of items.keys()) if (!sessions.has(id)) scheduleMount(id);
});
observer.observe(document.documentElement, { childList: true, subtree: true });

window.addEventListener('beforeunload', () => {
  eventSource?.close();
  observer.disconnect();
  for (const id of [...sessions.keys()]) teardown(id, 'unload');
});
