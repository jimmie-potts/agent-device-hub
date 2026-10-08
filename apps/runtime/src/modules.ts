// The fixed, shipped module list (ADR 0012). Each module registers itself (Hub #999): the build imports every module
// folder's `registration` statically into `registry.js`, and this list holds the core first, then each registration
// that ships, in the order the registrations declare. Nothing loads modules at run time: adding or removing a module is
// a code change in its own folder, fixed when the runtime is built. Each entry is a factory: it creates the module with
// its real device transport, or, when the runtime runs with `--simulate`, with its simulated one, so a disposable
// verification run (#920) touches no device.
import type {BunnyModule, ModuleFactory, ModuleRegistration} from '@jimmie-potts/sdk';
import {CORE_MODULE, createCoreModule} from './core/core.js';
import {REGISTRATIONS} from './registry.js';

export type {ModuleFactory, ModuleRegistration} from '@jimmie-potts/sdk';

/**
 * The core (Hub #831) comes first: it registers before its first await, and the runtime starts the next module once it
 * awaits, so device modules that sync from it or republish to it at their start find it listening; and it closes first
 * at a clean stop, so an action still queued ends `cancelled`. It reaches no device, so its real and simulated builds are
 * the same. It is not a registration, so no declared order can move it.
 */
export const coreFactory: ModuleFactory = {name: CORE_MODULE, create: () => createCoreModule(), simulate: () => createCoreModule()};

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

/** The core's factory, then every shipped registration in start order. */
export function shippedList(registrations: readonly ModuleRegistration[]): ModuleFactory[] {
  return [coreFactory, ...orderModules(registrations)];
}

/** Every module folder's registration, shipped or not, in folder order, as the build collected them. */
export const registrations: readonly ModuleRegistration[] = REGISTRATIONS;

export const shippedModules: readonly ModuleFactory[] = shippedList(registrations);

/** Each factory's module, with its simulated transport when `simulate` is set and its real one otherwise. */
export function buildModules(factories: readonly ModuleFactory[], simulate: boolean): BunnyModule[] {
  return factories.map(factory => simulate ? factory.simulate() : factory.create());
}

/** Every factory's payload schemas, for the SDK edge's validator. */
export function moduleSchemas(factories: readonly ModuleFactory[]): Readonly<Record<string, object>> {
  return Object.assign({}, ...factories.map(factory => factory.schemas ?? {})) as Record<string, object>;
}
