import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const TOOL_NAME_RE = /^[A-Za-z0-9_-]{1,128}$/;
const NAMESPACE_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ENV_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SAFE_BASE_ENV = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL'];
const RESERVED_NAMESPACES = new Set([
  'api_tool', 'browser', 'computer', 'container', 'file_search', 'functions', 'image_gen',
  'multi_tool_use', 'python', 'python_user_visible', 'submodel_delegator', 'terminal', 'tool_search', 'web',
]);
const MAX_CONFIG_BYTES = 1024 * 1024;
const MAX_REQUEST_BYTES = 512 * 1024;
const DEFAULT_MAX_CONCURRENT = 8;

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function failure(text) {
  return { contentItems: [{ type: 'inputText', text: String(text).slice(0, 4096) }], success: false };
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function reservedIdentifier(value, label) {
  if (value === 'mcp' || value.startsWith('mcp__')) throw new Error(`${label} is reserved: ${value}`);
}

function validateContentItems(value) {
  if (!Array.isArray(value) || value.length > 128) throw new Error('Dynamic tool response contentItems must contain at most 128 items');
  let total = 0;
  return value.map((item, index) => {
    assertPlainObject(item, `contentItems[${index}]`);
    if (item.type === 'inputText') {
      if (typeof item.text !== 'string') throw new Error(`contentItems[${index}].text must be a string`);
      total += Buffer.byteLength(item.text);
      if (total > 2 * 1024 * 1024) throw new Error('Dynamic tool response text exceeds 2 MiB');
      return { type: 'inputText', text: item.text };
    }
    if (item.type === 'inputImage') {
      if (typeof item.imageUrl !== 'string' || !/^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i.test(item.imageUrl)) {
        throw new Error(`contentItems[${index}].imageUrl must be an inline base64 image data URL`);
      }
      total += Buffer.byteLength(item.imageUrl);
      if (total > 4 * 1024 * 1024) throw new Error('Dynamic tool response media exceeds 4 MiB');
      return { type: 'inputImage', imageUrl: item.imageUrl };
    }
    if (item.type === 'inputAudio') {
      if (typeof item.audioUrl !== 'string' || !/^data:audio\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i.test(item.audioUrl)) {
        throw new Error(`contentItems[${index}].audioUrl must be an inline base64 audio data URL`);
      }
      total += Buffer.byteLength(item.audioUrl);
      if (total > 4 * 1024 * 1024) throw new Error('Dynamic tool response media exceeds 4 MiB');
      return { type: 'inputAudio', audioUrl: item.audioUrl };
    }
    throw new Error(`Unsupported dynamic tool response content type: ${item.type || '<missing>'}`);
  });
}

function normalizeHandler(raw, configDir) {
  assertPlainObject(raw, 'dynamic tool handler');
  if (raw.type !== 'process') throw new Error('Dynamic tool handler.type must be "process"');
  const command = String(raw.command || '');
  if (!path.isAbsolute(command)) throw new Error(`Dynamic tool process command must be absolute: ${command || '<missing>'}`);
  const stat = fs.statSync(command);
  if (!stat.isFile()) throw new Error(`Dynamic tool process command is not a file: ${command}`);
  fs.accessSync(command, fs.constants.X_OK);
  const args = raw.args == null ? [] : raw.args;
  if (!Array.isArray(args) || args.length > 64 || args.some((arg) => typeof arg !== 'string' || arg.length > 4096)) {
    throw new Error('Dynamic tool process args must be an array of at most 64 strings');
  }
  const cwd = raw.cwd == null ? configDir : String(raw.cwd);
  if (!path.isAbsolute(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error(`Dynamic tool process cwd must be an absolute directory: ${cwd}`);
  const inheritEnv = raw.inheritEnv == null ? [] : raw.inheritEnv;
  if (!Array.isArray(inheritEnv) || inheritEnv.length > 32) throw new Error('Dynamic tool inheritEnv must contain at most 32 names');
  for (const name of inheritEnv) {
    if (typeof name !== 'string' || !ENV_RE.test(name) || name.startsWith('CWEB_')) {
      throw new Error(`Dynamic tool inheritEnv contains an unsafe name: ${String(name)}`);
    }
  }
  return Object.freeze({
    type: 'process', command, args: [...args], cwd,
    timeoutMs: integer(raw.timeoutMs, 30_000, 100, 120_000),
    maxOutputBytes: integer(raw.maxOutputBytes, 1024 * 1024, 1024, 8 * 1024 * 1024),
    inheritEnv: [...new Set(inheritEnv)],
  });
}

function normalizeTool(raw, configDir) {
  assertPlainObject(raw, 'dynamic tool');
  const namespace = raw.namespace == null || raw.namespace === '' ? null : String(raw.namespace);
  const name = String(raw.name || '');
  if (namespace !== null) {
    if (!NAMESPACE_RE.test(namespace)) throw new Error(`Invalid dynamic tool namespace: ${namespace}`);
    reservedIdentifier(namespace, 'dynamic tool namespace');
    if (RESERVED_NAMESPACES.has(namespace)) throw new Error(`Dynamic tool namespace collides with a reserved Responses API namespace: ${namespace}`);
  }
  if (!TOOL_NAME_RE.test(name)) throw new Error(`Invalid dynamic tool name: ${name || '<missing>'}`);
  reservedIdentifier(name, 'dynamic tool name');
  const description = String(raw.description || '').trim();
  if (!description || description.length > 4096) throw new Error(`Dynamic tool ${name} requires a non-empty description <= 4096 characters`);
  assertPlainObject(raw.inputSchema, `dynamic tool ${name} inputSchema`);
  const deferLoading = Boolean(raw.deferLoading);
  if (deferLoading && namespace === null) throw new Error(`Deferred dynamic tool ${name} must belong to a namespace`);
  const namespaceDescription = namespace === null ? '' : String(raw.namespaceDescription || `Tools in the ${namespace} namespace.`).trim();
  if (namespace !== null && (!namespaceDescription || namespaceDescription.length > 1024)) {
    throw new Error(`Dynamic tool namespace ${namespace} requires a description <= 1024 characters`);
  }
  return Object.freeze({
    namespace, namespaceDescription, name, description,
    inputSchema: structuredClone(raw.inputSchema), deferLoading,
    handler: normalizeHandler(raw.handler, configDir),
  });
}

function canonicalSpecs(tools) {
  const specs = [];
  const namespaceIndex = new Map();
  const topLevelNames = new Set();
  const namesByNamespace = new Map();
  for (const tool of tools) {
    const fn = { type: 'function', name: tool.name, description: tool.description, inputSchema: structuredClone(tool.inputSchema), deferLoading: tool.deferLoading };
    if (tool.namespace === null) {
      if (topLevelNames.has(tool.name)) throw new Error(`Duplicate dynamic tool name: ${tool.name}`);
      topLevelNames.add(tool.name);
      specs.push(fn);
      continue;
    }
    const seen = namesByNamespace.get(tool.namespace) || new Set();
    if (seen.has(tool.name)) throw new Error(`Duplicate dynamic tool name in namespace ${tool.namespace}: ${tool.name}`);
    seen.add(tool.name);
    namesByNamespace.set(tool.namespace, seen);
    let spec = namespaceIndex.get(tool.namespace);
    if (!spec) {
      spec = { type: 'namespace', name: tool.namespace, description: tool.namespaceDescription, tools: [] };
      namespaceIndex.set(tool.namespace, spec);
      specs.push(spec);
    } else if (spec.description !== tool.namespaceDescription) {
      throw new Error(`Dynamic tool namespace ${tool.namespace} has conflicting descriptions`);
    }
    spec.tools.push(fn);
  }
  return specs;
}

function toolKey(namespace, name) { return `${namespace || ''}\u0000${name || ''}`; }

function childEnv(handler, source = process.env) {
  const env = {};
  for (const name of SAFE_BASE_ENV) if (source[name] !== undefined) env[name] = source[name];
  for (const name of handler.inheritEnv) if (source[name] !== undefined) env[name] = source[name];
  return env;
}

async function runProcess(handler, request, children) {
  const payload = `${JSON.stringify(request)}\n`;
  if (Buffer.byteLength(payload) > MAX_REQUEST_BYTES) throw Object.assign(new Error('Dynamic tool request exceeds 512 KiB'), { code: 'DYNAMIC_TOOL_REQUEST_TOO_LARGE' });
  return new Promise((resolve, reject) => {
    const child = spawn(handler.command, handler.args, {
      cwd: handler.cwd,
      env: childEnv(handler),
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    children.add(child);
    const stdout = [];
    let stdoutBytes = 0;
    let settled = false;
    let terminationError = null;
    let forceKillTimer = null;
    const timer = setTimeout(() => terminate(Object.assign(new Error('Dynamic tool process timed out'), { code: 'DYNAMIC_TOOL_TIMEOUT' })), handler.timeoutMs);
    timer.unref();
    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      children.delete(child);
      if (error) reject(error); else resolve(result);
    }
    function terminate(error) {
      if (settled || terminationError) return;
      terminationError = error;
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 1000);
      forceKillTimer.unref();
    }
    child.on('error', (error) => finish(Object.assign(error, { code: error.code || 'DYNAMIC_TOOL_SPAWN_FAILED' })));
    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > handler.maxOutputBytes) {
        terminate(Object.assign(new Error('Dynamic tool process output exceeds configured limit'), { code: 'DYNAMIC_TOOL_OUTPUT_TOO_LARGE' }));
        return;
      }
      stdout.push(Buffer.from(chunk));
    });
    child.stderr.resume();
    child.once('exit', (code, signal) => {
      if (settled) return;
      if (terminationError) return finish(terminationError);
      if (code !== 0) return finish(Object.assign(new Error(`Dynamic tool process failed (${signal || `exit ${code}`})`), { code: 'DYNAMIC_TOOL_PROCESS_FAILED' }));
      let parsed;
      try { parsed = JSON.parse(Buffer.concat(stdout).toString('utf8').trim()); }
      catch { return finish(Object.assign(new Error('Dynamic tool process returned invalid JSON'), { code: 'DYNAMIC_TOOL_INVALID_JSON' })); }
      try {
        assertPlainObject(parsed, 'dynamic tool response');
        if (typeof parsed.success !== 'boolean') throw new Error('Dynamic tool response success must be boolean');
        return finish(null, { contentItems: validateContentItems(parsed.contentItems), success: parsed.success });
      } catch (error) {
        return finish(Object.assign(error, { code: 'DYNAMIC_TOOL_INVALID_RESPONSE' }));
      }
    });
    child.stdin.on('error', (error) => finish(Object.assign(error, { code: 'DYNAMIC_TOOL_STDIN_FAILED' })));
    child.stdin.end(payload);
  });
}

