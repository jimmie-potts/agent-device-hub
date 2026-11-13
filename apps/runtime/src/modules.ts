// The fixed, shipped module list (ADR 0012). Each module registers itself (Hub #999): the build imports every module
// folder's `registration` statically into `registry.js`, and this list holds the core first, then each registration
// that ships, in the order the registrations declare. Nothing loads modules at run time: adding or removing a module is
// a code change in its own folder, fixed when the runtime is built. Each entry is a factory: it creates the module with
// its real device transport, or, when the runtime runs with `--simulate`, with its simulated one, so a disposable
// verification run (#920) touches no device.
import {
  bookkeeping as contractBookkeeping, bookkeepingProblem, contractFamilies, contractSchemas, familyOfSchema, isContractFamily, type Bookkeeping,
} from '@jimmie-potts/event-contracts/v2/bookkeeping';
import type {BunnyModule, ModuleFactory, ModuleRegistration} from '@jimmie-potts/sdk';
import {CORE_MODULE, createCoreModule} from './core/core.js';
import type {HistoryRules} from './core/history.js';
import {sourceOf} from './host.js';
import {REGISTRATIONS} from './registry.js';

export type {ModuleFactory, ModuleRegistration} from '@jimmie-potts/sdk';

/**
 * The core's factory for `registrations` (Hub #831): the core comes first. It registers before its first await, and the
 * runtime starts the next module once it awaits, so device modules that sync from it or republish to it at their start
 * find it listening; and it closes first at a clean stop, so an action still queued ends `cancelled`. It reaches no
 * device, so its real and simulated builds are the same. It is not a registration, so no declared order can move it.
 * Its history keeps by every registration's bookkeeping members and polled families (#1772, #1795); a module that a
 * profile does not host publishes nothing, so its rules never apply. Throws as `historyRules` does.
 */
function coreFactoryFor(history: HistoryRules, standby = false): ModuleFactory {
  const create = (): BunnyModule => createCoreModule({history, standby});
  return {name: CORE_MODULE, create, simulate: create};
}

/** The longest polling interval a module may declare: one hour. */
export const MAX_POLLING_MS = 3_600_000;
const contractStates = new Set(contractFamilies.filter(({kind}) => kind === 'state').map(({family}) => family));

/** Throws a fixed sentence: the registrations break a rule of the shipped list, which a build of this checkout must fix. */
function refuse(sentence: string): never {
  throw new Error(`the shipped module list cannot be assembled: ${sentence}`);
}

/**
 * The shipped registrations in start order: each after the modules its `after` names, and otherwise by `order`, then
 * by name. Throws for a registration named after the core, a name registered twice, an order that is not a number, an
 * `after` that names no shipped module, and registrations that wait on each other.
 */
export function orderModules(registrations: readonly ModuleRegistration[]): ModuleRegistration[] {
  const seen = new Set<string>();
  for (const {name, order} of registrations) {
    if (name === CORE_MODULE) refuse('the core is not a registration; it always starts first');
    if (seen.has(name)) refuse(`${name} is registered twice`);
    if (!Number.isFinite(order)) refuse(`${name}'s order is not a number`);
    seen.add(name);
  }
  const shipped = registrations.filter(registration => registration.shipped);
  const names = new Set(shipped.map(({name}) => name));
  for (const {name, after = []} of shipped) {
    for (const before of after) if (!names.has(before)) refuse(`${name} starts after ${before}, which does not ship`);
  }
  const ordered: ModuleRegistration[] = [];
  const placed = new Set<string>();
  const byOrder = (a: ModuleRegistration, b: ModuleRegistration): number => {
    if (a.order !== b.order) return a.order - b.order;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  };
  const waiting = [...shipped].sort(byOrder);
  while (waiting.length > 0) {
    const index = waiting.findIndex(({after = []}) => after.every(before => placed.has(before)));
    if (index < 0) refuse(`${waiting.map(({name}) => name).sort().join(', ')} wait on each other`);
    const [next] = waiting.splice(index, 1) as [ModuleRegistration];
    ordered.push(next);
    placed.add(next.name);
  }
  return ordered;
}

/**
 * The core's factory, with the history rules of every registration, then every shipped registration in start order.
 * Throws as `orderModules` does, and when a registration's bookkeeping or polling declaration breaks a rule of
 * `moduleBookkeeping` or `modulePolling`, so the runtime does not start.
 */
export function shippedList(registrations: readonly ModuleRegistration[]): ModuleFactory[] {
  const ordered = orderModules(registrations);
  return [coreFactoryFor(historyRules(registrations)), ...ordered];
}

