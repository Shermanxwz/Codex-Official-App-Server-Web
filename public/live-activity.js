const ACTIVE_STATUS_KEYS=new Set(['active','running','inprogress','working','progress']);
const TERMINAL_STATUS_KEYS=new Set(['completed','complete','done','failed','error','interrupted','aborted','cancelled','canceled','stopped','idle','ready','inactive','closed','archived']);
const TERMINAL_TURN_METHODS=new Set(['turn/completed','turn/failed','turn/error','turn/interrupted','turn/aborted','turn/cancelled','turn/canceled','turn/stopped']);
const LIVE_TURN_METHODS=new Set(['item/started','item/completed','item/agentMessage/delta','item/commandExecution/outputDelta','item/fileChange/outputDelta','item/fileChange/patchUpdated','item/plan/delta','item/reasoning/summaryTextDelta','item/reasoning/textDelta','item/reasoning/summaryPartAdded','item/mcpToolCall/progress']);

export function statusKey(status){return String(status?.type||status||'').toLowerCase().replace(/[\s_-]/g,'')}
export function isActiveOfficialStatus(status){return ACTIVE_STATUS_KEYS.has(statusKey(status))}
export function isTerminalOfficialStatus(status){return TERMINAL_STATUS_KEYS.has(statusKey(status))}

export function inferOfficialActiveTurnId(thread){
  const turns=Array.isArray(thread?.turns)?thread.turns:[],active=turns.filter(turn=>isActiveOfficialStatus(turn?.status)&&turn?.id),threadStatus=thread?.status;
  if(threadStatus&&statusKey(threadStatus)&&!isActiveOfficialStatus(threadStatus))return null;
  if(active.length!==1){
    if(active.length&&isActiveOfficialStatus(threadStatus))return active.at(-1)?.id||null;
    if(isActiveOfficialStatus(threadStatus))return turns.at(-1)?.id||null;
    return null;
  }
  return active[0]?.id||null;
}

export function classifyOfficialActivity(message,{currentThreadId='',thread=null}={}){
  const method=String(message?.method||''),params=message?.params||{},detail=params.turn&&typeof params.turn==='object'?params.turn:params;
  const threadId=String(params.threadId||params.thread?.id||params.turn?.threadId||'');
  if(!currentThreadId||threadId&&threadId!==String(currentThreadId))return null;
  const turnId=String(params.turnId||detail.id||'');
  if(method==='turn/started'&&turnId)return{kind:'started',active:true,turnId,threadId};
  if(method==='turn/plan/updated'&&turnId)return{kind:'plan',active:true,turnId,threadId};
  if(LIVE_TURN_METHODS.has(method)&&turnId)return{kind:'activity',active:true,turnId,threadId};
  if(TERMINAL_TURN_METHODS.has(method))return{kind:'terminal',active:false,turnId,threadId};
  if(method==='thread/status/changed'){
    const status=params.status||params.state||params.thread?.status,active=isActiveOfficialStatus(status),terminal=isTerminalOfficialStatus(status);
    if(terminal)return{kind:'threadStatus',active:false,turnId,threadId,status};
    if(active)return{kind:'threadStatus',active:true,turnId:turnId||inferOfficialActiveTurnId({...thread,status})||thread?.turns?.filter(turn=>turn?.id).at(-1)?.id||null,threadId,status};
  }
  return null;
}

export const terminalTurnMethods=TERMINAL_TURN_METHODS;
