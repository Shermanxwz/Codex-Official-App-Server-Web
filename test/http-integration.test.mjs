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

function fakeTurnStartDedupeCodex(dir){
  const file=path.join(dir,'codex');
  fs.writeFileSync(file,`#!/usr/bin/env node
const fs=require('node:fs'), path=require('node:path'), readline=require('node:readline');
const args=process.argv.slice(2);
if(args[0]==='--version'){console.log('codex-cli 9.9.9-dedupe-test');process.exit(0)}
if(args[0]==='app-server'&&args[1]==='generate-json-schema'){
 const out=args[args.indexOf('--out')+1];fs.mkdirSync(out,{recursive:true});
 const variant=(method,ref)=>({title:method,properties:{id:{},method:{enum:[method]},params:{$ref:'#/definitions/'+ref}},required:['id','method','params']});
 const req={definitions:{InitializeParams:{type:'object',properties:{clientInfo:{type:'object'}}},TurnStartParams:{type:'object',properties:{threadId:{type:'string'},input:{type:'array'},clientUserMessageId:{type:['string','null']}},required:['threadId','input']}},oneOf:[variant('initialize','InitializeParams'),variant('turn/start','TurnStartParams')]};
 const empty={definitions:{},oneOf:[]};
 for(const [name,data] of [['ClientRequest.json',req],['ClientNotification.json',empty],['ServerRequest.json',empty],['ServerNotification.json',empty]])fs.writeFileSync(path.join(out,name),JSON.stringify(data));process.exit(0);
}
if(args[0]==='app-server'&&args[1]==='generate-ts'){
 const out=args[args.indexOf('--out')+1];fs.mkdirSync(out,{recursive:true});
 fs.writeFileSync(path.join(out,'ClientRequest.ts'),'export type ClientRequest={"method":"initialize"}|{"method":"turn/start"};');
 for(const name of ['ClientNotification.ts','ServerRequest.ts','ServerNotification.ts'])fs.writeFileSync(path.join(out,name),'export type Empty=never;');process.exit(0);
}
if(args[0]==='app-server'){
 let starts=0;const rl=readline.createInterface({input:process.stdin});
 rl.on('line',line=>{const m=JSON.parse(line);if(m.method==='initialize')return console.log(JSON.stringify({id:m.id,result:{codexHome:'/fake',platformFamily:'unix',platformOs:'linux'}}));if(m.method==='initialized')return;if(m.method==='turn/start'){const count=++starts;return setTimeout(()=>console.log(JSON.stringify({id:m.id,result:{turn:{id:'turn-'+count,status:'inProgress'},count}})),30)}if(m.id!==undefined)console.log(JSON.stringify({id:m.id,result:{}}));});return;
}
process.exit(2);
`,{mode:0o755});return file;
}

