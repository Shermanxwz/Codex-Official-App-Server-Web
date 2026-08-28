import test from 'node:test';
import assert from 'node:assert/strict';
import { appendOfficialEvent, officialEventEntry } from '../public/official-events.js';

test('official notification fallback keeps a bounded chronological log', () => {
  let entries = [];
  for (let index = 0; index < 12; index += 1) {
    entries = appendOfficialEvent(entries, {
      method: `process/event-${index}`,
      params: { index },
    }, { maxEntries: 5, maxBytes: 64 * 1024, maxEventBytes: 8 * 1024 });
  }
  assert.equal(entries.length, 5);
  assert.equal(entries[0].method, 'process/event-7');
  assert.equal(entries.at(-1).method, 'process/event-11');
});

test('oversized official notifications retain identity without retaining payload', () => {
  const entry = officialEventEntry({
    method: 'mcpServer/event/stream/notification',
    params: { data: 'x'.repeat(4096) },
  }, 123, { maxEntries: 10, maxBytes: 2048, maxEventBytes: 128 });
  assert.equal(entry.method, 'mcpServer/event/stream/notification');
  assert.equal(entry.at, 123);
  assert.equal(entry.truncated, true);
  assert.match(entry.json, /"truncated": true/);
  assert.doesNotMatch(entry.json, /x{128}/);
});

test('transport-oversize metadata retains the original byte count', () => {
  const entry = officialEventEntry({
    method: 'process/outputDelta',
    params: { transportOversize: true, payloadBytes: 8 * 1024 * 1024 },
  }, 456);
  assert.equal(entry.at, 456);
  assert.equal(entry.truncated, true);
  assert.equal(entry.payloadBytes, 8 * 1024 * 1024);
  assert.match(entry.json, /"payloadBytes": 8388608/);
});

test('official event byte budget evicts only complete oldest entries', () => {
  let entries = [];
  for (let index = 0; index < 20; index += 1) {
    entries = appendOfficialEvent(entries, {
      method: 'process/outputDelta',
      params: { index, deltaBase64: 'a'.repeat(80) },
    }, { maxEntries: 100, maxBytes: 600, maxEventBytes: 512 });
  }
  assert.ok(entries.length > 0 && entries.length < 20);
  assert.ok(entries.reduce((sum, entry) => sum + entry.storageBytes, 0) <= 600 || entries.length === 1);
  assert.equal(JSON.parse(entries.at(-1).json).params.index, 19);
});
