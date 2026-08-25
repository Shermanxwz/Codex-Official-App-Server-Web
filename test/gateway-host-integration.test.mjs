import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function freePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});}
function variant(method, ref){return {title:method,properties:{id:{},method:{enum:[method]},params:{$ref:`#/definitions/${ref}`}},required:['id','method','params']};}
function fakeCodex(dir, logFile){
 const file=path.join(dir,'codex');
 fs.writeFileSync(file,`#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline'); const args=process.argv.slice(2), log=${JSON.stringify(logFile)};
if(args[0]==='--version'){console.log('codex-cli 9.9.9-host-test');process.exit(0)}
if(args[0]==='app-server'&&args[1]==='generate-json-schema'){
 const out=args[args.indexOf('--out')+1];fs.mkdirSync(out,{recursive:true});
 const defs={InitializeParams:{type:'object',properties:{}},ThreadStartParams:{type:'object',properties:{cwd:{type:'string'},dynamicTools:{type:'array'}}},McpStatus:{type:'object'},McpRead:{type:'object'},McpCall:{type:'object'}};
 const req={definitions:defs,oneOf:[${JSON.stringify(variant('initialize','InitializeParams'))},${JSON.stringify(variant('thread/start','ThreadStartParams'))},${JSON.stringify(variant('mcpServerStatus/list','McpStatus'))},${JSON.stringify(variant('mcpServer/resource/read','McpRead'))},${JSON.stringify(variant('mcpServer/tool/call','McpCall'))}]};
 const note={definitions:{},oneOf:[{title:'clientPing',properties:{method:{enum:['client/ping']},params:{type:'object'}},required:['method','params']}]};
 const sdefs={Dynamic:{type:'object'},Clock:{type:'object'},Approval:{type:'object'},Token:{type:'object'},Attest:{type:'object'}};
 const sreq={definitions:sdefs,oneOf:[${JSON.stringify(variant('item/tool/call','Dynamic'))},${JSON.stringify(variant('currentTime/read','Clock'))},${JSON.stringify(variant('item/commandExecution/requestApproval','Approval'))},${JSON.stringify(variant('account/chatgptAuthTokens/refresh','Token'))},${JSON.stringify(variant('attestation/generate','Attest'))}]};
 const snote={definitions:{},oneOf:[{title:'started',properties:{method:{enum:['thread/started']},params:{type:'object'}},required:['method','params']}]};
 for(const [n,d] of [['ClientRequest.json',req],['ClientNotification.json',note],['ServerRequest.json',sreq],['ServerNotification.json',snote]])fs.writeFileSync(path.join(out,n),JSON.stringify(d));process.exit(0);
}
if(args[0]==='app-server'&&args[1]==='generate-ts'){
 const out=args[args.indexOf('--out')+1];fs.mkdirSync(out,{recursive:true});
 fs.writeFileSync(path.join(out,'ClientRequest.ts'),'export type ClientRequest={"method":"initialize"}|{"method":"thread/start"}|{"method":"mcpServerStatus/list"}|{"method":"mcpServer/resource/read"}|{"method":"mcpServer/tool/call"};');
 fs.writeFileSync(path.join(out,'ClientNotification.ts'),'export type ClientNotification={"method":"client/ping"};');
 fs.writeFileSync(path.join(out,'ServerRequest.ts'),'export type ServerRequest={"method":"item/tool/call"}|{"method":"currentTime/read"}|{"method":"item/commandExecution/requestApproval"}|{"method":"account/chatgptAuthTokens/refresh"}|{"method":"attestation/generate"};');
 fs.writeFileSync(path.join(out,'ServerNotification.ts'),'export type ServerNotification={"method":"thread/started"};');process.exit(0);
}
if(args[0]==='app-server'){
 const rl=readline.createInterface({input:process.stdin});let sent=false;
 rl.on('line',line=>{const m=JSON.parse(line);fs.appendFileSync(log,JSON.stringify(m)+'\\n');
  if(m.method==='initialize')return console.log(JSON.stringify({id:m.id,result:{codexHome:'/fake',platformFamily:'unix',platformOs:'linux'}}));
  if(m.method==='initialized'){if(!sent){sent=true;setTimeout(()=>{console.log(JSON.stringify({id:100,method:'currentTime/read',params:{threadId:'thread-1'}}));console.log(JSON.stringify({id:101,method:'item/tool/call',params:{threadId:'thread-1',turnId:'turn-1',callId:'call-1',namespace:null,tool:'echo',arguments:{hello:'world'}}}));},50)}return;}
  if(m.method==='thread/start')return console.log(JSON.stringify({id:m.id,result:{thread:{id:'thread-1',turns:[],cwd:m.params.cwd||'/tmp'}}}));
  if(m.method==='mcpServerStatus/list')return console.log(JSON.stringify({id:m.id,result:{data:[],nextCursor:null}}));
  if(m.id!==undefined&&m.method)return console.log(JSON.stringify({id:m.id,result:{}}));
 });return;
}
process.exit(2);`,{mode:0o755}); return file;
}
async function ready(url,child,logs){for(let i=0;i<100;i++){if(child.exitCode!==null)throw new Error(`server exited ${child.exitCode}: ${logs()}`);try{if((await fetch(`${url}/readyz`)).status===200)return;}catch{}await new Promise(r=>setTimeout(r,40));}throw new Error(`not ready: ${logs()}`);}
function records(file){if(!fs.existsSync(file))return[];return fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);}
async function waitFor(file,predicate){for(let i=0;i<100;i++){const r=records(file);if(predicate(r))return r;await new Promise(x=>setTimeout(x,30));}throw new Error('timed out waiting for fake Codex log');}

