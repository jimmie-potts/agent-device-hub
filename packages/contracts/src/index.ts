import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import type {
  Admission, AdmissionResult, AdmissionState, Authorization, Capabilities, Command,
  FailureCode, FeedEvent, Receipt, ReferenceInput, Request, Ticket,
} from './types.js';
export type * from './types.js';

export const ARTIFACT_VERSION = '1.0.0';
export const API_VERSION = '1.0';
export const MAX_JSON_DEPTH = 32;
export const schema = JSON.parse(readFileSync(new URL('../schemas/controller-v1.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ strict: true, allErrors: true });
ajv.addSchema(schema);
const validators = new Map<string, ValidateFunction>();

/** Strict shape validation. Unknown schema names reject rather than widening the contract. */
export function validate(definition: string, value: unknown): boolean {
  if (!Object.hasOwn(schema.$defs, definition)) return false;
  let validator = validators.get(definition);
  if (!validator) {
    validator = ajv.compile({ $ref: `${schema.$id}#/$defs/${definition}` });
    validators.set(definition, validator);
  }
  return isJson(value) && validator(value) as boolean;
}

function isJson(value: unknown): boolean {
  // All v1 schema shapes are shallower than this bound. Walk hostile input without recursion.
  const pending: [unknown, number][] = [[value, 0]];
  while (pending.length) {
    const [item, depth] = pending.pop()!;
    if (depth > MAX_JSON_DEPTH) return false;
    if (item === null || typeof item === 'string' || typeof item === 'boolean') continue;
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) return false;
      continue;
    }
    if (!Array.isArray(item) && (typeof item !== 'object' || Object.getPrototypeOf(item) !== Object.prototype)) return false;
    for (const child of Object.values(item)) pending.push([child, depth + 1]);
  }
  return true;
}

// JSON object order is immaterial and numeric negative zero is the same value as zero.
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => sameJson(v, b[i]));
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) || Array.isArray(b)) return false;
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  return Object.keys(left).length === Object.keys(right).length
    && Object.keys(left).every(k => Object.hasOwn(right, k) && sameJson(left[k], right[k]));
}

const sameTicket = (a: Ticket, b: Ticket): boolean => a.epoch === b.epoch && a.sequence === b.sequence;

export function authorize(input: Authorization): { decision: 'allowed' | 'unauthenticated' | 'forbidden'; effects: 0 } {
  const c = input.credential;
  if (!c || c.kind !== 'machine' || !c.declared || !['active', 'overlap'].includes(c.status)) {
    return { decision: 'unauthenticated', effects: 0 };
  }
  if (!input.hostAllowed || !input.fetchMetadataAllowed || (input.originPresent && !input.originAllowed)
      || !c.devices.includes(input.deviceId) || !c.scopes.includes(input.scope)) {
    return { decision: 'forbidden', effects: 0 };
  }
  return { decision: 'allowed', effects: 0 };
}

function supports(c: Capabilities, command: Command): boolean {
  switch (command.kind) {
    case 'power.set': return c.power.supported;
    case 'brightness.set': return c.brightness.supported;
    case 'media.start': return c.media.supported && c.media.playlistIds.includes(command.playlistId);
    case 'media.control': return c.media.supported && c.media.actions.includes(command.action);
    case 'scene.activate': return c.scenes.supported && c.scenes.sceneIds.includes(command.sceneId);
    case 'zone.power.set': return c.zones.supported && c.zones.zoneIds.includes(command.zoneId);
    case 'mode.set': return !!c.modes?.supported && c.modes.values.includes(command.mode);
  }
}

/** A pure admission decision. The owner must atomically apply a reservation and retain its receipt. */
export function admit(input: Admission): AdmissionResult {
  const s = input.state;
  const reject = (decision: AdmissionResult['decision']): AdmissionResult =>
    ({ decision, reserved: false, nextSequence: s.nextSequence, scheduled: 0 });
  // Authentication precedes even schema diagnostics and replay content. Scope the actual target below.
  const auth = authorize({ ...input.auth, scope: 'control' });
  if (auth.decision !== 'allowed') return reject(auth.decision);
  if (!validate('request', input.request)) return reject('invalid-request');
  const r = input.request as Request;
  const targetAuth = authorize({ ...input.auth, deviceId: r.deviceId, scope: 'control' });
  if (targetAuth.decision !== 'allowed') return reject(targetAuth.decision);
  if (r.controllerId !== s.controllerId || r.deviceId !== s.deviceId) return reject('unknown-device');
  if (!Number.isSafeInteger(input.bodyBytes) || input.bodyBytes < 0) return reject('invalid-request');
  if (input.bodyBytes > s.maxBodyBytes) return reject('capacity');
  if (r.requestId.epoch !== s.epoch) return reject('request-expired');
  const cached = s.cache.find(entry => sameTicket(entry.request.requestId, r.requestId));
  if (cached) {
    return sameJson(cached.request, r)
      ? { ...reject('replay'), receipt: structuredClone(cached.receipt) } : reject('request-conflict');
  }
  const pending = s.pending.find(entry => sameTicket(entry.request.requestId, r.requestId));
  if (pending) return reject(sameJson(pending.request, r) ? 'join' : 'request-conflict');
  if (r.requestId.sequence < s.nextSequence) return reject('request-expired');
  if (r.requestId.sequence > s.nextSequence) return reject('request-order');
  if (s.inFlight >= s.maxInFlight || s.queueDepth >= s.maxQueue
      || s.nextSequence >= Number.MAX_SAFE_INTEGER || s.configurationRevision >= Number.MAX_SAFE_INTEGER) {
    return reject('capacity');
  }
  let failure: FailureCode | undefined;
  if (r.expectedConfigurationRevision !== s.configurationRevision) failure = 'revision-conflict';
  else if (!sameTicket(r.expectedGeneration, s.generation)) failure = 'stale-generation';
  else if (!supports(s.capabilities, r.command)) failure = 'unsupported-capability';
  const receipt: Receipt = {
    apiVersion: '1.0', controllerId: r.controllerId, deviceId: r.deviceId,
    requestId: structuredClone(r.requestId), configurationRevision: s.configurationRevision + (failure ? 0 : 1),
    generation: structuredClone(s.generation), outcome: failure ? 'failed' : 'queued',
    priorEffects: 'none', completedOperations: [], uncertainOperations: [],
  };
  if (failure) receipt.failure = { code: failure };
  return { decision: failure ?? 'queued', reserved: true, nextSequence: s.nextSequence + 1,
    scheduled: failure ? 0 : 1, receipt };
}

