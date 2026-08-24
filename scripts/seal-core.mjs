import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { OfficialSchemaRegistry } from '../src/schema-registry.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function run(cmd,args){
  const r=spawnSync(cmd,args,{cwd:root,encoding:'utf8',stdio:'pipe',env:process.env});
  if(r.error) throw r.error;
  if(r.status!==0) throw new Error(`${cmd} ${args.join(' ')} failed\n${r.stdout}\n${r.stderr}`);
  return (r.stdout||'').trim();
}
run(process.execPath,['scripts/source-manifest.mjs','--verify']);
run(process.execPath,['scripts/check.mjs']);
const tests=fs.readdirSync(path.join(root,'test')).filter(x=>x.endsWith('.test.mjs')).map(x=>path.join('test',x));
run(process.execPath,['--test',...tests]);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cweb-core-seal-'));
try{
  const registry=new OfficialSchemaRegistry({dir,codexBin:process.env.CWEB_CODEX_BIN||'codex',experimental:false,refresh:true});
  const requiredRequests=['initialize','thread/start','thread/resume','thread/list','thread/loaded/list','thread/read','turn/start','turn/interrupt','model/list','account/read'];
  const missing=requiredRequests.filter(method=>!registry.getRequest(method));
  if(missing.length) throw new Error(`Installed official Codex is missing required stable methods: ${missing.join(', ')}`);
  if(!registry.serverRequests.length) throw new Error('Official stable ServerRequest method set is unexpectedly empty');
  const manifest={
    sealedAt:new Date().toISOString(), node:process.version, codexVersion:registry.version,
    schemaDigest:registry.digest, protocolExportParity:true,
    stableClientRequests:registry.requests.length,
    stableClientNotifications:registry.notifications.length, stableServerRequests:registry.serverRequests.length,
    stableServerNotifications:registry.serverNotifications.length, requiredCoreMethods:requiredRequests,
    sourceDigest:sourceDigest(root),
  };
  fs.mkdirSync(path.join(root,'.state'),{recursive:true});
  fs.writeFileSync(path.join(root,'.state','core-seal.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(manifest,null,2));
  console.log('CORE_SEALED');
} finally { fs.rmSync(dir,{recursive:true,force:true}); }

function sourceDigest(base){
  const hash=crypto.createHash('sha256'); const ignored=new Set(['.git','node_modules','.state','SOURCE_MANIFEST.sha256']);
  function walk(dir){ for(const ent of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){ if(ignored.has(ent.name))continue; const full=path.join(dir,ent.name); const rel=path.relative(base,full); if(ent.isDirectory())walk(full); else{hash.update(rel);hash.update('\0');hash.update(fs.readFileSync(full));hash.update('\0');}}}
  walk(base); return hash.digest('hex');
}
