import {readFileSync} from 'node:fs';
import {Ajv2020} from 'ajv/dist/2020.js';
import type {ErrorObject, ValidateFunction} from 'ajv';
import {RETRYABLE, isErrorCode, type ErrorCode} from './errors.js';

/** B.U.N.N.Y. profile 2.0 (ADR 0012): one envelope, shared building blocks, one error body and code registry. */
export const PROFILE_VERSION = '2.0';
export const MAX_MESSAGE_BYTES = 256 * 1024;
export const MAX_DEPTH = 32;
export const SCHEMA_BASE = 'https://bunny.invalid/events/';

const read = (name: string): unknown => JSON.parse(readFileSync(new URL(`../../schemas/v2/${name}`, import.meta.url), 'utf8')) as unknown;
export const schemas = {
  blocks: read('blocks.schema.json'),
  envelope: read('envelope.schema.json'),
  kinds: read('kinds.schema.json'),
};

export {RETRYABLE, isErrorCode, type ErrorCode};
type ErrorRegistry = {codes: Readonly<Record<ErrorCode, {retryable: boolean; meaning: string}>>};
/** The registry file, `schemas/v2/errors.json`: each code's flag and meaning. `RETRYABLE` is the same table as a type. */
export const errorCodes = (read('errors.json') as ErrorRegistry).codes;

export type MessageKind = 'state' | 'removal' | 'occurrence' | 'command' | 'reply' | 'outcome' | 'sync-request' | 'sync-completed';
export type Ticket = {epoch: string; sequence: number};
export type Unknown = {status: 'unknown'};
export type Known<T> = {status: 'known'; value: T};
export type EntityRef = {family: string; id: string};
export type ErrorDetail = {code: ErrorCode; retryable: boolean; requestId?: string; traceId?: string; detail?: string};
export type ErrorBody = {error: ErrorDetail};
export type Message<T = Record<string, unknown>> = {
  specversion: '1.0'; bunnyprofile: '2.0'; id: string; source: string; type: string; subject: string; time: string;
  kind: MessageKind; datacontenttype: 'application/json'; dataschema: string; traceparent: string; expiresat?: string; data: T;
};

const ID = /^[A-Za-z0-9_.-]{1,128}$/;
const TRACE_ID = /^[0-9a-f]{32}$/;
export const MAX_DETAIL = 1024;

/**
 * The error body every boundary returns. `retryable` comes from the registry, and the validator refuses received
 * bodies whose code or flag disagrees with it. A code outside the registry fails to compile, and throws when an
 * untyped caller passes one. Extras that the error block would refuse throw here.
 */
export function errorBody(code: ErrorCode, extra: {requestId?: string; traceId?: string; detail?: string} = {}): ErrorBody {
  if (!isErrorCode(code)) throw new Error(`unregistered error code: ${String(code)}`);
  if (extra.requestId !== undefined && !ID.test(extra.requestId)) throw new Error('requestId is not an identifier');
  if (extra.traceId !== undefined && !TRACE_ID.test(extra.traceId)) throw new Error('traceId is not 32 lowercase hex digits');
  if (extra.detail !== undefined && (extra.detail.length === 0 || extra.detail.length > MAX_DETAIL)) throw new Error(`detail must have 1 to ${MAX_DETAIL} characters`);
  return {error: {code, retryable: RETRYABLE[code], ...extra}};
}

export type Validation<T = Record<string, unknown>> = {ok: true; value: Message<T>} | {ok: false; error: ErrorDetail};
/**
 * A rule that JSON Schema cannot state, such as two fields that must agree. It runs after the payload schema passes
 * and returns where the message breaks it, for example `payload /parent/identity another source`, or undefined.
 */
export type PayloadCheck = (message: Message) => string | undefined;

