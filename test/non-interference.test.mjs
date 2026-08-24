import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizedCodexEnv } from '../src/codex-client.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sources=['src','scripts','deploy'].flatMap(dir=>collect(path.join(root,dir)));
function collect(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?collect(path.join(dir,e.name)):[path.join(dir,e.name)]);}

test('implementation contains no direct Codex credential/config ownership',()=>{
  const forbidden=[/chatgpt\.com\/backend-api/i,/(pkill|killall)[^\n]*codex/i,/npm\s+install\s+-g\s+@openai\/codex/i];
  for(const file of sources){
    if(path.basename(file)==='check.mjs') continue;
    const text=fs.readFileSync(file,'utf8');
    for(const re of forbidden) assert.equal(re.test(text),false,`${path.relative(root,file)} matched ${re}`);
  }
});

test('gateway spawns only its own app-server child with official stdio transport',()=>{
  const text=fs.readFileSync(path.join(root,'src/codex-client.mjs'),'utf8');
  assert.match(text,/spawn\(this\.codexBin, \['app-server', '--listen', 'stdio:\/\/'\]/);
  assert.match(text,/child\.kill\('SIGTERM'\)/);
  assert.doesNotMatch(text,/(pkill|killall)/);
});

test('web-only secrets are stripped before any Codex subprocess launch',()=>{
  const env=sanitizedCodexEnv({PATH:'/bin',HOME:'/home/test',CODEX_HOME:'/home/test/.codex',CWEB_TOKEN:'secret',CWEB_PUBLIC_ORIGIN:'https://example.test',CWEB_WORKSPACE:'/tmp'});
  assert.deepEqual(env,{PATH:'/bin',HOME:'/home/test',CODEX_HOME:'/home/test/.codex'});
  assert.equal(Object.keys(env).some(key=>key.startsWith('CWEB_')),false);
});
