import crypto from 'node:crypto';

export function secureHeaders(extra = {}) {
  return {
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    ...extra,
  };
}

export function json(res, status, body, headers = {}) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, secureHeaders({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': data.length,
    ...headers,
  }));
  res.end(data);
}

export async function readJson(req, limit) {
  const type = (req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
  if (type !== 'application/json' && !(type.startsWith('application/') && type.endsWith('+json'))) {
    const error = new Error('JSON requests require application/json or application/*+json');
    error.status = 415;
    error.code = 'UNSUPPORTED_MEDIA_TYPE';
    throw error;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error('Request body too large');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Invalid JSON');
    error.status = 400;
    throw error;
  }
}

export function parseCookies(req) {
  const result = Object.create(null);
  for (const part of String(req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    try { result[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim()); }
    catch { /* ignore malformed cookie */ }
  }
  return result;
}

export function sameOrigin(req, publicOrigin = '') {
  const origin = req.headers.origin;
  if (!origin) return false;
  if (publicOrigin) return origin === publicOrigin;
  const host = req.headers.host;
  if (!host) return false;
  return origin === `http://${host}` || origin === `https://${host}`;
}

export function safeEqualText(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function isLoopbackHost(host) {
  const value = String(host).toLowerCase().replace(/^\[|\]$/g, '');
  return value === '127.0.0.1' || value === '::1' || value === 'localhost';
}

export class SessionStore {
  constructor(ttlMs = 12 * 60 * 60 * 1000, maxSessions = 256) {
    this.ttlMs = ttlMs;
    this.maxSessions = maxSessions;
    this.sessions = new Map();
  }
  #prune(now = Date.now()) {
    for (const [token, expiresAt] of this.sessions) if (expiresAt <= now) this.sessions.delete(token);
    while (this.sessions.size >= this.maxSessions) this.sessions.delete(this.sessions.keys().next().value);
  }
  create() {
    this.#prune();
    const token = randomToken();
    this.sessions.set(token, Date.now() + this.ttlMs);
    return token;
  }
  has(token) {
    if (!token) return false;
    const expiresAt = this.sessions.get(token);
    if (!expiresAt || expiresAt <= Date.now()) {
      if (token) this.sessions.delete(token);
      return false;
    }
    return true;
  }
  delete(token) { this.sessions.delete(token); }
  get size() { return this.sessions.size; }
}

export class SlidingRateLimit {
  constructor(max, windowMs, maxKeys = 4096) {
    this.max = max;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
    this.entries = new Map();
  }
  #pruneKeys(now) {
    for (const [key, list] of this.entries) {
      const fresh = list.filter((x) => x > now - this.windowMs);
      if (fresh.length) this.entries.set(key, fresh);
      else this.entries.delete(key);
    }
    while (this.entries.size >= this.maxKeys) this.entries.delete(this.entries.keys().next().value);
  }
  allow(key) {
    const now = Date.now();
    if (!this.entries.has(key) && this.entries.size >= this.maxKeys) this.#pruneKeys(now);
    const list = (this.entries.get(key) || []).filter((x) => x > now - this.windowMs);
    if (list.length >= this.max) {
      this.entries.set(key, list);
      return false;
    }
    list.push(now);
    this.entries.set(key, list);
    return true;
  }
  get size() { return this.entries.size; }
}
