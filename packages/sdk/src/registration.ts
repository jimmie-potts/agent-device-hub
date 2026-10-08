// How a module registers itself with the runtime and its scenario harnesses (Hub #999). The runtime ships a fixed list
// of modules (ADR 0012): its build imports each module's `registration` statically, so nothing loads at run time, and
// it orders them by what each declares, after the core. The harnesses build each module on its simulated devices
// through the same registration, so neither the runtime nor a harness names a module. A module imports only the SDK and
// the contracts packages, so these types live here.
import type {MessageValidator} from '@jimmie-potts/event-contracts/v2';
import type {BunnyModule} from './module.js';
import type {Scheduler} from './sdk.js';

/** How the runtime creates one module: with its real device transport, or with its simulated one under `--simulate`. */
export type ModuleFactory = {
  /** The module's name, as its manifest declares it. */
  readonly name: string;
  /** The module with its real device transport. */
  readonly create: () => BunnyModule;
  /** The module with its simulated transport, which reaches no device. */
  readonly simulate: () => BunnyModule;
  /** The module's own payload schemas by `dataschema`, which the SDK edge checks remote parts' messages against. */
  readonly schemas?: Readonly<Record<string, object>>;
  /** The module's configuration section for simulated runs (--simulate, the shipped run, tests), without its `secrets` member. */
  readonly simulatedSection?: {
    readonly config: Readonly<Record<string, unknown>>;
    /** The secret names the section needs; each consumer writes one synthetic file per name and maps it in `secrets`. */
    readonly secrets?: readonly string[];
  };
};

/** A module's registration: its factory, whether and where it ships, and how the harnesses simulate its devices. */
export type ModuleRegistration = ModuleFactory & {
  /** Whether the runtime ships the module. A module that does not is still built, tested and simulated. */
  readonly shipped: boolean;
  /** Its place among the shipped modules after the core: a lower number starts first, and modules with one number start by name. */
  readonly order: number;
  /** The modules that must start before it, such as one whose records it follows from its start. */
  readonly after?: readonly string[];
  /**
   * Registers the module's families on a validator with any checks beyond their schemas. Without it, a validator takes
   * `schemas` as they are.
   */
  readonly registerFamilies?: (validator: MessageValidator) => void;
  /** How the scenario harnesses simulate the module's devices, if it has any. */
  readonly simulation?: DeviceSimulation;
};

/** What a scenario asks a simulated device to do: the device's module, the action, and any fields the action takes. */
export type DeviceAction = {readonly device: string; readonly action: string; readonly [field: string]: unknown};

/** The harness's clock and scheduler: virtual in the in-memory harness, real in a disposable run. */
export type SimulationOptions = {readonly now: () => number; readonly scheduler: Scheduler};

/**
 * How a call over a disposable run's link ended: the device's answer, a failure the device reported, or `abandoned`
 * when the caller's signal aborted first or the runtime that made it ended.
 */
export type LinkAnswer = {readonly status: 'answered'; readonly value: unknown} | {readonly status: 'failed'} | {readonly status: 'abandoned'};

/**
 * The runtime process's end of a disposable run's link to a simulated device, which the run's supervisor holds so that
 * it outlives a runtime restart, as a real device would. Arguments and answers cross a process boundary as JSON.
 */
export type DeviceLink = {
  /** Calls the device. Aborting `signal` abandons the call: the supervisor aborts its own call, and the answer is `abandoned`. */
  call(method: string, args?: unknown, signal?: AbortSignal): Promise<LinkAnswer>;
  /** What the last runtime process left with the supervisor, from the simulation's `handover`, or undefined. */
  readonly handover: unknown;
  /** Hears each simulation the supervisor hands this process (`push`). */
  onPush(handler: (simulation: DeviceAction) => void): void;
};

/** One call that a runtime process made over its link, as the supervisor serves it. */
export type LinkCall = {
  readonly method: string;
  readonly args: unknown;
  /** Aborts when the caller abandons the call or its runtime ends. */
  readonly signal: AbortSignal;
  /** Whether the call comes from the current runtime, not one that a restart or crash replaced. */
  readonly current: boolean;
};

/**
 * How the scenario harnesses (Hub #846, #920) simulate a module's devices. A scenario names the module as `device`, one
 * of `actions`, and any other fields `admits` takes; each harness checks a request against both before it acts.
 */
export interface DeviceSimulation<Device = unknown, Held = unknown> {
  /** Every action the device takes. */
  readonly actions: readonly string[];
  /** Whether an action's fields beyond `device` and `action` are what it takes. Without it, an action takes no other field. */
  admits?(action: string, fields: Readonly<Record<string, unknown>>): boolean;
  /** The in-memory harness: the device and the module live in the harness's process. */
  readonly memory: {
    /** A new simulated device, which outlives the runtime's restarts and crashes. */
    create(options: SimulationOptions): Device;
    /** What the device shows now, as plain data. */
    state(device: Device): unknown;
    act(device: Device, simulation: DeviceAction): void;
    /** The module on the device. */
    build(device: Device, options: SimulationOptions): BunnyModule;
  };
  /** A disposable run: the supervisor holds what outlives the runtime, and the runtime's process reaches it over a link. */
  readonly run: {
    create(options: SimulationOptions): Held;
    state(held: Held): unknown;
    /** Acts on an admitted simulation; `push` hands it to the current runtime process's `onPush` handlers. */
    act(held: Held, simulation: DeviceAction, push: (simulation: DeviceAction) => Promise<void>): void | Promise<void>;
    /** Answers one call from the runtime process. A throw or a rejection answers `failed`. */
    serve(held: Held, call: LinkCall): unknown;
    /** What the next runtime process starts with, as its link's `handover`. */
    handover?(held: Held): unknown;
    /** The module in the runtime's process, reaching the supervisor's device over `link`. */
    remote(link: DeviceLink): BunnyModule;
  };
}
