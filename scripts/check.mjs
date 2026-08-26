import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skip = new Set(['.git', 'node_modules', '.state']);
const textExt = new Set(['.mjs','.js','.json','.md','.html','.css','.sh','.service','.yml','.yaml','.txt']);
const files=[];
function walk(dir){for(const ent of fs.readdirSync(dir,{withFileTypes:true})){if(skip.has(ent.name))continue;const full=path.join(dir,ent.name);if(ent.isDirectory())walk(full);else if(textExt.has(path.extname(ent.name))||['LICENSE','.gitignore'].includes(ent.name))files.push(full);}}
walk(root);
const docAllow=['README.md','README.zh-CN.md','SECURITY.md','ARCHITECTURE.md','PRODUCTION_SEAL.md','ARCHIVE_CONTRACT.md','PROTOCOL_PARITY.md','UPSTREAM_VALIDATION.md','HOSTS.md','check.mjs'];
const rules=[
 {name:'no direct auth.json access',re:/\bauth\.json\b/i,allow:docAllow},
 {name:'no direct config.toml mutation',re:/\bconfig\.toml\b/i,allow:docAllow},
 {name:'no Codex install/upgrade in product',re:/(npm\s+install\s+-g\s+@openai\/codex|codex\s+(upgrade|update)|installCodex|upgradeCodex)/i,allow:[...docAllow,'ci.yml']},
 {name:'no process-wide Codex kill',re:/(pkill|killall)[^\n]*codex/i,allow:[...docAllow,'non-interference.test.mjs']},
 {name:'no private ChatGPT backend',re:/chatgpt\.com\/backend-api/i,allow:['check.mjs']},
];
const failures=[];
for(const file of files){const rel=path.relative(root,file),text=fs.readFileSync(file,'utf8');for(const rule of rules){if(rule.allow.some(x=>rel.endsWith(x)))continue;if(rule.re.test(text))failures.push(`${rule.name}: ${rel}`);}}
const required=[
 'src/schema-registry.mjs','src/codex-client.mjs','src/server.mjs','src/dynamic-tool-host.mjs',
 'public/index.html','public/app.js','public/protocol-support.js','public/mcp-app-core.js','public/mcp-app-host.js','public/mcp-sandbox-proxy.js','public/mcp-app.css',
 'README.md','README.zh-CN.md','SECURITY.md','ARCHITECTURE.md','docs/PRODUCTION_SEAL.md','docs/ARCHIVE_CONTRACT.md','docs/PROTOCOL_PARITY.md','docs/UPSTREAM_VALIDATION.md','docs/HOSTS.md',
 'deploy/codex-app-server-web.service','deploy/codex-official-app-server.service','scripts/source-manifest.mjs','SOURCE_MANIFEST.sha256'
];
for(const rel of required)if(!fs.existsSync(path.join(root,rel)))failures.push(`missing required file: ${rel}`);
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
if(pkg.version!=='0.4.0')failures.push('package version must be 0.4.0');
if(Object.keys(pkg.dependencies||{}).length)failures.push('runtime dependencies must remain empty');
if(!String(pkg.engines?.node||'').includes('22.12'))failures.push('Node >=22.12 contract missing');
for(const script of ['test','check','seal','seal:core','seal:protocol','manifest:verify'])if(!pkg.scripts?.[script])failures.push(`package script missing: ${script}`);
const server=fs.readFileSync(path.join(root,'src/server.mjs'),'utf8');
for(const needle of ["'METHOD_NOT_IN_OFFICIAL_SCHEMA'","'NOTIFICATION_NOT_IN_OFFICIAL_SCHEMA'",'registry.getServerRequest','registry.getServerNotification','INITIALIZE_IS_MANAGED_BY_GATEWAY','scheduleCodexRestart','CWEB_PUBLIC_ORIGIN','server.headersTimeout','server.requestTimeout',"message.method === 'currentTime/read'",'dynamicToolHost.canHandle','MCP_APPS_EXTENSION','MCP_APPS_MIME','mcpAppsDoubleIframeSandbox: true','properties?.dynamicTools'])if(!server.includes(needle))failures.push(`server contract missing: ${needle}`);
const client=fs.readFileSync(path.join(root,'src/codex-client.mjs'),'utf8');
for(const needle of ['stdio://','sanitizedCodexEnv()','maxPending','maxServerRequests','maxStdinBufferBytes','maxLineBytes','serverRequestsCleared'])if(!client.includes(needle))failures.push(`Codex client hardening missing: ${needle}`);
if(/env:\s*\{\s*\.\.\.process\.env\s*\}/.test(client))failures.push('Codex child must not inherit raw Web process environment');
const dynamicHost=fs.readFileSync(path.join(root,'src/dynamic-tool-host.mjs'),'utf8');
for(const needle of ['shell: false','MAX_REQUEST_BYTES','maxOutputBytes','timeoutMs','inheritEnv',"startsWith('CWEB_')",'data:image','data:audio','maxConcurrent','this.children','RESERVED_NAMESPACES'])if(!dynamicHost.includes(needle))failures.push(`Dynamic Tool Host hardening missing: ${needle}`);
if(/shell:\s*true/.test(dynamicHost))failures.push('Dynamic Tool Host must never invoke a shell');
const mcpHost=fs.readFileSync(path.join(root,'public/mcp-app-host.js'),'utf8'),mcpCore=fs.readFileSync(path.join(root,'public/mcp-app-core.js'),'utf8'),mcpProxy=fs.readFileSync(path.join(root,'public/mcp-sandbox-proxy.js'),'utf8');
for(const needle of ['sandboxProxyDataUrl','mcpServer/resource/read','mcpServer/tool/call','mcpServerStatus/list','toolVisibleToApp','ui/initialize','ui/notifications/initialized','MAX_SESSION_REQUESTS','MAX_INVENTORY_CACHE','resources/templates/list'])if(!mcpHost.includes(needle))failures.push(`MCP Apps Host contract missing: ${needle}`);
for(const needle of ['2026-01-26','text/html;profile=mcp-app',"object-src 'none'",'connectDomains','frameDomains','worker-src'])if(!mcpCore.includes(needle))failures.push(`MCP Apps security contract missing: ${needle}`);
for(const needle of ['data:text/html;base64','sandbox-proxy-ready','sandbox-resource-ready','allow-scripts allow-same-origin allow-forms','EXPECTED_HOST_ORIGIN','MAX_RESOURCE_MESSAGE'])if(!mcpProxy.includes(needle))failures.push(`MCP sandbox proxy contract missing: ${needle}`);
if(/allow-top-navigation|allow-popups|allow-downloads/.test(mcpProxy))failures.push('MCP sandbox must not grant popup/top-navigation/download escape capabilities');
const security=fs.readFileSync(path.join(root,'src/security.mjs'),'utf8');
for(const needle of ['maxSessions = 256','maxKeys = 4096','frame-src data:',"object-src 'none'"])if(!security.includes(needle))failures.push(`bounded/auth/sandbox security missing: ${needle}`);
const schema=fs.readFileSync(path.join(root,'src/schema-registry.mjs'),'utf8');
for(const needle of ['generate-json-schema','generate-ts','OFFICIAL_PROTOCOL_EXPORT_DRIFT','_cweb-schema-manifest.json','assertJsonWireCoveredByTypeScript'])if(!schema.includes(needle))failures.push(`dual official protocol contract missing: ${needle}`);
const protocolSeal=fs.readFileSync(path.join(root,'scripts/protocol-seal.mjs'),'utf8');
for(const needle of ['CWEB_PROTOCOL_SEAL_MODE','experimental','stable','PROTOCOL_DISPOSITION_SEALED_','dynamicTools','currentTime/read','mcpServer/resource/read'])if(!protocolSeal.includes(needle))failures.push(`stable/experimental protocol seal missing: ${needle}`);
const workflow=fs.readFileSync(path.join(root,'.github/workflows/ci.yml'),'utf8');
for(const line of workflow.split(/\r?\n/)){const match=line.match(/uses:\s*([^@\s]+)@([^\s#]+)/);if(match&&!/^[0-9a-f]{40}$/.test(match[2]))failures.push(`GitHub Action is not pinned to a full commit SHA: ${match[1]}@${match[2]}`);}
if(!/CODEX_VALIDATED_VERSION:\s*['"]?0\.149\.1/.test(workflow))failures.push('archive Codex CI version must be pinned to 0.149.1');
if(!workflow.includes('official-schema-experimental-pinned'))failures.push('pinned experimental protocol job missing');
if(!workflow.includes('official-schema-latest-advisory'))failures.push('forward-compatibility advisory job missing');
if(!workflow.includes('npm run manifest:verify'))failures.push('CI does not verify source manifest');
const service=fs.readFileSync(path.join(root,'deploy/codex-app-server-web.service'),'utf8');
for(const needle of ['Environment=CWEB_REQUIRE_AUTH=1','UMask=0077','KillMode=control-group','TimeoutStopSec=10','RestartPreventExitStatus=2 3'])if(!service.includes(needle))failures.push(`systemd hardening missing: ${needle}`);
const officialService=fs.readFileSync(path.join(root,'deploy/codex-official-app-server.service'),'utf8');
for(const needle of ['app-server --listen','EnvironmentFile=-__ENV_FILE__','Restart=on-failure','KillMode=control-group','TimeoutStopSec=10','UMask=0077'])if(!officialService.includes(needle))failures.push(`persistent official service contract missing: ${needle}`);
const installer=fs.readFileSync(path.join(root,'scripts/install-linux.sh'),'utf8');
for(const needle of ['SERVICE_DIR="$HOME/.config/systemd/user"','CWEB_STATE_DIR=','CWEB_CONFIG_DIR=','CWEB_CODEX_TRANSPORT=websocket','CWEB_CODEX_SERVER_URL=','codex-official-app-server.service','systemctl --user is-active'])if(!installer.includes(needle))failures.push(`installer hardening missing: ${needle}`);
if(!service.includes('EnvironmentFile=__ENV_FILE__'))failures.push('systemd unit must use the installer-resolved project EnvironmentFile');
const config=fs.readFileSync(path.join(root,'src/config.mjs'),'utf8');
for(const needle of ["CWEB_CODEX_TRANSPORT",'codexServerUrl','websocket'])if(!config.includes(needle))failures.push(`transport configuration missing: ${needle}`);
if(/echo[^\n]*\$TOKEN/.test(installer))failures.push('installer must not print the access token');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
for(const needle of ["thread/loaded/list","thread/resume","model/list","supportedReasoningEfforts","resyncAuthoritativeState","serverRequestsCleared"])if(!app.includes(needle))failures.push(`native UI archive behavior missing: ${needle}`);
if(failures.length){console.error(failures.join('\n'));process.exit(1);}console.log(`CHECK_OK files=${files.length} runtimeDependencies=0 officialSchemaGate=bidirectional mcpApps=double-iframe dynamicTools=experimental-no-shell protocolSeal=stable+experimental authDefault=on`);