type SchemaId = {family: string; version: string};
const parseSchemaId = (uri: string): SchemaId | undefined => {
  if (!uri.startsWith(SCHEMA_BASE)) return undefined;
  const rest = uri.slice(SCHEMA_BASE.length), slash = rest.lastIndexOf('/');
  if (slash <= 0) return undefined;
  return {family: rest.slice(0, slash), version: rest.slice(slash + 1)};
};
const builtIn: Partial<Record<MessageKind, string>> = {
  reply: 'reply', outcome: 'outcome', removal: 'removal', 'sync-request': 'sync-request', 'sync-completed': 'sync-completed',
};

// Plain JSON only: no prototypes other than Object and Array, no accessors, at most MAX_DEPTH levels of nesting.
function plain(value: unknown, depth = 0): boolean {
  if (depth > MAX_DEPTH) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(item => plain(item, depth + 1));
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false;
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!('value' in descriptor) || descriptor.enumerable !== true || !plain(descriptor.value, depth + 1)) return false;
  }
  return Object.getOwnPropertySymbols(value).length === 0;
}

const zeroTrace = /^00-0{32}-|-0{16}-[0-9a-f]{2}$/;
// The schema fixes the shape `YYYY-MM-DDTHH:MM:SS.mmmZ`; a real instant prints back the same, so 2026-02-30 is refused.
const realInstant = (value: string): boolean => {
  const ms = Date.parse(value);
  return !Number.isNaN(ms) && new Date(ms).toISOString() === value;
};
// Names the failing location, for example `envelope /traceparent pattern` or `payload / required expiresat`. When a
// oneOf failed, its own location is named, because the first error then comes from an arbitrary branch.
const describe = (scope: string, errors: ErrorObject[] | null | undefined): string => {
  // Ajv lists an outer oneOf after the errors of its branches, so the last oneOf is the outermost.
  const first = [...(errors ?? [])].reverse().find(error => error.keyword === 'oneOf') ?? errors?.[0];
  if (first === undefined) return scope;
  const missing = first.keyword === 'required' ? ` ${String((first.params as {missingProperty?: unknown}).missingProperty)}` : '';
  const params = first.params as {additionalProperty?: unknown; unevaluatedProperty?: unknown};
  const extra = first.keyword === 'additionalProperties' ? ` ${String(params.additionalProperty)}` :
    first.keyword === 'unevaluatedProperties' ? ` ${String(params.unevaluatedProperty)}` : '';
  return `${scope} ${first.instancePath === '' ? '/' : first.instancePath} ${first.keyword}${missing}${extra}`;
};
const fail = (code: ErrorCode, detail: string): {ok: false; error: ErrorDetail} => ({ok: false, error: errorBody(code, {detail: detail.slice(0, MAX_DETAIL)}).error});

/**
 * Validates messages against profile 2.0 and the payload schemas registered for their `dataschema`. Modules register
 * their own payload schemas, built from the shared blocks (`https://bunny.invalid/events/blocks/2.0#/$defs/...`).
 */
export class MessageValidator {
  readonly #ajv = new Ajv2020({strict: true, allErrors: false});
  readonly #envelope: ValidateFunction;
  readonly #payloads = new Map<string, ValidateFunction>();
  readonly #checks = new Map<string, PayloadCheck>();

  constructor() {
    this.#ajv.addSchema(schemas.blocks as object);
    this.#ajv.addSchema(schemas.kinds as object);
    this.#envelope = this.#ajv.compile(schemas.envelope as object);
    for (const family of Object.values(builtIn)) {
      this.#payloads.set(`${SCHEMA_BASE}${family}/${PROFILE_VERSION}`, this.#ajv.compile({$ref: `${SCHEMA_BASE}kinds/2.0#/$defs/${family}`}));
    }
  }

