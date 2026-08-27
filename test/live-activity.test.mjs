import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyOfficialActivity,
  inferOfficialActiveTurnId,
  isActiveOfficialStatus,
} from '../public/live-activity.js';

const thread = {
  id: 'thread-1',
  status: { type: 'idle' },
  turns: [
    { id: 'turn-old', status: 'completed' },
    { id: 'turn-current', status: 'completed' },
  ],
};

test('official activity classifier follows a foreign turn without claiming Web ownership', () => {
  const started = classifyOfficialActivity({
    method: 'turn/started',
    params: { threadId: 'thread-1', turn: { id: 'turn-foreign', status: 'inProgress' } },
  }, { currentThreadId: 'thread-1', thread });
  assert.deepEqual(started, { kind: 'started', active: true, turnId: 'turn-foreign', threadId: 'thread-1' });

  const plan = classifyOfficialActivity({
    method: 'turn/plan/updated',
    params: { threadId: 'thread-1', turnId: 'turn-foreign', plan: [{ step: 'work', status: 'inProgress' }] },
  }, { currentThreadId: 'thread-1', thread });
  assert.equal(plan.kind, 'plan');
  assert.equal(plan.turnId, 'turn-foreign');

  const delta = classifyOfficialActivity({
    method: 'item/agentMessage/delta',
    params: { threadId: 'thread-1', turnId: 'turn-foreign', itemId: 'item-1', delta: 'reply' },
  }, { currentThreadId: 'thread-1', thread });
  assert.deepEqual(delta, { kind: 'activity', active: true, turnId: 'turn-foreign', threadId: 'thread-1' });

  const completed = classifyOfficialActivity({
    method: 'turn/completed',
    params: { threadId: 'thread-1', turn: { id: 'turn-foreign', status: 'completed' } },
  }, { currentThreadId: 'thread-1', thread });
  assert.equal(completed.kind, 'terminal');
  assert.equal(completed.turnId, 'turn-foreign');
});

test('thread/status/changed active is sufficient even though the official event has no turnId', () => {
  const activeThread = { ...thread, status: { type: 'active', activeFlags: [] }, turns: [...thread.turns, { id: 'turn-latest', status: 'completed' }] };
  const event = classifyOfficialActivity({
    method: 'thread/status/changed',
    params: { threadId: 'thread-1', status: { type: 'active', activeFlags: [] } },
  }, { currentThreadId: 'thread-1', thread: activeThread });
  assert.equal(event.kind, 'threadStatus');
  assert.equal(event.active, true);
  assert.equal(event.turnId, 'turn-latest');
  assert.equal(inferOfficialActiveTurnId(activeThread), 'turn-latest');
  assert.equal(isActiveOfficialStatus({ type: 'active', activeFlags: [] }), true);

  const noHistory = classifyOfficialActivity({
    method: 'thread/status/changed',
    params: { threadId: 'thread-1', status: { type: 'active', activeFlags: [] } },
  }, { currentThreadId: 'thread-1', thread: { id: 'thread-1', turns: [], status: { type: 'idle' } } });
  assert.equal(noHistory.active, true);
  assert.equal(noHistory.turnId, null);
});

test('thread/status/changed idle clears activity and unrelated threads are ignored', () => {
  const idle = classifyOfficialActivity({
    method: 'thread/status/changed',
    params: { threadId: 'thread-1', status: { type: 'idle' } },
  }, { currentThreadId: 'thread-1', thread });
  assert.deepEqual(idle, { kind: 'threadStatus', active: false, turnId: '', threadId: 'thread-1', status: { type: 'idle' } });

  assert.equal(classifyOfficialActivity({
    method: 'turn/started',
    params: { threadId: 'other-thread', turn: { id: 'turn-other', status: 'inProgress' } },
  }, { currentThreadId: 'thread-1', thread }), null);
});
