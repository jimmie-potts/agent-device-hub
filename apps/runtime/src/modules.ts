// The fixed, shipped module list (ADR 0012). Each entry is a module's factory: it creates the module with its real
// device transport, or, when the runtime runs with `--simulate`, with its simulated one, so a disposable verification
// run (#920) touches no device. Adding or removing a module is a code change here; nothing loads modules at run time.
import type {BunnyModule} from '@jimmie-potts/sdk';

/** How the runtime creates one module: the `create<Name>Module({transport})` convention with each transport chosen. */
export type ModuleFactory = {
  /** The module's name, as its manifest declares it. */
  readonly name: string;
  /** The module with its real device transport. */
  readonly create: () => BunnyModule;
  /** The module with its simulated transport, which reaches no device. */
  readonly simulate: () => BunnyModule;
  /** The module's own payload schemas by `dataschema`, which the SDK edge checks remote parts' messages against. */
  readonly schemas?: Readonly<Record<string, object>>;
};

export const shippedModules: readonly ModuleFactory[] = [];

/** Each factory's module, with its simulated transport when `simulate` is set and its real one otherwise. */
export function buildModules(factories: readonly ModuleFactory[], simulate: boolean): BunnyModule[] {
  return factories.map(factory => simulate ? factory.simulate() : factory.create());
}

/** Every factory's payload schemas, for the SDK edge's validator. */
export function moduleSchemas(factories: readonly ModuleFactory[]): Readonly<Record<string, object>> {
  return Object.assign({}, ...factories.map(factory => factory.schemas ?? {})) as Record<string, object>;
}
