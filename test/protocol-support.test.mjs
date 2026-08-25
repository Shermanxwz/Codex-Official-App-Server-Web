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
  for (const type of THREAD_ITEM_TYPES) assert.match(app, new RegExp(`case\\s*['\"]${type}['\"]`), `missing native renderer disposition for ${type}`);
});

test('composer keeps workspace selection in the primary new-thread flow and supports official image input', () => {
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'public/styles.css'), 'utf8');
  const protocol = fs.readFileSync(path.join(root, 'public/protocol-support.js'), 'utf8');
  assert.doesNotMatch(html, /id="workspaceButton"/);
  assert.match(html, /id="attachButton"/);
  assert.match(html, /id="attachmentInput"[^>]+accept="image\//);
  assert.doesNotMatch(html, /id="capabilitiesButton"/);
  assert.doesNotMatch(html, /id="imagePasteHint"/);
  assert.doesNotMatch(html, /id="composerHint"/);
  assert.match(html, /id="capabilityCards"/);
  assert.match(app, /type:'image',url:/);
  assert.match(app, /function handleClipboardPaste/);
  assert.match(app, /addEventListener\('paste',handleClipboardPaste\)/);
  assert.match(app, /threadSelectionSerial/);
  assert.match(app, /function loadMethodSchema/);
  assert.match(app, /mcpServerStatus\/list/);
  assert.match(app, /plugin\/list/);
  assert.match(app, /config\/read/);
  assert.match(app, /config\/batchWrite/);
  assert.match(app, /model_reasoning_effort/);
  assert.match(html, /id="composerMode"/);
  assert.match(html, /id="contextIndicator"/);
  assert.match(html, /id="compactThread"/);
  assert.match(html, /id="contextUsage"/);
  assert.match(html, /id="contextUsageFill"/);
  assert.match(html, /id="contextUsageRemainingValue"/);
  assert.match(app, /turn\/steer/);
  assert.match(app, /thread\/compact\/start/);
  assert.match(app, /thread\/compacted/);
  assert.match(app, /thread\/tokenUsage\/updated/);
  assert.match(app, /modelContextWindow/);
  assert.match(app, /contextUsageSnapshot/);
  assert.match(app, /tokenUsageThreadId/);
  assert.match(app, /function createWorkGroup/);
  assert.match(app, /function showContextCompaction/);
  assert.match(app, /function preserveLiveTimeline/);
  assert.match(app, /function removeIgnoredProtocolEvents/);
  assert.match(app, /m==='turn\/diff\/updated'/);
  assert.match(app, /m==='turn\/plan\/updated'/);
  assert.match(app, /function upsertOfficialPlan/);
  assert.match(app, /officialSource/);
  assert.match(app, /else if\(r\.method==='item\/tool\/call'\)\{if\(state\.meta\?\.capabilities\?\.dynamicToolHost\?\.enabled===true\)/);
  assert.match(app, /LAST_THREAD_KEY/);
  assert.match(app, /function restoreLastThread/);
  assert.match(app, /function adoptPendingTurnBlock/);
  assert.match(app, /data-pending-turn/);
  assert.match(app, /await restoreLastThread\(\)/);
  assert.match(protocol, /turn\/diff\/updated/);
  assert.match(app, /kind==='ignore'/);
  assert.match(css, /grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(css, /@media\(max-width:480px\)\{\s*\.composer-toolbar\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css, /\.topbar\{min-width:0;max-width:100%;overflow:hidden\}/);
  assert.match(css, /\.top-actions #openProtocolTop\{display:none\}/);
});

test('all declared ServerRequest methods have one explicit trust/UI disposition', () => {
  const entries = Object.entries(SERVER_REQUEST_SUPPORT);
  assert.equal(entries.length, 11);
  assert.equal(new Set(entries.map(([method]) => method)).size, entries.length);
  assert.deepEqual(new Set([...NATIVE_SERVER_REQUESTS, ...MANUAL_SERVER_REQUESTS, ...PLATFORM_ONLY_SERVER_REQUESTS]), new Set(entries.map(([method]) => method)));
  assert.equal(PLATFORM_ONLY_SERVER_REQUESTS.includes('attestation/generate'), true);
  assert.equal(PLATFORM_ONLY_SERVER_REQUESTS.includes('account/chatgptAuthTokens/refresh'), true);
  assert.equal(SERVER_REQUEST_SUPPORT['currentTime/read'], 'native-experimental-host');
  assert.equal(SERVER_REQUEST_SUPPORT['item/tool/call'], 'native-tool-host');
});

test('published support summary advertises only implemented archive hosts', () => {
  const summary = protocolSupportSummary();
  assert.equal(summary.threadItemTypes, 18);
  assert.equal(summary.serverRequests, 11);
  assert.equal(summary.openaiForm, true);
  assert.equal(summary.mcpAppsHost, true);
  assert.equal(summary.dynamicToolHost, true);
  assert.equal(summary.currentTimeHost, true);
  assert.equal(summary.experimentalProtocolSeal, true);
});

test('runtime server advertises the implemented MCP Apps profile and gates Dynamic Tools experimentally', () => {
  const server = fs.readFileSync(path.join(root, 'src/server.mjs'), 'utf8');
  assert.match(server, /MCP_APPS_EXTENSION/);
  assert.match(server, /mimeTypes:\s*\[MCP_APPS_MIME\]/);
  assert.match(server, /mcpAppsDoubleIframeSandbox:\s*true/);
  assert.match(server, /CWEB_DYNAMIC_TOOLS_FILE requires CWEB_EXPERIMENTAL=1/);
  assert.match(server, /properties\?\.dynamicTools/);
  assert.match(server, /message\.method === 'currentTime\/read'/);
  assert.match(server, /function rejectDynamicToolRequest/);
  assert.match(server, /dynamic-tool-host-unconfigured/);
  assert.match(server, /function compactRpcError/);
  assert.doesNotMatch(server, /rpc: error\.rpc/);
});

test('Codex child transport failures have an explicit containment path', () => {
  const client = fs.readFileSync(path.join(root, 'src/codex-client.mjs'), 'utf8');
  assert.match(client, /child\.stdin\.on\('error', failTransport\)/);
  assert.match(client, /emit\('transportError'/);
  assert.match(client, /try \{ child\.stdin\.write\(data\); \}/);
});

test('MCP Apps host bridge covers stable server tool/resource proxy surfaces', () => {
  const host = fs.readFileSync(path.join(root, 'public/mcp-app-host.js'), 'utf8');
  for (const method of ['ui/initialize', 'tools/list', 'tools/call', 'resources/list', 'resources/templates/list', 'resources/read', 'ui/open-link', 'ui/request-display-mode']) {
    assert.match(host, new RegExp(method.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(host, /originCallId/);
  assert.match(host, /toolVisibleToApp/);
  assert.match(host, /mcpServer\/resource\/read/);
  assert.match(host, /mcpServer\/tool\/call/);
});

test('legacy and v2 approval decision vocabularies remain separate', () => {
  const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
  for (const decision of ['approved', 'approved_for_session', 'accept', 'acceptForSession']) assert.match(app, new RegExp(`decision\\s*:\\s*['\"]${decision}['\"]`), decision);
  assert.match(app, /action\s*:\s*['\"]accept['\"]\s*,\s*content\s*:/);
  assert.match(app, /_meta\s*:\s*null/);
});
