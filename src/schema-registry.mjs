import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { sanitizedCodexEnv } from './codex-client.mjs';

const REQUIRED_SCHEMA_FILES = ['ClientRequest.json', 'ClientNotification.json', 'ServerRequest.json', 'ServerNotification.json'];
const REQUIRED_TS_FILES = ['ClientRequest.ts', 'ClientNotification.ts', 'ServerRequest.ts', 'ServerNotification.ts'];
const CACHE_MANIFEST = '_cweb-schema-manifest.json';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function resolveRef(schema, ref) {
  if (!ref?.startsWith('#/definitions/')) return null;
  return schema.definitions?.[ref.slice('#/definitions/'.length)] || null;
}

function descriptorFromVariant(schema, variant) {
  const method = variant?.properties?.method?.enum?.[0];
  if (typeof method !== 'string') return null;
  const paramsNode = variant?.properties?.params || null;
  const paramsRef = paramsNode?.$ref || null;
  const paramsSchema = paramsRef ? resolveRef(schema, paramsRef) : paramsNode;
  return {
    method,
    title: variant.title || method,
    description: variant.description || paramsSchema?.description || '',
    paramsRef,
    paramsSchema: paramsSchema || { type: 'object' },
    rootSchema: schema,
  };
}

export function extractMethods(schema) {
  const variants = Array.isArray(schema?.oneOf) ? schema.oneOf : [];
  return variants.map((variant) => descriptorFromVariant(schema, variant)).filter(Boolean);
}

function assertUniqueMethods(items, label) {
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.method)) throw new Error(`Official ${label} schema contains duplicate method: ${item.method}`);
    seen.add(item.method);
  }
}

export function extractMethodsFromTypeScript(text) {
  const methods = [];
  const seen = new Set();
  for (const match of String(text).matchAll(/"method"\s*:\s*"([^"]+)"/g)) {
    if (!seen.has(match[1])) { seen.add(match[1]); methods.push(match[1]); }
  }
  return methods;
}

export function assertJsonWireCoveredByTypeScript(jsonItems, tsMethods, label) {
  const json = new Set(jsonItems.map((item) => item.method));
  const ts = new Set(tsMethods);
  const jsonOnly = [...json].filter((method) => !ts.has(method));
  const tsOnly = [...ts].filter((method) => !json.has(method));
  if (jsonOnly.length) {
    const error = new Error(`Official ${label} TypeScript export is missing JSON wire methods`);
    error.code = 'OFFICIAL_PROTOCOL_EXPORT_DRIFT';
    error.details = { jsonOnly, tsOnly };
    throw error;
  }
  return { jsonOnly, tsOnly };
}

export function schemaDigest(dir) {
  const hash = crypto.createHash('sha256');
  for (const name of fs.readdirSync(dir).filter((x) => (x.endsWith('.json') || x.endsWith('.ts')) && x !== CACHE_MANIFEST).sort()) {
    hash.update(name); hash.update('\0'); hash.update(fs.readFileSync(path.join(dir, name))); hash.update('\0');
  }
  return hash.digest('hex');
}

