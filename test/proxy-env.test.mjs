import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOfficialProxyEnv, mergeGatewayProxyEnv } from '../scripts/proxy-env.mjs';

test('installer updates explicit proxy values and removes duplicate assignments', () => {
  const input = 'CWEB_TOKEN="private"\nHTTPS_PROXY="http://old"\nHTTPS_PROXY="http://duplicate"\n';
  const merged = mergeGatewayProxyEnv(input, { HTTPS_PROXY: 'http://new:7890' });
  assert.match(merged, /CWEB_TOKEN="private"/);
  assert.equal((merged.match(/^HTTPS_PROXY=/gm) || []).length, 1);
  assert.match(merged, /^HTTPS_PROXY="http:\/\/new:7890"$/m);
});

test('official service preserves its proxy when a later installer shell omits it', () => {
  const gateway = 'CWEB_TOKEN="never-copy"\nHTTP_PROXY="http://gateway"\n';
  const existing = 'HTTPS_PROXY="http://preserved"\n';
  const merged = buildOfficialProxyEnv(existing, gateway, {});
  assert.match(merged, /^HTTP_PROXY="http:\/\/gateway"$/m);
  assert.match(merged, /^HTTPS_PROXY="http:\/\/preserved"$/m);
  assert.doesNotMatch(merged, /CWEB_|never-copy/);
});

test('official service accepts only proxy keys and current values take precedence', () => {
  const merged = buildOfficialProxyEnv('CWEB_TOKEN="bad"\nALL_PROXY="http://old"\n', 'NO_PROXY="localhost"\n', { ALL_PROXY: 'socks5://current' });
  assert.equal(merged, 'ALL_PROXY="socks5://current"\nNO_PROXY="localhost"\n');
});

test('an explicitly empty proxy value clears a stale service setting', () => {
  const gateway = mergeGatewayProxyEnv('CWEB_TOKEN="private"\nHTTPS_PROXY="http://stale"\n', { HTTPS_PROXY: '' });
  assert.equal(gateway, 'CWEB_TOKEN="private"\n');
  const official = buildOfficialProxyEnv('HTTPS_PROXY="http://stale"\n', 'HTTPS_PROXY="http://gateway"\n', { HTTPS_PROXY: '' });
  assert.equal(official, '');
});

test('environment-file control-character injection is rejected', () => {
  assert.throws(() => mergeGatewayProxyEnv('', { HTTP_PROXY: 'http://ok\nCWEB_TOKEN=bad' }), /unsupported control character/);
});
