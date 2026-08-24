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
const readline=require('node:readline');
const rl=readline.createInterface({input:process.stdin});
rl.on('line',line=>{const m=JSON.parse(line); if(m.method==='initialize'){console.log(JSON.stringify({id:m.id,result:{codexHome:'/fake',platformFamily:'unix',platformOs:'linux'}}));return;} if(m.method==='initialized')return; if(m.method==='thread/list'){console.log(JSON.stringify({id:m.id,result:{data:[{id:'t1',preview:'hello'}]}}));return;} if(m.method==='test/requestServer'){console.log(JSON.stringify({id:m.id,result:{ok:true}})); console.log(JSON.stringify({id:99,method:'item/commandExecution/requestApproval',params:{threadId:'t1'}})); return;} if(m.id!==undefined) console.log(JSON.stringify({id:m.id,result:{echo:m.params}}));});
`,{mode:0o755});
  return {dir,file};
}

test('CodexAppServer performs handshake, RPC, and server-request response on its own child', async(t)=>{
  const fake=fakeCodex(); t.after(()=>fs.rmSync(fake.dir,{recursive:true,force:true}));
  const client=new CodexAppServer({codexBin:fake.file,cwd:fake.dir,timeoutMs:2000}); t.after(()=>client.close());
  const init=await client.start(); assert.equal(init.platformOs,'linux');
  const list=await client.request('thread/list',{}); assert.equal(list.data[0].id,'t1');
  const serverRequestPromise=once(client,'serverRequest');
  await client.request('test/requestServer',{});
  const [request]=await serverRequestPromise; assert.equal(request.id,99);
  client.respond(99,{decision:'accept'});
  assert.equal(client.pendingServerRequests().length,0);
});
