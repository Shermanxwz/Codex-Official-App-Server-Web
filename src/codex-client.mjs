import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';

export class CodexRpcError extends Error {
  constructor(message, rpc) {
    super(message);
    this.name = 'CodexRpcError';
    this.rpc = rpc;
  }
}

export class CodexClientBusyError extends Error {
  constructor(message = 'Codex App Server client is busy') {
    super(message);
    this.name = 'CodexClientBusyError';
    this.status = 503;
    this.code = 'CODEX_CLIENT_BUSY';
  }
}

export function sanitizedCodexEnv(source = process.env) {
  return Object.fromEntries(Object.entries(source).filter(([key]) => !key.startsWith('CWEB_')));
}

export class CodexAppServer extends EventEmitter {
  constructor({
    codexBin = 'codex', cwd, transport = 'stdio', serverUrl = 'ws://127.0.0.1:43999',
    experimental = false, capabilities = {}, timeoutMs = 600_000,
    maxPending = 64, maxServerRequests = maxPending, maxStdinBufferBytes = 4 * 1024 * 1024,
    maxLineBytes = 32 * 1024 * 1024,
  }) {
    super();
    this.codexBin = codexBin;
    this.cwd = cwd;
    this.transport = transport === 'websocket' ? 'websocket' : 'stdio';
    this.serverUrl = serverUrl;
    this.experimental = experimental;
    this.capabilities = capabilities && typeof capabilities === 'object' ? capabilities : {};
    this.timeoutMs = timeoutMs;
    this.maxPending = maxPending;
    this.maxServerRequests = maxServerRequests;
    this.maxStdinBufferBytes = maxStdinBufferBytes;
    this.maxLineBytes = maxLineBytes;
    this.nextId = 1;
    this.pending = new Map();
    this.serverRequests = new Map();
    this.child = null;
    this.socket = null;
    this.ready = null;
    this.closed = false;
    this.initializeResult = null;
    this.generation = 0;
    this.protocolTerminationGeneration = null;
    this.stdoutBuffer = Buffer.alloc(0);
  }

  start() {
    if (this.closed) return Promise.reject(new Error('Codex App Server client is closed'));
    if (this.ready) return this.ready;
    const promise = this.#startTransport();
    this.ready = promise;
    promise.catch(() => { if (this.ready === promise) this.ready = null; });
    return promise;
  }

