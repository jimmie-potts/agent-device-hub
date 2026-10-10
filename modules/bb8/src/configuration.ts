import {errorBody, type ErrorBody} from '@jimmie-potts/event-contracts/v2';
import type {Configured} from '@jimmie-potts/sdk';
export type Bb8Config = {id: string; configurationRevision: number};
export function configureBb8(section: unknown): Configured<Bb8Config> | ErrorBody {
  if (typeof section !== 'object' || section === null || Array.isArray(section)) return errorBody('invalid-request', {detail: 'BB-8 configuration is an object'});
  const value = section as Record<string, unknown>;
  if (Object.keys(value).some(key => !['id', 'configurationRevision'].includes(key)) || typeof value.id !== 'string' || value.id.length > 128 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id) || !Number.isSafeInteger(value.configurationRevision) || Number(value.configurationRevision) < 0) return errorBody('invalid-request', {detail: 'BB-8 configuration requires a routing ID and configuration revision'});
  return {config: {id: value.id, configurationRevision: Number(value.configurationRevision)}, devices: [value.id]};
}
