import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Ajv2020} from 'ajv/dist/2020.js';
import {MAX_BYTES,MAX_DEPTH,MAX_NODES,validateEvent as validateEarlierEvent,type Envelope as EarlierEnvelope} from './index.js';

// Lifecycle 1.2 (Hub #784) lives beside the frozen 1.0/1.1 module: `index.js` decides whether a
// previous release can reopen stored sessions, so it stays byte-identical. Import this subpath,
// `@jimmie-potts/agent-lifecycle-contracts/v1.2`, wherever 1.2 envelopes must be accepted.
export * from './index.js';
export const ARTIFACT_VERSION = '1.2.0';
export const API_VERSIONS = Object.freeze(['1.0','1.1','1.2'] as const);
export type Envelope = Omit<EarlierEnvelope,'apiVersion'> & {
  apiVersion:'1.0'|'1.1'|'1.2';
  /** Lifecycle 1.2 root events only: the hosting application's session ID (Claude Desktop `local_<uuid>`). Never an identity. */
  hostSessionId?:string;
};
export type Validation = {ok:true; value:Envelope}|{ok:false; code:'invalid-event'};
const check = new Ajv2020({strict:true, allErrors:false}).compile(JSON.parse(readFileSync(new URL('../schemas/lifecycle-v1.2.schema.json', import.meta.url), 'utf8')));

// The same plain-JSON bounds as the 1.0/1.1 module, applied before schema evaluation.
function bounded(value:unknown, depth=0, budget={nodes:0, bytes:0}):boolean {
  if (depth > MAX_DEPTH || ++budget.nodes > MAX_NODES) return false;
  if (typeof value === 'string') {
    budget.bytes += Buffer.byteLength(value, 'utf8');
    return budget.bytes <= MAX_BYTES && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
  }
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0;
  if (typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const entries = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length > MAX_NODES) return false;
  for (const [key, descriptor] of Object.entries(entries)) {
    if (!descriptor.enumerable || !('value' in descriptor) || !bounded(key,depth+1,budget) || !bounded(descriptor.value,depth+1,budget)) return false;
  }
  return Object.getOwnPropertySymbols(value).length === 0;
}

/** Accept lifecycle 1.0, 1.1 and 1.2 envelopes; errors stay content-free. */
export function validateEvent(input:unknown):Validation {
  const earlier = validateEarlierEvent(input);
  if (earlier.ok) return earlier;
  try {
    if (!bounded(input)) return {ok:false, code:'invalid-event'};
    const encoded = JSON.stringify(input);
    if (Buffer.byteLength(encoded,'utf8') > MAX_BYTES || !check(input)) return {ok:false, code:'invalid-event'};
    const value = JSON.parse(encoded) as Envelope;
    if (value.parent.status === 'known') {
      const parent = value.parent.identity;
      if (parent.sessionId === value.identity.sessionId ||
          (['provider','client','hostId','sourceId'] as const).some(key=>parent[key] !== value.identity[key])) return {ok:false,code:'invalid-event'};
    }
    return {ok:true, value};
  } catch { return {ok:false, code:'invalid-event'}; }
}

function canonical(value:unknown):string {
  if (typeof value !== 'object' || value === null) return JSON.stringify(value);
  const object = value as Record<string,unknown>;
  return '{' + Object.keys(object).sort().map(key => JSON.stringify(key)+':'+canonical(object[key])).join(',') + '}';
}

/** The 1.0/1.1 deduplication algorithm, extended to 1.2 envelopes; earlier inputs keep their keys. */
export function deduplicationKey(input:unknown):{kind:'native'|'content'; key:string}|null {
  const result = validateEvent(input);
  if (!result.ok) return null;
  const value = result.value;
  const kind = value.eventId === undefined ? 'content' : 'native';
  const material = kind === 'native' ? {identity:value.identity, turn:value.turn, eventId:value.eventId} : value;
  return {kind, key:createHash('sha256').update(canonical(material),'utf8').digest('hex')};
}