  #startTransport() {
    return this.transport === 'websocket' ? this.#startWebSocket() : this.#startProcess();
  }

  #initializeCapabilities() {
    const configuredExtensions = this.capabilities.extensions && typeof this.capabilities.extensions === 'object'
      ? this.capabilities.extensions : {};
    const extensions = Object.fromEntries(
      Object.entries({ 'openai/form': {}, ...configuredExtensions }).filter(([, value]) => value !== undefined),
    );
    const capabilities = {
      ...(this.experimental ? { experimentalApi: true } : {}),
      ...this.capabilities,
      extensions,
    };
    if (!Array.isArray(capabilities.optOutNotificationMethods) || !capabilities.optOutNotificationMethods.length) {
      delete capabilities.optOutNotificationMethods;
    }
    if (!capabilities.requestAttestation) delete capabilities.requestAttestation;
    if (!capabilities.experimentalApi) delete capabilities.experimentalApi;
    return capabilities;
  }

  async #startProcess() {
    const generation = ++this.generation;
    const child = spawn(this.codexBin, ['app-server', '--listen', 'stdio://'], {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: sanitizedCodexEnv(),
    });
    this.child = child;
    this.stdoutBuffer = Buffer.alloc(0);

    const failTransport = (error) => {
      if (this.child !== child || generation !== this.generation) return;
      this.#failAll(error);
      this.emit('transportError', { error, generation });
    };
    child.stdout.on('data', (chunk) => this.#onStdoutChunk(child, generation, chunk));
    child.stderr.on('data', (chunk) => { if (this.child === child) this.emit('stderr', chunk.toString()); });
    child.stdin.on('error', failTransport);
    child.once('error', failTransport);
    child.once('exit', (code, signal) => this.#onExit(child, generation, code, signal));

    try {
      const result = await this.#requestRaw('initialize', {
        clientInfo: { name: 'codex_app_server_web', title: 'Codex App Server Web', version: '0.4.0' },
        capabilities: this.#initializeCapabilities(),
      }, 30_000);
      if (this.child !== child || generation !== this.generation) throw new Error('Codex App Server changed during initialization');
      this.#send({ method: 'initialized', params: {} });
      this.initializeResult = result;
      this.emit('ready', result);
      return result;
    } catch (error) {
      this.emit('startError', {
        error,
        generation,
        pid: child.pid,
        pendingMethods: [...this.pending.values()].map((pending) => pending.method),
      });
      if (this.child === child && !child.killed) child.kill('SIGTERM');
      throw error;
    }
  }

  async #startWebSocket() {
    const WebSocketImpl = globalThis.WebSocket;
    if (typeof WebSocketImpl !== 'function') {
      const error = new Error('This Node.js runtime does not provide the WebSocket client required by CWEB_CODEX_TRANSPORT=websocket');
      error.code = 'WEBSOCKET_UNAVAILABLE';
      throw error;
    }
    const generation = ++this.generation;
    let socket;
    try { socket = new WebSocketImpl(this.serverUrl); }
    catch (error) {
      error.code ||= 'CODEX_WEBSOCKET_CONNECT_FAILED';
      throw error;
    }
    this.socket = socket;
    let opened = false;
    let ended = false;
    let resolveOpen;
    let rejectOpen;
    const opening = new Promise((resolve, reject) => { resolveOpen = resolve; rejectOpen = reject; });
    const transportError = (message, cause = null) => {
      if (this.socket !== socket || generation !== this.generation || ended) return;
      const error = new Error(message);
      error.code = 'CODEX_WEBSOCKET_DISCONNECTED';
      if (cause) error.cause = cause;
      if (!opened) rejectOpen(error);
      this.#onSocketExit(socket, generation, null, '', error);
      ended = true;
    };
    socket.addEventListener('open', () => {
      if (this.socket !== socket || generation !== this.generation || ended) return;
      opened = true;
      resolveOpen();
    });
    socket.addEventListener('error', (event) => {
      const detail = event?.message ? `: ${event.message}` : '';
      transportError(`Codex App Server WebSocket error${detail}`, event);
    });
    socket.addEventListener('close', (event) => {
      if (this.socket !== socket || generation !== this.generation || ended) return;
      const detail = event?.reason ? `: ${event.reason}` : '';
      const error = new Error(`Codex App Server WebSocket closed (${event?.code ?? 'unknown'})${detail}`);
      error.code = 'CODEX_WEBSOCKET_DISCONNECTED';
      if (!opened) rejectOpen(error);
      this.#onSocketExit(socket, generation, event?.code ?? null, event?.reason || '', error);
      ended = true;
    });
    socket.addEventListener('message', (event) => {
      void this.#onWebSocketMessage(socket, generation, event?.data).catch((error) => {
        transportError(`Codex App Server WebSocket message could not be read: ${error.message}`, error);
      });
    });

    try {
      await opening;
      const result = await this.#requestRaw('initialize', {
        clientInfo: { name: 'codex_app_server_web', title: 'Codex App Server Web', version: '0.4.0' },
        capabilities: this.#initializeCapabilities(),
      }, 30_000);
      if (this.socket !== socket || generation !== this.generation || ended) throw new Error('Codex App Server WebSocket changed during initialization');
      this.#send({ method: 'initialized', params: {} });
      this.initializeResult = result;
      this.emit('ready', result);
      return result;
    } catch (error) {
      this.emit('startError', {
        error,
        generation,
        url: this.serverUrl,
        pendingMethods: [...this.pending.values()].map((pending) => pending.method),
      });
      if (this.socket === socket && !ended) {
        ended = true;
        try { socket.close(); } catch { /* ignore */ }
        this.#onSocketExit(socket, generation, null, '', error);
      }
      throw error;
    }
  }

  async #onWebSocketMessage(socket, generation, data) {
    if (this.socket !== socket || generation !== this.generation) return;
    let text;
    if (typeof data === 'string') text = data;
    else if (data instanceof ArrayBuffer) text = new TextDecoder().decode(data);
    else if (ArrayBuffer.isView(data)) text = new TextDecoder().decode(data);
    else if (data && typeof data.text === 'function') text = await data.text();
    else text = String(data ?? '');
    if (!text) return;
    if (Buffer.byteLength(text) > this.maxLineBytes) {
      if (this.protocolTerminationGeneration === generation) return;
      this.protocolTerminationGeneration = generation;
      const error = new Error(`Codex App Server emitted a WebSocket message larger than ${this.maxLineBytes} bytes`);
      error.code = 'CODEX_PROTOCOL_LINE_TOO_LARGE';
      this.emit('protocolError', { message: error.message, code: error.code });
      try { socket.close(1009, 'message too large'); } catch { /* handled by close/error */ }
      return;
    }
    // The official WebSocket transport sends one JSON object per message. The
    // split also accepts JSONL from compatible proxies without weakening the
    // same per-message protocol parser and limits.
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) this.#onLine(line.trim());
    }
  }

  #onStdoutChunk(child, generation, chunk) {
    if (this.child !== child || generation !== this.generation) return;
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, Buffer.from(chunk)]);
    if (this.stdoutBuffer.length > this.maxLineBytes && this.stdoutBuffer.indexOf(0x0a) === -1) {
      const error = new Error(`Codex App Server emitted a JSONL line larger than ${this.maxLineBytes} bytes`);
      error.code = 'CODEX_PROTOCOL_LINE_TOO_LARGE';
      this.#terminateForProtocolError(child, generation, error);
      return;
    }
    for (;;) {
      const newline = this.stdoutBuffer.indexOf(0x0a);
      if (newline < 0) break;
      const line = this.stdoutBuffer.subarray(0, newline);
      this.stdoutBuffer = this.stdoutBuffer.subarray(newline + 1);
      if (!line.length) continue;
      if (line.length > this.maxLineBytes) {
        const error = new Error(`Codex App Server emitted a JSONL line larger than ${this.maxLineBytes} bytes`);
        error.code = 'CODEX_PROTOCOL_LINE_TOO_LARGE';
        this.#terminateForProtocolError(child, generation, error);
        return;
      }
      this.#onLine(line.toString('utf8'));
    }
  }

  #terminateForProtocolError(child, generation, error) {
    if (this.child !== child || generation !== this.generation || this.protocolTerminationGeneration === generation) return;
    this.protocolTerminationGeneration = generation;
    this.emit('protocolError', { message: error.message, code: error.code });
    child.kill('SIGTERM');
  }

  #send(message) {
    if (this.transport === 'websocket') {
      const socket = this.socket;
      if (!socket || socket.readyState !== 1) throw new Error('Codex App Server WebSocket is unavailable');
      const data = JSON.stringify(message);
      const bytes = Buffer.byteLength(data);
      if ((socket.bufferedAmount || 0) + bytes > this.maxStdinBufferBytes) {
        throw new CodexClientBusyError('Codex App Server WebSocket backpressure limit reached');
      }
      try { socket.send(data); }
      catch (error) {
        if (this.socket === socket) this.#failAll(error);
        throw error;
      }
      return;
    }
    const child = this.child;
    if (!child?.stdin?.writable) throw new Error('Codex App Server stdin is unavailable');
    const data = `${JSON.stringify(message)}\n`;
    const bytes = Buffer.byteLength(data);
    if (child.stdin.writableLength + bytes > this.maxStdinBufferBytes) {
      throw new CodexClientBusyError('Codex App Server stdin backpressure limit reached');
    }
    try { child.stdin.write(data); }
    catch (error) {
      if (this.child === child) this.#failAll(error);
      throw error;
    }
  }

  #onLine(line) {
    let message;
    try { message = JSON.parse(line); }
    catch {
      this.emit('protocolError', { message: 'Malformed JSON from Codex App Server', line: line.slice(0, 4000) });
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
      const key = String(message.id);
      if (!this.serverRequests.has(key) && this.serverRequests.size >= this.maxServerRequests) {
        try { this.#send({ id: message.id, error: { code: -32001, message: 'Web client server-request capacity reached; retry later.' } }); } catch { /* handled by child lifecycle */ }
        this.emit('protocolError', { message: 'Codex server-request capacity reached', method: message.method });
        return;
      }
      this.serverRequests.set(key, message);
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
    if (this.pending.size >= this.maxPending) return Promise.reject(new CodexClientBusyError());
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(String(id));
        const error = new Error(`Codex request timed out: ${method}`);
        error.code = 'CODEX_RPC_TIMEOUT';
        reject(error);
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
    await this.start();
    this.#send({ method, params });
  }

  respond(id, result) {
    const key = String(id);
    if (!this.serverRequests.has(key)) throw Object.assign(new Error('Server request is no longer pending'), { status: 404, code: 'SERVER_REQUEST_NOT_PENDING' });
    this.#send({ id, result });
    this.serverRequests.delete(key);
  }

  respondError(id, error) {
    const key = String(id);
    if (!this.serverRequests.has(key)) throw Object.assign(new Error('Server request is no longer pending'), { status: 404, code: 'SERVER_REQUEST_NOT_PENDING' });
    this.#send({ id, error });
    this.serverRequests.delete(key);
  }

  pendingServerRequests() { return [...this.serverRequests.values()]; }
  isReady() {
    const transportReady = this.transport === 'websocket'
      ? this.socket?.readyState === 1
      : this.child?.stdin?.writable;
    return Boolean(transportReady && this.initializeResult && this.ready);
  }

  #clearServerRequests(reason) {
    if (!this.serverRequests.size) return;
    const ids = [...this.serverRequests.keys()];
    this.serverRequests.clear();
    this.emit('serverRequestsCleared', { ids, reason: reason?.message || String(reason || 'connection closed') });
  }

  #failAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  #onExit(child, generation, code, signal) {
    if (this.child !== child || generation !== this.generation) return;
    const error = new Error(`Codex App Server exited (${code ?? signal ?? 'unknown'})`);
    error.code = 'CODEX_APP_SERVER_EXITED';
    const pendingMethods = [...this.pending.values()].map((pending) => pending.method);
    const exit = {
      code,
      signal,
      generation,
      pid: child.pid,
      killed: child.killed,
      exitCode: child.exitCode,
      signalCode: child.signalCode,
      pendingMethods,
    };
    this.child = null;
    this.ready = null;
    this.initializeResult = null;
    this.stdoutBuffer = Buffer.alloc(0);
    this.#failAll(error);
    this.#clearServerRequests(error);
    this.emit('exit', exit);
    if (!this.closed) this.emit('crash', error);
  }

  #onSocketExit(socket, generation, closeCode, closeReason, suppliedError = null) {
    if (this.socket !== socket || generation !== this.generation) return;
    const error = suppliedError || new Error(`Codex App Server WebSocket closed (${closeCode ?? 'unknown'})`);
    error.code ||= 'CODEX_WEBSOCKET_DISCONNECTED';
    this.socket = null;
    this.ready = null;
    this.initializeResult = null;
    const pendingMethods = [...this.pending.values()].map((pending) => pending.method);
    this.#failAll(error);
    this.#clearServerRequests(error);
    this.emit('exit', {
      code: null,
      signal: null,
      generation,
      pid: null,
      killed: false,
      exitCode: null,
      signalCode: null,
      closeCode,
      closeReason,
      transport: 'websocket',
      pendingMethods,
    });
    if (!this.closed) this.emit('crash', error);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.ready = null;
    this.initializeResult = null;
    this.#failAll(new Error('Codex App Server client closed'));
    this.#clearServerRequests(new Error('Codex App Server client closed'));
    const socket = this.socket;
    this.socket = null;
    if (socket && (socket.readyState === 0 || socket.readyState === 1)) {
      try { socket.close(1000, 'gateway shutdown'); } catch { /* ignore */ }
    }
    const child = this.child;
    this.child = null;
    if (child && child.exitCode === null && !child.killed) {
      child.kill('SIGTERM');
      const force = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 4_000);
      force.unref();
      child.once('exit', () => clearTimeout(force));
    }
  }
}