/** Serial reduction models one atomic reservation owner; it is not a concurrent controller or queue. */
function batchAdmit(input: Extract<ReferenceInput, { operation: 'batch-admit' }>) {
  const state: AdmissionState = structuredClone(input.state);
  const results: AdmissionResult[] = [];
  for (const item of input.items) {
    const result = admit({ ...item, state });
    results.push(result);
    if (result.reserved && result.receipt) {
      state.nextSequence = result.nextSequence;
      state.configurationRevision = result.receipt.configurationRevision;
      if (result.scheduled) {
        state.pending.push({ request: structuredClone(item.request as Request) });
        state.inFlight += 1;
        state.queueDepth += 1;
      } else {
        state.cache.push({ request: structuredClone(item.request as Request), receipt: result.receipt });
        state.cache = state.cache.slice(-state.maxReceipts);
      }
    }
  }
  return { results, nextSequence: state.nextSequence, scheduled: results.reduce((sum, r) => sum + r.scheduled, 0) };
}

function feed(input: Extract<ReferenceInput, { operation: 'feed' }>): { events: FeedEvent[]; effects: 0 } {
  const latest = input.snapshot.cursor;
  const cursor = input.cursor as Ticket;
  const retained = validate('ticket', cursor) && cursor.epoch === latest.epoch
    && (sameTicket(cursor, latest) || input.events.some(e => sameTicket(e.cursor, cursor)));
  if (!retained || cursor.sequence > latest.sequence) {
    return { events: [{ apiVersion: '1.0', kind: 'resync', cursor: structuredClone(latest), snapshot: structuredClone(input.snapshot) }], effects: 0 };
  }
  return { events: structuredClone(input.events.filter(e => e.cursor.epoch === latest.epoch
    && e.cursor.sequence > cursor.sequence && e.cursor.sequence <= latest.sequence).sort((a, b) => a.cursor.sequence - b.cursor.sequence)), effects: 0 };
}

function clock(input: Extract<ReferenceInput, { operation: 'clock' }>) {
  const r = input.renderer;
  if (!r || !validate('renderer', r)) return { status: 'unknown' };
  if (!input.supportedProfiles.some(p => p.profileId === r.profileId && p.profileVersion === r.profileVersion)) return { status: 'unsupported' };
  if (!input.fresh || r.clock.epoch !== input.expectedClockEpoch || r.deadlineMs === undefined
      || !Number.isFinite(input.receivedAtLocalMs) || !Number.isFinite(input.nowLocalMs)
      || input.receivedAtLocalMs < 0 || input.nowLocalMs < input.receivedAtLocalMs) return { status: 'unknown' };
  return { status: 'known', remainingMs: Math.max(0, Math.max(0, r.deadlineMs - r.clock.sampledAtMs)
    - (input.nowLocalMs - input.receivedAtLocalMs)) };
}

/** Inputs other than request/cursor/renderer are trusted, schema-validated owner state. No I/O occurs. */
export function evaluate(input: ReferenceInput): unknown {
  switch (input.operation) {
    case 'authorize': return authorize(input);
    case 'admit': return admit(input);
    case 'batch-admit': return batchAdmit(input);
    case 'dequeue': return sameTicket(input.expectedGeneration, input.currentGeneration)
      ? { decision: 'send-permitted', priorEffects: input.priorEffects, scheduled: 1 }
      : { decision: 'cancelled', failure: 'stale-generation', priorEffects: input.priorEffects, scheduled: 0 };
    case 'feed': return feed(input);
    case 'project': return {
      snapshot: structuredClone(input.event.kind === 'resync' || input.event.cursor.epoch !== input.snapshot.cursor.epoch
        || input.event.cursor.sequence > input.snapshot.cursor.sequence ? input.event.snapshot : input.snapshot),
      effects: 0,
    };
    case 'clock': return clock(input);
    case 'read': return { snapshot: structuredClone(input.snapshot), effects: 0 };
    case 'sample': return { snapshot: { ...structuredClone(input.snapshot), sampleClock: structuredClone(input.sampleClock), serviceHealth: input.serviceHealth }, effects: 0 };
    default: throw new Error('Unknown reference operation');
  }
}
