import {readFileSync} from 'node:fs';
import {Ajv2020} from 'ajv/dist/2020.js';

export const ARTIFACT_VERSION = '1.0.0';
export const PROFILE_VERSION = '1.0';
export const MAX_BYTES = 16 * 1024;
export const MAX_DEPTH = 12;
export const MAX_NODES = 512;
export type KnownId = {status:'unknown'} | {status:'known'; id:string};
export type Reference = {status:'unknown'} | {status:'known'; source:string; id:string};
export type Evidence = {
  observedAtMs:number; receivedAtMs?:number; occurrence:'known'|'unknown';
  ordering:{status:'unknown'}|{status:'known'; authority:string; epoch:string; sequence:number};
  correlation:Reference; causation:Reference;
};
export type Payloads = {
  'org.bunny.lifecycle.observed': {provider:'codex'|'claude'; client:'cli'|'desktop'|'code'; hostId:string; sourceId:string; sessionId:string; kind:string; nativeIdentity:KnownId};
  'org.bunny.state.changed': {ownerId:string; revision:number};
  'org.bunny.selection.committed': {selectionId:string; revision:number; mode:'Work'|'Free'|'Quiet'};
  'org.bunny.controller.outcome': {controllerId:string; deviceId:string; request:{epoch:string; sequence:number}; outcome:'queued'|'sent'|'failed'|'partially-applied'|'uncertain'|'cancelled'; priorEffects:'none'|'possible'|'confirmed-transmission'};
  'org.bunny.notice.accepted': {noticeId:string; acceptanceId:string; policyId:string};
  'org.bunny.effect.available': {effectId:string; policyId:string; notBeforeMs:number; expiresAtMs:number};
};
export type EventRecord = {[K in keyof Payloads]: {
  specversion:'1.0'; bunnyprofile:'1.0'; id:string; source:string; type:K;
  dataschema:string; datacontenttype:'application/json'; time?:string;
  deliveryclass:'current-state'|'actionable-notification'|'time-sensitive-effect';
  data:{evidence:Evidence; payload:Payloads[K]};
}}[keyof Payloads];
export type Validation = {ok:true; value:EventRecord}|{ok:false; code:'invalid-event'};
export const schema = JSON.parse(readFileSync(new URL('../schemas/event-v1.schema.json',import.meta.url),'utf8'));
const check = new Ajv2020({strict:true,allErrors:false}).compile(schema);
const invalid = ():Validation => ({ok:false,code:'invalid-event'});

// Inspect only plain JSON data descriptors. No getters, toJSON hooks or proxies
// are promised safe; callers must not hand this boundary executable objects.
function bounded(value:unknown,depth=0,budget={nodes:0,bytes:0}):boolean {
  if (depth>MAX_DEPTH || ++budget.nodes>MAX_NODES) return false;
  if (typeof value==='string') {
    budget.bytes+=Buffer.byteLength(value,'utf8');
    return budget.bytes<=MAX_BYTES && !(/[^\x20-\x7e]/.test(value)) && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
  }
  if (value===null || typeof value==='boolean') return true;
  if (typeof value==='number') return Number.isSafeInteger(value) && value>=0;
  if (typeof value!=='object' || Array.isArray(value) || Object.getPrototypeOf(value)!==Object.prototype) return false;
  if (Reflect.ownKeys(value).length>MAX_NODES || Object.getOwnPropertySymbols(value).length) return false;
  for (const [key,d] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!d.enumerable || !('value' in d) || !bounded(key,depth+1,budget) || !bounded(d.value,depth+1,budget)) return false;
  }
  return true;
}

/** Pure profile validation. Authentication, durable acceptance and delivery remain owner obligations. */
export function validateEvent(input:unknown):Validation {
  try {
    if (!bounded(input)) return invalid();
    const encoded=JSON.stringify(input);
    if (Buffer.byteLength(encoded,'utf8')>MAX_BYTES || !check(input)) return invalid();
    const value=JSON.parse(encoded) as EventRecord;
    const evidence=value.data.evidence;
    if ((evidence.occurrence==='known') !== (value.time!==undefined)) return invalid();
    if (value.time!==undefined && (value.time.startsWith('0000') || new Date(value.time).toISOString()!==value.time)) return invalid();
    if (evidence.causation.status==='known' && evidence.causation.source===value.source && evidence.causation.id===value.id) return invalid();
    if (value.type==='org.bunny.lifecycle.observed') {
      const p=value.data.payload;
      if ((p.provider==='claude') !== (p.client==='code')) return invalid();
    }
    if (value.type==='org.bunny.effect.available' && value.data.payload.expiresAtMs<=value.data.payload.notBeforeMs) return invalid();
    return {ok:true,value};
  } catch {return invalid();}
}

function canonical(value:unknown):string {
  if (value===null || typeof value!=='object') return JSON.stringify(value);
  const record=value as Record<string,unknown>;
  return '{'+Object.keys(record).sort().map(k=>JSON.stringify(k)+':'+canonical(record[k])).join(',')+'}';
}

/** Specification decisions only: caller supplies acceptance/handling evidence; no state is persisted. */
export function referenceDecision(input:unknown):string {
  try {
    if (!bounded(input) || input===null || typeof input!=='object') return 'invalid';
    const i=input as Record<string,unknown>;
    const exact=(keys:string[])=>Object.keys(i).length===keys.length && keys.every(k=>Object.hasOwn(i,k));
    const event=validateEvent(i.event);
    if (!event.ok) return 'invalid';
    if (i.operation==='retry') {
      if (!exact(['operation','event','prior'])) return 'invalid';
      if (i.prior===null) return 'new';
      const prior=validateEvent(i.prior);
      if (!prior.ok) return 'invalid';
      if (prior.value.source!==event.value.source || prior.value.id!==event.value.id) return 'new';
      return canonical(prior.value)===canonical(event.value) ? 'duplicate' : 'conflict';
    }
    if (i.operation!=='delivery' || !exact(['operation','event','recovery','nowMs','acceptance','handling','delivered']) ||
        typeof i.recovery!=='boolean' || typeof i.delivered!=='boolean' || !Number.isSafeInteger(i.nowMs) || Number(i.nowMs)<0 ||
        !['unconfirmed','confirmed','ambiguous','failed'].includes(i.acceptance as string) ||
        !['pending','handled','expired'].includes(i.handling as string)) return 'invalid';
    const value=event.value;
    if (value.deliveryclass==='current-state') return 'read-snapshot';
    if (value.type==='org.bunny.notice.accepted') {
      if (i.acceptance!=='confirmed') return 'unconfirmed';
      if (i.handling==='handled') return 'handled';
      if (i.handling==='expired') return 'expired';
      if (i.recovery) return 'recover-notice';
      return i.delivered ? 'await-handling' : 'deliver-notice';
    }
    if (value.type==='org.bunny.effect.available') {
      if (i.recovery) return 'no-replay';
      if (Number(i.nowMs)<value.data.payload.notBeforeMs) return 'not-yet-valid';
      if (Number(i.nowMs)>=value.data.payload.expiresAtMs) return 'expired';
      return 'eligible-live-effect';
    }
    return 'invalid';
  } catch {return 'invalid';}
}
