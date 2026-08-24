import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import readline from 'node:readline';

export class CodexRpcError extends Error {
  constructor(message, rpc) {
    super(message);
    this.name = 'CodexRpcError';
    this.rpc = rpc;
  }
}

export class CodexAppServer extends EventEmitter {
  constructor({ codexBin = 'codex', cwd, experimental = false, timeoutMs = 600_000 }) {
    super();
    this.codexBin = codexBin;
    this.cwd = cwd;
    this.experimental = experimental;
    this.timeoutMs = timeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    this.serverRequests = new Map();
    this.child = null;
    this.ready = null;
    this.closed = false;
  }

  start() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const child = spawn(this.codexBin, ['app-server', '--listen', 'stdio://'], {
        cwd: this.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });
      this.child = child;
      const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
      lines.on('line', (line) => this.#onLine(line));
      child.stderr.on('data', (chunk) => this.emit('stderr', chunk.toString()));
      child.once('error', (error) => {
        this.#failAll(error);
        reject(error);
      });
      child.once('exit', (code, signal) => {
        const error = new Error(`Codex App Server exited (${code ?? signal ?? 'unknown'})`);
        this.#failAll(error);
        this.emit('exit', { code, signal });
        if (!this.closed) this.emit('error', error);
      });

      this.#requestRaw('initialize', {
        clientInfo: {
          name: 'codex_app_server_web',
          title: 'Codex App Server Web',
          version: '0.1.0',
        },
        capabilities: {
          ...(this.experimental ? { experimentalApi: true } : {}),
          extensions: {
            'openai/form': {},
            'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] },
          },
        },
      }, 30_000).then((result) => {
        this.notify('initialized', {});
        this.initializeResult = result;
        resolve(result);
      }, reject);
    });
    return this.ready;
  }

  #send(message) {
    if (!this.child?.stdin?.writable) throw new Error('Codex App Server stdin is unavailable');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #onLine(line) {
    let message;
    try { message = JSON.parse(line); }
    catch {
      this.emit('protocolError', { line: line.slice(0, 4000) });
      return;
    }
    if (message.id !== undefined && message.method === undefined) {
      const key = String(message.id);
      const pending = this.pending.get(key);
      if (!pending) return;
      this.pending.delete(key);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new CodexRpcError(message.error.message || 'Codex RPC error', message.error));
      else pending.resolve(message.result);
      return;
    }
    if (message.id !== undefined && message.method) {
      this.serverRequests.set(String(message.id), message);
      this.emit('serverRequest', message);
      this.emit('message', message);
      return;
    }
    if (message.method) {
      this.emit('notification', message);
      this.emit('message', message);
    }
  }

  #requestRaw(method, params = {}, timeoutMs = this.timeoutMs) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(String(id));
        reject(new Error(`Codex request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(String(id), { resolve, reject, timer, method });
      try { this.#send({ id, method, params }); }
      catch (error) {
        clearTimeout(timer);
        this.pending.delete(String(id));
        reject(error);
      }
    });
  }

  async request(method, params = {}, timeoutMs = this.timeoutMs) {
    await this.start();
    return this.#requestRaw(method, params, timeoutMs);
  }

  async notify(method, params = {}) {
    if (method !== 'initialized') await this.start();
    this.#send({ method, params });
  }

  respond(id, result) {
    const key = String(id);
    if (!this.serverRequests.has(key)) throw Object.assign(new Error('Server request is no longer pending'), { status: 404 });
    this.#send({ id, result });
    this.serverRequests.delete(key);
  }

  respondError(id, error) {
    const key = String(id);
    if (!this.serverRequests.has(key)) throw Object.assign(new Error('Server request is no longer pending'), { status: 404 });
    this.#send({ id, error });
    this.serverRequests.delete(key);
  }

  pendingServerRequests() { return [...this.serverRequests.values()]; }

  #failAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  close() {
    this.closed = true;
    this.#failAll(new Error('Codex App Server client closed'));
    if (this.child && !this.child.killed) this.child.kill('SIGTERM');
  }
}
