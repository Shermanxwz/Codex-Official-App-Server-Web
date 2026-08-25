const PROXY_SOURCE = String.raw`<!doctype html>
<html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src 'self' data: blob:; object-src 'none'; base-uri 'none'; form-action 'none'"></head>
<body style="margin:0"><script>
'use strict';
const HOST = window.parent;
let view = null;
let pending = [];
const RESERVED = 'ui/notifications/sandbox-';
const MAX_MESSAGE = 2097152;
const MAX_RESOURCE_MESSAGE = 12582912;
const EXPECTED_HOST_ORIGIN = (()=>{ try { return decodeURIComponent(location.hash.slice(1)); } catch { return ''; } })();
function validRpc(v,maxBytes=MAX_MESSAGE){
  if(!v || typeof v!=='object' || Array.isArray(v) || v.jsonrpc!=='2.0') return false;
  if('method' in v && typeof v.method!=='string') return false;
  try { return new TextEncoder().encode(JSON.stringify(v)).byteLength <= maxBytes; } catch { return false; }
}
function origins(values, allowWs){
  if(!Array.isArray(values)) return [];
  const re=/^(https?|wss?):\\/\\/(?:\\*\\.)?(?:\\[[0-9a-f:]+\\]|[a-z0-9.-]+)(?::\\d{1,5})?$/i;
  const out=[];
  for(const raw of values){
    const v=String(raw||'').trim();
    if(!re.test(v) || /[;\\r\\n'" ]/.test(v)) continue;
    const scheme=v.slice(0,v.indexOf(':')).toLowerCase();
    if(!['http','https'].includes(scheme) && !(allowWs && ['ws','wss'].includes(scheme))) continue;
    const port=v.match(/:(\\d{1,5})$/)?.[1];
    if(port && Number(port)>65535) continue;
    if(!out.includes(v)) out.push(v);
  }
  return out;
}
function cspValue(raw){
  const c=raw&&typeof raw==='object'?raw:{};
  const connect=origins(c.connectDomains,true), resources=origins(c.resourceDomains,false), frames=origins(c.frameDomains,false), bases=origins(c.baseUriDomains,false);
  return [
    "default-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: "+resources.join(' '),
    "style-src 'self' 'unsafe-inline' blob: data: "+resources.join(' '),
    "img-src 'self' data: blob: "+resources.join(' '),
    "font-src 'self' data: blob: "+resources.join(' '),
    "media-src 'self' data: blob: "+resources.join(' '),
    "connect-src 'self' "+connect.join(' '),
    "worker-src 'self' blob: "+resources.join(' '),
    frames.length?'frame-src '+frames.join(' '):"frame-src 'none'",
    "object-src 'none'",
    bases.length?'base-uri '+bases.join(' '):"base-uri 'none'",
    "form-action 'none'"
  ].join('; ');
}
function allowValue(p){
  const out=[]; p=p&&typeof p==='object'?p:{};
  if(p.camera)out.push('camera'); if(p.microphone)out.push('microphone'); if(p.geolocation)out.push('geolocation'); if(p.clipboardWrite)out.push('clipboard-write');
  return out.join('; ');
}
function mount(params){
  if(!params || typeof params.html!=='string') return;
  const doc=new DOMParser().parseFromString(params.html,'text/html');
  const meta=doc.createElement('meta'); meta.httpEquiv='Content-Security-Policy'; meta.content=cspValue(params.csp);
  doc.head.prepend(meta);
  const frame=document.createElement('iframe');
  frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms');
  frame.setAttribute('referrerpolicy','no-referrer');
  frame.setAttribute('title','MCP App');
  const allow=allowValue(params.permissions); if(allow) frame.setAttribute('allow',allow);
  frame.style.cssText='display:block;border:0;width:100%;height:100%;min-height:160px;background:transparent';
  frame.srcdoc='<!doctype html>\\n'+doc.documentElement.outerHTML;
  document.body.replaceChildren(frame); view=frame;
  for(const message of pending) view.contentWindow.postMessage(message,'*');
  pending=[];
}
window.addEventListener('message',(event)=>{
  const data=event.data;
  if(event.source===HOST){
    if(EXPECTED_HOST_ORIGIN && event.origin!==EXPECTED_HOST_ORIGIN) return;
    const resourceReady=data?.method==='ui/notifications/sandbox-resource-ready';
    if(!validRpc(data,resourceReady?MAX_RESOURCE_MESSAGE:MAX_MESSAGE)) return;
    if(resourceReady){ mount(data.params); return; }
    if(String(data.method||'').startsWith(RESERVED)) return;
    if(view?.contentWindow) view.contentWindow.postMessage(data,'*'); else pending.push(data);
    return;
  }
  if(view?.contentWindow && event.source===view.contentWindow){
    if(!validRpc(data) || String(data.method||'').startsWith(RESERVED)) return;
    HOST.postMessage(data,EXPECTED_HOST_ORIGIN||'*');
  }
});
HOST.postMessage({jsonrpc:'2.0',method:'ui/notifications/sandbox-proxy-ready',params:{}},EXPECTED_HOST_ORIGIN||'*');
<\/script></body></html>`;

export function sandboxProxyDataUrl(expectedHostOrigin = '') {
  const bytes = new TextEncoder().encode(PROXY_SOURCE);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base = `data:text/html;base64,${btoa(binary)}`;
  if (!expectedHostOrigin) return base;
  let parsed;
  try { parsed = new URL(expectedHostOrigin); } catch { parsed = null; }
  if (!parsed || !['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== expectedHostOrigin) throw new Error('Invalid MCP Apps host origin');
  return `${base}#${encodeURIComponent(parsed.origin)}`;
}

export { PROXY_SOURCE };