test('gateway closes capability, experimental Dynamic Tool and currentTime host loops end-to-end',async(t)=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cweb-host-e2e-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const logFile=path.join(dir,'codex.log');
 const handler=path.join(dir,'handler.mjs');fs.writeFileSync(handler,`let s='';for await(const c of process.stdin)s+=c;const r=JSON.parse(s);console.log(JSON.stringify({success:true,contentItems:[{type:'inputText',text:'hosted:'+r.arguments.hello}]}));`);
 const tools=path.join(dir,'tools.json');fs.writeFileSync(tools,JSON.stringify({version:1,tools:[{name:'echo',description:'Echo',inputSchema:{type:'object'},handler:{type:'process',command:process.execPath,args:[handler]}}]}));
 const codex=fakeCodex(dir,logFile),port=await freePort(),url=`http://127.0.0.1:${port}`,token='host-test-token';let output='';
 const child=spawn(process.execPath,['src/server.mjs'],{cwd:root,env:{...process.env,CWEB_CODEX_BIN:codex,CWEB_STATE_DIR:path.join(dir,'state'),CWEB_WORKSPACE:dir,CWEB_HOST:'127.0.0.1',CWEB_PORT:String(port),CWEB_REQUIRE_AUTH:'1',CWEB_TOKEN:token,CWEB_EXPERIMENTAL:'1',CWEB_MCP_APPS:'1',CWEB_DYNAMIC_TOOLS_FILE:tools,FAKE_LOG:logFile},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);t.after(()=>{if(child.exitCode===null)child.kill('SIGTERM')});await ready(url,child,()=>output);
 const origin=url,login=await fetch(`${url}/api/login`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({token})});assert.equal(login.status,200,output);const cookie=login.headers.get('set-cookie').split(';',1)[0];
 const meta=await (await fetch(`${url}/api/meta`,{headers:{cookie}})).json();assert.equal(meta.capabilities.experimentalApi,true);assert.deepEqual(meta.capabilities.extensions['io.modelcontextprotocol/ui'].mimeTypes,['text/html;profile=mcp-app']);assert.equal(meta.capabilities.dynamicToolHost.tools,1);
 const start=await fetch(`${url}/api/rpc`,{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify({method:'thread/start',params:{cwd:dir}})});assert.equal(start.status,200,output);
 const seen=await waitFor(logFile,r=>r.some(x=>x.method==='thread/start')&&r.some(x=>x.id===100&&x.result)&&r.some(x=>x.id===101&&x.result));
 const init=seen.find(x=>x.method==='initialize');assert.equal(init.params.capabilities.experimentalApi,true);assert.deepEqual(init.params.capabilities.extensions['io.modelcontextprotocol/ui'].mimeTypes,['text/html;profile=mcp-app']);
 const threadStart=seen.find(x=>x.method==='thread/start');assert.equal(Array.isArray(threadStart.params.dynamicTools),true);assert.equal(threadStart.params.dynamicTools[0].name,'echo');
 const clock=seen.find(x=>x.id===100&&x.result);assert.equal(Number.isInteger(clock.result.currentTimeAt),true);
 const tool=seen.find(x=>x.id===101&&x.result);assert.equal(tool.result.success,true);assert.equal(tool.result.contentItems[0].text,'hosted:world');
});
