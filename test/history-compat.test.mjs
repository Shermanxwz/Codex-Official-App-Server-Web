import test from 'node:test';
import assert from 'node:assert/strict';
import { hasOfficialHistoryPaging, isUnsupportedOfficialMethodError } from '../public/history-compat.js';

test('history paging requires both official summary and item methods', () => {
  const methods = { requests: [{ method: 'thread/turns/list' }, { method: 'thread/items/list' }] };
  assert.equal(hasOfficialHistoryPaging(methods), true);
  assert.equal(hasOfficialHistoryPaging(methods, true), false);
  assert.equal(hasOfficialHistoryPaging({ requests: [{ method: 'thread/turns/list' }] }), false);
  assert.equal(hasOfficialHistoryPaging(['thread/turns/list', 'thread/items/list']), true);
});

test('unsupported official method errors are recognized across gateway envelopes', () => {
  assert.equal(isUnsupportedOfficialMethodError({ body: { rpc: { code: -32601 } } }, 'thread/items/list'), true);
  assert.equal(isUnsupportedOfficialMethodError({ body: { message: 'thread/items/list is not supported yet' } }, 'thread/items/list'), true);
  assert.equal(isUnsupportedOfficialMethodError({ body: { rpc: { message: 'method not found' } } }, 'thread/items/list'), true);
  assert.equal(isUnsupportedOfficialMethodError({ body: { message: 'upstream timeout' } }, 'thread/items/list'), false);
  assert.equal(isUnsupportedOfficialMethodError({ body: { message: 'thread/items/list rejected' } }, 'thread/items/list'), false);
});
