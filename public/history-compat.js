const UNSUPPORTED_METHOD_PATTERNS = [
  /not supported/i,
  /not implemented/i,
  /method not found/i,
  /unsupported/i,
];

function errorCode(error) {
  return error?.body?.rpc?.code ?? error?.rpc?.code ?? error?.body?.code ?? error?.code ?? null;
}

function errorText(error) {
  return [
    error?.message,
    error?.body?.message,
    error?.body?.rpc?.message,
    error?.rpc?.message,
  ].filter(Boolean).map(String).join(' ');
}

export function isUnsupportedOfficialMethodError(error, method = '') {
  if (Number(errorCode(error)) === -32601) return true;
  const text = errorText(error);
  if (!UNSUPPORTED_METHOD_PATTERNS.some((pattern) => pattern.test(text))) return false;
  const name = String(method || '').trim();
  return !name || text.toLowerCase().includes(name.toLowerCase()) || /method|rpc|official/i.test(text);
}

export function hasOfficialHistoryPaging(methods, disabled = false) {
  if (disabled) return false;
  const requests = Array.isArray(methods?.requests) ? methods.requests : Array.isArray(methods) ? methods : [];
  const names = new Set(requests.map((item) => typeof item === 'string' ? item : item?.method).filter(Boolean));
  return names.has('thread/turns/list') && names.has('thread/items/list');
}
