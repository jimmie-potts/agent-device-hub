// The runtime of a verification run with fixture modules (Hub #920): `node child.js <modules|-> <fault|none> <pixoo state>
// -- <runtime arguments>`, forked by the supervisor. It runs the runtime's own entry (`runMain`) with each fixture module's factory,
// whose simulated transport reaches the supervisor's simulated device over the IPC channel; the arguments name the run's
// configuration file when its seed has one (Hub #919). With any module, a harness module reports every message the bus
// publishes. The supervisor's controls arm a crash between the lamp's commit and
// its publish, lose the core's next acknowledgment to the lamp, make the chime's next ring fail, or end a remote part's
// stream at the edge, which `runMain` hands over once it serves. The simulated Pixoo (Hub #843) lives here, beside the
// module that reaches it: the child reports what the Pixoo shows, and the supervisor sets how it answers and starts each
// runtime with the mode and the panel the last one had, as a real Pixoo keeps its picture across a runtime restart.
import http from 'node:http';
import {createLifxModule, lifxSchemas, type LifxNetwork} from '@jimmie-potts/lifx';
import {SimulatedPixoo, createPixooModule, pixooOwnSchemas, type SimulatedMode, type SimulatedPixooState} from '@jimmie-potts/pixoo';
import {createPlaybackModule, type SonosReply, type SonyReply, type SpeakerTransport} from '@jimmie-potts/playback';
import type {BunnyModule, RemoteEdge} from '@jimmie-potts/sdk';
import {createTidbytModule, type CloudFetch} from '@jimmie-potts/tidbyt';
import {followStandInAcks} from '@jimmie-potts/sdk/testing';
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
const speakerCalls = new Map<number, {resolve: (reply: SonyReply | SonosReply) => void; reject: (error: Error) => void}>();
const exchanges = new Map<number, {resolve: (payload: Buffer) => void; reject: (error: Error) => void}>();
const cloudCalls = new Map<number, {resolve: (response: Response) => void; reject: (error: Error) => void}>();
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
    case 'speaker.replied':
      speakerCalls.get(message.id)?.resolve(message.reply);
      speakerCalls.delete(message.id);
      return;
    case 'speaker.failed':
      speakerCalls.get(message.id)?.reject(new Error('the speaker did not answer'));
      speakerCalls.delete(message.id);
      return;
    case 'lifx.answered':
      exchanges.get(message.id)?.resolve(Buffer.from(message.payload, 'base64'));
      exchanges.delete(message.id);
      return;
    case 'lifx.failed':
      exchanges.get(message.id)?.reject(new Error('the bulb refused the packet'));
      exchanges.delete(message.id);
      return;
    case 'cloud.answered':
      cloudCalls.get(message.id)?.resolve(new Response(message.body, {status: message.status, headers: message.headers}));
      cloudCalls.delete(message.id);
      return;
    case 'cloud.failed':
      // A refused connection fails as undici reports one, so the module knows nothing was sent.
      cloudCalls.get(message.id)?.reject(message.refused ?
        new TypeError('fetch failed', {cause: Object.assign(new Error('connect ECONNREFUSED'), {code: 'ECONNREFUSED'})}) :
        new DOMException('the cloud did not answer', 'AbortError'));
      cloudCalls.delete(message.id);
      return;
    case 'control':
      flags[message.control] = true;
      send({type: 'applied', id: message.id});
      return;
    case 'simulate':
      pixoo.set(message.simulation.action);
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

/**
 * One call to the supervisor's simulated speakers (Hub #929). A speaker that does not answer never replies, so the
 * playback module's deadline aborts the call, which then tells the supervisor's speaker to stop waiting.
 */
function speakerCall(signal: AbortSignal, message: (id: number) => ChildMessage): Promise<SonyReply | SonosReply> {
  return new Promise((resolve, reject) => {
    next += 1;
    const id = next;
    const abandon = (): void => {
      if (!speakerCalls.delete(id)) return;
      send({type: 'speaker.abandon', id});
      reject(new Error('the speaker did not answer'));
    };
    speakerCalls.set(id, {
      resolve: reply => { signal.removeEventListener('abort', abandon); resolve(reply); },
      reject: error => { signal.removeEventListener('abort', abandon); reject(error); },
    });
    signal.addEventListener('abort', abandon, {once: true});
    if (signal.aborted) abandon();
    else send(message(id));
  });
}
/**
 * The LIFX bulbs, reached over the IPC channel: each packet goes to the supervisor's simulated bulb (Hub #928). A bulb
 * off the network never answers, so the module's own deadline aborts the wait, which tells the supervisor to stop too.
 */
