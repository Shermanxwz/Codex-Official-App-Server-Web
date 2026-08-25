import { config } from '../src/config.mjs';
import { pruneStateArtifacts } from '../src/state-maintenance.mjs';

const result = pruneStateArtifacts(config.stateDir);
console.log(`STATE_PRUNE scanned=${result.scanned} removed=${result.removed.length}`);
if (result.removed.length) console.log(result.removed.join('\n'));
