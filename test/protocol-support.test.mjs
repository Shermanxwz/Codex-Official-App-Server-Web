import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MANUAL_SERVER_REQUESTS, NATIVE_SERVER_REQUESTS, PLATFORM_ONLY_SERVER_REQUESTS,
  SERVER_REQUEST_SUPPORT, THREAD_ITEM_TYPES, protocolSupportSummary,
} from '../public/protocol-support.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('archive support registry covers every current first-class Codex item disposition', () => {
  assert.equal(THREAD_ITEM_TYPES.length, 18);
  assert.equal(new Set(THREAD_ITEM_TYPES).size, THREAD_ITEM_TYPES.length);
  const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
  for (const type of THREAD_ITEM_TYPES) assert.match(app, new RegExp(`case ['\"]${type}['\"]`), `missing native renderer disposition for ${type}`);
});

test('all declared ServerRequest methods have one explicit trust/UI disposition', () => {
  const entries = Object.entries(SERVER_REQUEST_SUPPORT);
  assert.equal(entries.length, 10);
  assert.equal(new Set(entries.map(([method]) => method)).size, entries.length);
  assert.deepEqual(new Set([...NATIVE_SERVER_REQUESTS, ...MANUAL_SERVER_REQUESTS, ...PLATFORM_ONLY_SERVER_REQUESTS]), new Set(entries.map(([method]) => method)));
  assert.equal(PLATFORM_ONLY_SERVER_REQUESTS.includes('attestation/generate'), true);
  assert.equal(PLATFORM_ONLY_SERVER_REQUESTS.includes('account/chatgptAuthTokens/refresh'), true);
});

test('published support summary is conservative about MCP Apps hosting', () => {
  const summary = protocolSupportSummary();
  assert.equal(summary.threadItemTypes, 18);
  assert.equal(summary.serverRequests, 10);
  assert.equal(summary.openaiForm, true);
  assert.equal(summary.mcpAppsHost, false);
});

test('runtime server does not advertise MCP Apps UI without a complete host bridge', () => {
  const server = fs.readFileSync(path.join(root, 'src/server.mjs'), 'utf8');
  assert.match(server, /'io\.modelcontextprotocol\/ui': undefined/);
  assert.match(server, /mcpAppsAdvertised: false/);
  assert.match(server, /extensions: \{ 'openai\/form': \{\} \}/);
});

test('legacy and v2 approval decision vocabularies remain separate', () => {
  const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
  for (const token of ["decision: 'approved'", "decision: 'approved_for_session'", "decision: 'accept'", "decision: 'acceptForSession'"]) assert.ok(app.includes(token), token);
  assert.ok(app.includes("action: 'accept', content:"));
  assert.ok(app.includes('_meta: null'));
});