  /**
   * Registers a payload schema under `https://bunny.invalid/events/<family>/<major>.<minor>`, with an optional check
   * for rules the schema cannot state. A message that fails the check is refused with `invalid-message`.
   */
  register(dataschema: string, schema: object, check?: PayloadCheck): void {
    const id = parseSchemaId(dataschema);
    if (id === undefined || !/^[a-z][a-z0-9-]*(\/[a-z][a-z0-9-]*)*$/.test(id.family) || !/^[0-9]+\.[0-9]+$/.test(id.version)) {
      throw new Error(`invalid dataschema: ${dataschema}`);
    }
    if (Object.values(builtIn).includes(id.family) || ['blocks', 'kinds', 'profile'].includes(id.family)) {
      throw new Error(`reserved schema family: ${id.family}`);
    }
    if (this.#payloads.has(dataschema)) throw new Error(`schema already registered: ${dataschema}`);
    this.#payloads.set(dataschema, this.#ajv.compile(schema));
    if (check !== undefined) this.#checks.set(dataschema, check);
  }

  // A registered check never makes validation throw: an empty or non-string answer, or a throw, still refuses.
  #check(message: Message): string | undefined {
    const check = this.#checks.get(message.dataschema);
    if (check === undefined) return undefined;
    let broken: unknown;
    try {
      broken = check(message);
    } catch {
      return 'payload check threw';
    }
    if (broken === undefined) return undefined;
    return typeof broken === 'string' && broken.length > 0 ? broken : 'payload check failed';
  }

  /** Checks one message. `nowMs`, when given, rejects a command or sync request past its expiry. */
  validate<T = Record<string, unknown>>(input: unknown, options: {nowMs?: number} = {}): Validation<T> {
    let encoded: string;
    try {
      if (!plain(input)) return fail('invalid-message', `not plain JSON data, or nested more than ${MAX_DEPTH} levels`);
      encoded = JSON.stringify(input);
    } catch {
      return fail('invalid-message', 'not serializable');
    }
    if (Buffer.byteLength(encoded, 'utf8') > MAX_MESSAGE_BYTES) return fail('too-large', `over ${MAX_MESSAGE_BYTES} bytes`);
    if (input === null || typeof input !== 'object' || Array.isArray(input)) return fail('invalid-message', 'not a JSON object');
    const profile = (input as {bunnyprofile?: unknown}).bunnyprofile;
    if (typeof profile === 'string' && profile !== PROFILE_VERSION) return fail('unsupported-version', `bunnyprofile ${profile.slice(0, 32)}`);
    if (!this.#envelope(input)) return fail('invalid-message', describe('envelope', this.#envelope.errors));
    const message = input as Message<T>;
    if (zeroTrace.test(message.traceparent)) return fail('invalid-message', 'trace context');
    if (!realInstant(message.time)) return fail('invalid-message', 'time');
    const id = parseSchemaId(message.dataschema);
    if (id === undefined) return fail('invalid-message', 'dataschema');
    const expected = builtIn[message.kind];
    if (expected !== undefined && id.family !== expected) return fail('invalid-message', `a ${message.kind} message uses the ${expected} schema`);
    if (expected === undefined && Object.values(builtIn).includes(id.family)) return fail('invalid-message', 'reserved schema family');
    const validatePayload = this.#payloads.get(message.dataschema);
    if (validatePayload === undefined) {
      const sameFamily = [...this.#payloads.keys()].some(uri => parseSchemaId(uri)?.family === id.family);
      return sameFamily ? fail('unsupported-version', message.dataschema) : fail('unknown-schema', message.dataschema);
    }
    if (!validatePayload(message.data)) return fail('invalid-message', describe('payload', validatePayload.errors));
    const broken = this.#check(message as Message);
    if (broken !== undefined) return fail('invalid-message', broken);
    if (message.expiresat !== undefined) {
      if (!realInstant(message.expiresat)) return fail('invalid-message', 'expiresat');
      if (options.nowMs !== undefined && Date.parse(message.expiresat) <= options.nowMs) return fail('expired', message.expiresat);
    }
    return {ok: true, value: message};
  }
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}

/**
 * Compares a message with an earlier one under the retry identity `(source, id)`. The same identity with the same
 * content is a duplicate to drop; the same identity with different content is a conflict.
 */
export function compareDelivery(prior: Message<unknown> | undefined, next: Message<unknown>): 'new' | 'duplicate' | 'conflict' {
  if (prior === undefined || prior.source !== next.source || prior.id !== next.id) return 'new';
  return canonical(prior) === canonical(next) ? 'duplicate' : 'conflict';
}
