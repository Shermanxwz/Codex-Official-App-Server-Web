const $ = (id) => document.getElementById(id);
const state = {
  lang: localStorage.getItem('cweb_lang') || (navigator.language.startsWith('zh') ? 'zh' : 'en'),
  meta: null, methods: null, currentThread: null, activeTurnId: null, eventSource: null,
  threads: [], selectedMethod: null, pendingRequests: new Map(),
};

const T = {
  zh: {
    officialClient:'官方 App Server Web 客户端', newThread:'新建会话', searchThreads:'搜索会话', protocol:'官方接口', logout:'退出',
    reload:'刷新', stop:'停止', welcome:'Codex Web', emptyTitle:'官方 Codex，浏览器里使用', emptyBody:'通过官方 codex app-server 协议连接，不解析终端，不使用私有接口。',
    prompt:'给 Codex 发送消息…', send:'发送', searchMethods:'搜索 method', schema:'参数 Schema', params:'参数 JSON', invoke:'调用', loginSub:'安全登录', accessToken:'访问令牌', login:'登录',
    user:'你', agent:'Codex', loading:'加载中…', ready:'就绪', degraded:'Codex 连接异常', noThreads:'暂无会话', created:'已创建', request:'需要你的确认', accept:'允许', acceptSession:'本会话允许', decline:'拒绝', cancel:'拒绝并停止', respond:'提交响应', invalidJson:'JSON 格式错误', invoking:'调用中…',
    threadCreateFailed:'新建会话失败', sendFailed:'发送失败', reconnect:'事件流已断开，正在重连', connected:'已连接', interfaceCount:'官方接口', experimental:'实验接口已开启', stable:'Stable-only',
  },
  en: {
    officialClient:'Official App Server Web Client', newThread:'New thread', searchThreads:'Search threads', protocol:'Official APIs', logout:'Log out',
    reload:'Reload', stop:'Stop', welcome:'Codex Web', emptyTitle:'Official Codex, in your browser', emptyBody:'Connected through the official codex app-server protocol. No terminal scraping. No private APIs.',
    prompt:'Message Codex…', send:'Send', searchMethods:'Search methods', schema:'Parameter schema', params:'Parameters JSON', invoke:'Invoke', loginSub:'Secure sign in', accessToken:'Access token', login:'Sign in',
    user:'You', agent:'Codex', loading:'Loading…', ready:'Ready', degraded:'Codex connection degraded', noThreads:'No threads yet', created:'Created', request:'Your confirmation is required', accept:'Allow', acceptSession:'Allow for session', decline:'Decline', cancel:'Decline & stop', respond:'Submit response', invalidJson:'Invalid JSON', invoking:'Invoking…',
    threadCreateFailed:'Failed to create thread', sendFailed:'Failed to send', reconnect:'Event stream disconnected; reconnecting', connected:'Connected', interfaceCount:'official methods', experimental:'Experimental enabled', stable:'Stable-only',
  }
};
function tr(key){ return T[state.lang][key] || key; }
function applyI18n(){
  document.documentElement.lang = state.lang === 'zh' ? 'zh-CN' : 'en';
  document.querySelectorAll('[data-i18n]').forEach(el => el.textContent = tr(el.dataset.i18n));
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => el.placeholder = tr(el.dataset.i18nPlaceholder));
  renderThreads(); renderApprovals(); updateStatus();
}

