// The bookkeeping members of state families (Hub #1771, design #1768). A bookkeeping member may change while the state
// it belongs to does not: a reading time, a paint time, an update time. Each is a JSON pointer (RFC 6901) to an object
// member at any depth, declared by family, not by version, beside the family's schema: here for the families of this
// package, and in a module's registration (`ModuleFactory.bookkeeping`) for the module's own families. A family with no
// bookkeeping member declares an empty list, which is a deliberate answer: every member counts.
//
// The declaration is metadata. It changes no message, schema, payload or validation result, and it is not a family
// version. Nothing reads it yet: history will use it to tell a repeated reading from a change (#1772).
import {SCHEMA_BASE, schemas} from './index.js';
import {artStateFamilies} from './art-state.js';
import {deviceFamilies} from './devices.js';
import {coreFamilies} from './families.js';
import type {PayloadFamily} from './registry.js';

/** JSON pointers to bookkeeping members, by family. */
export type Bookkeeping = Readonly<Record<string, readonly string[]>>;

const freeze = (map: Record<string, string[]>): Bookkeeping =>
  Object.freeze(Object.fromEntries(Object.entries(map).map(([family, pointers]) => [family, Object.freeze(pointers)])));

/**
 * Every state family of this package and its bookkeeping members. A new state family of this package, or a member
 * named here that its schema does not declare, fails the package's tests until it is classified.
 */
export const bookkeeping: Bookkeeping = freeze({
  // Reading, paint and evidence times. Each moves with every poll, probe or paint while the device stays as it was.
  // `observed/status`, `/power` and `/brightness`, `lastTransmission/requestId` and `/operationIds`, and
  // `externalControl/owner` still count (owner decision 3 on #1768, 2026-11-12, for the paint time).
  'device': ['/observed/observedAtMs', '/lastTransmission/transmittedAtMs', '/externalControl/observedAtMs'],
  // The core copies the device's reading time and stamps every view with its clock; the settings, status, start,
  // deadline and attempt still count.
  'power-limit': ['/observedAtMs', '/updatedAtMs'],
  // The source's reading time; the playback module already publishes no new revision for it alone.
  'playback': ['/observedAtMs'],
  // Agent session times stay rows (owner decision 6 on #1768, 2026-11-12), and freshness is real state.
  'session': [],
  'mode': [],
  'inbox-item': [],
  'operation': [],
  'preference-state': [],
  'companion-state': [],
  'companion-speech-state': [],
  'coding-state': [],
  'music-capture-state': [],
  'music-lighting-state': [],
  'music-lighting-device': [],
  'playback-position': [],
  'art-schedule': [],
  'assistant-state': [],
  'lighting-layout': [],
  'playback-layout': [],
  'home-layout': [],
  'art': [],
});

/**
 * Settings families: every member is something a person set, which replicates between installations by its latest
 * edit (ADR 0015), so none is ever bookkeeping. Power-limit settings are refused by name below.
 */
export const SETTINGS_FAMILIES: readonly string[] = Object.freeze([
  'mode', 'lighting-layout', 'playback-layout', 'home-layout', 'art-schedule', 'preference-state',
  'pixoo-playlist', 'nanoleaf-animations', 'nanoleaf-reactive-presets', 'nanoleaf-shows',
]);

/**
 * Member names that are never bookkeeping, at any depth, nor anything below them: identity, availability and safety,
 * holds, what was observed and desired, commands in flight and their outcomes, power-limit settings and status, and
 * the members the history replay on #1768 showed changing on their own as real state (`showing`, `freshness`, `failing`).
 */
export const NEVER_BOOKKEEPING: readonly string[] = Object.freeze([
  'id', 'revision', 'availability', 'generation', 'configurationRevision', 'held', 'status', 'power', 'brightness',
  'desired', 'pending', 'pendingKinds', 'lastOutcome', 'requestId', 'operationIds',
  'enabled', 'durationMs', 'settingsRevision', 'startedAtMs', 'deadlineMs', 'lastAttempt',
  'showing', 'freshness', 'failing',
]);

