// The runtime of a verification run with fixture modules (Hub #920): `node child.js <modules|-> <fault|none> -- <runtime
// arguments>`, forked by the supervisor. It runs the runtime's own entry (`runMain`) with each fixture module's factory,
// whose simulated transport reaches the supervisor's simulated device over the IPC channel; the arguments name the run's
// configuration file when its seed has one (Hub #919). With any module, a harness module reports every message the bus
// publishes. The supervisor's controls arm a crash between the lamp's commit and
// its publish, lose the core's next acknowledgment to the lamp, make the chime's next ring fail, or end a remote part's
// stream at the edge, which `runMain` hands over once it serves.
import http from 'node:http';
import type {BunnyModule, RemoteEdge} from '@jimmie-potts/sdk';
import {runMain, type ModuleFactory} from '../src/index.js';
import {createChimeModule, type ChimeRing, type ChimeTransport} from '../tests/fixtures/chime.js';
import {createCoreModule} from '../tests/fixtures/core.js';
import {createLampModule, lampSchemas, type Indicator, type LampTransport, type Power} from '../tests/fixtures/lamp.js';
import {createSignModule, signSchemas, type SignTransport} from '../tests/fixtures/sign.js';
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

// The supervisor is this checkout's own code, so its messages are taken as typed.
process.on('message', (value: unknown) => {
  const message = value as SupervisorMessage;
  switch (message.type) {
    case 'lamp.switched':
      switches.get(message.id)?.resolve(message.power);
      switches.delete(message.id);
      return;
    case 'lamp.failed':
      switches.get(message.id)?.reject(new Error(message.detail));
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
      setImmediate(() => { send({type: 'flushed', id: message.id}); });
      return;
  }
});

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

const fixture = (name: string, simulate: () => BunnyModule, schemas?: Readonly<Record<string, object>>): ModuleFactory => ({
  name, simulate, ...(schemas === undefined ? {} : {schemas}),
  create: () => { throw new Error(`the fixture ${name} has no real device; run it with --simulate`); },
});

/** Reports every message the bus publishes, so the run's adapter sees what the in-memory harness's watcher sees. */
const harness = fixture('harness', () => ({
  manifest: {name: 'harness', apiVersion: '1.0'},
  async start({sdk}) {
    await sdk.subscribe('bunny.*.*.*', message => { send({type: 'published', message}); });
  },
  stop: () => {},
}));

const FACTORIES: Readonly<Record<string, ModuleFactory>> = {
  core: fixture('core', () => createCoreModule()),
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
};

const [list = '-', fault = 'none', separator, ...runtimeArgs] = process.argv.slice(2);
if (separator !== '--') throw new Error('usage: child.js <modules|-> <fault|none> -- <runtime arguments>');
const names = [...(list === '-' ? [] : list.split(',')), ...(fault === 'installed-port' ? ['prober'] : [])];
const factories = names.map(name => {
  const factory = FACTORIES[name];
  if (factory === undefined) throw new Error(`no fixture module ${name}`);
  return factory;
});
// A run with no module hosts none, not even the harness module, so its health lists none. Its edge still knows the
// fixture families the scenario's parts use, as the in-memory harness's does.
await runMain(runtimeArgs, factories.length === 0 ? [] : [harness, ...factories], {schemas: {...lampSchemas, ...signSchemas}, onEdge: served => { edge = served; }});
