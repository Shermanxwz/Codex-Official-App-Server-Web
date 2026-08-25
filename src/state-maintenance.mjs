import fs from 'node:fs';
import path from 'node:path';

// Schema generation is transactional. These are the only gateway-owned
// artifacts that are safe to remove automatically after an interrupted swap.
const STALE_SCHEMA_ARTIFACT = /^schema-(?:stable|experimental)\.\d+\.[a-f0-9]+\.(?:tmp|bak)$/i;

export function pruneStateArtifacts(dir, { now = Date.now(), maxAgeMs = 60 * 60 * 1000 } = {}) {
  const root = path.resolve(dir);
  if (!fs.existsSync(root)) return { scanned: false, removed: [] };
  const removed = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!STALE_SCHEMA_ARTIFACT.test(entry.name)) continue;
    const target = path.join(root, entry.name);
    let stat;
    try { stat = fs.statSync(target); } catch { continue; }
    if (now - stat.mtimeMs < maxAgeMs) continue;
    fs.rmSync(target, { recursive: true, force: true });
    removed.push(entry.name);
  }
  return { scanned: true, removed };
}