const bulbs: LifxNetwork = {connect: address => ({
  exchange: (packet, payload, expected, signal) => new Promise<Buffer>((resolve, reject) => {
    next += 1;
    const id = next;
    const abandon = (): void => {
      if (!exchanges.delete(id)) return;
      send({type: 'lifx.abandon', id});
      reject(new Error('the bulb did not answer'));
    };
    exchanges.set(id, {
      resolve: answer => { signal.removeEventListener('abort', abandon); resolve(answer); },
      reject: error => { signal.removeEventListener('abort', abandon); reject(error); },
    });
    signal.addEventListener('abort', abandon, {once: true});
    if (signal.aborted) abandon();
    else send({type: 'lifx.exchange', id, address, packet, payload: Buffer.from(payload).toString('base64'), expected});
  }),
  close: () => {},
})};
/**
 * The Tidbyt cloud, reached over the IPC channel: each request goes to the supervisor's simulated cloud (Hub #930), which
 * answers as the cloud would. A cloud that does not answer never replies, so the module's own deadline aborts the call,
 * which then tells the supervisor's cloud to stop waiting.
 */
const cloud: CloudFetch = (url, init) => new Promise<Response>((resolve, reject) => {
  next += 1;
  const id = next;
  const abandon = (): void => {
    if (!cloudCalls.delete(id)) return;
    send({type: 'cloud.abandon', id});
    reject(new DOMException('the cloud did not answer', 'AbortError'));
  };
  cloudCalls.set(id, {
    resolve: response => { init.signal.removeEventListener('abort', abandon); resolve(response); },
    reject: error => { init.signal.removeEventListener('abort', abandon); reject(error); },
  });
  init.signal.addEventListener('abort', abandon, {once: true});
  if (init.signal.aborted) abandon();
  else send({type: 'cloud.call', id, method: init.method, url, authorization: init.headers.authorization ?? '', ...(init.body === undefined ? {} : {body: init.body})});
});

/** The speakers, reached over the IPC channel; the supervisor's simulated speakers answer. Their addresses stay here. */
const speakers: SpeakerTransport = {
  sony: async (_endpoint, method, version, signal) => await speakerCall(signal, id => ({type: 'speaker.sony', id, method, version})) as SonyReply,
  sonos: async (_endpoint, action, args, signal) => await speakerCall(signal, id => ({type: 'speaker.sonos', id, action, args})) as SonosReply,
};

/** The chime, reached over the IPC channel. A fault the supervisor set throws here, inside the chime's handler. */
const chime: ChimeTransport = {
  ring: (ring: ChimeRing) => {
    if (take('chime-fault')) throw new TypeError('the chime hit a fault');
    send({type: 'chime.ring', ring});
  },
};

const [list = '-', fault = 'none', panel = '', separator, ...runtimeArgs] = process.argv.slice(2);
const MODES: readonly string[] = ['online', 'offline', 'silent'] satisfies SimulatedMode[];
/** The Pixoo the last runtime left, as the supervisor hands it over: base64url JSON of its state, mode included. */
const left = ((): SimulatedPixooState | undefined => {
  try {
    const value = JSON.parse(Buffer.from(panel, 'base64url').toString('utf8')) as Partial<SimulatedPixooState> | null;
    return value !== null && typeof value === 'object' && MODES.includes(String(value.mode)) ? value as SimulatedPixooState : undefined;
  } catch {
    return undefined;
  }
})();
if (separator !== '--' || left === undefined) throw new Error('usage: child.js <modules|-> <fault|none> <pixoo state> -- <runtime arguments>');
/** The simulated Pixoo, in the mode the supervisor last set and showing what the last runtime's Pixoo showed. */
const {mode: pixooMode, ...pixooPanel} = left;
const pixoo = new SimulatedPixoo({mode: pixooMode, panel: pixooPanel});
pixoo.onChange(state => { send({type: 'pixoo.state', state}); });

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
  playback: fixture('playback', () => createPlaybackModule({transport: speakers})),
  // The shipped LIFX module with simulated bulbs; it follows the fixture core's stand-in acknowledgments until #782.
  lifx: fixture('lifx', () => createLifxModule({transport: bulbs, acknowledgments: followStandInAcks}), lifxSchemas),
  // The shipped Tidbyt module with the supervisor's simulated cloud (Hub #930).
  tidbyt: fixture('tidbyt', () => createTidbytModule({transport: cloud})),
  // The fixture core's stand-in history acknowledges each outcome, until Hub #782.
  pixoo: fixture('pixoo', () => createPixooModule({transport: pixoo, acknowledgments: followStandInAcks}), pixooOwnSchemas),
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

const names = [...(list === '-' ? [] : list.split(',')), ...(fault === 'installed-port' ? ['prober'] : [])];
const factories = names.map(name => {
  const factory = FACTORIES[name];
  if (factory === undefined) throw new Error(`no fixture module ${name}`);
  return factory;
});
// A run with no module hosts none, not even the harness module, so its health lists none. Its edge still knows the
// fixture families the scenario's parts use, as the in-memory harness's does.
await runMain(runtimeArgs, factories.length === 0 ? [] : [harness, ...factories], {schemas: {...lampSchemas, ...signSchemas, ...pixooOwnSchemas}, onEdge: served => { edge = served; }});
