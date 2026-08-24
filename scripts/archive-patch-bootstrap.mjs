import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const file = 'scripts/archive-patch.mjs';
let source = fs.readFileSync(file, 'utf8');

const fixes = [
  [
    "`${item.exitCode!=null?'exit '+item.exitCode:''}${item.durationMs!=null?' · '+item.durationMs+'ms':''}`",
    "(item.exitCode!=null?'exit '+item.exitCode:'')+(item.durationMs!=null?' · '+item.durationMs+'ms':'')",
  ],
  [
    "`[data-stream-target=\"${CSS.escape(kind)}\"]`",
    "'[data-stream-target=\"'+CSS.escape(kind)+'\"]'",
  ],
  [
    "`[data-turn-id=\"${CSS.escape(String(p.turnId||''))}\"]`",
    "'[data-turn-id=\"'+CSS.escape(String(p.turnId||''))+'\"]'",
  ],
  [
    "`support-badge ${serverRequestSupport(r.method)}`",
    "'support-badge '+serverRequestSupport(r.method)",
  ],
  [
    "`${s.codexVersion} · ${s.clientRequests} requests · ${p.threadItemTypes} Items · ${p.nativeServerRequests} native · ${s.schemaDigest.slice(0,12)}`",
    "s.codexVersion+' · '+s.clientRequests+' requests · '+p.threadItemTypes+' Items · '+p.nativeServerRequests+' native · '+s.schemaDigest.slice(0,12)",
  ],
];

for (const [from, to] of fixes) {
  if (!source.includes(from)) throw new Error(`archive bootstrap target missing: ${from}`);
  source = source.replaceAll(from, to);
}
fs.writeFileSync(file, source);
execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
await import(new URL(`./archive-patch.mjs?fixed=${Date.now()}`, import.meta.url));