/** Every family this package defines, of any kind, in every version. */
export const contractFamilies: readonly PayloadFamily[] = Object.freeze([...coreFamilies, ...deviceFamilies, ...artStateFamilies]);
const contractNames = new Set(contractFamilies.map(({family}) => family));
/** Whether this package defines `family`, so that a module may not declare its bookkeeping. */
export const isContractFamily = (family: string): boolean => contractNames.has(family);

/** The family a `dataschema` names, such as `device` for `https://bunny.invalid/events/device/2.4`, or undefined. */
export function familyOfSchema(dataschema: string): string | undefined {
  if (!dataschema.startsWith(SCHEMA_BASE)) return undefined;
  const rest = dataschema.slice(SCHEMA_BASE.length), slash = rest.lastIndexOf('/');
  return slash > 0 ? rest.slice(0, slash) : undefined;
}

/** The schemas a family's schema may `$ref`, by `$id`: the shared blocks and kinds and every family of this package. */
export function contractSchemas(): Readonly<Record<string, object>> {
  const blocks = schemas.blocks as {$id: string}, kinds = schemas.kinds as {$id: string};
  return {[blocks.$id]: blocks, [kinds.$id]: kinds, ...Object.fromEntries(contractFamilies.map(({dataschema, schema}) => [dataschema, schema]))};
}

const POINTER = /^(\/[^/~]+)+$/;
const INDEX = /^(0|[1-9]\d*)$/;
const tokens = (pointer: string): string[] => pointer.slice(1).split('/');

type Node = {schema: unknown; root: unknown};
const MAX_REFS = 32;
const objectOf = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
/** Tokens that could lead from a record to `Object.prototype` or `Object`: no pointer names them, and they match nothing. */
const UNSAFE_TOKENS: readonly string[] = ['__proto__', 'constructor', 'prototype'];
/** The own member `token` of an object, never an inherited one or one through an unsafe token. */
const member = (value: unknown, token: string): unknown => {
  const object = objectOf(value);
  return object !== undefined && !UNSAFE_TOKENS.includes(token) && Object.hasOwn(object, token) ? object[token] : undefined;
};

function resolve(ref: string, root: unknown, refs: Readonly<Record<string, object>>): Node | undefined {
  const hash = ref.indexOf('#'), document = hash < 0 ? ref : ref.slice(0, hash), fragment = hash < 0 ? '' : ref.slice(hash + 1);
  const target = document === '' ? root : Object.hasOwn(refs, document) ? refs[document] : undefined;
  if (target === undefined) return undefined;
  let schema: unknown = target;
  for (const token of fragment === '' ? [] : tokens(fragment)) {
    schema = member(schema, token);
    if (schema === undefined) return undefined;
  }
  return {schema, root: target};
}

/** The schema and every subschema that also applies at the same place: its `$ref`, `allOf`, `oneOf` and `anyOf` branches. */
function branches(node: Node, refs: Readonly<Record<string, object>>, depth = 0): Node[] {
  const schema = objectOf(node.schema);
  if (schema === undefined) return [];
  if (depth > MAX_REFS) throw new Error('bookkeeping schema references nest too deeply');
  const found: Node[] = [node];
  if (typeof schema.$ref === 'string') {
    const target = resolve(schema.$ref, node.root, refs);
    if (target === undefined) throw new Error(`bookkeeping schema reference not found: ${schema.$ref}`);
    found.push(...branches(target, refs, depth + 1));
  }
  for (const keyword of ['allOf', 'oneOf', 'anyOf']) {
    const list = schema[keyword];
    if (Array.isArray(list)) for (const branch of list) found.push(...branches({schema: branch, root: node.root}, refs, depth + 1));
  }
  return found;
}

