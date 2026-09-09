import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SERVER_NOTIFICATION_DIAGNOSTIC_ONLY,
  SERVER_NOTIFICATION_FALLBACK,
  SERVER_NOTIFICATION_SPECIALIZED_UI,
  SERVER_NOTIFICATION_TIMELINE_DEFAULT,
  TIMELINE_DELTA_NOTIFICATIONS,
  protocolSupportSummary,
  serverNotificationDisposition,
  timelineNotificationKind,
} from '../public/protocol-support.js';
import { appendOfficialEvent } from '../public/official-events.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');

test('server notifications fail closed at the human timeline boundary', () => {
  assert.equal(SERVER_NOTIFICATION_FALLBACK, 'official-event-log');
  assert.equal(SERVER_NOTIFICATION_TIMELINE_DEFAULT, 'official-event-log-only');

  assert.equal(serverNotificationDisposition('item/agentMessage/delta'), 'timeline-delta');
  assert.equal(serverNotificationDisposition('thread/tokenUsage/updated'), 'specialized-ui');
  assert.equal(serverNotificationDisposition('item/commandExecution/terminalInteraction'), 'official-event-log-only');
  assert.equal(serverNotificationDisposition('future/new/serverNotification'), 'official-event-log-only');

  assert.equal(timelineNotificationKind('item/agentMessage/delta'), 'agent');
  assert.equal(timelineNotificationKind('thread/tokenUsage/updated'), undefined);
  assert.equal(timelineNotificationKind('item/commandExecution/terminalInteraction'), 'ignore');
  assert.equal(timelineNotificationKind('future/new/serverNotification'), 'ignore');

  assert.equal(TIMELINE_DELTA_NOTIFICATIONS['item/commandExecution/terminalInteraction'], 'ignore');
  assert.equal(TIMELINE_DELTA_NOTIFICATIONS['future/new/serverNotification'], 'ignore');
  assert.equal(TIMELINE_DELTA_NOTIFICATIONS['thread/tokenUsage/updated'], undefined);
  assert.ok(SERVER_NOTIFICATION_DIAGNOSTIC_ONLY.includes('item/commandExecution/terminalInteraction'));
  assert.ok(SERVER_NOTIFICATION_SPECIALIZED_UI.includes('item/started'));

  const summary = protocolSupportSummary();
  assert.equal(summary.serverNotificationFallback, 'official-event-log');
  assert.equal(summary.serverNotificationTimelineDefault, 'official-event-log-only');
});

test('raw system-event fallback is gated behind the sealed router in both live handlers', () => {
  const legacyStart = app.indexOf('function appendLiveLegacy(message)');
  const liveStart = app.indexOf('function appendLive(message)');
  assert.ok(legacyStart >= 0, 'appendLiveLegacy is missing');
  assert.ok(liveStart >= 0, 'appendLive is missing');

  const legacyEnd = app.indexOf('function showContextCompaction', legacyStart);
  const liveEnd = app.indexOf('function syncContextCompactionLifecycle', liveStart);
  const legacy = app.slice(legacyStart, legacyEnd);
  const live = app.slice(liveStart, liveEnd);

  for (const [name, source] of [['legacy', legacy], ['live', live]]) {
    const router = source.indexOf('TIMELINE_DELTA_NOTIFICATIONS[m]');
    const rawFallback = source.indexOf('if(p.turnId||p.itemId)');
    assert.ok(router >= 0, `${name} handler is missing notification routing`);
    assert.ok(rawFallback >= 0, `${name} handler is missing the compatibility fallback`);
    assert.ok(router < rawFallback, `${name} compatibility fallback runs before the sealed router`);
  }
});

test('official observability happens before timeline handling', () => {
  assert.match(
    app,
    /if\(e\.type==='notification'\)\{recordOfficialNotification\(e\.payload\);appendLive\(e\.payload\)\}/,
  );

  let entries = [];
  for (let i = 0; i < 260; i += 1) {
    entries = appendOfficialEvent(entries, {
      method: 'item/commandExecution/terminalInteraction',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'item-1',
        processId: 'process-1',
        stdin: '',
      },
    });
  }
  assert.equal(entries.length, 200);
  assert.ok(entries.every((entry) => entry.method === 'item/commandExecution/terminalInteraction'));
});
