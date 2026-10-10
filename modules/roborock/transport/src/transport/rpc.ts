import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {SdkError} from '@jimmie-potts/sdk';

export type MapSecurity = {readonly endpoint: string; readonly nonce: Uint8Array};

const uint = (value: unknown, maximum: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= maximum;

/**
 * Internal final RPC boundary, used immediately before framing. Never re-export this generic encoder to consumers.
 * Parameters and route are guarded here as well as in the typed reader; a read name cannot smuggle control parameters.
 */
export function encodeRpc(method: string, route: 'local' | 'mqtt', params: readonly unknown[], id: number, seconds: number, security?: MapSecurity): Buffer {
  const map = method === 'get_map_v1';
  const local = ['get_status', 'get_consumable', 'get_clean_summary', 'get_clean_record', 'get_room_mapping'].includes(method);
  const record = method === 'get_clean_record';
  const validParams = Array.isArray(params) && (record ? params.length === 1 && uint(params[0], 0xffffffff) : params.length === 0);
  const validSecurity = map
    ? typeof security === 'object' && security !== null && typeof security.endpoint === 'string' && security.endpoint.length === 8 && !/[^A-Za-z0-9+/]/.test(security.endpoint)
      && security.nonce instanceof Uint8Array && security.nonce.byteLength === 16
    : security === undefined;
  if (!(map ? route === 'mqtt' : local && route === 'local') || !validParams || !validSecurity) {
    throw new SdkError(errorBody('forbidden', {detail: 'The transport refuses this RPC.'}));
  }
  if (!uint(id, 0xffff) || id === 0 || !uint(seconds, 0xffffffff)) {
    throw new SdkError(errorBody('invalid-request', {detail: 'The read identity is invalid.'}));
  }
  const inner = {id, method, params, ...(security === undefined ? {} : {
    security: {endpoint: security.endpoint, nonce: Buffer.from(security.nonce).toString('hex').toUpperCase()},
  })};
  return Buffer.from(JSON.stringify({dps: {'101': JSON.stringify(inner)}, t: seconds}), 'utf8');
}