export class DynamicToolHost {
  constructor({ tools = [], sourceFile = null, maxConcurrent = DEFAULT_MAX_CONCURRENT } = {}) {
    this.sourceFile = sourceFile;
    this.maxConcurrent = integer(maxConcurrent, DEFAULT_MAX_CONCURRENT, 1, 64);
    this.inFlight = 0;
    this.closed = false;
    this.children = new Set();
    this.tools = new Map();
    for (const tool of tools) {
      const key = toolKey(tool.namespace, tool.name);
      if (this.tools.has(key)) throw new Error(`Duplicate dynamic tool: ${tool.namespace ? `${tool.namespace}.` : ''}${tool.name}`);
      this.tools.set(key, tool);
    }
    this._specs = canonicalSpecs([...this.tools.values()]);
  }

  static load(file) {
    if (!file) return new DynamicToolHost();
    const resolved = path.resolve(file);
    const stat = fs.statSync(resolved);
    if (!stat.isFile() || stat.size > MAX_CONFIG_BYTES) throw new Error('Dynamic tool configuration must be a file <= 1 MiB');
    const raw = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    assertPlainObject(raw, 'dynamic tool configuration');
    if (raw.version !== 1) throw new Error('Dynamic tool configuration version must be 1');
    if (!Array.isArray(raw.tools) || raw.tools.length > 256) throw new Error('Dynamic tool configuration tools must contain at most 256 entries');
    const configDir = path.dirname(resolved);
    return new DynamicToolHost({ tools: raw.tools.map((tool) => normalizeTool(tool, configDir)), sourceFile: resolved, maxConcurrent: raw.maxConcurrent });
  }

