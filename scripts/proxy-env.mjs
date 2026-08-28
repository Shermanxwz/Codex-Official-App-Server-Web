import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROXY_ENV_NAMES = Object.freeze([
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
]);

const proxyNames = new Set(PROXY_ENV_NAMES);

function checked(value, name) {
  const text = String(value ?? '');
  if (/[\0\r\n]/.test(text)) throw new Error(`${name} contains an unsupported control character`);
  return text;
}

function assignment(line) {
  const match = String(line).match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  return match ? { name: match[1], raw: match[2] } : null;
}

function decode(raw, name) {
  const value = String(raw || '').trim();
  if (value.startsWith('"')) {
    if (!value.endsWith('"')) throw new Error(`${name} has an unterminated quoted value`);
    try { return checked(JSON.parse(value), name); }
    catch (error) { throw new Error(`${name} has an invalid quoted value: ${error.message}`); }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.slice(1, -1).includes("'")) throw new Error(`${name} has an invalid single-quoted value`);
    return checked(value.slice(1, -1), name);
  }
  return checked(value, name);
}

function encode(name, value) {
  return `${name}=${JSON.stringify(checked(value, name))}`;
}

function normalizedLines(text) {
  const lines = String(text || '').split(/\r?\n/);
  while (lines.length && lines.at(-1) === '') lines.pop();
  return lines;
}

function firstProxyValues(text) {
  const values = new Map();
  for (const line of normalizedLines(text)) {
    const item = assignment(line);
    if (!item || !proxyNames.has(item.name) || values.has(item.name)) continue;
    values.set(item.name, decode(item.raw, item.name));
  }
  return values;
}

function explicitValue(env, name) {
  if (!Object.hasOwn(env || {}, name)) return undefined;
  return checked(env[name], name);
}

export function mergeGatewayProxyEnv(text, env = process.env) {
  const lines = normalizedLines(text), seen = new Set(), result = [];
  for (const line of lines) {
    const item = assignment(line);
    if (!item || !proxyNames.has(item.name)) { result.push(line); continue; }
    if (seen.has(item.name)) continue;
    seen.add(item.name);
    const current = explicitValue(env, item.name);
    if (current === undefined) result.push(encode(item.name, decode(item.raw, item.name)));
    else if (current) result.push(encode(item.name, current));
  }
  for (const name of PROXY_ENV_NAMES) {
    if (seen.has(name)) continue;
    const current = explicitValue(env, name);
    if (current) result.push(encode(name, current));
  }
  return `${result.join('\n')}\n`;
}

export function buildOfficialProxyEnv(existingOfficial, gatewayText, env = process.env) {
  const existing = firstProxyValues(existingOfficial), gateway = firstProxyValues(gatewayText), lines = [];
  for (const name of PROXY_ENV_NAMES) {
    const current = explicitValue(env, name);
    if (current !== undefined) {
      if (current) lines.push(encode(name, current));
      continue;
    }
    const value = existing.get(name) ?? gateway.get(name);
    if (value !== undefined && value !== '') lines.push(encode(name, value));
  }
  return lines.length ? `${lines.join('\n')}\n` : '';
}

function writeAtomic(file, text) {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(temp, text, { mode: 0o600 });
    fs.renameSync(temp, file);
    fs.chmodSync(file, 0o600);
  } finally {
    try { fs.unlinkSync(temp); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
}

export function mergeProxyEnvironmentFiles(gatewayFile, officialFile, env = process.env) {
  const gatewayText = fs.readFileSync(gatewayFile, 'utf8');
  const officialText = fs.existsSync(officialFile) ? fs.readFileSync(officialFile, 'utf8') : '';
  const mergedGateway = mergeGatewayProxyEnv(gatewayText, env);
  const mergedOfficial = buildOfficialProxyEnv(officialText, mergedGateway, env);
  writeAtomic(gatewayFile, mergedGateway);
  writeAtomic(officialFile, mergedOfficial);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [gatewayFile, officialFile] = process.argv.slice(2);
  if (!gatewayFile || !officialFile) throw new Error('Usage: proxy-env.mjs <gateway-env> <official-env>');
  mergeProxyEnvironmentFiles(path.resolve(gatewayFile), path.resolve(officialFile));
}