export function codexVersion(codexBin) {
  const result = spawnSync(codexBin, ['--version'], {
    encoding: 'utf8', timeout: 15_000, env: sanitizedCodexEnv(),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Unable to run ${codexBin} --version: ${result.stderr || result.stdout}`);
  return (result.stdout || result.stderr || '').trim();
}

function validateRequiredSchemas(dir) {
  for (const required of [...REQUIRED_SCHEMA_FILES, ...REQUIRED_TS_FILES]) {
    if (!fs.existsSync(path.join(dir, required))) throw new Error(`Codex protocol export is missing ${required}`);
  }
}

function writeCacheManifest(dir, { version, experimental }) {
  const manifest = {
    format: 1,
    codexVersion: version,
    experimental: Boolean(experimental),
    schemaDigest: schemaDigest(dir),
  };
  fs.writeFileSync(path.join(dir, CACHE_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return manifest;
}

function validateCachedSchemas(dir, { version, experimental }) {
  validateRequiredSchemas(dir);
  const file = path.join(dir, CACHE_MANIFEST);
  if (!fs.existsSync(file)) throw new Error('Cached official schema has no version manifest; refresh is required');
  const manifest = readJson(file);
  if (manifest.format !== 1) throw new Error('Cached official schema manifest format is unsupported');
  if (manifest.codexVersion !== version) throw new Error(`Cached schema belongs to ${manifest.codexVersion}, current Codex is ${version}`);
  if (Boolean(manifest.experimental) !== Boolean(experimental)) throw new Error('Cached schema stable/experimental mode does not match this launch');
  const digest = schemaDigest(dir);
  if (manifest.schemaDigest !== digest) throw new Error('Cached official schema digest does not match its manifest');
  return manifest;
}

export function generateOfficialSchemas({ codexBin, targetDir, experimental = false, version = codexVersion(codexBin) }) {
  const parent = path.dirname(targetDir);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const temp = `${targetDir}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.mkdirSync(temp, { recursive: true, mode: 0o700 });
  try {
    const jsonArgs = ['app-server', 'generate-json-schema', '--out', temp];
    const tsArgs = ['app-server', 'generate-ts', '--out', temp];
    if (experimental) { jsonArgs.push('--experimental'); tsArgs.push('--experimental'); }
    for (const [label, args] of [['JSON Schema', jsonArgs], ['TypeScript', tsArgs]]) {
      const result = spawnSync(codexBin, args, { encoding: 'utf8', timeout: 60_000, env: sanitizedCodexEnv() });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`Official ${label} generation failed: ${result.stderr || result.stdout}`);
    }
    validateRequiredSchemas(temp);
    writeCacheManifest(temp, { version, experimental });

    const backup = `${targetDir}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.bak`;
    const hadTarget = fs.existsSync(targetDir);
    try {
      if (hadTarget) fs.renameSync(targetDir, backup);
      fs.renameSync(temp, targetDir);
      if (hadTarget) fs.rmSync(backup, { recursive: true, force: true });
    } catch (error) {
      if (!fs.existsSync(targetDir) && hadTarget && fs.existsSync(backup)) fs.renameSync(backup, targetDir);
      throw error;
    } finally {
      fs.rmSync(backup, { recursive: true, force: true });
    }
  } catch (error) {
    fs.rmSync(temp, { recursive: true, force: true });
    throw error;
  }
}

function bundleForDescriptor(descriptor) {
  if (!descriptor) return null;
  return {
    $schema: descriptor.rootSchema?.$schema || 'http://json-schema.org/draft-07/schema#',
    definitions: descriptor.rootSchema?.definitions || {},
    ...descriptor.paramsSchema,
  };
}

export class OfficialSchemaRegistry {
  constructor({ dir, codexBin, experimental = false, refresh = true }) {
    this.dir = dir;
    this.codexBin = codexBin;
    this.experimental = experimental;
    this.version = codexVersion(codexBin);
    if (refresh || !fs.existsSync(path.join(dir, 'ClientRequest.json'))) {
      generateOfficialSchemas({ codexBin, targetDir: dir, experimental, version: this.version });
    } else {
      validateCachedSchemas(dir, { version: this.version, experimental });
    }

    this.clientRequestSchema = readJson(path.join(dir, 'ClientRequest.json'));
    this.clientNotificationSchema = readJson(path.join(dir, 'ClientNotification.json'));
    this.serverRequestSchema = readJson(path.join(dir, 'ServerRequest.json'));
    this.serverNotificationSchema = readJson(path.join(dir, 'ServerNotification.json'));
    this.requests = extractMethods(this.clientRequestSchema);
    this.notifications = extractMethods(this.clientNotificationSchema);
    this.serverRequests = extractMethods(this.serverRequestSchema);
    this.serverNotifications = extractMethods(this.serverNotificationSchema);
    const tsExports = {
      ClientRequest: extractMethodsFromTypeScript(fs.readFileSync(path.join(dir, 'ClientRequest.ts'), 'utf8')),
      ClientNotification: extractMethodsFromTypeScript(fs.readFileSync(path.join(dir, 'ClientNotification.ts'), 'utf8')),
      ServerRequest: extractMethodsFromTypeScript(fs.readFileSync(path.join(dir, 'ServerRequest.ts'), 'utf8')),
      ServerNotification: extractMethodsFromTypeScript(fs.readFileSync(path.join(dir, 'ServerNotification.ts'), 'utf8')),
    };
    this.exportCoverage = {
      clientRequests: assertJsonWireCoveredByTypeScript(this.requests, tsExports.ClientRequest, 'ClientRequest'),
      clientNotifications: assertJsonWireCoveredByTypeScript(this.notifications, tsExports.ClientNotification, 'ClientNotification'),
      serverRequests: assertJsonWireCoveredByTypeScript(this.serverRequests, tsExports.ServerRequest, 'ServerRequest'),
      serverNotifications: assertJsonWireCoveredByTypeScript(this.serverNotifications, tsExports.ServerNotification, 'ServerNotification'),
    };
    assertUniqueMethods(this.requests, 'ClientRequest');
    assertUniqueMethods(this.notifications, 'ClientNotification');
    assertUniqueMethods(this.serverRequests, 'ServerRequest');
    assertUniqueMethods(this.serverNotifications, 'ServerNotification');
    if (!this.requests.length) throw new Error('Official ClientRequest method set is unexpectedly empty');

    this.requestMap = new Map(this.requests.map((x) => [x.method, x]));
    this.notificationMap = new Map(this.notifications.map((x) => [x.method, x]));
    this.serverRequestMap = new Map(this.serverRequests.map((x) => [x.method, x]));
    this.serverNotificationMap = new Map(this.serverNotifications.map((x) => [x.method, x]));
    this.digest = schemaDigest(dir);
  }

  getRequest(method) { return this.requestMap.get(method) || null; }
  getNotification(method) { return this.notificationMap.get(method) || null; }
  getServerRequest(method) { return this.serverRequestMap.get(method) || null; }
  getServerNotification(method) { return this.serverNotificationMap.get(method) || null; }
  getSchemaBundle(kind, method) {
    const maps = {
      requests: this.requestMap,
      notifications: this.notificationMap,
      serverRequests: this.serverRequestMap,
      serverNotifications: this.serverNotificationMap,
    };
    return bundleForDescriptor(maps[kind]?.get(method) || null);
  }

  summary() {
    return {
      codexVersion: this.version,
      schemaDigest: this.digest,
      experimental: this.experimental,
      clientRequests: this.requests.length,
      clientNotifications: this.notifications.length,
      serverRequests: this.serverRequests.length,
      serverNotifications: this.serverNotifications.length,
      typeScriptOnlyExports: Object.fromEntries(Object.entries(this.exportCoverage).map(([key, value]) => [key, value.tsOnly])),
    };
  }
}
