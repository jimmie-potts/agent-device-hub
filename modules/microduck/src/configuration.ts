import {Ajv2020} from 'ajv/dist/2020.js';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import type {Configure} from '@jimmie-potts/sdk';
export type MicroDuckConfig = {id: string; fixtureRoot: string; configurationRevision: number};
const valid = new Ajv2020().compile<MicroDuckConfig>({
  type: 'object', additionalProperties: false, required: ['id', 'fixtureRoot', 'configurationRevision'],
  properties: {
    id: {type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$', maxLength: 128},
    fixtureRoot: {type: 'string', pattern: '^/tmp/bunny-md-(?:[0-9a-f]{32}|simulated)$'},
    configurationRevision: {type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER},
  },
});
export const configureMicroDuck: Configure<MicroDuckConfig> = section => valid(section)
  ? {config: {...section}, devices: [section.id]}
  : errorBody('invalid-request', {detail: 'MicroDuck requires a target, configuration revision and private simulator fixture root'});