  get size() { return this.tools.size; }
  get specs() { return structuredClone(this._specs); }
  canHandle(params) { return this.tools.has(toolKey(params?.namespace, params?.tool)); }

  async handle(params) {
    if (this.closed) return failure('Dynamic tool host is shutting down');
    const tool = this.tools.get(toolKey(params?.namespace, params?.tool));
    if (!tool) return null;
    if (this.inFlight >= this.maxConcurrent) return failure('Dynamic tool host is busy');
    const request = {
      threadId: String(params?.threadId || ''), turnId: String(params?.turnId || ''), callId: String(params?.callId || ''),
      namespace: params?.namespace == null ? null : String(params.namespace), tool: String(params?.tool || ''), arguments: params?.arguments ?? {},
    };
    this.inFlight += 1;
    try { return await runProcess(tool.handler, request, this.children); }
    catch (error) {
      const label = {
        DYNAMIC_TOOL_TIMEOUT: 'Dynamic tool timed out',
        DYNAMIC_TOOL_OUTPUT_TOO_LARGE: 'Dynamic tool returned too much output',
        DYNAMIC_TOOL_REQUEST_TOO_LARGE: 'Dynamic tool request was too large',
        DYNAMIC_TOOL_INVALID_JSON: 'Dynamic tool returned invalid JSON',
        DYNAMIC_TOOL_INVALID_RESPONSE: 'Dynamic tool returned an invalid response',
        DYNAMIC_TOOL_PROCESS_FAILED: 'Dynamic tool process failed',
        DYNAMIC_TOOL_SPAWN_FAILED: 'Dynamic tool could not be started',
      }[error.code] || 'Dynamic tool host failed';
      return failure(label);
    } finally { this.inFlight -= 1; }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const child of [...this.children]) {
      if (child.exitCode !== null) continue;
      child.kill('SIGTERM');
      const timer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 1000);
      timer.unref();
      child.once('exit', () => clearTimeout(timer));
    }
  }
}