/** Every module folder's registration, shipped or not, in folder order, as the build collected them. */
export const registrations: readonly ModuleRegistration[] = REGISTRATIONS;

export const shippedModules: readonly ModuleFactory[] = shippedList(registrations);
/** Only the explicit container standby selection uses this core. */
export const standbyCoreFactory: ModuleFactory = coreFactoryFor(historyRules(registrations), true);

/**
 * The shipped list's own core factory, which every entry point that hosts a subset of the modules (the container's
 * profiles, Hub #1202 and #1595) puts first. It is the same factory as `shippedModules[0]`, so no entry point can build
 * a core without the registrations' history rules (#1795).
 */
export const coreFactory: ModuleFactory = shippedModules[0] as ModuleFactory;

/** Each factory's module, with its simulated transport when `simulate` is set and its real one otherwise. */
export function buildModules(factories: readonly ModuleFactory[], simulate: boolean): BunnyModule[] {
  return factories.map(factory => simulate ? factory.simulate() : factory.create());
}

/** Every factory's payload schemas, for the SDK edge's validator. */
export function moduleSchemas(factories: readonly ModuleFactory[]): Readonly<Record<string, object>> {
  return Object.assign({}, ...factories.map(factory => factory.schemas ?? {})) as Record<string, object>;
}

/**
 * Every factory's bookkeeping members, by family (Hub #1771), beside the contracts package's own. Throws for a module
 * that declares a family of the contracts package, a family its `schemas` do not register or one another module also
 * declares, and for pointers `bookkeepingProblem` refuses. History reads the result (#1772).
 */
export function moduleBookkeeping(factories: readonly ModuleFactory[]): Bookkeeping {
  const merged: Record<string, readonly string[]> = {};
  const refs = {...contractSchemas(), ...moduleSchemas(factories)};
  for (const {name, schemas = {}, bookkeeping = {}} of factories) {
    for (const [family, pointers] of Object.entries(bookkeeping)) {
      if (isContractFamily(family)) refuse(`${name} declares bookkeeping for ${family}, a family of the contracts package`);
      if (Object.hasOwn(merged, family)) refuse(`${family}'s bookkeeping is declared twice`);
      const versions = Object.entries(schemas).filter(([dataschema]) => familyOfSchema(dataschema) === family).map(([, schema]) => schema);
      if (versions.length === 0) refuse(`${name} declares bookkeeping for ${family}, which it does not register`);
      const problem = bookkeepingProblem(family, pointers, versions, refs);
      if (problem !== undefined) refuse(`${name}'s bookkeeping for ${family}: ${problem}`);
      merged[family] = Object.freeze([...pointers]);
    }
  }
  return Object.freeze(merged);
}


/**
 * The families each factory publishes on a poll, by the factory's source, with their polling intervals (Hub #1772).
 * Throws for a family that is neither a state family of the contracts package nor one the factory's `schemas`
 * register, and for an interval that is not a whole number of milliseconds from 1 to `MAX_POLLING_MS`.
 */
export function modulePolling(factories: readonly ModuleFactory[]): HistoryRules['polling'] {
  const polling: Record<string, Readonly<Record<string, number>>> = {};
  for (const {name, schemas = {}, polling: declared = {}} of factories) {
    const own = new Set(Object.keys(schemas).map(familyOfSchema).filter((family): family is string => family !== undefined));
    const families: Record<string, number> = {};
    for (const [family, interval] of Object.entries(declared)) {
      if (!contractStates.has(family) && !own.has(family)) refuse(`${name} declares a polling interval for ${family}, which is not a state family it can publish`);
      if (!Number.isSafeInteger(interval) || interval < 1 || interval > MAX_POLLING_MS) {
        refuse(`${name}'s polling interval for ${family} is not a whole number of milliseconds from 1 to ${MAX_POLLING_MS}`);
      }
      families[family] = interval;
    }
    if (Object.keys(families).length > 0) polling[sourceOf(name)] = Object.freeze(families);
  }
  return Object.freeze(polling);
}

/**
 * What the core's history needs to know of the shipped families (Hub #1772): the contracts package's bookkeeping
 * members with every factory's own, and every factory's polled families. Throws as `moduleBookkeeping` and
 * `modulePolling` do.
 */
export function historyRules(factories: readonly ModuleFactory[]): HistoryRules {
  return Object.freeze({bookkeeping: Object.freeze({...contractBookkeeping, ...moduleBookkeeping(factories)}), polling: modulePolling(factories)});
}
