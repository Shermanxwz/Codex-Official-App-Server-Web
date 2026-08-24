import path from 'node:path';
import { config } from '../src/config.mjs';
import { OfficialSchemaRegistry } from '../src/schema-registry.mjs';
const dir=path.join(config.stateDir,config.experimental?'schema-experimental':'schema-stable');
const registry=new OfficialSchemaRegistry({dir,codexBin:config.codexBin,experimental:config.experimental,refresh:true});
console.log(JSON.stringify(registry.summary(),null,2));