function fakeActiveWriterCodex(dir){
  const file=path.join(dir,'codex');
  fs.writeFileSync(file,`#!/usr/bin/env node
const readline=require('node:readline');
const args=process.argv.slice(2);
if(args[0]==='--version'){console.log('codex-cli 9.9.9-active-writer-test');process.exit(0)}
if(args[0]==='app-server'&&args[1]==='generate-json-schema'){
 const out=args[args.indexOf('--out')+1];require('node:fs').mkdirSync(out,{recursive:true});
 const variant=(method,ref)=>({title:method,properties:{id:{},method:{enum:[method]},params:{$ref:'#/definitions/'+ref}},required:['id','method','params']});
 const req={definitions:{InitializeParams:{type:'object'},ThreadReadParams:{type:'object'},ThreadResumeParams:{type:'object'},ThreadArchiveParams:{type:'object'}},oneOf:[variant('initialize','InitializeParams'),variant('thread/read','ThreadReadParams'),variant('thread/resume','ThreadResumeParams'),variant('thread/archive','ThreadArchiveParams')]};
 const empty={definitions:{},oneOf:[]};
 for(const [name,data] of [['ClientRequest.json',req],['ClientNotification.json',empty],['ServerRequest.json',empty],['ServerNotification.json',empty]])require('node:fs').writeFileSync(require('node:path').join(out,name),JSON.stringify(data));process.exit(0);
}
if(args[0]==='app-server'&&args[1]==='generate-ts'){
 const out=args[args.indexOf('--out')+1];require('node:fs').mkdirSync(out,{recursive:true});
 require('node:fs').writeFileSync(require('node:path').join(out,'ClientRequest.ts'),'export type ClientRequest={"method":"initialize"}|{"method":"thread/read"}|{"method":"thread/resume"}|{"method":"thread/archive"};');
 for(const name of ['ClientNotification.ts','ServerRequest.ts','ServerNotification.ts'])require('node:fs').writeFileSync(require('node:path').join(out,name),'export type Empty=never;');
 process.exit(0);
}
if(args[0]==='app-server'){
 const rl=readline.createInterface({input:process.stdin});
 rl.on('line',line=>{const m=JSON.parse(line);if(m.method==='initialize')return console.log(JSON.stringify({id:m.id,result:{codexHome:'/fake',platformFamily:'unix',platformOs:'linux'}}));if(m.method==='initialized')return;if(m.method==='thread/read')return console.log(JSON.stringify({id:m.id,result:{thread:{id:'thread-1',turns:[]}}}));if(m.method==='thread/resume'||m.method==='thread/archive')return console.log(JSON.stringify({id:m.id,error:{code:-32600,message:'thread thread-1 already has an active writer'}}));if(m.id!==undefined)console.log(JSON.stringify({id:m.id,result:{}}));});return;
}
process.exit(2);
`,{mode:0o755}); return file;
}
async function waitReady(url, child){let logs='';child.stderr?.on('data',x=>logs+=x);child.stdout?.on('data',x=>logs+=x);for(let i=0;i<80;i++){if(child.exitCode!==null)throw new Error(`server exited ${child.exitCode}\n${logs}`);try{const r=await fetch(`${url}/readyz`);if(r.status===200)return;}catch{}await new Promise(r=>setTimeout(r,50));}throw new Error(`server/app-server did not become ready\n${logs}`);}
function sseReader(response){const reader=response.body.getReader();const decoder=new TextDecoder();let buffer='';return{async next(){for(;;){const boundary=buffer.indexOf('\n\n');if(boundary>=0){const frame=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);const data=frame.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');if(data)return JSON.parse(data);continue}const chunk=await reader.read();if(chunk.done)return null;buffer+=decoder.decode(chunk.value,{stream:true})}},cancel(){return reader.cancel()}}}

test('full HTTP gateway admits only methods exported by official schema', async(t)=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cweb-http-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const codex=fakeCodex(dir); const port=await getFreePort(); const url=`http://127.0.0.1:${port}`; const token='integration-secret-token';
  const child=spawn(process.execPath,['src/server.mjs'],{cwd:root,env:{...process.env,CWEB_CODEX_BIN:codex,CWEB_STATE_DIR:path.join(dir,'state'),CWEB_WORKSPACE:dir,CWEB_HOST:'127.0.0.1',CWEB_PORT:String(port),CWEB_REQUIRE_AUTH:'1',CWEB_TOKEN:token,CWEB_MCP_APPS:'0'},stdio:['ignore','pipe','pipe']});
  let logs=''; child.stdout.on('data',x=>logs+=x); child.stderr.on('data',x=>logs+=x); t.after(()=>{if(child.exitCode===null)child.kill('SIGTERM')});
  await waitReady(url,child); const origin=url;
  const login=await fetch(`${url}/api/login`,{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify({token})});
  assert.equal(login.status,200,logs); const cookie=login.headers.get('set-cookie').split(';',1)[0];
  assert.equal((await fetch(`${url}/healthz`)).status,200); assert.equal((await fetch(`${url}/readyz`)).status,200);
  const meta=await (await fetch(`${url}/api/meta`,{headers:{cookie}})).json(); assert.match(meta.runtime.bootId,/^[0-9a-f-]{36}$/); assert.equal(typeof meta.runtime.startedAt,'number');
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

test('repeating one Web turn/start id reuses the in-flight official result', async(t)=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cweb-turn-dedupe-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const codex=fakeTurnStartDedupeCodex(dir),port=await getFreePort(),url=`http://127.0.0.1:${port}`,token='turn-dedupe-test-token';let logs='';
  const child=spawn(process.execPath,['src/server.mjs'],{cwd:root,env:{...process.env,CWEB_CODEX_BIN:codex,CWEB_STATE_DIR:path.join(dir,'state'),CWEB_WORKSPACE:dir,CWEB_HOST:'127.0.0.1',CWEB_PORT:String(port),CWEB_REQUIRE_AUTH:'1',CWEB_TOKEN:token,CWEB_MCP_APPS:'0'},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);t.after(()=>{if(child.exitCode===null)child.kill('SIGTERM')});await waitReady(url,child);
  const origin=url,login=await fetch(url+'/api/login',{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify({token})});assert.equal(login.status,200,logs);const cookie=login.headers.get('set-cookie').split(';',1)[0];
  const send=clientUserMessageId=>fetch(url+'/api/rpc',{method:'POST',headers:{'content-type':'application/json',origin,cookie},body:JSON.stringify({method:'turn/start',params:{threadId:'thread-1',input:[{type:'text',text:'dedupe',text_elements:[]}],clientUserMessageId}})});
  const [first,second]=await Promise.all([send('web-dedupe-1'),send('web-dedupe-1')]);assert.equal(first.status,200,logs);assert.equal(second.status,200,logs);const a=await first.json(),b=await second.json();assert.equal(a.result.count,1);assert.equal(b.result.count,1);assert.equal(a.result.turn.id,b.result.turn.id);
  const third=await send('web-dedupe-2');assert.equal(third.status,200,logs);assert.equal((await third.json()).result.count,2);
  child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));
});

test('multiple SSE clients stay independent when one client disconnects', async(t)=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cweb-sse-multi-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const codex=fakeCodex(dir),port=await getFreePort(),url=`http://127.0.0.1:${port}`,token='sse-multi-test-token';let logs='';
  const child=spawn(process.execPath,['src/server.mjs'],{cwd:root,env:{...process.env,CWEB_CODEX_BIN:codex,CWEB_STATE_DIR:path.join(dir,'state'),CWEB_WORKSPACE:dir,CWEB_HOST:'127.0.0.1',CWEB_PORT:String(port),CWEB_REQUIRE_AUTH:'1',CWEB_TOKEN:token,CWEB_MCP_APPS:'0'},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);t.after(()=>{if(child.exitCode===null)child.kill('SIGTERM')});await waitReady(url,child);
  const origin=url,login=await fetch(`${url}/api/login`,{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify({token})});assert.equal(login.status,200,logs);const cookie=login.headers.get('set-cookie').split(';',1)[0];
  const firstResponse=await fetch(`${url}/api/events`,{headers:{cookie}}),secondResponse=await fetch(`${url}/api/events`,{headers:{cookie}});assert.equal(firstResponse.status,200);assert.equal(secondResponse.status,200);
  const first=sseReader(firstResponse),second=sseReader(secondResponse);t.after(()=>Promise.allSettled([first.cancel(),second.cancel()]));
  assert.equal((await first.next()).type,'connected');assert.equal((await second.next()).type,'connected');await first.cancel();
  const changed=await fetch(`${url}/api/control`,{method:'POST',headers:{'content-type':'application/json',origin,cookie},body:JSON.stringify({desktopWriteProtection:false})});assert.equal(changed.status,200,logs);
  const changedBody=await changed.json();assert.equal(changedBody.control.webWriteEnabled,true);assert.equal(Object.hasOwn(changedBody.control,'desktopWriteProtection'),false);
  const event=await second.next();assert.equal(event.type,'controlChanged');assert.equal(event.payload.control.webWriteEnabled,true);assert.equal(Object.hasOwn(event.payload.control,'desktopWriteProtection'),false);
});

test('active-writer resume is a read-only conflict, never an HTTP 502', async(t)=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cweb-active-writer-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const codex=fakeActiveWriterCodex(dir); const port=await getFreePort(); const url=`http://127.0.0.1:${port}`; const token='active-writer-test-token'; let logs='';
  const child=spawn(process.execPath,['src/server.mjs'],{cwd:root,env:{...process.env,CWEB_CODEX_BIN:codex,CWEB_STATE_DIR:path.join(dir,'state'),CWEB_WORKSPACE:dir,CWEB_HOST:'127.0.0.1',CWEB_PORT:String(port),CWEB_REQUIRE_AUTH:'1',CWEB_TOKEN:token,CWEB_MCP_APPS:'0'},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',x=>logs+=x); child.stderr.on('data',x=>logs+=x); t.after(()=>{if(child.exitCode===null)child.kill('SIGTERM')});
  await waitReady(url,child); const origin=url; const login=await fetch(`${url}/api/login`,{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify({token})}); assert.equal(login.status,200,logs); const cookie=login.headers.get('set-cookie').split(';',1)[0];
  const resume=await fetch(`${url}/api/rpc`,{method:'POST',headers:{'content-type':'application/json',origin,cookie},body:JSON.stringify({method:'thread/resume',params:{threadId:'thread-1'}})});
  assert.equal(resume.status,409,logs); const conflict=await resume.json(); assert.equal(conflict.error,'THREAD_READ_ONLY'); assert.match(conflict.message,/只读/);
  const read=await fetch(`${url}/api/rpc`,{method:'POST',headers:{'content-type':'application/json',origin,cookie},body:JSON.stringify({method:'thread/read',params:{threadId:'thread-1',includeTurns:false}})});
  assert.equal(read.status,200,logs); assert.equal((await read.json()).result.thread.id,'thread-1');
  const archive=await fetch(`${url}/api/rpc`,{method:'POST',headers:{'content-type':'application/json',origin,cookie},body:JSON.stringify({method:'thread/archive',params:{threadId:'thread-1'}})});
  assert.equal(archive.status,409,logs); assert.equal((await archive.json()).error,'THREAD_READ_ONLY');
});

test('Web write control blocks mutations while preserving official reads', async(t)=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cweb-write-control-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const codex=fakeActiveWriterCodex(dir); const port=await getFreePort(); const url='http://127.0.0.1:'+port; const token='write-control-test-token'; let logs='';
  const child=spawn(process.execPath,['src/server.mjs'],{cwd:root,env:{...process.env,CWEB_CODEX_BIN:codex,CWEB_STATE_DIR:path.join(dir,'state'),CWEB_WORKSPACE:dir,CWEB_HOST:'127.0.0.1',CWEB_PORT:String(port),CWEB_REQUIRE_AUTH:'1',CWEB_TOKEN:token,CWEB_MCP_APPS:'0'},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',x=>logs+=x); child.stderr.on('data',x=>logs+=x); t.after(()=>{if(child.exitCode===null)child.kill('SIGTERM')});
  await waitReady(url,child); const origin=url; const login=await fetch(url+'/api/login',{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify({token})}); assert.equal(login.status,200,logs); const cookie=login.headers.get('set-cookie').split(';',1)[0];
  const initial=await (await fetch(url+'/api/control',{headers:{cookie}})).json(); assert.equal(initial.control.webWriteEnabled,true); assert.equal(Object.hasOwn(initial.control,'desktopWriteProtection'),false);
  const off=await fetch(url+'/api/control',{method:'POST',headers:{'content-type':'application/json',origin,cookie},body:JSON.stringify({webWriteEnabled:false})}); assert.equal(off.status,200,logs); assert.equal((await off.json()).control.webWriteEnabled,false);
  const read=await fetch(url+'/api/rpc',{method:'POST',headers:{'content-type':'application/json',origin,cookie},body:JSON.stringify({method:'thread/read',params:{threadId:'thread-1',includeTurns:false}})}); assert.equal(read.status,200,logs);
  const methods=await (await fetch(url+'/api/methods',{headers:{cookie}})).json(); assert.equal(methods.requests.find(item=>item.method==='thread/read').allowed,true); assert.equal(methods.requests.find(item=>item.method==='thread/resume').allowed,false);
  const blocked=await fetch(url+'/api/rpc',{method:'POST',headers:{'content-type':'application/json',origin,cookie},body:JSON.stringify({method:'thread/resume',params:{threadId:'thread-1'}})}); assert.equal(blocked.status,403,logs); assert.equal((await blocked.json()).error,'WEB_WRITE_DISABLED');
  const on=await fetch(url+'/api/control',{method:'POST',headers:{'content-type':'application/json',origin,cookie},body:JSON.stringify({webWriteEnabled:true})}); assert.equal(on.status,200,logs);
  const conflict=await fetch(url+'/api/rpc',{method:'POST',headers:{'content-type':'application/json',origin,cookie},body:JSON.stringify({method:'thread/resume',params:{threadId:'thread-1'}})}); assert.equal(conflict.status,409,logs); assert.equal((await conflict.json()).error,'THREAD_READ_ONLY');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'state','control.json'),'utf8')),{webWriteEnabled:true});
});
