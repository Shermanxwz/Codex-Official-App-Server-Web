export const OFFICIAL_EVENT_LOG_LIMITS = Object.freeze({
  maxEntries: 200,
  maxBytes: 1024 * 1024,
  maxEventBytes: 128 * 1024,
});

function bytes(value) {
  return new TextEncoder().encode(String(value || '')).byteLength;
}

export function officialEventEntry(message, now = Date.now(), limits = OFFICIAL_EVENT_LOG_LIMITS) {
  const method = String(message?.method || 'unknown').slice(0, 256);
  let compact;
  try { compact = JSON.stringify(message); }
  catch { compact = JSON.stringify({ method, params: { serializationError: true } }); }
  const serializedBytes = bytes(compact);
  const transportBytes = Number(message?.params?.payloadBytes);
  const transportTruncated = message?.params?.transportOversize === true;
  const payloadBytes = transportTruncated && Number.isFinite(transportBytes) && transportBytes > 0
    ? transportBytes
    : serializedBytes;
  const truncated = transportTruncated || serializedBytes > limits.maxEventBytes;
  const displayValue = truncated
    ? { method, params: { truncated: true, payloadBytes } }
    : message;
  let json;
  try { json = JSON.stringify(displayValue, null, 2); }
  catch { json = JSON.stringify({ method, params: { serializationError: true } }, null, 2); }
  return Object.freeze({
    method,
    at: Number(now) || Date.now(),
    json,
    payloadBytes,
    storageBytes: bytes(json),
    truncated,
  });
}

export function appendOfficialEvent(entries, message, options = {}) {
  const limits = { ...OFFICIAL_EVENT_LOG_LIMITS, ...options };
  const next = [...(Array.isArray(entries) ? entries : []), officialEventEntry(message, Date.now(), limits)];
  let total = next.reduce((sum, entry) => sum + Number(entry?.storageBytes || 0), 0);
  while (next.length > limits.maxEntries || (total > limits.maxBytes && next.length > 1)) {
    const removed = next.shift();
    total -= Number(removed?.storageBytes || 0);
  }
  return next;
}
