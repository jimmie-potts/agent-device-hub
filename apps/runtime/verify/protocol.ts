// What a verification run's parts say to each other (Hub #920). The supervisor and its runtime child talk over the
// child's IPC channel: the child reaches the simulated devices, which the supervisor holds, and reports what its bus
// published; the supervisor sends the run's controls. One channel carries them all in order, so a flush that comes back
// means every earlier message has arrived. The network guard writes each refusal to the run's report file instead, so
// that worker threads and the child's own child processes report too. A run adapter reads and drives the run through
// the supervisor's loopback harness API, whose documents are below.
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
  /** The sign module shows a frame on a simulated sign, with the token it read from its secret file (Hub #919). */
  | {type: 'sign.show'; id: number; address: string; token: string; frame: string}
  /** The sign module's deadline for that show passed, so the simulated sign stops waiting. */
  | {type: 'sign.abandon'; id: number}
  | {type: 'published'; message: Message}
  | {type: 'applied'; id: number}
  | {type: 'flushed'; id: number};

export type SupervisorMessage =
  | {type: 'lamp.switched'; id: number; power: Power}
  | {type: 'lamp.failed'; id: number; detail: string}
  | {type: 'sign.shown'; id: number}
  | {type: 'sign.failed'; id: number}
  | {type: 'control'; id: number; control: Control}
  /** Ends a remote part's stream at the edge, as a lost connection would; the part reconnects on its own. */
  | {type: 'disconnect'; id: number; source: string}
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

/** One outbound connection or datagram the guard refused. */
export type Attempt = {protocol: 'tcp' | 'udp'; host: string; port: number};

/** `GET boundaries`: what the boundary checks judge, all of it observed rather than taken from the runtime's arguments. */
export type BoundaryReport = {
  /** `shipped`: the runtime's own entry point with the shipped modules; `fixtures`: the fixture modules. */
  runtime: 'shipped' | 'fixtures';
  /** What the current runtime's `runtime.started` record says of `--simulate`, or null before it said anything. */
  simulate: boolean | null;
  /** The run's data directory. */
  dataDir: string;
  /** The home the runtime process has, read from its environment once it was ready; empty when it could not be read. */
  home: string;
  /** Whether anything exists at `<home>/.local/state`, under which the runtime's default state directory lies. */
  defaultState: boolean;
  /** The SQLite files the runtime process has open, from its file descriptors: the modules' databases. */
  stateFiles: string[];
  /** The grants file's permission bits, or null when there is none. */
  grantsMode: number | null;
  /** Every outbound connection or datagram the guard refused, from the runtime and every process it started. */
  outbound: Attempt[];
};

/** `POST disconnect`: the remote part whose stream the edge ends. Only a part's source, `bunny/parts/<role>`, is taken. */
export type DisconnectRequest = {source: string};

/** `POST simulate`: what a device should do, as the catalog's `Simulation`. */
export type SimulateRequest =
  | {device: 'lamp'; action: 'hold' | 'release' | 'fail-next'}
  | {device: 'chime'; action: 'fault-next'}
  | {device: 'sign'; action: 'online' | 'offline'};
