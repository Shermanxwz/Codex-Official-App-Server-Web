import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OfficialSchemaRegistry } from '../src/schema-registry.mjs';
import { SERVER_REQUEST_SUPPORT, THREAD_ITEM_TYPES, protocolSupportSummary } from '../public/protocol-support.js';

const supportedItems = new Set(THREAD_ITEM_TYPES);
const supportedServerRequests = new Set(Object.keys(SERVER_REQUEST_SUPPORT));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cweb-protocol-seal-'));

function literals(text, field) {
  const values = [];
  const seen = new Set();
  const re = new RegExp(`\\"${field}\\"\\s*:\\s*\\"([^\\"]+)\\"`, 'g');
  for (const match of String(text).matchAll(re)) {
    if (!seen.has(match[1])) { seen.add(match[1]); values.push(match[1]); }
  }
  return values;
}
function missingFrom(actual, declared) { return actual.filter((value) => !declared.has(value)); }

try {
  const registry = new OfficialSchemaRegistry({
    dir,
    codexBin: process.env.CWEB_CODEX_BIN || 'codex',
    experimental: false,
    refresh: true,
  });
  const threadItemFile = path.join(dir, 'v2', 'ThreadItem.ts');
  if (!fs.existsSync(threadItemFile)) throw new Error('Official generated TypeScript is missing v2/ThreadItem.ts');
  const officialThreadItems = literals(fs.readFileSync(threadItemFile, 'utf8'), 'type');
  if (!officialThreadItems.length) throw new Error('Unable to extract official ThreadItem variants');
  const missingItems = missingFrom(officialThreadItems, supportedItems);
  if (missingItems.length) throw new Error(`Native Web timeline has no disposition for official ThreadItem variants: ${missingItems.join(', ')}`);

  const officialServerRequests = registry.serverRequests.map((item) => item.method);
  const missingServerRequests = missingFrom(officialServerRequests, supportedServerRequests);
  if (missingServerRequests.length) throw new Error(`Web client has no disposition for official ServerRequest methods: ${missingServerRequests.join(', ')}`);

  for (const [method, disposition] of Object.entries(SERVER_REQUEST_SUPPORT)) {
    if (!['native', 'native-legacy', 'manual-tool-host', 'platform-only'].includes(disposition)) {
      throw new Error(`Unsupported ServerRequest disposition ${disposition} for ${method}`);
    }
  }

  const summary = protocolSupportSummary();
  console.log(JSON.stringify({
    codexVersion: registry.version,
    officialThreadItems,
    officialServerRequests,
    declaredThreadItems: THREAD_ITEM_TYPES.length,
    declaredServerRequests: Object.keys(SERVER_REQUEST_SUPPORT).length,
    ...summary,
  }, null, 2));
  console.log('PROTOCOL_DISPOSITION_SEALED');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
