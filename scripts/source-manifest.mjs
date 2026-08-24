import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifestPath=path.join(root,'SOURCE_MANIFEST.sha256');
const ignored=new Set(['.git','node_modules','.state','SOURCE_MANIFEST.sha256']);

function filesUnder(dir){
  const output=[];
  for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    if(ignored.has(entry.name)) continue;
    const full=path.join(dir,entry.name);
    if(entry.isDirectory()) output.push(...filesUnder(full));
    else if(entry.isFile()) output.push(full);
  }
  return output;
}
function digest(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function expected(){return filesUnder(root).map(file=>`${digest(file)}  ${path.relative(root,file).split(path.sep).join('/')}`).join('\n')+'\n';}
function parseManifest(text){
  const map=new Map();
  for(const line of text.trimEnd().split('\n')){
    if(!line) continue;
    const match=/^([0-9a-f]{64})  (.+)$/.exec(line);
    if(match) map.set(match[2],match[1]);
  }
  return map;
}
function reportMismatch(actual, wanted){
  const a=parseManifest(actual), w=parseManifest(wanted);
  const paths=[...new Set([...a.keys(),...w.keys()])].sort((x,y)=>x.localeCompare(y));
  for(const file of paths){
    if(!a.has(file)) console.error(`MISSING ${file} expected=${w.get(file)}`);
    else if(!w.has(file)) console.error(`UNEXPECTED ${file} actual=${a.get(file)}`);
    else if(a.get(file)!==w.get(file)) console.error(`DIGEST_MISMATCH ${file} actual=${a.get(file)} expected=${w.get(file)}`);
  }
}

const content=expected();
if(process.argv.includes('--verify')){
  const actual=fs.existsSync(manifestPath)?fs.readFileSync(manifestPath,'utf8'):'';
  if(actual!==content){
    console.error('SOURCE_MANIFEST_MISMATCH');
    reportMismatch(actual,content);
    process.exit(1);
  }
  console.log('SOURCE_MANIFEST_OK');
}else{
  fs.writeFileSync(manifestPath,content);
  console.log(`SOURCE_MANIFEST_WRITTEN files=${content.trim()?content.trim().split('\n').length:0}`);
}
