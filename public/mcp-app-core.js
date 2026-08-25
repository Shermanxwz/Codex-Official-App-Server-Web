export const MCP_APPS_EXTENSION = 'io.modelcontextprotocol/ui';
export const MCP_APPS_PROTOCOL_VERSION = '2026-01-26';
export const MCP_APPS_MIME = 'text/html;profile=mcp-app';
export const DEFAULT_MCP_APP_MAX_BYTES = 2 * 1024 * 1024;
export const DEFAULT_MCP_APP_MESSAGE_MAX_BYTES = 2 * 1024 * 1024;

const DOMAIN_TOKEN = /^(https?|wss?):\/\/(?:\*\.)?(?:\[[0-9a-f:]+\]|[a-z0-9.-]+)(?::\d{1,5})?$/i;

function normalizeMime(value) {
  return String(value || '').split(';').map((part) => part.trim().toLowerCase()).filter(Boolean).join(';');
}

export function normalizeCspDomains(values, { allowWebSocket = false } = {}) {
  if (values == null) return [];
  if (!Array.isArray(values)) throw new Error('MCP App CSP domains must be arrays');
  const out = [];
  for (const raw of values) {
    const value = String(raw || '').trim();
    if (!value || value.length > 512 || /[;\r\n'" ]/.test(value) || !DOMAIN_TOKEN.test(value)) throw new Error(`Invalid MCP App CSP origin: ${value || '<empty>'}`);
    const scheme = value.slice(0, value.indexOf(':')).toLowerCase();
    if (!['http', 'https'].includes(scheme) && !(allowWebSocket && ['ws', 'wss'].includes(scheme))) throw new Error(`Unsupported MCP App CSP scheme: ${value}`);
    const port = value.match(/:(\d{1,5})$/)?.[1];
    if (port && Number(port) > 65535) throw new Error(`Invalid MCP App CSP port: ${value}`);
    if (!out.includes(value)) out.push(value);
  }
  return out;
}

export function normalizeResourceCsp(csp = {}) {
  if (csp == null) csp = {};
  if (typeof csp !== 'object' || Array.isArray(csp)) throw new Error('MCP App CSP metadata must be an object');
  return {
    connectDomains: normalizeCspDomains(csp.connectDomains, { allowWebSocket: true }),
    resourceDomains: normalizeCspDomains(csp.resourceDomains),
    frameDomains: normalizeCspDomains(csp.frameDomains),
    baseUriDomains: normalizeCspDomains(csp.baseUriDomains),
  };
}

export function buildMcpAppCsp(input = {}) {
  const csp = normalizeResourceCsp(input);
  const resourceDomains = csp.resourceDomains.join(' ');
  const connectDomains = csp.connectDomains.join(' ');
  const frameDomains = csp.frameDomains.join(' ');
  const baseDomains = csp.baseUriDomains.join(' ');
  return [
    "default-src 'self' 'unsafe-inline'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: ${resourceDomains}`.trim(),
    `style-src 'self' 'unsafe-inline' blob: data: ${resourceDomains}`.trim(),
    `img-src 'self' data: blob: ${resourceDomains}`.trim(),
    `font-src 'self' data: blob: ${resourceDomains}`.trim(),
    `media-src 'self' data: blob: ${resourceDomains}`.trim(),
    `connect-src 'self' ${connectDomains}`.trim(),
    `worker-src 'self' blob: ${resourceDomains}`.trim(),
    frameDomains ? `frame-src ${frameDomains}` : "frame-src 'none'",
    "object-src 'none'",
    baseDomains ? `base-uri ${baseDomains}` : "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

export function safeExternalUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

function decodeBase64Utf8(value) {
  const text = String(value || '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 === 1) throw new Error('Invalid base64 MCP App resource');
  const binary = atob(text);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export function validateMcpAppResource(content, requestedUri, maxBytes = DEFAULT_MCP_APP_MAX_BYTES) {
  if (!content || typeof content !== 'object' || Array.isArray(content)) throw new Error('MCP App resource content is missing');
  const uri = String(content.uri || '');
  if (!uri.startsWith('ui://')) throw new Error(`MCP App resource must use ui://: ${uri || '<missing>'}`);
  if (requestedUri && uri !== requestedUri) throw new Error(`MCP App resource URI mismatch: expected ${requestedUri}, received ${uri}`);
  if (normalizeMime(content.mimeType) !== MCP_APPS_MIME) throw new Error(`MCP App resource MIME must be ${MCP_APPS_MIME}`);
  const hasText = typeof content.text === 'string';
  const hasBlob = typeof content.blob === 'string';
  if (hasText === hasBlob) throw new Error('MCP App resource must contain exactly one of text or blob');
  const html = hasText ? content.text : decodeBase64Utf8(content.blob);
  const bytes = new TextEncoder().encode(html).byteLength;
  if (bytes > maxBytes) throw new Error(`MCP App resource exceeds host limit (${bytes} > ${maxBytes})`);
  const metaRoot = content._meta || content.meta || {};
  return { uri, html, bytes, meta: metaRoot.ui && typeof metaRoot.ui === 'object' ? metaRoot.ui : {} };
}

export function toolVisibleToApp(tool) {
  const visibility = tool?._meta?.ui?.visibility ?? tool?.meta?.ui?.visibility;
  if (visibility == null) return true;
  return Array.isArray(visibility) && visibility.includes('app');
}

export function buildGrantedPermissions(resourcePermissions = {}, allowed = {}) {
  const requested = resourcePermissions && typeof resourcePermissions === 'object' ? resourcePermissions : {};
  const granted = {};
  for (const key of ['camera', 'microphone', 'geolocation', 'clipboardWrite']) {
    if (requested[key] && allowed[key]) granted[key] = {};
  }
  return granted;
}

export function buildIframeAllow(permissions = {}) {
  const out = [];
  if (permissions.camera) out.push('camera');
  if (permissions.microphone) out.push('microphone');
  if (permissions.geolocation) out.push('geolocation');
  if (permissions.clipboardWrite) out.push('clipboard-write');
  return out.join('; ');
}

export function jsonRpcEnvelope(value, maxBytes = DEFAULT_MCP_APP_MESSAGE_MAX_BYTES) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.jsonrpc !== '2.0') return null;
  if ('method' in value && typeof value.method !== 'string') return null;
  let bytes;
  try { bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength; } catch { return null; }
  if (bytes > maxBytes) return null;
  return value;
}

export function isReservedSandboxMethod(method) {
  return String(method || '').startsWith('ui/notifications/sandbox-');
}
