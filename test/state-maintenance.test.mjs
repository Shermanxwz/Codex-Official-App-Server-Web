import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pruneStateArtifacts } from '../src/state-maintenance.mjs';

test('state maintenance removes only stale interrupted schema swaps', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cweb-maintenance-'));
  const stale = path.join(dir, 'schema-stable.123.abcdef.tmp');
  const fresh = path.join(dir, 'schema-experimental.456.abcdef.bak');
  const unrelated = path.join(dir, 'keep-me.log');
  fs.mkdirSync(stale);
  fs.writeFileSync(fresh, 'fresh');
  fs.writeFileSync(unrelated, 'keep');
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
  fs.utimesSync(stale, old, old);

  const result = pruneStateArtifacts(dir);
  assert.deepEqual(result.removed, ['schema-stable.123.abcdef.tmp']);
  assert.equal(fs.existsSync(stale), false);
  assert.equal(fs.existsSync(fresh), true);
  assert.equal(fs.existsSync(unrelated), true);
  fs.rmSync(dir, { recursive: true, force: true });
});
