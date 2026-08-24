import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skip = new Set(['.git', 'node_modules']);
const textExt = new Set(['.mjs','.js','.json','.md','.html','.css','.sh','.service','.yml','.yaml','.txt']);
const files=[];
function walk(dir){
  for(const ent of fs.readdirSync(dir,{withFileTypes:true})){
    if(skip.has(ent.name)) continue;
    const full=path.join(dir,ent.name);
    if(ent.isDirectory()) walk(full); else if(textExt.has(path.extname(ent.name)) || ['LICENSE','.gitignore'].includes(ent.name)) files.push(full);
  }
}
walk(root);

const rules = [
  { name:'no direct auth.json access', re:/\bauth\.json\b/i, allow:['README.md','README.zh-CN.md','SECURITY.md','ARCHITECTURE.md','PRODUCTION_SEAL.md','check.mjs'] },
  { name:'no direct config.toml mutation', re:/\bconfig\.toml\b/i, allow:['README.md','README.zh-CN.md','SECURITY.md','ARCHITECTURE.md','PRODUCTION_SEAL.md','check.mjs'] },
  { name:'no Codex install/upgrade', re:/(npm\s+install\s+-g\s+@openai\/codex|codex\s+(upgrade|update)|installCodex|upgradeCodex)/i, allow:['README.md','README.zh-CN.md','SECURITY.md','ARCHITECTURE.md','PRODUCTION_SEAL.md','check.mjs','ci.yml'] },
  { name:'no process-wide Codex kill', re:/(pkill|killall)[^\n]*codex/i, allow:['README.md','README.zh-CN.md','SECURITY.md','ARCHITECTURE.md','PRODUCTION_SEAL.md','check.mjs','non-interference.test.mjs'] },
  { name:'no private ChatGPT backend', re:/chatgpt\.com\/backend-api/i, allow:['check.mjs'] },
  { name:'no shell execution wrapper', re:/(execSync|\bexec\()[^\n]*(codex|CWEB_CODEX_BIN)/i, allow:['check.mjs'] },
];
const failures=[];
for(const file of files){
  const rel=path.relative(root,file);
  const text=fs.readFileSync(file,'utf8');
  for(const rule of rules){
    if(rule.allow.some(x=>rel.endsWith(x))) continue;
    if(rule.re.test(text)) failures.push(`${rule.name}: ${rel}`);
  }
}

const required = [
  'src/schema-registry.mjs','src/codex-client.mjs','src/server.mjs','public/index.html','public/app.js',
  'README.md','README.zh-CN.md','SECURITY.md','ARCHITECTURE.md','docs/PRODUCTION_SEAL.md','deploy/codex-app-server-web.service'
];
for(const rel of required) if(!fs.existsSync(path.join(root,rel))) failures.push(`missing required file: ${rel}`);

const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
if(Object.keys(pkg.dependencies||{}).length) failures.push('runtime dependencies must remain empty');
if(!String(pkg.engines?.node||'').includes('22.12')) failures.push('Node >=22.12 contract missing');

const server=fs.readFileSync(path.join(root,'src/server.mjs'),'utf8');
for(const needle of ["'METHOD_NOT_IN_OFFICIAL_SCHEMA'","'NOTIFICATION_NOT_IN_OFFICIAL_SCHEMA'","CWEB_TOKEN"]){
  if(!server.includes(needle)) failures.push(`server contract missing: ${needle}`);
}
const client=fs.readFileSync(path.join(root,'src/codex-client.mjs'),'utf8');
if(!client.includes('stdio://')) failures.push('official stdio transport contract missing');

const workflow=fs.readFileSync(path.join(root,'.github/workflows/ci.yml'),'utf8');
for(const line of workflow.split(/\r?\n/)){
  const match=line.match(/uses:\s*([^@\s]+)@([^\s#]+)/);
  if(match && !/^[0-9a-f]{40}$/.test(match[2])) failures.push(`GitHub Action is not pinned to a full commit SHA: ${match[1]}@${match[2]}`);
}

const service=fs.readFileSync(path.join(root,'deploy/codex-app-server-web.service'),'utf8');
if(!service.includes('Environment=CWEB_REQUIRE_AUTH=1')) failures.push('systemd auth default is not fail-closed');
if(!service.includes('UMask=0077')) failures.push('systemd restrictive umask missing');

if(failures.length){ console.error(failures.join('\n')); process.exit(1); }
console.log(`CHECK_OK files=${files.length} runtimeDependencies=0 officialSchemaGate=on authDefault=on`);
