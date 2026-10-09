import {errorBody, type ErrorBody, type ErrorCode} from '@jimmie-potts/event-contracts/v2';
import type {ModuleContent} from '@jimmie-potts/sdk';
import type {WisprResponse} from './wispr.js';

export type WisprReadResult = ModuleContent | ErrorBody;
export const ANALYTICS_SCHEMA = 'wispr-analytics/2.0';
export const MAX_RESPONSE_BYTES = 1048576;
const codes: Readonly<Record<string, ErrorCode>> = {
  'unsupported-filter': 'invalid-request', 'range-outside-coverage': 'invalid-request',
  'wispr-row-capacity': 'too-large', 'wispr-response-capacity': 'too-large',
  'text-not-shared': 'forbidden', 'wispr-unavailable': 'unavailable', 'wispr-observation-changed': 'unavailable',
  capacity: 'capacity', cancelled: 'cancelled', 'not-found': 'not-found',
  'invalid-request': 'invalid-request', 'too-large': 'too-large', forbidden: 'forbidden', unavailable: 'unavailable', internal: 'internal',
};
export const wisprRefusal = (code: ErrorCode): ErrorBody => errorBody(code, {detail: 'the Wispr analytics read was refused'});
export const readerRefusal = (code: string): ErrorBody => wisprRefusal(codes[code] ?? 'internal');
/** The reader uses its original internal response; the runtime boundary returns the shared registry and document schema. */
export function adaptWisprResponse(response: WisprResponse): WisprReadResult {
  if (Buffer.byteLength(response.body) > MAX_RESPONSE_BYTES) return wisprRefusal('too-large');
  if (response.status !== 200) {
    try {
      const value: unknown = JSON.parse(response.body);
      const code = (value as {error?: {code?: unknown}} | null)?.error?.code;
      return readerRefusal(typeof code === 'string' ? code : 'internal');
    } catch { return wisprRefusal('internal'); }
  }
  if (response.csv === true) return {type: 'text/csv; charset=utf-8', bytes: Buffer.from(response.body)};
  try {
    const value: unknown = JSON.parse(response.body);
    if (typeof value !== 'object' || value === null || Array.isArray(value) || !('apiVersion' in value) || value.apiVersion !== '1.0'
      || !('data' in value) || 'error' in value) return wisprRefusal('internal');
    const {apiVersion: _version, ...fields} = value;
    const bytes = Buffer.from(JSON.stringify({schema: ANALYTICS_SCHEMA, ...fields}));
    return bytes.byteLength > MAX_RESPONSE_BYTES ? wisprRefusal('too-large') : {type: 'application/json', bytes};
  } catch { return wisprRefusal('internal'); }
}
