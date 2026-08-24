import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

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
  };
}

export function extractMethods(schema) {
  const variants = Array.isArray(schema?.oneOf) ? schema.oneOf : [];
  return variants.map((v) => descriptorFromVariant(schema, v)).filter(Boolean);
}

export function schemaDigest(dir) {
  const hash = crypto.createHash('sha256');
  for (const name of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    hash.update(name); hash.update('\0'); hash.update(fs.readFileSync(path.join(dir, name))); hash.update('\0');
  }
  return hash.digest('hex');
}

export function codexVersion(codexBin) {
  const result = spawnSync(codexBin, ['--version'], { encoding: 'utf8', timeout: 15_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Unable to run ${codexBin} --version: ${result.stderr || result.stdout}`);
  return (result.stdout || result.stderr || '').trim();
}

export function generateOfficialSchemas({ codexBin, targetDir, experimental = false }) {
  const parent = path.dirname(targetDir);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const temp = `${targetDir}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.mkdirSync(temp, { recursive: true, mode: 0o700 });
  try {
    const args = ['app-server', 'generate-json-schema', '--out', temp];
    if (experimental) args.push('--experimental');
    const result = spawnSync(codexBin, args, { encoding: 'utf8', timeout: 60_000 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Official schema generation failed: ${result.stderr || result.stdout}`);
    for (const required of ['ClientRequest.json', 'ClientNotification.json', 'ServerRequest.json', 'ServerNotification.json']) {
      if (!fs.existsSync(path.join(temp, required))) throw new Error(`Codex schema export is missing ${required}`);
    }
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

export class OfficialSchemaRegistry {
  constructor({ dir, codexBin, experimental = false, refresh = true }) {
    this.dir = dir;
    this.codexBin = codexBin;
    this.experimental = experimental;
    if (refresh || !fs.existsSync(path.join(dir, 'ClientRequest.json'))) {
      generateOfficialSchemas({ codexBin, targetDir: dir, experimental });
    }
    this.clientRequestSchema = readJson(path.join(dir, 'ClientRequest.json'));
    this.clientNotificationSchema = readJson(path.join(dir, 'ClientNotification.json'));
    this.serverRequestSchema = readJson(path.join(dir, 'ServerRequest.json'));
    this.serverNotificationSchema = readJson(path.join(dir, 'ServerNotification.json'));
    this.requests = extractMethods(this.clientRequestSchema);
    this.notifications = extractMethods(this.clientNotificationSchema);
    this.serverRequests = extractMethods(this.serverRequestSchema);
    this.serverNotifications = extractMethods(this.serverNotificationSchema);
    this.requestMap = new Map(this.requests.map((x) => [x.method, x]));
    this.notificationMap = new Map(this.notifications.map((x) => [x.method, x]));
    this.digest = schemaDigest(dir);
    this.version = codexVersion(codexBin);
  }

  getRequest(method) { return this.requestMap.get(method) || null; }
  getNotification(method) { return this.notificationMap.get(method) || null; }

  summary() {
    return {
      codexVersion: this.version,
      schemaDigest: this.digest,
      experimental: this.experimental,
      clientRequests: this.requests.length,
      clientNotifications: this.notifications.length,
      serverRequests: this.serverRequests.length,
      serverNotifications: this.serverNotifications.length,
    };
  }
}
