import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readJson, safeEqualText, SessionStore, SlidingRateLimit } from '../src/security.mjs';

function request(body, contentType='application/json'){
  const req=Readable.from(body ? [Buffer.from(body)] : []);
  req.headers={'content-type':contentType};
  return req;
}

test('readJson accepts JSON and +json only', async()=>{
  assert.deepEqual(await readJson(request('{"a":1}'),1024),{a:1});
  assert.deepEqual(await readJson(request('{"a":2}','application/problem+json; charset=utf-8'),1024),{a:2});
  await assert.rejects(readJson(request('{"a":3}','text/plain'),1024),e=>e.status===415 && e.code==='UNSUPPORTED_MEDIA_TYPE');
});

test('readJson enforces request limit', async()=>{
  await assert.rejects(readJson(request(JSON.stringify({x:'x'.repeat(200)})),32),e=>e.status===413);
});

test('auth primitives fail closed',()=>{
  assert.equal(safeEqualText('same','same'),true); assert.equal(safeEqualText('same','diff'),false);
  const sessions=new SessionStore(10); const token=sessions.create(); assert.equal(sessions.has(token),true); sessions.delete(token); assert.equal(sessions.has(token),false);
  const rate=new SlidingRateLimit(2,1000); assert.equal(rate.allow('x'),true); assert.equal(rate.allow('x'),true); assert.equal(rate.allow('x'),false);
});