const SCALAR_TYPES: readonly unknown[] = ['integer', 'number', 'string', 'boolean', 'null'];
/** The keywords a single-value member's schema may use: scalar types and their bounds, notes, and composition. */
const SCALAR_KEYWORDS: readonly string[] = [
  'type', 'const', 'enum', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'pattern',
  'format', '$ref', 'allOf', 'oneOf', 'anyOf', '$schema', '$id', '$comment', 'title', 'description', 'default', 'examples', 'deprecated',
  'readOnly', 'writeOnly',
];
const scalar = (value: unknown): boolean => value === null || ['number', 'string', 'boolean'].includes(typeof value);
// A `null` alternative is how a schema says a time is not known yet.
const isNull = (schema: Record<string, unknown>): boolean => schema.type === 'null' || (Object.hasOwn(schema, 'const') && schema.const === null);
// A `const` or `enum` alternative names states rather than a value such as a time.
const isEnumeration = (schema: Record<string, unknown>): boolean => Object.hasOwn(schema, 'const') || Object.hasOwn(schema, 'enum');

// The schema an alternative names once its own `$ref` chain is followed.
function target(node: Node, refs: Readonly<Record<string, object>>): Record<string, unknown> {
  let current = node;
  for (let depth = 0; depth <= MAX_REFS; depth += 1) {
    const schema = objectOf(current.schema) ?? {};
    if (typeof schema.$ref !== 'string' || isNull(schema) || isEnumeration(schema)) return schema;
    const next = resolve(schema.$ref, current.root, refs);
    if (next === undefined) return schema;
    current = next;
  }
  throw new Error('bookkeeping schema references nest too deeply');
}

/**
 * Why a member's schema does not positively declare a single value, or undefined. Every alternative must say it holds a
 * scalar: a scalar `type`, or a `const` or `enum` of scalars, directly, through `$ref`, through one `allOf` part, or in
 * every `oneOf` and `anyOf` branch. A keyword outside `SCALAR_KEYWORDS` anywhere, such as `if`, `not` or
 * `patternProperties`, refuses it, and so does an unconstrained `{}` or `true`. A member whose alternatives mix a value
 * with a `const` or `enum` is refused too: one of its alternatives is a state, so a change of it can be a change of state.
 */
function notScalar(node: Node, refs: Readonly<Record<string, object>>, depth = 0): string | undefined {
  const schema = objectOf(node.schema);
  if (schema === undefined) return 'may hold any value';
  if (depth > MAX_REFS) throw new Error('bookkeeping schema references nest too deeply');
  const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type as unknown[] : [schema.type];
  if (!types.every(type => SCALAR_TYPES.includes(type))) return 'may hold other members';
  const other = Object.keys(schema).find(keyword => !SCALAR_KEYWORDS.includes(keyword));
  if (other !== undefined) return `uses ${other}, so it may hold more than one value`;
  if (Object.hasOwn(schema, 'const') && !scalar(schema.const)) return 'may hold other members';
  if (Object.hasOwn(schema, 'enum') && !(Array.isArray(schema.enum) && schema.enum.every(scalar))) return 'may hold other members';
  let positive = types.length > 0 || Object.hasOwn(schema, 'const') || Object.hasOwn(schema, 'enum');
  if (typeof schema.$ref === 'string') {
    const target = resolve(schema.$ref, node.root, refs);
    if (target === undefined) throw new Error(`bookkeeping schema reference not found: ${schema.$ref}`);
    const problem = notScalar(target, refs, depth + 1);
    if (problem !== undefined) return problem;
    positive = true;
  }
  if (Array.isArray(schema.allOf)) {
    for (const part of schema.allOf) {
      const problem = notScalar({schema: part, root: node.root}, refs, depth + 1);
      if (problem === undefined) positive = true;
      else if (problem !== 'does not say it holds a single value') return problem;
    }
  }
  for (const keyword of ['oneOf', 'anyOf']) {
    const list = schema[keyword];
    if (!Array.isArray(list)) continue;
    for (const branch of list) {
      const problem = notScalar({schema: branch, root: node.root}, refs, depth + 1);
      if (problem !== undefined) return problem;
    }
    const alternatives = list.map(branch => target({schema: branch, root: node.root}, refs)).filter(branch => !isNull(branch));
    if (alternatives.length > 1 && alternatives.some(isEnumeration)) return 'mixes a value with a state enumeration';
    if (list.length > 0) positive = true;
  }
  return positive ? undefined : 'does not say it holds a single value';
}

