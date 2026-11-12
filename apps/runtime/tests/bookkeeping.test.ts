// The bookkeeping members of every state family the runtime carries (Hub #1771): the checked-in classification lists
// every state family and version of the core and of every registered module, each entry equals the declaration, the
// runtime refuses a module's declaration that breaks a rule at start, and every leaf that is not bookkeeping still
// counts as a change in each declared family's fixtures. Nothing reads the declaration yet (#1772).
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {MessageValidator, SCHEMA_BASE, type Message, type MessageKind} from '@jimmie-potts/event-contracts/v2';
import {bookkeeping, contractFamilies, familyOfSchema, leafMutations, sameState, type Bookkeeping} from '@jimmie-potts/event-contracts/v2/bookkeeping';
import {registerDeviceFamilies} from '@jimmie-potts/event-contracts/v2/devices';
import {registerCoreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import type {ModuleRegistration} from '@jimmie-potts/sdk';
import {CORE_MODULE, moduleBookkeeping, registrations, shippedList} from '../src/index.js';
import {OTHER_MODULE_FAMILIES, STATE_FAMILIES} from './fixtures/bookkeeping-classification.js';
import {it} from './support.js';

const short = (dataschema: string): string => dataschema.slice(SCHEMA_BASE.length);
type Family = {dataschema: string; kind?: MessageKind};

/** Every family the contracts package defines, with its kind, and every family each registration registers of its own. */
function familiesOf(list: readonly ModuleRegistration[]): Family[] {
  const contract = new Set(contractFamilies.map(({dataschema}) => dataschema));
  const own = new Set<string>();
  for (const {schemas = {}, registerFamilies} of list) {
    for (const dataschema of Object.keys(schemas)) own.add(dataschema);
    registerFamilies?.({register: (dataschema: string) => { own.add(dataschema); }} as unknown as MessageValidator);
  }
  return [...contractFamilies.map(({dataschema, kind}) => ({dataschema, kind})), ...[...own].filter(dataschema => !contract.has(dataschema)).map(dataschema => ({dataschema}))];
}

/**
 * What the classification lacks or holds in error: a state family or a module's own family it does not list; an entry
 * that names no family; a contracts-package family listed with the wrong kind; and an entry that differs from the
 * declaration.
 */
function classificationProblems(families: readonly Family[], states: Readonly<Record<string, readonly string[]>>, others: readonly string[],
  declared: Bookkeeping): string[] {
  const problems: string[] = [];
  const known = new Map(families.map(({dataschema, kind}) => [short(dataschema), kind]));
  for (const [name, kind] of known) {
    const listed = Object.hasOwn(states, name), other = others.includes(name);
    if (kind === 'state' && !listed) problems.push(`${name} is a state family the classification does not list`);
    if (kind !== undefined && kind !== 'state' && (listed || other)) problems.push(`${name} is a ${kind} family, not a module's own state`);
    if (kind === undefined && !listed && !other) problems.push(`${name} is a module's family the classification does not list`);
  }
  for (const name of [...Object.keys(states), ...others]) if (!known.has(name)) problems.push(`${name} names no registered family`);
  for (const [name, pointers] of Object.entries(states)) {
    const family = familyOfSchema(`${SCHEMA_BASE}${name}`) ?? name;
    if (JSON.stringify(declared[family] ?? []) !== JSON.stringify(pointers)) problems.push(`${name} is declared as ${JSON.stringify(declared[family] ?? [])}`);
  }
  for (const family of Object.keys(declared)) {
    if (!Object.keys(states).some(name => familyOfSchema(`${SCHEMA_BASE}${name}`) === family)) problems.push(`${family} is declared but not classified`);
  }
  return problems;
}

const declaredFor = (list: readonly ModuleRegistration[]): Bookkeeping => ({...bookkeeping, ...moduleBookkeeping(list)});

/** A registration with no module behind it, for the start refusals. */
const registered = (name: string, more: Partial<ModuleRegistration> = {}): ModuleRegistration => ({
  name, order: 10, shipped: true,
  create: () => { throw new Error('not built'); }, simulate: () => { throw new Error('not built'); },
  ...more,
});
const lampSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', additionalProperties: false,
  properties: {id: {type: 'string'}, revision: {type: 'integer'}, glow: {type: 'integer'},
    observed: {oneOf: [{$ref: `${SCHEMA_BASE}blocks/2.0#/$defs/unknown`}, {type: 'object', properties: {status: {const: 'known'}, readAtMs: {$ref: `${SCHEMA_BASE}blocks/2.0#/$defs/instantMs`}}}]}},
};
const lamp = (bookkeepingOf: Readonly<Record<string, readonly string[]>>, name = 'lamp'): ModuleRegistration =>
  registered(name, {schemas: {[`${SCHEMA_BASE}lamp-glow/2.0`]: lampSchema}, bookkeeping: bookkeepingOf});

