import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OfficialSchemaRegistry } from '../src/schema-registry.mjs';
import { SERVER_REQUEST_SUPPORT, THREAD_ITEM_TYPES, protocolSupportSummary } from '../public/protocol-support.js';

const supportedItems = new Set(THREAD_ITEM_TYPES);
const supportedServerRequests = new Set(Object.keys(SERVER_REQUEST_SUPPORT));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cweb-protocol-seal-'));
const requestedMode = String(process.env.CWEB_PROTOCOL_SEAL_MODE || 'both').toLowerCase();
if (!['stable', 'experimental', 'both'].includes(requestedMode)) throw new Error('CWEB_PROTOCOL_SEAL_MODE must be stable, experimental, or both');
const modes = requestedMode === 'both' ? [false, true] : [requestedMode === 'experimental'];
const MCP_REQUIRED = ['mcpServerStatus/list', 'mcpServer/resource/read', 'mcpServer/tool/call'];

function literals(text, field) {
  const values = [], seen = new Set();
  const re = new RegExp(`\\"${field}\\"\\s*:\\s*\\"([^\\"]+)\\"`, 'g');
  for (const match of String(text).matchAll(re)) if (!seen.has(match[1])) { seen.add(match[1]); values.push(match[1]); }
  return values;
}
function missingFrom(actual, declared) { return actual.filter((value) => !declared.has(value)); }

function sealMode(experimental) {
  const label = experimental ? 'experimental' : 'stable', dir = path.join(root, label);
  const registry = new OfficialSchemaRegistry({ dir, codexBin: process.env.CWEB_CODEX_BIN || 'codex', experimental, refresh: true });
  const threadItemFile = path.join(dir, 'v2', 'ThreadItem.ts');
  if (!fs.existsSync(threadItemFile)) throw new Error(`Official ${label} generated TypeScript is missing v2/ThreadItem.ts`);
  const officialThreadItems = literals(fs.readFileSync(threadItemFile, 'utf8'), 'type');
  if (!officialThreadItems.length) throw new Error(`Unable to extract official ${label} ThreadItem variants`);
  const missingItems = missingFrom(officialThreadItems, supportedItems);
  if (missingItems.length) throw new Error(`Native Web timeline has no disposition for official ${label} ThreadItem variants: ${missingItems.join(', ')}`);

  const officialServerRequests = registry.serverRequests.map((item) => item.method);
  const missingServerRequests = missingFrom(officialServerRequests, supportedServerRequests);
  if (missingServerRequests.length) throw new Error(`Web client has no disposition for official ${label} ServerRequest methods: ${missingServerRequests.join(', ')}`);
  const missingMcp = MCP_REQUIRED.filter((method) => !registry.getRequest(method));
  if (missingMcp.length) throw new Error(`Official ${label} protocol is missing MCP Apps Host RPCs: ${missingMcp.join(', ')}`);
  if (experimental) {
    if (!registry.getServerRequest('currentTime/read')) throw new Error('Official experimental protocol is missing currentTime/read');
    if (!registry.getRequest('thread/start')?.paramsSchema?.properties?.dynamicTools) throw new Error('Official experimental thread/start schema is missing dynamicTools');
  }

  return {
    mode: label, codexVersion: registry.version, schemaDigest: registry.digest,
    officialThreadItems, officialServerRequests,
    clientRequests: registry.requests.length, clientNotifications: registry.notifications.length,
    serverNotifications: registry.serverNotifications.length,
    mcpAppsRpcSurface: MCP_REQUIRED,
    dynamicToolsField: Boolean(registry.getRequest('thread/start')?.paramsSchema?.properties?.dynamicTools),
  };
}

try {
  for (const [method, disposition] of Object.entries(SERVER_REQUEST_SUPPORT)) {
    if (!(String(disposition).startsWith('native') || ['manual-tool-host', 'platform-only'].includes(disposition))) throw new Error(`Unsupported ServerRequest disposition ${disposition} for ${method}`);
  }
  const sealed = modes.map(sealMode), summary = protocolSupportSummary();
  if (!summary.mcpAppsHost || !summary.dynamicToolHost || !summary.currentTimeHost || !summary.experimentalProtocolSeal) throw new Error('Archive host capability summary is incomplete');
  console.log(JSON.stringify({ requestedMode, sealed, declaredThreadItems: THREAD_ITEM_TYPES.length, declaredServerRequests: Object.keys(SERVER_REQUEST_SUPPORT).length, ...summary }, null, 2));
  console.log(`PROTOCOL_DISPOSITION_SEALED_${requestedMode.toUpperCase()}`);
} finally { fs.rmSync(root, { recursive: true, force: true }); }
