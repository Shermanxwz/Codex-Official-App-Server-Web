import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OfficialSchemaRegistry } from '../src/schema-registry.mjs';
import {
  SERVER_REQUEST_SUPPORT, THREAD_ITEM_TYPES, TIMELINE_DELTA_NOTIFICATIONS,
} from '../public/protocol-support.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const codexBin = process.env.CWEB_CODEX_BIN || 'codex';
const source = {
  app: fs.readFileSync(path.join(root, 'public/app.js'), 'utf8'),
  mcp: fs.readFileSync(path.join(root, 'public/mcp-app-host.js'), 'utf8'),
  server: fs.readFileSync(path.join(root, 'src/server.mjs'), 'utf8'),
};

function literalMethods(text) {
  const result = new Set();
  for (const match of String(text).matchAll(/\b(?:rpc|hasRequest|officialHistoryPage)\(\s*['"]([^'"]+)['"]/g)) result.add(match[1]);
  return result;
}

function typeLiterals(text) {
  return new Set([...String(text).matchAll(/\"type\"\s*:\s*\"([^\"]+)\"/g)].map((match) => match[1]));
}

function assertSubset(actual, expected, label, errors) {
  for (const value of actual) if (!expected.has(value)) errors.push(`${label}: ${value}`);
}

const callEvidence = [
  ['thread/list', source.app, /rpc\('thread\/list',\{limit:100/],
  ['thread/read', source.app, /rpc\('thread\/read',\{threadId/],
  ['thread/turns/list', source.app, /rpc\('thread\/turns\/list',\{threadId/],
  ['thread/items/list', source.app, /officialHistoryPage\('thread\/items\/list',params/],
  ['thread/start', source.app, /rpc\('thread\/start',p\)/],
  ['thread/resume', source.app, /rpc\('thread\/resume',\{threadId:key/],
  ['turn/start', source.app, /const p=\{threadId,input:/],
  ['turn/steer', source.app, /rpc\('turn\/steer',\{threadId,expectedTurnId,input:/],
  ['turn/interrupt', source.app, /rpc\('turn\/interrupt',\{threadId:state\.currentThread\.id,turnId:/],
  ['thread/compact/start', source.app, /rpc\('thread\/compact\/start',\{threadId:/],
  ['thread/searchOccurrences', source.app, /searchTerm:query/],
  ['config/batchWrite', source.app, /rpc\('config\/batchWrite',\{edits/],
  ['config/value/write', source.app, /rpc\('config\/value\/write',\{\.\.\.edit\}/],
  ['thread/name/set', source.app, /rpc\('thread\/name\/set',\{threadId:String\(thread\.id\),name:trimmed\}/],
  ['thread/archive', source.app, /rpc\('thread\/archive',\{threadId:String\(thread\.id\)\}/],
  ['thread/unarchive', source.app, /rpc\('thread\/unarchive',\{threadId:String\(thread\.id\)\}/],
  ['thread/delete', source.app, /rpc\('thread\/delete',\{threadId:String\(thread\.id\)\}/],
  ['mcpServer/resource/read', source.mcp, /originCallId: item\.id,[\s\S]*server: item\.server,[\s\S]*uri/],
  ['mcpServer/tool/call', source.mcp, /threadId: session\.threadId, server: session\.item\.server, tool: name/],
];
// These four inventory requests are intentionally invoked through one small
// capability loop in the browser, so they do not appear as literal
// `rpc('method', ...)` calls. Keep them in the same official-schema gate.
const capabilityMethods = ['mcpServerStatus/list', 'skills/list', 'plugin/list', 'app/installed'];
const capabilityEvidence = /const specs=\[\['mcpServerStatus\/list',mcpCapabilityGroup\],\['skills\/list',skillsCapabilityGroup\],\['plugin\/list',pluginCapabilityGroup\],\['app\/installed',appCapabilityGroup\]\]/;

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cweb-official-interface-audit-'));
const errors = [];
try {
  const usedRequests = new Set([...literalMethods(source.app), ...literalMethods(source.mcp), ...capabilityMethods]);
  for (const [method, text, pattern] of callEvidence) if (!pattern.test(text)) errors.push(`missing call-site evidence: ${method}`);
  if (!capabilityEvidence.test(source.app)) errors.push('missing call-site evidence: capability inventory loop');
  const allDeclaredDeltaNotifications = new Set(Object.keys(TIMELINE_DELTA_NOTIFICATIONS));
  const stableOptionalRequests = new Set(['thread/turns/list', 'thread/items/list', 'thread/searchOccurrences']);
  const stableOptionalServerRequests = new Set(['currentTime/read']);

  for (const experimental of [false, true]) {
    const label = experimental ? 'experimental' : 'stable';
    const dir = path.join(tempRoot, label);
    const registry = new OfficialSchemaRegistry({ dir, codexBin, experimental, refresh: true });
    const requests = new Set(registry.requests.map((item) => item.method));
    const serverRequests = new Set(registry.serverRequests.map((item) => item.method));
    const serverNotifications = new Set(registry.serverNotifications.map((item) => item.method));
    const itemFile = path.join(dir, 'v2', 'ThreadItem.ts');
    const officialItems = typeLiterals(fs.readFileSync(itemFile, 'utf8'));

    assertSubset(label === 'stable' ? new Set([...usedRequests].filter((method) => !stableOptionalRequests.has(method))) : usedRequests, requests, `${label} official ClientRequest missing`, errors);
    assertSubset(allDeclaredDeltaNotifications, serverNotifications, `${label} official ServerNotification missing`, errors);
    assertSubset(new Set([...Object.keys(SERVER_REQUEST_SUPPORT)].filter((method) => !(label === 'stable' && stableOptionalServerRequests.has(method)))), serverRequests, `${label} stale ServerRequest disposition`, errors);
    assertSubset(new Set([...serverRequests].filter((method) => !(label === 'stable' && stableOptionalServerRequests.has(method)))), new Set(Object.keys(SERVER_REQUEST_SUPPORT)), `${label} undisposed ServerRequest`, errors);
    assertSubset(new Set(THREAD_ITEM_TYPES), officialItems, `${label} stale ThreadItem renderer`, errors);
    assertSubset(officialItems, new Set(THREAD_ITEM_TYPES), `${label} undisposed ThreadItem`, errors);

    if (!requests.has('initialize')) errors.push(`${label} official ClientRequest missing initialize`);
    if (!registry.notifications.some((item) => item.method === 'initialized')) errors.push(`${label} official ClientNotification missing initialized`);
    for (const [method, text, pattern] of callEvidence) {
      if (method === 'mcpServer/resource/read' || method === 'mcpServer/tool/call') continue;
      if (!requests.has(method) && !(label === 'stable' && stableOptionalRequests.has(method))) errors.push(`${label} call site uses unavailable official ClientRequest: ${method}`);
      if (!pattern.test(text)) errors.push(`${label} call site is not bound to ${method}`);
    }
    for (const method of capabilityMethods) {
      if (!requests.has(method)) errors.push(`${label} capability inventory is unavailable through the official ClientRequest schema: ${method}`);
    }
    for (const method of ['mcpServerStatus/list', 'mcpServer/resource/read', 'mcpServer/tool/call']) {
      if (!requests.has(method)) errors.push(`${label} MCP Apps official RPC missing: ${method}`);
    }
    if (experimental) {
      const turns = registry.getRequest('thread/turns/list');
      const items = registry.getRequest('thread/items/list');
      const search = registry.getRequest('thread/searchOccurrences');
      const dynamic = registry.getRequest('thread/start')?.paramsSchema?.properties?.dynamicTools;
      if (!turns || !items || !search) errors.push('experimental official paged-history surface is incomplete');
      if (!dynamic) errors.push('experimental official thread/start.dynamicTools field is missing');
      if (!registry.getServerRequest('currentTime/read')) errors.push('experimental official currentTime/read is missing');
    }

    console.log(`${label}: codex=${registry.version} requests=${requests.size} serverRequests=${serverRequests.size} serverNotifications=${serverNotifications.size} threadItems=${officialItems.size}`);
  }
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`OFFICIAL_INTERFACE_AUDIT_OK requests=${literalMethods(source.app).size + literalMethods(source.mcp).size} serverRequests=${Object.keys(SERVER_REQUEST_SUPPORT).length} deltaNotifications=${Object.keys(TIMELINE_DELTA_NOTIFICATIONS).length}`);
