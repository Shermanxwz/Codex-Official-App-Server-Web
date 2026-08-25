import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  MCP_APPS_MIME, MCP_APPS_PROTOCOL_VERSION, buildGrantedPermissions, buildIframeAllow,
  buildMcpAppCsp, normalizeResourceCsp, safeExternalUrl, toolVisibleToApp, validateMcpAppResource,
} from '../public/mcp-app-core.js';
import { PROXY_SOURCE } from '../public/mcp-sandbox-proxy.js';
import { DynamicToolHost } from '../src/dynamic-tool-host.mjs';

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cweb-hosts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('MCP Apps stable profile, resource validation and CSP are fail closed', () => {
  assert.equal(MCP_APPS_PROTOCOL_VERSION, '2026-01-26');
  assert.equal(MCP_APPS_MIME, 'text/html;profile=mcp-app');
  const resource = validateMcpAppResource({ uri: 'ui://demo/app', mimeType: MCP_APPS_MIME, text: '<main>ok</main>', _meta: { ui: { csp: { connectDomains: ['https://api.example.com'] } } } }, 'ui://demo/app');
  assert.equal(resource.html, '<main>ok</main>');
  assert.deepEqual(normalizeResourceCsp(resource.meta.csp).connectDomains, ['https://api.example.com']);
  assert.throws(() => validateMcpAppResource({ uri: 'https://bad', mimeType: MCP_APPS_MIME, text: 'x' }, 'https://bad'));
  assert.throws(() => normalizeResourceCsp({ connectDomains: ["https://ok.test; script-src *"] }));
  const csp = buildMcpAppCsp({ connectDomains: ['https://api.example.com'], frameDomains: ['https://frame.example.com'] });
  assert.match(csp, /connect-src 'self' https:\/\/api\.example\.com/);
  assert.match(csp, /frame-src https:\/\/frame\.example\.com/);
  assert.match(csp, /object-src 'none'/);
  assert.equal(safeExternalUrl('javascript:alert(1)'), null);
  assert.equal(toolVisibleToApp({ _meta: { ui: { visibility: ['model'] } } }), false);
  assert.equal(toolVisibleToApp({ _meta: { ui: { visibility: ['app'] } } }), true);
  const permissions = buildGrantedPermissions({ camera: {}, clipboardWrite: {} }, { camera: true });
  assert.deepEqual(permissions, { camera: {} });
  assert.equal(buildIframeAllow(permissions), 'camera');
});

test('MCP Apps proxy preserves the stable double-iframe isolation profile', () => {
  assert.match(PROXY_SOURCE, /sandbox-proxy-ready/);
  assert.match(PROXY_SOURCE, /sandbox-resource-ready/);
  assert.match(PROXY_SOURCE, /allow-scripts allow-same-origin allow-forms/);
  assert.match(PROXY_SOURCE, /EXPECTED_HOST_ORIGIN/);
  assert.match(PROXY_SOURCE, /MAX_RESOURCE_MESSAGE/);
  assert.doesNotMatch(PROXY_SOURCE, /allow-top-navigation|allow-popups|allow-downloads/);
});

test('Dynamic Tool Host executes an explicit process without shell or CWEB secret inheritance', async (t) => {
  const dir = tempDir(t);
  const handler = path.join(dir, 'handler.mjs');
  fs.writeFileSync(handler, `let s=''; for await (const c of process.stdin) s+=c; const req=JSON.parse(s); console.log(JSON.stringify({success:true,contentItems:[{type:'inputText',text:JSON.stringify({tool:req.tool,secret:process.env.CWEB_TOKEN||null,allowed:process.env.ALLOWED||null})}]}));`);
  const config = path.join(dir, 'tools.json');
  fs.writeFileSync(config, JSON.stringify({ version: 1, tools: [{ name: 'echo', description: 'Echo safely', inputSchema: { type: 'object' }, handler: { type: 'process', command: process.execPath, args: [handler], inheritEnv: ['ALLOWED'] } }] }));
  const oldSecret = process.env.CWEB_TOKEN, oldAllowed = process.env.ALLOWED;
  process.env.CWEB_TOKEN = 'must-not-leak'; process.env.ALLOWED = 'yes';
  t.after(() => { if (oldSecret === undefined) delete process.env.CWEB_TOKEN; else process.env.CWEB_TOKEN = oldSecret; if (oldAllowed === undefined) delete process.env.ALLOWED; else process.env.ALLOWED = oldAllowed; });
  const host = DynamicToolHost.load(config); t.after(() => host.close());
  assert.equal(host.size, 1);
  assert.deepEqual(host.specs.map((x) => x.name), ['echo']);
  const result = await host.handle({ threadId: 't', turnId: 'v', callId: 'c', namespace: null, tool: 'echo', arguments: { x: 1 } });
  assert.equal(result.success, true);
  const payload = JSON.parse(result.contentItems[0].text);
  assert.equal(payload.tool, 'echo');
  assert.equal(payload.secret, null);
  assert.equal(payload.allowed, 'yes');
});

test('Dynamic Tool Host mirrors official identifier and reserved namespace rules', (t) => {
  const dir = tempDir(t);
  const handler = path.join(dir, 'handler.mjs'); fs.writeFileSync(handler, 'console.log(JSON.stringify({success:true,contentItems:[]}));');
  const write = (name, tool) => { const file = path.join(dir, name); fs.writeFileSync(file, JSON.stringify({ version: 1, tools: [{ description: 'x', inputSchema: { type: 'object' }, handler: { type: 'process', command: process.execPath, args: [handler] }, ...tool }] })); return file; };
  assert.throws(() => DynamicToolHost.load(write('dot.json', { name: 'bad.name' })), /Invalid dynamic tool name/);
  assert.throws(() => DynamicToolHost.load(write('reserved.json', { namespace: 'web', name: 'ok' })), /reserved Responses API namespace/);
  assert.throws(() => DynamicToolHost.load(write('mcp.json', { namespace: 'mcp__x', name: 'ok' })), /reserved/);
});

test('Dynamic Tool Host close terminates owned in-flight children', async (t) => {
  const dir = tempDir(t);
  const handler = path.join(dir, 'slow.mjs'); fs.writeFileSync(handler, `setTimeout(()=>console.log(JSON.stringify({success:true,contentItems:[]})),60000);`);
  const file = path.join(dir, 'tools.json'); fs.writeFileSync(file, JSON.stringify({ version: 1, tools: [{ name: 'slow', description: 'slow', inputSchema: { type: 'object' }, handler: { type: 'process', command: process.execPath, args: [handler], timeoutMs: 120000 } }] }));
  const host = DynamicToolHost.load(file);
  const pending = host.handle({ threadId: 't', turnId: 'v', callId: 'c', tool: 'slow', arguments: {} });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(host.children.size >= 1);
  host.close();
  const result = await pending;
  assert.equal(result.success, false);
  assert.equal(host.children.size, 0);
});
