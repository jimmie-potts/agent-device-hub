import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Ajv2020} from 'ajv/dist/2020.js';

export const ARTIFACT_VERSION = '1.1.0';
export const API_VERSION = '1.0';
export const MAX_BYTES = 8192;
export const MAX_DEPTH = 8;
export const MAX_NODES = 256;
export type Identity = {provider:'codex'|'claude'; client:'cli'|'desktop'|'code'; hostId:string; sourceId:string; sessionId:string};
export type KnownId = {status:'unknown'} | {status:'known'; id:string};
export type LifecycleEvent =
  | {kind:'session.started'|'turn.started'|'activity.observed'|'turn.ended'|'turn.interrupted'|'runtime.ended'}
  | {kind:'question.continuing'|'attention.input'|'attention.approval'|'attention.resolved'; attention:KnownId}
  | {kind:'notice.acknowledged'; consumerId:string; noticeId:string}
  | {kind:'read.observed'; state:'read'|'unread'}
  | {kind:'evidence.unavailable'; dimension:'activity'|'attention'|'turn'|'parent'|'read'|'ordering'; reason:'unsupported'|'inaccessible'|'missing'|'ambiguous'|'lost'};
export type Envelope = {
  apiVersion:'1.0'|'1.1'; identity:Identity; turn:KnownId;
  parent:{status:'unknown'|'top-level'}|{status:'known'; identity:Identity};
  eventId?:string; event:LifecycleEvent; observedAtMs:number; occurredAtMs?:number;
  ordering:{status:'unknown'}|{status:'known'; epoch:string; sequence:number};
  projectId?:string; label?:{origin:'user'|'agent'; value:string};
  title?:{value:string;source:'provider'|'user'}; project?:string;
};
export type Validation = {ok:true; value:Envelope}|{ok:false; code:'invalid-event'};
const schema = JSON.parse(readFileSync(new URL('../schemas/lifecycle-v1.schema.json', import.meta.url), 'utf8'));
const metadataSchema = JSON.parse(readFileSync(new URL('../schemas/lifecycle-v1.1.schema.json', import.meta.url), 'utf8'));
const metadataCheck = new Ajv2020({strict:true, allErrors:false}).compile(metadataSchema);
const displayPattern = new RegExp(metadataSchema.$defs.displayText.pattern,'u');
export function validDisplayText(value:unknown, maximum=160):value is string {
  return typeof value==='string' && [...value].length<=maximum && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value) && displayPattern.test(value);
}
const check = new Ajv2020({strict:true, allErrors:false}).compile(schema);

// Accept plain JSON only, before schema evaluation or serialization. Never return
// Ajv errors: their paths/parameters can carry attacker-controlled field names.
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

export function validateEvent(input:unknown):Validation {
  try {
    if (!bounded(input)) return {ok:false, code:'invalid-event'};
    const encoded = JSON.stringify(input);
    if (Buffer.byteLength(encoded,'utf8') > MAX_BYTES || !(check(input) || metadataCheck(input))) return {ok:false, code:'invalid-event'};
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

/** A content key is deliberately marked ambiguous: identical observations collide. */
export function deduplicationKey(input:unknown):{kind:'native'|'content'; key:string}|null {
  const result = validateEvent(input);
  if (!result.ok) return null;
  const value = result.value;
  const kind = value.eventId === undefined ? 'content' : 'native';
  const material = kind === 'native' ? {identity:value.identity, turn:value.turn, eventId:value.eventId} : value;
  return {kind, key:createHash('sha256').update(canonical(material),'utf8').digest('hex')};
}