/** Why one version's schema does not declare `pointer` as a member that holds a single value, or undefined. */
function undeclared(pointer: string, schema: object, refs: Readonly<Record<string, object>>): string | undefined {
  let nodes: Node[] = [{schema, root: schema}];
  for (const token of tokens(pointer)) {
    const next: Node[] = [];
    for (const node of nodes.flatMap(node => branches(node, refs))) {
      const declared = member(member(node.schema, 'properties'), token);
      if (declared !== undefined) next.push({schema: declared, root: node.root});
    }
    if (next.length === 0) return `${pointer} is not a member the schema declares`;
    nodes = next;
  }
  for (const node of nodes) {
    const problem = notScalar(node, refs);
    if (problem !== undefined) return `${pointer} names a member that ${problem}`;
  }
  return undefined;
}

/**
 * Why `pointers` cannot be `family`'s bookkeeping members, or undefined when they can. Each must be a distinct JSON
 * pointer to an object member, never an array position; must name no member that is never bookkeeping, nor anything
 * below one; must not belong to a settings family; and must name a member that holds a single value in every version's
 * schema, through `$ref`, `allOf`, `oneOf` and `anyOf`. `refs` holds the schemas a `$ref` may name, by `$id`.
 */
export function bookkeepingProblem(family: string, pointers: readonly string[], versions: readonly object[],
  refs: Readonly<Record<string, object>> = contractSchemas()): string | undefined {
  if (!Array.isArray(pointers)) return 'bookkeeping is not a list of pointers';
  if (versions.length === 0) return `${family} has no schema`;
  if (pointers.length > 0 && SETTINGS_FAMILIES.includes(family)) return `${family} is a settings family, which has no bookkeeping members`;
  const seen = new Set<string>();
  for (const pointer of pointers) {
    if (typeof pointer !== 'string' || !POINTER.test(pointer)) return `${String(pointer)} is not a JSON pointer to an object member`;
    if (seen.has(pointer)) return `${pointer} is declared twice`;
    seen.add(pointer);
    const path = tokens(pointer);
    if (path.some(token => INDEX.test(token))) return `${pointer} names an array position`;
    const unsafe = path.find(token => UNSAFE_TOKENS.includes(token));
    if (unsafe !== undefined) return `${pointer} names ${unsafe}, which no pointer may name`;
    const denied = path.find(token => NEVER_BOOKKEEPING.includes(token));
    if (denied !== undefined) return `${pointer} names ${denied}, which is never bookkeeping`;
    for (const schema of versions) {
      let problem: string | undefined;
      try {
        problem = undeclared(pointer, schema, refs);
      } catch {
        problem = `${pointer} meets a schema reference that does not resolve or nests too deeply`;
      }
      if (problem !== undefined) return problem;
    }
  }
  return undefined;
}

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
};

/** What `withoutBookkeeping` puts in place of a bookkeeping member's value: any two values compare equal. */
export const BOOKKEEPING_VALUE = '(bookkeeping value)';

/**
 * A copy of `record` with the value of each bookkeeping member set aside: a member that is present and not null holds
 * `BOOKKEEPING_VALUE` instead of its value. An absent member stays absent and a null one stays null, so absent, null
 * and "some value" stay three different states, and only the value itself never counts. A pointer whose parent is absent
 * or not an object changes nothing. It follows and writes own members only, and a pointer through `__proto__`,
 * `constructor` or `prototype` changes nothing, so no pointer, declared or not, reaches a prototype (code scanning
 * alert 24).
 */
export function withoutBookkeeping(record: unknown, pointers: readonly string[]): unknown {
  const copy = structuredClone(record);
  for (const pointer of pointers) {
    const path = tokens(pointer), last = path.pop() as string;
    let parent: unknown = copy;
    for (const token of path) parent = member(parent, token);
    const object = objectOf(parent);
    if (object === undefined || UNSAFE_TOKENS.includes(last) || !Object.hasOwn(object, last) || object[last] === null) continue;
    Object.defineProperty(object, last, {value: BOOKKEEPING_VALUE, writable: true, enumerable: true, configurable: true});
  }
  return copy;
}