it('the classification lists every state family of the core and of every registered module, each as declared', () => {
  assert.deepEqual(classificationProblems(familiesOf(registrations), STATE_FAMILIES, OTHER_MODULE_FAMILIES, declaredFor(registrations)), []);
  assert.deepEqual(moduleBookkeeping(registrations), {
    'lifx-light': ['/observed/observedAtMs'], 'pixoo-display': ['/monitor/page'], 'roborock-vacuum': ['/observedAtMs/value'],
  });
  assert.ok(registrations.some(({name}) => name === 'pixoo') && registrations.some(({name}) => name === 'roborock'));
});

it('a family or version that is not classified fails the check, and so does an entry that differs from its declaration', () => {
  const withLamp = [...registrations, lamp({})];
  assert.deepEqual(classificationProblems(familiesOf(withLamp), STATE_FAMILIES, OTHER_MODULE_FAMILIES, declaredFor(withLamp)),
    ['lamp-glow/2.0 is a module\'s family the classification does not list']);
  const families = [...familiesOf(registrations), {dataschema: `${SCHEMA_BASE}device/2.5`, kind: 'state' as const}];
  assert.deepEqual(classificationProblems(families, STATE_FAMILIES, OTHER_MODULE_FAMILIES, declaredFor(registrations)),
    ['device/2.5 is a state family the classification does not list']);
  const changed = {...STATE_FAMILIES, 'session/2.1': ['/lastEvidenceAtMs']};
  assert.deepEqual(classificationProblems(familiesOf(registrations), changed, OTHER_MODULE_FAMILIES, declaredFor(registrations)), ['session/2.1 is declared as []']);
  const stale = {...STATE_FAMILIES, 'mode-set/2.0': []};
  assert.deepEqual(classificationProblems(familiesOf(registrations), stale, [...OTHER_MODULE_FAMILIES, 'gone/2.0'], declaredFor(registrations)),
    ['mode-set/2.0 is a command family, not a module\'s own state', 'gone/2.0 names no registered family']);
});

it('the runtime refuses to start with a module that declares bookkeeping for a family of the contracts package', () => {
  const sneaky = registered('sneaky', {schemas: {}, bookkeeping: {device: ['/observed/observedAtMs']}});
  assert.throws(() => shippedList([sneaky]),
    {message: 'the shipped module list cannot be assembled: sneaky declares bookkeeping for device, a family of the contracts package'});
  assert.throws(() => shippedList([...registrations, registered('copy', {bookkeeping: {'power-limit': []}})]), /power-limit, a family of the contracts package/);
});

