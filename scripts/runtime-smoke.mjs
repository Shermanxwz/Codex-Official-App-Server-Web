import crypto from 'node:crypto';
import os from 'node:os';
import { CodexAppServer } from '../src/codex-client.mjs';

const codexBin = process.env.CWEB_CODEX_BIN || 'codex';
const cwd = process.env.CWEB_WORKSPACE || os.homedir();
const runModelTurn = /^(1|true|yes)$/i.test(process.env.CWEB_RUNTIME_SMOKE_MODEL_TURN || '');
const timeoutMs = Math.max(30_000, Math.min(600_000, Number(process.env.CWEB_RUNTIME_SMOKE_TIMEOUT_MS) || 240_000));
const sentinel = `CWEB_RUNTIME_SMOKE_OK_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
const notifications = [];
const client = new CodexAppServer({
  codexBin,
  cwd,
  experimental: true,
  timeoutMs,
  maxPending: 16,
  maxServerRequests: 16,
  maxLineBytes: 128 * 1024 * 1024,
});

let threadId = '';
let deleted = false;

client.on('notification', (message) => {
  notifications.push(message);
  if (notifications.length > 2_048) notifications.shift();
});

client.on('serverRequest', (message) => {
  try {
    client.respondError(message.id, {
      code: -32000,
      message: `Unexpected server request during non-interactive runtime smoke: ${message.method}`,
    });
  } catch { /* transport may already be closing */ }
});

function rows(result) {
  if (Array.isArray(result)) return result;
  return result?.data || result?.items || result?.turns || [];
}

function messageThreadId(message) {
  const params = message?.params || {};
  return String(params.threadId || params.thread?.id || params.turn?.threadId || '');
}

function messageTurnId(message) {
  const params = message?.params || {};
  return String(params.turnId || params.turn?.id || '');
}

function statusKey(value) {
  return String(value?.type || value || '').toLowerCase().replace(/[\s_-]/g, '');
}

async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForNotification(predicate, label) {
  const existing = notifications.find(predicate);
  if (existing) return existing;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off('notification', onNotification);
      reject(new Error(`Timed out waiting for ${label}`));
    }, timeoutMs);
    const onNotification = (message) => {
      if (!predicate(message)) return;
      clearTimeout(timer);
      client.off('notification', onNotification);
      resolve(message);
    };
    client.on('notification', onNotification);
  });
}

async function readPersistedTurn(targetTurnId) {
  let latest = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const page = await client.request('thread/turns/list', {
      threadId,
      limit: 10,
      sortDirection: 'desc',
      itemsView: 'notLoaded',
    });
    latest = rows(page).find((turn) => String(turn?.id || '') === targetTurnId) || null;
    if (latest) return latest;
    await delay(500);
  }
  throw new Error(`Completed Turn ${targetTurnId} was not visible through thread/turns/list`);
}

async function readPersistedItems(targetTurnId) {
  const collected = [];
  let cursor = null;
  for (let page = 0; page < 100; page += 1) {
    const result = await client.request('thread/items/list', {
      threadId,
      turnId: targetTurnId,
      limit: 100,
      sortDirection: 'asc',
      ...(cursor ? { cursor } : {}),
    });
    collected.push(...rows(result).map((entry) => entry?.item || entry));
    cursor = result?.nextCursor || result?.next_cursor || null;
    if (!cursor) return collected;
  }
  throw new Error('thread/items/list exceeded the 100-page smoke-test safety bound');
}

try {
  const initialize = await client.start();
  const account = await client.request('account/read', {});
  const models = await client.request('model/list', {});
  if (!account?.account && account?.requiresOpenaiAuth !== false) throw new Error('Official Codex account is not signed in or usable');
  if (!rows(models).length) throw new Error('Official model/list returned no models');

  const started = await client.request('thread/start', {
    cwd,
    approvalPolicy: 'never',
    sandbox: 'read-only',
    historyMode: 'paginated',
    serviceName: 'codex_app_server_web_runtime_smoke',
  });
  const thread = started?.thread || started;
  threadId = String(thread?.id || '');
  if (!threadId) throw new Error('Official thread/start returned no thread id');
  if (thread?.historyMode !== 'paginated') throw new Error(`Official thread/start did not honor paginated history (got ${thread?.historyMode || 'missing'})`);

  const read = await client.request('thread/read', { threadId, includeTurns: false });
  const readThread = read?.thread || read;
  if (String(readThread?.id || '') !== threadId) throw new Error('Official thread/read returned the wrong thread');
  if (readThread?.historyMode !== 'paginated') throw new Error(`Official thread/read lost paginated history mode (got ${readThread?.historyMode || 'missing'})`);

  let modelTurn = null;
  let historyRuntimeProof = 'pre-materialization-contract';
  if (runModelTurn) {
    const turnStarted = await client.request('turn/start', {
      threadId,
      input: [{
        type: 'text',
        text: `Reply with exactly ${sentinel}. Do not use tools, inspect files, or add any other text.`,
      }],
      clientUserMessageId: `cweb-runtime-smoke-${crypto.randomUUID()}`,
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'readOnly' },
    });
    const turnId = String(turnStarted?.turn?.id || turnStarted?.id || '');
    if (!turnId) throw new Error('Official turn/start returned no turn id');
    const completed = await waitForNotification((message) => (
      message?.method === 'turn/completed'
      && messageThreadId(message) === threadId
      && messageTurnId(message) === turnId
    ), `turn/completed for ${turnId}`);
    const terminalStatus = statusKey(completed?.params?.turn?.status || completed?.params?.status);
    if (terminalStatus && !['completed', 'success'].includes(terminalStatus)) {
      throw new Error(`Official model Turn ended with ${terminalStatus}`);
    }
    const persistedTurn = await readPersistedTurn(turnId);
    const items = await readPersistedItems(turnId);
    const agentText = items
      .filter((item) => item?.type === 'agentMessage')
      .map((item) => String(item?.text || ''))
      .join('\n');
    if (!agentText.includes(sentinel)) throw new Error('Persisted official agent message did not contain the smoke sentinel');
    modelTurn = {
      completed: true,
      persisted: String(persistedTurn?.id || '') === turnId,
      items: items.length,
      agentMessageVerified: true,
    };
    historyRuntimeProof = 'persisted-turn-and-items';
  } else {
    // A fresh paginated thread is intentionally not materialized until its
    // first user message. A protocol-only smoke still proves that both methods
    // reached the official runtime and produced its explicit lifecycle error;
    // the metered model-Turn mode above proves persisted paging end to end.
    for (const [method, params] of [
      ['thread/turns/list', { threadId, limit: 1, sortDirection: 'desc', itemsView: 'notLoaded' }],
      ['thread/items/list', { threadId, limit: 1, sortDirection: 'asc' }],
    ]) {
      try { await client.request(method, params); }
      catch (error) {
        if (!/not materialized yet|before first user message/i.test(String(error?.message || ''))) throw error;
      }
    }
  }

  await client.request('thread/delete', { threadId });
  deleted = true;
  const result = {
    ok: true,
    codexVersion: initialize?.userAgent || null,
    platformFamily: initialize?.platformFamily || null,
    platformOs: initialize?.platformOs || null,
    accountType: account?.account?.type || 'configured',
    models: rows(models).length,
    historyMode: 'paginated',
    historyMethods: ['thread/turns/list', 'thread/items/list'],
    historyRuntimeProof,
    modelTurn,
    cleanup: 'thread/delete',
  };
  console.log(JSON.stringify(result, null, 2));
  console.log(runModelTurn ? 'RUNTIME_MODEL_TURN_SMOKE_OK' : 'RUNTIME_PROTOCOL_SMOKE_OK');
} finally {
  if (threadId && !deleted) {
    try { await client.request('thread/delete', { threadId }, 30_000); }
    catch (error) { console.error(`WARNING: runtime smoke cleanup failed: ${error.message}`); }
  }
  client.close();
}