/**
 * Whether two records of one family hold the same state: equal once the values of their bookkeeping members, `id` and
 * `revision` are set aside as `withoutBookkeeping` does, whatever the order of their members. A bookkeeping member that
 * appears, disappears or becomes null is a change; one whose value moves is not. History's comparison (#1772) uses this
 * function unchanged.
 */
export function sameState(a: unknown, b: unknown, pointers: readonly string[]): boolean {
  const strip = (record: unknown): string => canonical(withoutBookkeeping(record, ['/id', '/revision', ...pointers]));
  return strip(a) === strip(b);
}

/**
 * One leaf of a record changed alone: where it is, as a JSON pointer, the changed copy, and how it changed: `value`, a
 * leaf that is not bookkeeping given another value; or, for a bookkeeping member, `null` in place of its value,
 * `present`, a value in place of its null, or `removed`.
 */
export type LeafMutation = {pointer: string; record: unknown; change: 'value' | 'null' | 'present' | 'removed'};

const changed = (value: unknown): unknown => {
  if (typeof value === 'number') return value + 1;
  if (typeof value === 'string') return `${value}x`;
  if (typeof value === 'boolean') return !value;
  if (value === null) return 0;
  return Array.isArray(value) ? [null] : {changed: null};
};
const escape = (token: string): string => token.replace(/~/g, '~0').replace(/\//g, '~1');

/**
 * Every change of one leaf of `record` that must count as a change of state, each on its own copy: every leaf that is
 * not bookkeeping, `/id` or `/revision` (a number, string, boolean or null, or an empty object or array) given another
 * value; and every bookkeeping member present in `record` made null (or, when null, given a value) and removed.
 * History's intake (#1772) must count each one as a change; `sameState` does, which the package's tests check for every
 * declared family's fixtures.
 */
export function leafMutations(record: unknown, pointers: readonly string[]): LeafMutation[] {
  // A pointer through an unsafe token changes nothing in `withoutBookkeeping`, so it skips nothing here either.
  const bookkeeping = pointers.filter(pointer => !tokens(pointer).some(token => UNSAFE_TOKENS.includes(token)));
  const skipped = ['/id', '/revision', ...bookkeeping];
  const mutations: LeafMutation[] = [];
  // A copy with the member at `path` set to `value`, or removed when `value` is undefined. The path holds the record's
  // own keys; each step and the write stay on own data members, so a member a JSON record names `__proto__` is changed
  // as data and never reaches a prototype.
  const edited = (path: readonly string[], value: unknown): unknown => {
    const copy = structuredClone(record);
    let parent: unknown = copy;
    for (const token of path.slice(0, -1)) parent = Object.getOwnPropertyDescriptor(parent, token)?.value;
    const last = path.at(-1) as string;
    if (value === undefined) Reflect.deleteProperty(parent as object, last);
    else Object.defineProperty(parent, last, {value, writable: true, enumerable: true, configurable: true});
    return copy;
  };
  const walk = (value: unknown, path: string[]): void => {
    const pointer = path.map(escape).map(token => `/${token}`).join('');
    if (bookkeeping.includes(pointer)) {
      mutations.push({pointer, record: edited(path, value === null ? 0 : null), change: value === null ? 'present' : 'null'});
      mutations.push({pointer, record: edited(path, undefined), change: 'removed'});
      return;
    }
    if (skipped.some(skip => pointer === skip || pointer.startsWith(`${skip}/`))) return;
    const children = Array.isArray(value) ? value.map((item, index) => [String(index), item] as const)
      : objectOf(value) !== undefined ? Object.entries(value as Record<string, unknown>) : [];
    if (children.length > 0) {
      for (const [key, item] of children) walk(item, [...path, key]);
      return;
    }
    mutations.push({pointer, record: path.length === 0 ? changed(structuredClone(record)) : edited(path, changed(value)), change: 'value'});
  };
  walk(record, []);
  return mutations;
}