async function api(path, options={}) {
  const response = await fetch(path, { credentials:'same-origin', ...options, headers:{ ...(options.body ? {'Content-Type':'application/json'} : {}), ...(options.headers||{}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.message || body.error || `HTTP ${response.status}`);
    error.status = response.status; error.body = body; throw error;
  }
  return body;
}
async function rpc(method, params={}) { return (await api('/api/rpc',{method:'POST',body:JSON.stringify({method,params})})).result; }
async function notify(method, params={}) { return api('/api/notify',{method:'POST',body:JSON.stringify({method,params})}); }
async function respond(id, result){ return api('/api/respond',{method:'POST',body:JSON.stringify({id,result})}); }

function escapeText(value){ return String(value ?? ''); }
function shortDate(seconds){
  if (!seconds) return '';
  const ms = seconds > 10_000_000_000 ? seconds : seconds * 1000;
  try { return new Intl.DateTimeFormat(state.lang==='zh'?'zh-CN':'en',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(ms)); } catch { return ''; }
}
function threadTitle(thread){ return thread.name || thread.title || thread.preview || thread.id || 'Thread'; }

function normalizeThreads(result){ return result?.data || result?.threads || result?.items || (Array.isArray(result) ? result : []); }
async function refreshThreads(){
  try {
    const result = await rpc('thread/list',{limit:100,sortKey:'updated_at',sortDirection:'desc'});
    state.threads = normalizeThreads(result);
    renderThreads();
  } catch (error) { console.warn(error); }
}
function renderThreads(){
  const q = $('threadSearch').value.trim().toLowerCase();
  const list = state.threads.filter(t => !q || threadTitle(t).toLowerCase().includes(q) || String(t.id||'').toLowerCase().includes(q));
  $('threadList').replaceChildren(...list.map(thread => {
    const div=document.createElement('div'); div.className='thread'+(state.currentThread?.id===thread.id?' active':'');
    const title=document.createElement('div'); title.className='thread-title'; title.textContent=threadTitle(thread);
    const meta=document.createElement('div'); meta.className='thread-meta'; meta.textContent=[thread.status?.type||thread.status,shortDate(thread.updatedAt||thread.createdAt)].filter(Boolean).join(' · ');
    div.append(title,meta); div.onclick=()=>selectThread(thread.id); return div;
  }));
  if (!list.length) { const p=document.createElement('div'); p.className='thread-meta'; p.style.padding='12px'; p.textContent=tr('noThreads'); $('threadList').replaceChildren(p); }
}

function extractText(item){
  if (!item || typeof item !== 'object') return null;
  if (typeof item.text === 'string') return item.text;
  if (typeof item.message === 'string') return item.message;
  if (Array.isArray(item.content)) {
    const parts=item.content.map(x => typeof x==='string'?x:(x?.text||x?.input_text||x?.output_text||'')).filter(Boolean);
    if(parts.length) return parts.join('\n');
  }
  if (typeof item.delta === 'string') return item.delta;
  return null;
}
function itemRole(item){
  const type=String(item?.type||item?.kind||'').toLowerCase();
  if(type.includes('user')) return 'user';
  if(type.includes('agent')||type.includes('assistant')) return 'agent';
  return 'event';
}
function collectItems(thread){
  const rows=[];
  for(const turn of thread?.turns||[]){
    for(const item of turn?.items||[]) rows.push({turn,item});
  }
  return rows;
}
function renderThread(thread){
  state.currentThread=thread;
  $('threadTitle').textContent=threadTitle(thread);
  $('workspaceChip').textContent=thread.cwd || state.meta?.workspace || '—';
  $('emptyState').classList.add('hidden'); $('timeline').classList.remove('hidden');
  const nodes=[];
  for(const {item} of collectItems(thread)){
    const role=itemRole(item), text=extractText(item);
    if(text && (role==='user'||role==='agent')){
      const wrap=document.createElement('div'); wrap.className=`message ${role}`;
      const label=document.createElement('div'); label.className='label'; label.textContent=role==='user'?tr('user'):tr('agent');
      const body=document.createElement('div'); body.className='body'; body.textContent=text; wrap.append(label,body); nodes.push(wrap);
    } else {
      const card=document.createElement('details'); card.className='event-card';
      const summary=document.createElement('summary'); summary.textContent=item?.type || item?.kind || 'item';
      const pre=document.createElement('pre'); pre.textContent=JSON.stringify(item,null,2); card.append(summary,pre); nodes.push(card);
    }
  }
  $('timeline').replaceChildren(...nodes);
  $('timeline').scrollTop=$('timeline').scrollHeight;
  renderThreads(); updateStatus();
}
async function selectThread(id){
  $('statusLine').textContent=tr('loading');
  try { const result=await rpc('thread/read',{threadId:id,includeTurns:true}); renderThread(result.thread || result); }
  catch(error){ $('statusLine').textContent=error.message; }
}
async function createThread(){
  const cwd = prompt(state.lang==='zh'?'工作目录（绝对路径）':'Working directory (absolute path)', state.currentThread?.cwd || state.meta?.workspace || '');
  if(!cwd) return null;
  try {
    const result=await rpc('thread/start',{cwd});
    const thread=result.thread||result; await refreshThreads(); renderThread(thread); return thread;
  } catch(error){ alert(`${tr('threadCreateFailed')}: ${error.message}`); return null; }
}
async function sendPrompt(){
  const text=$('prompt').value.trim(); if(!text) return;
  let thread=state.currentThread || await createThread(); if(!thread) return;
  $('send').disabled=true;
  try {
    const result=await rpc('turn/start',{threadId:thread.id,input:[{type:'text',text}]});
    state.activeTurnId=result?.turn?.id || result?.id || null; $('prompt').value=''; updateStatus();
    setTimeout(()=>selectThread(thread.id),300);
  } catch(error){ alert(`${tr('sendFailed')}: ${error.message}`); }
  finally { $('send').disabled=false; }
}
async function interrupt(){
  if(!state.currentThread?.id || !state.activeTurnId) return;
  try { await rpc('turn/interrupt',{threadId:state.currentThread.id,turnId:state.activeTurnId}); } catch(error){ alert(error.message); }
}

function eventTitle(message){ return message?.method || 'event'; }
function appendLiveEvent(message){
  if(!state.currentThread) return;
  const threadId=message?.params?.threadId || message?.params?.thread?.id || message?.params?.turn?.threadId;
  if(threadId && threadId!==state.currentThread.id) return;
  if(message.method==='turn/started') { state.activeTurnId=message.params?.turn?.id || message.params?.turnId || state.activeTurnId; updateStatus(); }
  if(message.method==='turn/completed') { state.activeTurnId=null; updateStatus(); setTimeout(()=>selectThread(state.currentThread.id),150); refreshThreads(); }
  if(message.method==='item/agentMessage/delta' && typeof message.params?.delta==='string'){
    let live=$('timeline').querySelector('[data-live-agent="1"]');
    if(!live){ live=document.createElement('div'); live.className='message agent'; live.dataset.liveAgent='1'; const label=document.createElement('div'); label.className='label'; label.textContent=tr('agent'); const body=document.createElement('div'); body.className='body'; live.append(label,body); $('timeline').append(live); }
    live.querySelector('.body').textContent += message.params.delta; $('timeline').scrollTop=$('timeline').scrollHeight; return;
  }
  if(['item/started','item/completed','turn/plan/updated','thread/status/changed'].includes(message.method)){
    const card=document.createElement('details'); card.className='event-card'; const sum=document.createElement('summary'); sum.textContent=eventTitle(message); const pre=document.createElement('pre'); pre.textContent=JSON.stringify(message.params||{},null,2); card.append(sum,pre); $('timeline').append(card);
  }
}

function connectEvents(){
  if(state.eventSource) state.eventSource.close();
  const es=new EventSource('/api/events',{withCredentials:true}); state.eventSource=es;
  es.onmessage=(event)=>{
    const envelope=JSON.parse(event.data);
    if(envelope.type==='connected'){
      for(const request of envelope.payload?.pendingServerRequests||[]) state.pendingRequests.set(String(request.id),request);
      renderApprovals(); return;
    }
    const message=envelope.payload;
    if(envelope.type==='serverRequest') { state.pendingRequests.set(String(message.id),message); renderApprovals(); }
    if(envelope.type==='notification') appendLiveEvent(message);
  };
  es.onerror=()=>{ $('statusLine').textContent=tr('reconnect'); };
}

function approvalPreset(method){
  if(method==='item/commandExecution/requestApproval' || method==='item/fileChange/requestApproval') return true;
  return false;
}
function renderApprovals(){
  const nodes=[];
  for(const request of state.pendingRequests.values()){
    const card=document.createElement('div'); card.className='approval-card';
    const h=document.createElement('h4'); h.textContent=`${tr('request')} · ${request.method}`;
    const pre=document.createElement('pre'); pre.textContent=JSON.stringify(request.params,null,2); card.append(h,pre);
    const actions=document.createElement('div'); actions.className='approval-actions';
    if(approvalPreset(request.method)){
      for(const [label,decision,cls] of [[tr('decline'),'decline','ghost'],[tr('cancel'),'cancel','danger'],[tr('acceptSession'),'acceptForSession','ghost'],[tr('accept'),'accept','primary']]){
        const b=document.createElement('button'); b.className=cls; b.textContent=label; b.onclick=()=>answerRequest(request,{decision}); actions.append(b);
      }
    } else {
      const textarea=document.createElement('textarea'); textarea.rows=4; textarea.value='{}'; textarea.style.width='100%'; card.append(textarea);
      const b=document.createElement('button'); b.className='primary'; b.textContent=tr('respond'); b.onclick=()=>{ try{ answerRequest(request,JSON.parse(textarea.value)); }catch{ alert(tr('invalidJson')); } }; actions.append(b);
    }
    card.append(actions); nodes.push(card);
  }
  $('approvalTray').replaceChildren(...nodes);
}
async function answerRequest(request,result){
  try { await respond(request.id,result); state.pendingRequests.delete(String(request.id)); renderApprovals(); }
  catch(error){ alert(error.message); }
}

function updateStatus(){
  if(!state.meta) return;
  const bits=[state.meta.status==='ready'?tr('ready'):tr('degraded'), state.meta.schema?.codexVersion, state.meta.schema?.experimental?tr('experimental'):tr('stable')].filter(Boolean);
  $('statusLine').textContent=bits.join(' · ');
  $('interrupt').classList.toggle('hidden',!state.activeTurnId);
}

function defaultFromSchema(schema, root){
  if(!schema) return {};
  if(schema.default!==undefined) return schema.default;
  if(schema.const!==undefined) return schema.const;
  if(schema.enum?.length) return schema.enum[0];
  if(schema.$ref && root?.definitions){ const key=schema.$ref.split('/').pop(); return defaultFromSchema(root.definitions[key],root); }
  if(schema.oneOf?.length) return defaultFromSchema(schema.oneOf[0],root);
  if(schema.anyOf?.length) return defaultFromSchema(schema.anyOf.find(x=>x.type!=='null')||schema.anyOf[0],root);
  if(schema.type==='array' || (Array.isArray(schema.type)&&schema.type.includes('array'))) return [];
  if(schema.type==='boolean') return false;
  if(schema.type==='integer'||schema.type==='number') return 0;
  if(schema.type==='string') return '';
  const obj={};
  for(const key of schema.required||[]) obj[key]=defaultFromSchema(schema.properties?.[key],root);
  return obj;
}
function methodBucket(){ return state.methods?.[$('methodKind').value] || []; }
function renderMethods(){
  const q=$('methodSearch').value.trim().toLowerCase(); const items=methodBucket().filter(x=>!q||x.method.toLowerCase().includes(q)||(x.description||'').toLowerCase().includes(q));
  $('methodList').replaceChildren(...items.map(item=>{ const div=document.createElement('div'); div.className='method-item'+(state.selectedMethod?.method===item.method?' active':''); div.textContent=item.method; div.onclick=()=>selectMethod(item); return div; }));
  if(!state.selectedMethod && items[0]) selectMethod(items[0]);
}
function selectMethod(item){
  state.selectedMethod=item; $('methodName').textContent=item.method; $('methodDescription').textContent=item.description||''; $('methodSchema').textContent=JSON.stringify(item.paramsSchema,null,2);
  $('methodParams').value=JSON.stringify(defaultFromSchema(item.paramsSchema,item.paramsSchema),null,2); $('methodResult').textContent=''; renderMethods();
}
async function invokeSelected(){
  const item=state.selectedMethod; if(!item) return;
  let params; try{params=JSON.parse($('methodParams').value||'{}');}catch{alert(tr('invalidJson'));return;}
  $('methodResult').textContent=tr('invoking');
  try {
    let result;
    if($('methodKind').value==='requests') result=await rpc(item.method,params);
    else if($('methodKind').value==='notifications') result=await notify(item.method,params);
    else throw new Error(state.lang==='zh'?'Server→Client 接口由 Codex 主动触发，不能从浏览器伪造调用。':'Server→Client methods are initiated by Codex and cannot be forged from the browser.');
    $('methodResult').textContent=JSON.stringify(result,null,2);
  } catch(error){ $('methodResult').textContent=JSON.stringify(error.body||{error:error.message},null,2); }
}

async function boot(){
  applyI18n();
  const session=await api('/api/session');
  if(session.authRequired && !session.authenticated){ $('loginModal').classList.remove('hidden'); return; }
  await afterLogin();
}
async function afterLogin(){
  $('loginModal').classList.add('hidden');
  [state.meta,state.methods]=await Promise.all([api('/api/meta'),api('/api/methods')]);
  $('workspaceChip').textContent=state.meta.workspace;
  const s=state.meta.schema; $('schemaSummary').textContent=`${s.codexVersion} · ${s.clientRequests} ${tr('interfaceCount')} · ${s.schemaDigest.slice(0,12)}`;
  updateStatus(); connectEvents(); await refreshThreads(); renderMethods();
}

$('loginForm').addEventListener('submit',async(e)=>{e.preventDefault();$('loginError').textContent='';try{await api('/api/login',{method:'POST',body:JSON.stringify({token:$('token').value})});$('token').value='';await afterLogin();}catch(error){$('loginError').textContent=error.message;}});
$('newThread').onclick=createThread; $('refreshThreads').onclick=refreshThreads; $('reloadThread').onclick=()=>state.currentThread&&selectThread(state.currentThread.id); $('send').onclick=sendPrompt; $('interrupt').onclick=interrupt;
$('prompt').addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();sendPrompt();}});
$('threadSearch').oninput=renderThreads; $('openProtocol').onclick=()=>$('protocolPanel').classList.remove('hidden'); $('closeProtocol').onclick=()=>$('protocolPanel').classList.add('hidden');
$('methodSearch').oninput=renderMethods; $('methodKind').onchange=()=>{state.selectedMethod=null;renderMethods();}; $('invokeMethod').onclick=invokeSelected;
$('langToggle').onclick=()=>{state.lang=state.lang==='zh'?'en':'zh';localStorage.setItem('cweb_lang',state.lang);applyI18n();};
$('logout').onclick=async()=>{try{await api('/api/logout',{method:'POST',body:'{}'});}finally{location.reload();}};
boot().catch(error=>{console.error(error);$('statusLine').textContent=error.message;});
