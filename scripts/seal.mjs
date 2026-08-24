import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CodexAppServer } from '../src/codex-client.mjs';
import { OfficialSchemaRegistry } from '../src/schema-registry.mjs';

const APP_VERSION='0.2.1';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const core=spawnSync(process.execPath,['scripts/seal-core.mjs'],{cwd:root,encoding:'utf8',stdio:'inherit',env:process.env});
if(core.error) throw core.error;
if(core.status!==0) process.exit(core.status||1);

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cweb-production-seal-'));
const codexBin=process.env.CWEB_CODEX_BIN||'codex';
let client;
try{
  const registry=new OfficialSchemaRegistry({dir,codexBin,experimental:false,refresh:true});
  client=new CodexAppServer({codexBin,cwd:process.env.CWEB_WORKSPACE||os.homedir(),experimental:false,timeoutMs:120_000});
  const initialize=await client.start();
  const account=await client.request('account/read',{});
  const models=await client.request('model/list',{});
  const threads=await client.request('thread/list',{limit:1,sortKey:'updated_at',sortDirection:'desc'});
  const hasLoadedList=Boolean(registry.getRequest('thread/loaded/list'));
  const loaded=hasLoadedList ? await client.request('thread/loaded/list',{}) : null;
  if(!account?.account && account?.requiresOpenaiAuth !== false) throw new Error('Codex account is not signed in/usable on this host');
  if(!models) throw new Error('model/list returned no result');
  if(!threads) throw new Error('thread/list returned no result');
  if(hasLoadedList && !loaded) throw new Error('thread/loaded/list returned no result');
  const manifest={
    archiveReady:true,
    appVersion:APP_VERSION,
    sealedAt:new Date().toISOString(),
    node:process.version,
    codexVersion:registry.version,
    schemaDigest:registry.digest,
    protocolExportParity:true,
    stableMethodCounts:{
      requests:registry.requests.length,
      notifications:registry.notifications.length,
      serverRequests:registry.serverRequests.length,
      serverNotifications:registry.serverNotifications.length,
    },
    codexHome:initialize?.codexHome||null,
    platformFamily:initialize?.platformFamily||null,
    platformOs:initialize?.platformOs||null,
    accountType:account?.account?.type||'configured',
    checks:{accountRead:true,modelList:true,threadList:true,threadLoadedList:hasLoadedList},
    officialTransport:'stdio',
    bidirectionalSchemaGate:true,
    webSecretsStrippedFromCodexEnvironment:true,
    experimental:false,
  };
  fs.mkdirSync(path.join(root,'.state'),{recursive:true});
  fs.writeFileSync(path.join(root,'.state','production-seal.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(manifest,null,2));
  console.log('ARCHIVE_READY');
} finally {
  try{client?.close();}catch{}
  fs.rmSync(dir,{recursive:true,force:true});
}