it('the runtime refuses a module that declares a family it does not register, twice, or with a pointer the rules refuse', () => {
  assert.throws(() => shippedList([registered('quiet', {bookkeeping: {'lamp-glow': ['/glow']}})]),
    {message: 'the shipped module list cannot be assembled: quiet declares bookkeeping for lamp-glow, which it does not register'});
  assert.throws(() => shippedList([lamp({'lamp-glow': []}), lamp({'lamp-glow': []}, 'lantern')]), /lamp-glow's bookkeeping is declared twice/);
  assert.throws(() => shippedList([lamp({'lamp-glow': ['/observed/status']})]), /lamp's bookkeeping for lamp-glow: \/observed\/status names status, which is never bookkeeping/);
  assert.throws(() => shippedList([lamp({'lamp-glow': ['/observed/seenAtMs']})]), /\/observed\/seenAtMs is not a member the schema declares/);
  assert.throws(() => shippedList([lamp({'lamp-glow': ['/observed']})]), /\/observed names a member that may hold the type "object", not only a number/);
  // The real Pixoo display's freshness state may not be declared, although it is a single value (review finding R5).
  const pixoo = registrations.find(({name}) => name === 'pixoo');
  assert.ok(pixoo !== undefined);
  const stateful = {...pixoo, bookkeeping: {'pixoo-display': ['/monitor/page', '/monitor/connection']}};
  assert.throws(() => shippedList([...registrations.filter(({name}) => name !== 'pixoo'), stateful]),
    {message: 'the shipped module list cannot be assembled: pixoo\'s bookkeeping for pixoo-display: /monitor/connection names a member that uses enum, not only a number'});
  const loose = registered('loose', {schemas: {[`${SCHEMA_BASE}lamp-glow/2.0`]: {type: 'object', properties: {at: {}}}}, bookkeeping: {'lamp-glow': ['/at']}});
  assert.throws(() => shippedList([loose]),
    {message: 'the shipped module list cannot be assembled: loose\'s bookkeeping for lamp-glow: /at names a member that does not say it holds a number'});
  const broken = registered('broken', {
    schemas: {[`${SCHEMA_BASE}lamp-glow/2.0`]: {type: 'object', properties: {gone: {$ref: `${SCHEMA_BASE}missing/2.0`}}}}, bookkeeping: {'lamp-glow': ['/gone/atMs']},
  });
  assert.throws(() => shippedList([broken]),
    {message: 'the shipped module list cannot be assembled: broken\'s bookkeeping for lamp-glow: /gone/atMs meets a schema reference that does not resolve or nests too deeply'});
  assert.deepEqual(shippedList([lamp({'lamp-glow': ['/observed/readAtMs']})]).map(({name}) => name), [CORE_MODULE, 'lamp']);
  assert.deepEqual(moduleBookkeeping([lamp({'lamp-glow': ['/observed/readAtMs']})]), {'lamp-glow': ['/observed/readAtMs']});
});

// Records of the families a module declares bookkeeping for, as their modules publish them.
const AT = 1_791_287_998_500;
const known = (value: number): {status: 'known'; value: number} => ({status: 'known', value});
const STATUS_KEYS = ['state', 'batteryPercent', 'cleanTimeSeconds', 'cleanAreaMm2', 'inCleaning', 'inReturning', 'errorCode', 'dockErrorStatus', 'chargeStatus',
  'dustCollectionStatus', 'waterBoxStatus', 'waterShortageStatus', 'washStatus', 'washPhase', 'dryStatus', 'avoidCount', 'dss'];
const CONSUMABLE_KEYS = ['mainBrushSeconds', 'sideBrushSeconds', 'filterSeconds', 'filterElementSeconds', 'sensorSeconds', 'strainerCycles', 'dustCollectionCycles',
  'cleaningBrushCycles'];
const monitor = {filter: {q: 'build'}, cadenceMs: 10_000, connection: 'current', sessions: 4, matched: 3, attention: 1, page: 1, pages: 2};
const player = {state: 'playing', intent: 'active', playlistId: null, itemId: null, renditionId: null, lastError: null};
const RECORDS: Readonly<Record<string, {type: string; data: Record<string, unknown>}>> = {
  'lifx-light/2.0': {type: 'org.bunny.lifx-light.updated', data: {
    id: 'bulb', revision: 4, capabilities: {color: {supported: true}, temperature: {supported: true, minimum: 1500, maximum: 9000}},
    observed: {status: 'known', observedAtMs: AT, hue: 120, saturation: 50, brightness: 80, kelvin: 3500},
  }},
  'roborock-vacuum/2.0': {type: 'org.bunny.roborock-vacuum.updated', data: {
    schema: 'roborock-vacuum/2.0', id: 'vacuum', revision: 7, observedAtMs: known(AT), availability: 'available', activity: 'cleaning',
    status: Object.fromEntries(STATUS_KEYS.map(key => [key, known(1)])),
    consumables: {observedAtMs: known(AT - 60_000), ...Object.fromEntries(CONSUMABLE_KEYS.map(key => [key, known(2)]))},
    totals: {observedAtMs: known(AT - 60_000), cleanTimeSeconds: known(3), cleanAreaMm2: known(4), cleanCount: known(5), dustCollectionCount: known(6)},
    collection: {retainedRuns: 1, observedSamples: 2, gaps: 0, history: 'partial', maps: 'unverified', clock: 'unqualified', lastFailure: {status: 'unknown'}},
  }},
  'pixoo-display/2.1': {type: 'org.bunny.pixoo-display.updated', data: {
    id: 'pixoo', revision: 9, mode: 'work', pendingMode: null, base: 'status', participating: true, showing: 'dashboard', monitor,
    nowPlaying: {media: 'popup', card: false, stale: false, takeover: null}, player, moments: {overStatus: true, playing: null},
  }},
  'pixoo-display/2.0': {type: 'org.bunny.pixoo-display.updated', data: {
    id: 'pixoo', revision: 9, mode: 'monitor', participating: true, pendingMode: null, showing: 'dashboard', monitor,
    nowPlaying: {media: 'popup', card: false, stale: false, takeover: null}, player, moments: {overMonitor: true, playing: null},
  }},
};

function validator(): MessageValidator {
  const validator = new MessageValidator();
  registerCoreFamilies(validator);
  registerDeviceFamilies(validator);
  for (const {registerFamilies, schemas = {}} of registrations) {
    if (registerFamilies !== undefined) registerFamilies(validator);
    else for (const [dataschema, schema] of Object.entries(schemas)) validator.register(dataschema, schema);
  }
  return validator;
}

it('every leaf that is not bookkeeping, changed alone, is a change in each module family that declares bookkeeping', () => {
  const declared = moduleBookkeeping(registrations), check = validator();
  const families = new Set(Object.keys(RECORDS).map(name => familyOfSchema(`${SCHEMA_BASE}${name}`)));
  assert.deepEqual([...families].sort(), Object.keys(declared).sort(), 'each declared module family has a fixture');
  for (const [name, {type, data}] of Object.entries(RECORDS)) {
    const message: Message = {
      specversion: '1.0', bunnyprofile: '2.0', id: randomUUID(), source: 'bunny/modules/fixture', type, subject: String(data.id), time: new Date(AT).toISOString(),
      kind: 'state', datacontenttype: 'application/json', dataschema: `${SCHEMA_BASE}${name}`, traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01', data,
    };
    const result = check.validate(message);
    assert.equal(result.ok, true, `${name}: ${JSON.stringify(result.ok ? undefined : result.error)}`);
    const pointers = STATE_FAMILIES[name] ?? [];
    assert.ok(pointers.length > 0, name);
    const mutations = leafMutations(data, pointers);
    assert.ok(mutations.length > 5, name);
    for (const {pointer, record} of mutations) assert.equal(sameState(data, record, pointers), false, `${name} ${pointer}`);
    // A record whose only changes are its bookkeeping members holds the same state.
    const moved = structuredClone(data) as Record<string, Record<string, unknown>>;
    for (const pointer of pointers) {
      const path = pointer.slice(1).split('/'), last = path.pop() as string;
      const parent = path.reduce<Record<string, unknown>>((node, token) => node[token] as Record<string, unknown>, moved);
      parent[last] = (parent[last] as number) + 1;
    }
    assert.equal(sameState(data, moved, pointers), true, name);
  }
});

it('what the history replay on #1768 showed as real state still counts in the declared families', () => {
  const display = RECORDS['pixoo-display/2.1']?.data as Record<string, unknown>;
  const pointers = STATE_FAMILIES['pixoo-display/2.1'] ?? [];
  assert.equal(sameState(display, {...display, showing: 'none'}, pointers), false);
  assert.equal(sameState(display, {...display, participating: false}, pointers), false);
  assert.equal(sameState(display, {...display, monitor: {...monitor, page: 0}}, pointers), true);
  assert.equal(sameState(display, {...display, monitor: {...monitor, pages: 3}}, pointers), false);
  const vacuum = RECORDS['roborock-vacuum/2.0']?.data as Record<string, unknown>;
  const reading = STATE_FAMILIES['roborock-vacuum/2.0'] ?? [];
  assert.equal(sameState(vacuum, {...vacuum, observedAtMs: {status: 'unknown'}}, reading), false, 'whether a reading exists still counts');
  assert.equal(sameState(vacuum, {...vacuum, availability: 'unavailable'}, reading), false);
});

it('a module\'s bookkeeping value does not count, but its presence and null-ness do (review finding R4)', () => {
  const display = RECORDS['pixoo-display/2.1']?.data as Record<string, unknown>;
  const page = STATE_FAMILIES['pixoo-display/2.1'] ?? [];
  const withPage = (value: unknown): Record<string, unknown> => {
    const copy = structuredClone(monitor) as Record<string, unknown>;
    if (value === undefined) delete copy.page;
    else copy.page = value;
    return {...display, monitor: copy};
  };
  assert.equal(sameState(display, withPage(1), page), true);
  assert.equal(sameState(display, withPage(null), page), false);
  assert.equal(sameState(display, withPage(undefined), page), false);
  const vacuum = RECORDS['roborock-vacuum/2.0']?.data as Record<string, unknown>;
  const reading = STATE_FAMILIES['roborock-vacuum/2.0'] ?? [];
  assert.equal(sameState(vacuum, {...vacuum, observedAtMs: known(AT + 60_000)}, reading), true);
  assert.equal(sameState(vacuum, {...vacuum, observedAtMs: {status: 'known', value: null}}, reading), false);
  assert.equal(sameState(vacuum, {...vacuum, observedAtMs: {status: 'known'}}, reading), false);
  const light = RECORDS['lifx-light/2.0']?.data as {observed: Record<string, unknown>};
  const color = STATE_FAMILIES['lifx-light/2.0'] ?? [];
  assert.equal(sameState(light, {...light, observed: {...light.observed, observedAtMs: AT + 5}}, color), true);
  assert.equal(sameState(light, {...light, observed: {...light.observed, observedAtMs: null}}, color), false);
  const {observedAtMs: _gone, ...unread} = light.observed;
  assert.equal(sameState(light, {...light, observed: unread}, color), false);
});
