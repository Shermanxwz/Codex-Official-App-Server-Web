import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCollaborationMode,
  extractPlanModeState,
  normalizePlanMode,
} from '../public/plan-mode-state.js';

test('normalizes only the two official collaboration modes', () => {
  assert.equal(normalizePlanMode('PLAN'), 'plan');
  assert.equal(normalizePlanMode(' default '), 'default');
  assert.equal(normalizePlanMode('unknown'), null);
  assert.equal(normalizePlanMode(null), null);
});

test('extracts authoritative Plan mode from the official update notification', () => {
  assert.deepEqual(
    extractPlanModeState({
      method: 'thread/settings/updated',
      params: {
        threadId: 'thread-plan',
        threadSettings: { collaborationMode: { mode: 'plan', settings: {} } },
      },
    }),
    { threadId: 'thread-plan', mode: 'plan', enabled: true },
  );
  assert.deepEqual(
    extractPlanModeState({
      params: {
        threadId: 'thread-default',
        threadSettings: { collaborationMode: { mode: 'default', settings: {} } },
      },
    }),
    { threadId: 'thread-default', mode: 'default', enabled: false },
  );
});

test('treats an explicit null collaboration mode as default and rejects missing authority', () => {
  assert.deepEqual(
    extractPlanModeState({ threadId: 'thread-null', collaborationMode: null }),
    { threadId: 'thread-null', mode: 'default', enabled: false },
  );
  assert.equal(extractPlanModeState({ threadId: 'thread-missing' }), null);
  assert.equal(extractPlanModeState({ collaborationMode: { mode: 'plan' } }), null);
});

test('builds a complete official collaboration mode for both turn and settings updates', () => {
  assert.deepEqual(buildCollaborationMode('plan', 'gpt-5-codex', 'high'), {
    mode: 'plan',
    settings: {
      model: 'gpt-5-codex',
      reasoning_effort: 'high',
      developer_instructions: null,
    },
  });
  assert.deepEqual(buildCollaborationMode('default', 'gpt-5', null), {
    mode: 'default',
    settings: {
      model: 'gpt-5',
      reasoning_effort: null,
      developer_instructions: null,
    },
  });
  assert.throws(() => buildCollaborationMode('legacy'), /Unsupported collaboration mode/);
});
