// The runtime of a verification run with fixture modules (Hub #920): `node child.js <modules|-> <fault|none>
// <handovers> <real|start ms> -- <runtime arguments>`, forked by the supervisor. It runs the runtime's own entry (`runMain`) with each
// module's factory, whose simulated transport reaches the supervisor's simulated device over the IPC channel; the
// arguments name the run's configuration file when its seed has one (Hub #919). The fixture modules have transports of
// their own here; every registered module is built through its registration's link (link.ts), so this file names none
// (Hub #999). `handovers` is base64url JSON of what the last runtime left with the supervisor for each registered
// module, such as what a simulated device that lives beside its module showed. With any module, a harness module
// reports every message the bus publishes. The supervisor's controls arm a crash between the lamp's commit and its
// publish, lose the core's next acknowledgment to the lamp, make the chime's next ring fail, or end a remote part's
// stream at the edge, which `runMain` hands over once it serves. On virtual time (Hub #1710) the clock argument is the
// run's virtual time, at which the child's clock starts; the child then moves it only on the supervisor's `advance`.
import http from 'node:http';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import {watchRemotePublications} from '@jimmie-potts/sdk/testing';
import type {BunnyModule, RemoteEdge} from '@jimmie-potts/sdk';
import {createWisprModule} from '@jimmie-potts/wispr';
import {registrations, runMain, type CoreModule, type ModuleFactory} from '../src/index.js';
import {createChimeModule, type ChimeRing, type ChimeTransport} from '../tests/fixtures/chime.js';
import {SCHEDULE_FIXTURE, ScheduledFixture} from '../tests/fixtures/scheduled.js';
import {createPresentationFixture} from '../tests/fixtures/presentation.js';
import {createLampModule, lampSchemas, type Indicator, type LampTransport, type Power} from '../tests/fixtures/lamp.js';
import {createSignModule, signSchemas, type SignTransport} from '../tests/fixtures/sign.js';
import {SCENARIO_SCHEMAS, sourceOf} from '../tests/scenarios/parts.js';
import {childClockOf, fixtureCore as buildCore, type ChildClock} from './child-clock.js';
import {ChildLinks} from './link.js';
import type {ChildMessage, Control, SupervisorMessage} from './protocol.js';

const send = (message: ChildMessage): void => { if (process.connected) process.send?.(message); };
const flags: Record<Control, boolean> = {'arm-crash': false, 'lose-acknowledgment': false, 'chime-fault': false};
/** Takes a flag the supervisor set, so it acts once. */
const take = (control: Control): boolean => {
  const set = flags[control];
  flags[control] = false;
  return set;
};

const switches = new Map<number, {resolve: (power: Power) => void; reject: (error: Error) => void}>();
const shows = new Map<number, {resolve: () => void; reject: (error: Error) => void}>();
let next = 0;
let edge: RemoteEdge | undefined;
let readerStream: (() => number | undefined) | undefined;
const readerPublications = new WeakMap<Message, number>();

// The supervisor is this checkout's own code, so its messages are taken as typed.
process.on('message', (value: unknown) => {
  const message = value as SupervisorMessage;
  switch (message.type) {
    case 'lamp.switched':
      switches.get(message.id)?.resolve(message.power);
      switches.delete(message.id);
      return;
    case 'lamp.failed':
      // The supervisor names no reason: the lamp module reports a failed switch with its own fixed text.
      switches.get(message.id)?.reject(new Error('the lamp did not answer'));
      switches.delete(message.id);
      return;
    case 'sign.shown':
      shows.get(message.id)?.resolve();
      shows.delete(message.id);
      return;
    case 'sign.failed':
      shows.get(message.id)?.reject(new Error('the sign refused the frame'));
      shows.delete(message.id);
      return;
    case 'control':
      flags[message.control] = true;
      send({type: 'applied', id: message.id});
      return;
    case 'disconnect':
      // The supervisor admits only parts' sources, so the edge never drops a module's or the core's.
      edge?.disconnect(message.source);
      send({type: 'applied', id: message.id});
      return;
    case 'flush':
      // Every delivery already queued runs before the next turn of the event loop.
      setImmediate(() => {
        const stream = readerStream?.();
        send({type: 'flushed', id: message.id, ...(stream === undefined ? {} : {readerStream: stream})});
      });
      return;
    case 'device.answered':
    case 'device.failed':
    case 'device.push':
      links.hear(message);
      return;
    case 'advance':
      advance(message.id, message.toMs);
      return;
  }
});

