import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertJsonWireCoveredByTypeScript, extractMethods, extractMethodsFromTypeScript, OfficialSchemaRegistry } from '../src/schema-registry.mjs';

test('extractMethods derives every official method from oneOf variants', () => {
  const schema={
    definitions:{A:{type:'object',properties:{x:{type:'string'}},required:['x']}},
    oneOf:[
      {title:'ARequest',description:'alpha',properties:{method:{enum:['alpha/run']},params:{$ref:'#/definitions/A'}}},
      {title:'BRequest',properties:{method:{enum:['beta/list']},params:{type:'object'}}},
    ],
  };
  const methods=extractMethods(schema);
  assert.deepEqual(methods.map(x=>x.method),['alpha/run','beta/list']);
  assert.equal(methods[0].paramsSchema.required[0],'x');
  assert.equal(methods[0].description,'alpha');
});

test('extractMethods ignores malformed schema alternatives', () => {
  assert.deepEqual(extractMethods({oneOf:[{}, {properties:{method:{enum:[]}}}]}),[]);
});

function fakeSchemaCodex(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cweb-schema-cache-'));
  const file=path.join(dir,'codex');
  const versionFile=path.join(dir,'version.txt');
  fs.writeFileSync(versionFile,'1.0.0');
  fs.writeFileSync(file,`#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path'); const args=process.argv.slice(2); const base=__dirname;
if(args[0]==='--version'){console.log('codex-cli '+fs.readFileSync(path.join(base,'version.txt'),'utf8').trim());process.exit(0)}
if(args[0]==='app-server'&&args[1]==='generate-json-schema'){
 const out=args[args.indexOf('--out')+1];fs.mkdirSync(out,{recursive:true});
 const req={definitions:{P:{type:'object',properties:{x:{type:'string'}},required:['x']}},oneOf:[{properties:{method:{enum:['thread/list']},params:{$ref:'#/definitions/P'}}}]};
 const empty={definitions:{},oneOf:[]}; const sr={definitions:{},oneOf:[{properties:{method:{enum:['item/fileChange/requestApproval']},params:{type:'object'}}}]};
 for(const [n,j] of [['ClientRequest.json',req],['ClientNotification.json',empty],['ServerRequest.json',sr],['ServerNotification.json',empty]])fs.writeFileSync(path.join(out,n),JSON.stringify(j));process.exit(0)
}
if(args[0]==='app-server'&&args[1]==='generate-ts'){
 const out=args[args.indexOf('--out')+1];fs.mkdirSync(out,{recursive:true});
 const files={'ClientRequest.ts':'export type ClientRequest={ "method": "thread/list" };','ClientNotification.ts':'export type ClientNotification=never;','ServerRequest.ts':'export type ServerRequest={ "method": "item/fileChange/requestApproval" };','ServerNotification.ts':'export type ServerNotification=never;'};
 for(const [n,v] of Object.entries(files))fs.writeFileSync(path.join(out,n),v);process.exit(0)
} process.exit(2);`,{mode:0o755});
  return {dir,file,versionFile};
}



test('TypeScript export must cover every JSON wire method while TS-only legacy exports are recorded', ()=>{
  const methods=extractMethodsFromTypeScript('export type R = { "method": "thread/list" } | { "method": "turn/start" } | { "method": "legacy/get" };');
  assert.deepEqual(methods,['thread/list','turn/start','legacy/get']);
  const coverage=assertJsonWireCoveredByTypeScript([{method:'thread/list'},{method:'turn/start'}],methods,'ClientRequest');
  assert.deepEqual(coverage,{jsonOnly:[],tsOnly:['legacy/get']});
  assert.throws(()=>assertJsonWireCoveredByTypeScript([{method:'thread/list'},{method:'missing/json-wire'}],methods,'ClientRequest'),error=>error?.code==='OFFICIAL_PROTOCOL_EXPORT_DRIFT' && error.details.jsonOnly.includes('missing/json-wire'));
});

test('cached official schema is bound to exact Codex version and digest',t=>{
  const fake=fakeSchemaCodex(); t.after(()=>fs.rmSync(fake.dir,{recursive:true,force:true}));
  const cache=path.join(fake.dir,'cache');
  const first=new OfficialSchemaRegistry({dir:cache,codexBin:fake.file,refresh:true});
  assert.equal(first.requests[0].method,'thread/list');
  const bundle=first.getSchemaBundle('requests','thread/list');
  assert.equal(bundle.definitions.P.required[0],'x');
  new OfficialSchemaRegistry({dir:cache,codexBin:fake.file,refresh:false});
  fs.writeFileSync(fake.versionFile,'1.0.1');
  assert.throws(()=>new OfficialSchemaRegistry({dir:cache,codexBin:fake.file,refresh:false}),/current Codex is codex-cli 1\.0\.1/);
  fs.writeFileSync(fake.versionFile,'1.0.0');
  fs.appendFileSync(path.join(cache,'ClientRequest.json'),' ');
  assert.throws(()=>new OfficialSchemaRegistry({dir:cache,codexBin:fake.file,refresh:false}),/digest does not match/);
});
