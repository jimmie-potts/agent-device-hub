// What a verification run's parts say to each other (Hub #920). The supervisor and its runtime child talk over the
// child's IPC channel: the child reaches the simulated devices, which the supervisor holds, and reports what its bus
// published and every outbound connection the guard refused; the supervisor sends the run's controls. One channel carries
// them all in order, so a flush that comes back means every earlier message has arrived. A run adapter reads and drives
// the run through the supervisor's loopback harness API, whose documents are below.
import type {Message} from '@jimmie-potts/event-contracts/v2';
import type {LogRecord} from '../src/index.js';
import type {ChimeRing} from '../tests/fixtures/chime.js';
import type {Indicator, Power} from '../tests/fixtures/lamp.js';
import type {DeviceStates, Generational} from '../tests/scenarios/catalog.js';

/** A control the supervisor sends a child, which the child acknowledges once applied. */
export type Control = 'arm-crash' | 'lose-acknowledgment' | 'chime-fault';

export type ChildMessage =
  | {type: 'lamp.switch'; id: number; lamp: string; power: Power}
  | {type: 'lamp.show'; indicator: Indicator}
  | {type: 'chime.ring'; ring: ChimeRing}
  | {type: 'published'; message: Message}
  | {type: 'guard'; host: string; port: number}
  | {type: 'applied'; id: number}
  | {type: 'flushed'; id: number};

export type SupervisorMessage =
  | {type: 'lamp.switched'; id: number; power: Power}
  | {type: 'lamp.failed'; id: number; detail: string}
  | {type: 'control'; id: number; control: Control}
  | {type: 'flush'; id: number};

/** The harness API's routes, under the supervisor's own loopback listener (the run's `harness` endpoint). */
export const HARNESS_PATH = '/api/harness/v1';

/** `GET state?logs=<n>&published=<m>`: the run now, with the log records and messages after the first `n` and `m`. */
export type HarnessState = {
  /** How many runtimes the run has started: 1 at first, one more after each crash or restart. */
  generation: number;
  devices: DeviceStates;
  logs: Generational<{record: LogRecord}>[];
  published: Generational<{message: Message}>[];
};

/** `GET boundaries`: what the boundary checks judge. */
export type BoundaryReport = {
  /** `shipped`: the runtime's own entry point with the shipped modules; `fixtures`: the fixture modules. */
  runtime: 'shipped' | 'fixtures';
  /** What the current runtime's `runtime.started` record says of `--simulate`, or null before it said anything. */
  simulate: boolean | null;
  /** The state directory the runtime was given, or null when it was left to its default. */
  stateDir: string | null;
  /** The run's own state directory, `<data>/state`. */
  runStateDir: string;
  /** The run's data directory and the runtime's private home in it. */
  dataDir: string;
  home: string;
  /** The grants file's permission bits, or null when there is none. */
  grantsMode: number | null;
  /** Every outbound connection the guard refused. */
  outbound: {host: string; port: number}[];
};

/** `POST simulate`: what a device should do, as the catalog's `Simulation`. */
export type SimulateRequest = {device: 'lamp'; action: 'hold' | 'release' | 'fail-next'} | {device: 'chime'; action: 'fault-next'};