/** Advances one after another, in the order the supervisor sent them. */
let advancing: Promise<void> = Promise.resolve();
function advance(id: number, toMs: number): void {
  advancing = advancing.then(async () => {
    if (clock === undefined) return;
    // The child waits on the supervisor while a device call or a fixture device's answer is outstanding.
    const answer = await clock.advance(toMs, () => links.waiting > 0 || switches.size > 0 || shows.size > 0);
    send({type: 'advanced', id, ...answer, lines});
  });
}

/** The lamps, reached over the IPC channel; the supervisor's simulated lamps answer. */
const lamps: LampTransport = {
  switch: (lamp, power) => new Promise<Power>((resolve, reject) => {
    next += 1;
    switches.set(next, {resolve, reject});
    send({type: 'lamp.switch', id: next, lamp, power});
  }),
  show: (indicator: Indicator) => { send({type: 'lamp.show', indicator}); },
};
/**
 * The signs, reached over the IPC channel. An offline sign never answers, so the sign module's deadline aborts the show,
 * which then tells the supervisor's sign to stop waiting.
 */
const signs: SignTransport = {
  show: (address, token, frame, signal) => new Promise<void>((resolve, reject) => {
    next += 1;
    const id = next;
    const abandon = (): void => {
      if (!shows.delete(id)) return;
      send({type: 'sign.abandon', id});
      reject(new Error('the sign did not answer'));
    };
    shows.set(id, {
      resolve: () => { signal.removeEventListener('abort', abandon); resolve(); },
      reject: error => { signal.removeEventListener('abort', abandon); reject(error); },
    });
    signal.addEventListener('abort', abandon, {once: true});
    if (signal.aborted) abandon();
    else send({type: 'sign.show', id, address, token, frame});
  }),
};

/** The chime, reached over the IPC channel. A fault the supervisor set throws here, inside the chime's handler. */
const chime: ChimeTransport = {
  ring: (ring: ChimeRing) => {
    if (take('chime-fault')) throw new TypeError('the chime hit a fault');
    send({type: 'chime.ring', ring});
  },
};

