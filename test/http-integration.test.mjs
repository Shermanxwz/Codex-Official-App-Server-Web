import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function getFreePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});}
function fakeCodex(dir){
  const file=path.join(dir,'codex');
  fs.writeFileSync(file,`#!/usr/bin/env node
const fs=require('node:fs'), path=require('node:path'), readline=require('node:readline');
const args=process.argv.slice(2);
if(args[0]==='--version'){console.log('codex-cli 9.9.9-test');process.exit(0)}
if(args[0]==='app-server'&&args[1]==='generate-json-schema'){
 const out=args[args.indexOf('--out')+1]; fs.mkdirSync(out,{recursive:true});
 const req={definitions:{InitializeParams:{type:'object',properties:{clientInfo:{type:'object'}}},ThreadListParams:{type:'object',properties:{limit:{type:'integer'}}}},oneOf:[{title:'InitializeRequest',properties:{id:{},method:{enum:['initialize']},params:{$ref:'#/definitions/InitializeParams'}},required:['id','method','params']},{title:'Thread/listRequest',properties:{id:{},method:{enum:['thread/list']},params:{$ref:'#/definitions/ThreadListParams'}},required:['id','method','params']}]};
 const note={definitions:{},oneOf:[{title:'Client/pingNotification',properties:{method:{enum:['client/ping']},params:{type:'object'}},required:['method','params']}]};
 const sreq={definitions:{},oneOf:[{title:'Item/commandExecution/requestApprovalRequest',properties:{id:{},method:{enum:['item/commandExecution/requestApproval']},params:{type:'object'}},required:['id','method','params']}]};
 const snote={definitions:{},oneOf:[{title:'Thread/startedNotification',properties:{method:{enum:['thread/started']},params:{type:'object'}},required:['method','params']}]};
 for(const [name,data] of [['ClientRequest.json',req],['ClientNotification.json',note],['ServerRequest.json',sreq],['ServerNotification.json',snote]]) fs.writeFileSync(path.join(out,name),JSON.stringify(data)); process.exit(0);
}
if(args[0]==='app-server'&&args[1]==='generate-ts'){
 const out=args[args.indexOf('--out')+1]; fs.mkdirSync(out,{recursive:true});
 const files={'ClientRequest.ts':'export type ClientRequest = { "method": "initialize" } | { "method": "thread/list" };','ClientNotification.ts':'export type ClientNotification = { "method": "client/ping" };','ServerRequest.ts':'export type ServerRequest = { "method": "item/commandExecution/requestApproval" };','ServerNotification.ts':'export type ServerNotification = { "method": "thread/started" };'};
 for(const [name,data] of Object.entries(files)) fs.writeFileSync(path.join(out,name),data); process.exit(0);
}
if(args[0]==='app-server'){
 const rl=readline.createInterface({input:process.stdin});
 rl.on('line',line=>{const m=JSON.parse(line); if(m.method==='initialize') return console.log(JSON.stringify({id:m.id,result:{codexHome:'/fake',platformFamily:'unix',platformOs:'linux'}})); if(m.method==='initialized'||m.method==='client/ping') return; if(m.method==='thread/list') return console.log(JSON.stringify({id:m.id,result:{data:[{id:'thread-1',preview:'fake thread',createdAt:1}]}})); if(m.id!==undefined) return console.log(JSON.stringify({id:m.id,result:{}}));}); return;
}
process.exit(2);
`,{mode:0o755}); return file;
}
async function waitReady(url, child){for(let i=0;i<80;i++){if(child.exitCode!==null)throw new Error(`server exited ${child.exitCode}`);try{const r=await fetch(`${url}/readyz`);if(r.status===200)return;}catch{}await new Promise(r=>setTimeout(r,50));}throw new Error('server/app-server did not become ready');}

test('full HTTP gateway admits only methods exported by official schema', async(t)=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cweb-http-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const codex=fakeCodex(dir); const port=await getFreePort(); const url=`http://127.0.0.1:${port}`; const token='integration-secret-token';
  const child=spawn(process.execPath,['src/server.mjs'],{cwd:root,env:{...process.env,CWEB_CODEX_BIN:codex,CWEB_STATE_DIR:path.join(dir,'state'),CWEB_WORKSPACE:dir,CWEB_HOST:'127.0.0.1',CWEB_PORT:String(port),CWEB_REQUIRE_AUTH:'1',CWEB_TOKEN:token,CWEB_MCP_APPS:'0'},stdio:['ignore','pipe','pipe']});
  let logs=''; child.stdout.on('data',x=>logs+=x); child.stderr.on('data',x=>logs+=x); t.after(()=>{if(child.exitCode===null)child.kill('SIGTERM')});
  await waitReady(url,child); const origin=url;
  const login=await fetch(`${url}/api/login`,{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify({token})});
  assert.equal(login.status,200,logs); const cookie=login.headers.get('set-cookie').split(';',1)[0];
  assert.equal((await fetch(`${url}/healthz`)).status,200); assert.equal((await fetch(`${url}/readyz`)).status,200);
  const methods=await (await fetch(`${url}/api/methods`,{headers:{cookie}})).json(); assert.deepEqual(methods.requests.map(x=>x.method),['initialize','thread/list']);
  assert.equal(methods.requests.find(x=>x.method==='initialize').managed,true);
  const schema=await (await fetch(`${url}/api/method-schema?kind=requests&method=${encodeURIComponent('thread/list')}`,{headers:{cookie}})).json();
  assert.equal(schema.method,'thread/list'); assert.equal(schema.kind,'requests'); assert.equal(schema.schema.properties.limit.type,'integer');
  const managed=await fetch(`${url}/api/rpc`,{method:'POST',headers:{'content-type':'application/json',origin,cookie},body:JSON.stringify({method:'initialize',params:{}})}); assert.equal(managed.status,400); assert.equal((await managed.json()).error,'INITIALIZE_IS_MANAGED_BY_GATEWAY');
  const ok=await fetch(`${url}/api/rpc`,{method:'POST',headers:{'content-type':'application/json',origin,cookie},body:JSON.stringify({method:'thread/list',params:{limit:1}})}); assert.equal(ok.status,200); const body=await ok.json(); assert.equal(body.result.data[0].id,'thread-1');
  const bad=await fetch(`${url}/api/rpc`,{method:'POST',headers:{'content-type':'application/json',origin,cookie},body:JSON.stringify({method:'private/unknown',params:{}})}); assert.equal(bad.status,400); assert.equal((await bad.json()).error,'METHOD_NOT_IN_OFFICIAL_SCHEMA');
  const csrf=await fetch(`${url}/api/rpc`,{method:'POST',headers:{'content-type':'text/plain',origin,cookie},body:'{}'}); assert.equal(csrf.status,415);
  const events=await fetch(`${url}/api/events`,{headers:{cookie}}); assert.equal(events.status,200);
  const exited=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error(`server did not shut down cleanly\n${logs}`)),7_000);
    child.once('exit',(code,signal)=>{clearTimeout(timer); resolve({code,signal});});
    child.kill('SIGTERM');
  });
  await events.body?.cancel();
  assert.equal(exited.code,0,logs);
});
