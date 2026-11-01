import {Ajv2020} from 'ajv/dist/2020.js';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import type {Configure} from '@jimmie-potts/sdk';
export type ReachyConfig = {id: string; endpoint: string; configurationRevision: number; ownership: 'exclusive'};
const check = new Ajv2020().compile<ReachyConfig>({
  type: 'object', additionalProperties: false, required: ['id', 'endpoint', 'configurationRevision', 'ownership'],
  properties: {id: {type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$', maxLength: 128},
    endpoint: {type: 'string', maxLength: 256}, configurationRevision: {type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER}, ownership: {const: 'exclusive'}},
});
export const configureReachy: Configure<ReachyConfig> = section => {
  if (!check(section)) return errorBody('invalid-request', {detail: 'Reachy requires an explicit owned simulated endpoint, routing ID and revision'});
  try {
    const url = new URL(section.endpoint);
    if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.port === '' || url.pathname !== '/' || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '')
      return errorBody('invalid-request', {detail: 'Reachy simulator endpoint must be a numeric loopback HTTP origin with an explicit port'});
    return {config: {...section, endpoint: url.origin}, devices: [section.id]};
  } catch {return errorBody('invalid-request', {detail: 'Reachy simulator endpoint is invalid'});}
};