const [list = '-', fault = 'none', handover = '', clockArgument = '', separator, ...runtimeArgs] = process.argv.slice(2);
/** What the last runtime left with the supervisor for each registered module, by name. */
const handovers = ((): Readonly<Record<string, unknown>> | undefined => {
  try {
    const value = JSON.parse(Buffer.from(handover, 'base64url').toString('utf8')) as unknown;
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
})();
if (separator !== '--' || handovers === undefined) throw new Error('usage: child.js <modules|-> <fault|none> <handovers> <real|start ms> -- <runtime arguments>');
const links = new ChildLinks(send, handovers);
/** The run's virtual clock, or undefined on the real clock. */
const clock: ChildClock | undefined = childClockOf(clockArgument);
/**
 * How many lines the child has written to stderr, which carries the runtime's records to the supervisor on a pipe of its
 * own: an advance's answer names it, so the supervisor reads them before it answers in turn.
 */
let lines = 0;
if (clock !== undefined) {
  const write = process.stderr.write.bind(process.stderr) as (...args: unknown[]) => boolean;
  process.stderr.write = (chunk: unknown, ...rest: unknown[]): boolean => {
    lines += typeof chunk === 'string' ? chunk.split('\n').length - 1 : chunk instanceof Uint8Array ? chunk.filter(byte => byte === 0x0a).length : 0;
    return write(chunk, ...rest);
  };
}

/** On virtual time, a module's worker calls hold the clock while they run, as in the in-memory harness. */
const held = (module: BunnyModule): BunnyModule => clock === undefined ? module : clock.wrap(module);
const fixture = (name: string, simulate: () => BunnyModule, schemas?: Readonly<Record<string, object>>): ModuleFactory => ({
  name, simulate: () => held(simulate()), ...(schemas === undefined ? {} : {schemas}),
  create: () => { throw new Error(`the fixture ${name} has no real device; run it with --simulate`); },
});

/** Reports every message the bus publishes, so the run's adapter sees what the in-memory harness's watcher sees. */
const harness = fixture('harness', () => ({
  manifest: {name: 'harness', apiVersion: '1.0'},
  async start({sdk}) {
    await sdk.subscribe('bunny.*.*.*', message => {
      const stream = readerPublications.get(message);
      send({type: 'published', message, ...(stream === undefined ? {} : {readerStream: stream})});
    });
  },
  stop: () => {},
}));

let fixtureCore: CoreModule | undefined;
const scheduled = new ScheduledFixture();
const FACTORIES: Readonly<Record<string, ModuleFactory>> = {
  wispr: {name: 'wispr', create: () => createWisprModule(), simulate: () => held(createWisprModule())},
  // On virtual time the core's monotonic clock is the test clock's (Hub #1709, #1710), the one `runMain` gets below.
  core: fixture('core', () => fixtureCore = buildCore(clock, scheduled.coreOptions(names))),
  [SCHEDULE_FIXTURE]: fixture(SCHEDULE_FIXTURE, () => scheduled.module()),
  'presentation-fixture': fixture('presentation-fixture', () => createPresentationFixture(() => fixtureCore)),
  lamp: fixture('lamp', () => createLampModule({
    transport: lamps,
    // A real crash: the process dies between the lamp's commit and its first publish, as #882's kill test does.
    beforePublish: () => { if (take('arm-crash')) process.kill(process.pid, 'SIGKILL'); },
    onAcknowledgment: () => take('lose-acknowledgment') ? 'lose' : 'apply',
  }), lampSchemas),
  chime: fixture('chime', () => createChimeModule({transport: chime})),
  sign: fixture('sign', () => createSignModule({transport: signs}), signSchemas),
  // The installed-port negative control: a module that reaches for the installed Hub with fetch and with node:http. The
  // guard refuses both before they connect.
  prober: fixture('prober', () => ({
    manifest: {name: 'prober', apiVersion: '1.0'},
    async start() {
      const url = 'http://127.0.0.1:8788/api/hub/v1/health';
      await fetch(url, {signal: AbortSignal.timeout(2000)}).catch(() => undefined);
      await new Promise<void>(settled => {
        const request = http.get(url, {timeout: 2000}, response => { response.resume(); settled(); });
        request.on('error', () => { settled(); }).on('timeout', () => { request.destroy(); });
      });
    },
    stop: () => {},
  })),
  // Every registered module, with the link to its simulated device in the supervisor (Hub #999), and on virtual time
  // with the run's clocks (Hub #1711).
  ...Object.fromEntries(registrations.map(({name, schemas, simulation, simulate}) =>
    [name, fixture(name, () => scheduled.remote(name, names, () => links.link(name))
      ?? (simulation === undefined ? simulate() : simulation.run.remote(links.link(name), clock?.remoteOptions)), schemas)] as const)),
};

const names = [...(list === '-' ? [] : list.split(',')), ...(fault === 'installed-port' ? ['prober'] : [])];
const factories = names.map(name => {
  const factory = FACTORIES[name];
  if (factory === undefined) throw new Error(`no fixture or simulated module ${name}`);
  return factory;
});
// A run with no module hosts none, not even the harness module, so its health lists none. Its edge and gateway still
// know every family the scenario's parts use, from the one list the in-memory harness takes too: the fixture core's
// the inbox among them; retained history reads use `/api/v2/history`.
// On virtual time the run passes its test clock, which `runProcess` takes only in this simulated test run under the
// supervisor (Hub #1709); its monotonic clock is the one the fixture core's options above carry. On the real clock it
// passes none.
await runMain(runtimeArgs, factories.length === 0 ? [] : [harness, ...factories], {
  schemas: SCENARIO_SCHEMAS,
  onEdge: served => {
    edge = served;
    if (clock !== undefined) readerStream = watchRemotePublications(served, sourceOf('reader'), (message, stream) => {
      readerPublications.set(message, stream);
    });
  },
  ...(clock === undefined ? {} : {testClock: clock.testClock}),
});
