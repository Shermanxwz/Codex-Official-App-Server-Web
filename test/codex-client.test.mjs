import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { CodexAppServer } from '../src/codex-client.mjs';

function fakeCodex(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fake-codex-'));
  const file=path.join(dir,'codex');
  fs.writeFileSync(file,`#!/usr/bin/env node
const fs=require('node:fs'),readline=require('node:readline');
const rl=readline.createInterface({input:process.stdin});
rl.on('line',line=>{const m=JSON.parse(line); if(m.method==='initialize'){console.log(JSON.stringify({id:m.id,result:{codexHome:'/fake',platformFamily:'unix',platformOs:'linux',clientCapabilities:m.params.capabilities}}));return;} if(m.method==='initialized')return; if(m.method==='thread/list'){console.log(JSON.stringify({id:m.id,result:{data:[{id:'t1',preview:'hello'}]}}));return;} if(m.method==='test/requestServer'){console.log(JSON.stringify({id:m.id,result:{ok:true}})); console.log(JSON.stringify({id:99,method:'item/commandExecution/requestApproval',params:{threadId:'t1'}})); return;} if(m.method==='test/manyServerRequests'){console.log(JSON.stringify({id:m.id,result:{ok:true}})); for(let i=0;i<3;i++) console.log(JSON.stringify({id:200+i,method:'item/commandExecution/requestApproval',params:{n:i}})); return;} if(m.method==='test/oversize'){process.stdout.write('x'.repeat(1000)+'\\n');return;} if(m.method==='test/crash'){process.exit(42)} if(m.method==='test/closeStdin'){process.stdin.destroy();try{fs.closeSync(0)}catch{}setTimeout(()=>{},1000);return;} if(m.method==='test/hang')return; if(m.id!==undefined) console.log(JSON.stringify({id:m.id,result:{echo:m.params}}));});
`,{mode:0o755});
  return {dir,file};
}

test('CodexAppServer performs honest handshake, RPC, and server-request response on its own child', async(t)=>{
  const fake=fakeCodex(); t.after(()=>fs.rmSync(fake.dir,{recursive:true,force:true}));
  const client=new CodexAppServer({codexBin:fake.file,cwd:fake.dir,timeoutMs:2000}); t.after(()=>client.close());
  const init=await client.start(); assert.equal(init.platformOs,'linux');
  assert.deepEqual(init.clientCapabilities.extensions['openai/form'],{});
  assert.equal(Object.hasOwn(init.clientCapabilities.extensions,'io.modelcontextprotocol/ui'),false);
  assert.equal(Object.hasOwn(init.clientCapabilities,'requestAttestation'),false);
  const list=await client.request('thread/list',{}); assert.equal(list.data[0].id,'t1');
  const serverRequestPromise=once(client,'serverRequest');
  await client.request('test/requestServer',{});
  const [request]=await serverRequestPromise; assert.equal(request.id,99);
  client.respond(99,{decision:'accept'});
  assert.equal(client.pendingServerRequests().length,0);
});

test('explicitly configured client extensions are preserved while undefined masks are omitted', async(t)=>{
  const fake=fakeCodex(); t.after(()=>fs.rmSync(fake.dir,{recursive:true,force:true}));
  const client=new CodexAppServer({
    codexBin:fake.file,cwd:fake.dir,timeoutMs:2000,
    capabilities:{extensions:{'vendor/example':{version:1},'io.modelcontextprotocol/ui':undefined}},
  }); t.after(()=>client.close());
  const init=await client.start();
  assert.deepEqual(init.clientCapabilities.extensions['vendor/example'],{version:1});
  assert.equal(Object.hasOwn(init.clientCapabilities.extensions,'io.modelcontextprotocol/ui'),false);
});

test('unexpected child exit clears stale approvals and permits a fresh official app-server start', async(t)=>{
  const fake=fakeCodex(); t.after(()=>fs.rmSync(fake.dir,{recursive:true,force:true}));
  const client=new CodexAppServer({codexBin:fake.file,cwd:fake.dir,timeoutMs:1000}); t.after(()=>client.close());
  await client.start();
  const requestPromise=once(client,'serverRequest');
  await client.request('test/requestServer',{});
  await requestPromise;
  assert.equal(client.pendingServerRequests().length,1);
  const crashEvent=once(client,'crash');
  await assert.rejects(client.request('test/crash',{}));
  await crashEvent;
  assert.equal(client.pendingServerRequests().length,0);
  const list=await client.request('thread/list',{});
  assert.equal(list.data[0].id,'t1');
});

test('pending RPC count is bounded before writes can grow without limit', async(t)=>{
  const fake=fakeCodex(); t.after(()=>fs.rmSync(fake.dir,{recursive:true,force:true}));
  const client=new CodexAppServer({codexBin:fake.file,cwd:fake.dir,timeoutMs:5000,maxPending:1});
  await client.start();
  const first=client.request('test/hang',{});
  await assert.rejects(client.request('thread/list',{}),error=>error.code==='CODEX_CLIENT_BUSY' && error.status===503);
  client.close();
  await assert.rejects(first,/closed/i);
});

test('child stdin EPIPE is reported as transport failure instead of crashing the gateway client', async(t)=>{
  const fake=fakeCodex(); t.after(()=>fs.rmSync(fake.dir,{recursive:true,force:true}));
  const client=new CodexAppServer({codexBin:fake.file,cwd:fake.dir,timeoutMs:2000}); t.after(()=>client.close());
  await client.start();
  const transport=once(client,'transportError');
  const closing=client.request('test/closeStdin',{}).catch(error=>error);
  await new Promise(resolve=>setTimeout(resolve,50));
  const probe=client.request('thread/list',{}).catch(error=>error);
  const [event,closingError,probeError]=await Promise.all([
    Promise.race([transport,new Promise((_,reject)=>setTimeout(()=>reject(new Error('transport error event timed out')),1000))]),
    closing,
    probe,
  ]);
  const description=`${event[0]?.error?.code||''} ${event[0]?.error?.message||''} ${closingError?.message||''} ${probeError?.message||''}`;
  assert.match(description,/EPIPE|pipe|closed|unavailable/i);
});


test('pending server-initiated request memory is bounded', async(t)=>{
  const fake=fakeCodex(); t.after(()=>fs.rmSync(fake.dir,{recursive:true,force:true}));
  const client=new CodexAppServer({codexBin:fake.file,cwd:fake.dir,timeoutMs:2000,maxServerRequests:1}); t.after(()=>client.close());
  await client.start();
  const protocolError=once(client,'protocolError');
  await client.request('test/manyServerRequests',{});
  await protocolError;
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(client.pendingServerRequests().length,1);
});

test('oversized official JSONL is contained and emits one protocol error', async(t)=>{
  const fake=fakeCodex(); t.after(()=>fs.rmSync(fake.dir,{recursive:true,force:true}));
  const client=new CodexAppServer({codexBin:fake.file,cwd:fake.dir,timeoutMs:2000,maxLineBytes:256}); t.after(()=>client.close());
  await client.start();
  const protocolError=once(client,'protocolError'),crash=once(client,'crash');
  await assert.rejects(client.request('test/oversize',{}),error=>error.code==='CODEX_APP_SERVER_EXITED');
  const [protocol]=await protocolError; const [crashError]=await crash;
  assert.equal(protocol.code,'CODEX_PROTOCOL_LINE_TOO_LARGE');
  assert.match(crashError.message,/exited/);
});
