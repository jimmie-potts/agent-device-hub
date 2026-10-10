// The playback module's registration (Hub #999): its factory, its place in the shipped list and how the scenario
// harnesses simulate its speakers. A disposable run's supervisor holds the simulated speakers, and the runtime's module
// reaches them one call at a time over its link; no address crosses it.
import type {DeviceAction, DeviceSimulation, ModuleRegistration} from '@jimmie-potts/sdk';
import {createSimulatedArtworkFetch, SIMULATED_ARTWORK_BASE64, SIMULATED_ARTWORK_MARKER, simulatedArtworkCandidate, simulatedArtworkReply} from './simulated-artwork.js';
import {createPlaybackModule, playbackFactory} from './module.js';
import {SimulatedSpeakers, type SimulatedKind} from './simulated.js';
import {artworkFailure} from './artwork-fetch.js';
import type {SonosReply, SonyReply} from './transport.js';

const KINDS: readonly string[] = ['sony', 'sonos'] satisfies SimulatedKind[];

/**
 * The phone plays `title` to one speaker over AirPlay, pauses, stops or switches it to another input; the speaker stops
 * answering, answers each call 400 ms late or answers again at once; or its next command is refused or never answered.
 */
function act(speakers: SimulatedSpeakers, simulation: DeviceAction): void {
  const speaker = simulation.speaker as SimulatedKind;
  const {title} = simulation;
  switch (simulation.action) {
    case 'artwork':
      speakers.artwork();
      return;
    case 'play':
      speakers.play(speaker, typeof title === 'string' ? {title} : undefined);
      return;
    case 'pause':
      speakers.pause(speaker);
      return;
    case 'stop':
      speakers.stop(speaker);
      return;
    case 'other-input':
      speakers.otherInput(speaker);
      return;
    case 'silent':
      speakers.silent(speaker);
      return;
    case 'slow':
      speakers.slow(speaker);
      return;
    case 'answer':
      speakers.answer(speaker);
      return;
    case 'refuse-next':
      speakers.nextCommand(speaker, 'refuse');
      return;
    case 'hang-next':
      speakers.nextCommand(speaker, 'hang');
      return;
  }
}

/** One speaker call as it crosses the link: a Sony JSON-RPC method (`sony`) or a Sonos SOAP action (`sonos`). */
type SonyCall = {method: string; version: string};
type SonosCall = {action: string; args: string};

export const playbackSimulation: DeviceSimulation<SimulatedSpeakers, SimulatedSpeakers> = {
  actions: ['artwork', 'play', 'pause', 'stop', 'other-input', 'silent', 'slow', 'answer', 'refuse-next', 'hang-next'],
  admits: (action, {speaker, title, ...rest}) => typeof speaker === 'string' && KINDS.includes(speaker) && Object.keys(rest).length === 0 &&
    (title === undefined || (typeof title === 'string' && title.length <= 200)) && (action !== 'artwork' || (speaker === 'sony' && title === undefined)),
  memory: {
    // A slow speaker waits on the harness's virtual time.
    create: ({scheduler}) => new SimulatedSpeakers({}, {scheduler}),
    state: speakers => speakers.state(),
    act,
    // Freshness follows the harness's clock, so a silent speaker ages in virtual time.
    build: (speakers, {now}) => createPlaybackModule({transport: speakers, monotonic: now, artwork: {fetch: createSimulatedArtworkFetch(() => speakers.artworkAcquired())}}),
  },
  run: {
    create: () => new SimulatedSpeakers(),
    state: speakers => speakers.state(),
    act: (speakers, simulation) => { act(speakers, simulation); },
    serve: (speakers, {method, args, signal}) => {
      if (method === 'artwork-fixture') {
        if (signal.aborted || args !== SIMULATED_ARTWORK_MARKER || !speakers.state().sony.syntheticArtwork) return null;
        speakers.artworkAcquired();
        return SIMULATED_ARTWORK_BASE64;
      }
      if (method === 'sony') {
        const {method: rpc, version} = args as SonyCall;
        return speakers.sony('', rpc, version, signal);
      }
      const {action, args: soap} = args as SonosCall;
      return speakers.sonos('', action, soap, signal);
    },
    // A speaker that does not answer never replies, so the module's deadline aborts the call, which tells the supervisor too.
    remote: link => {
      const call = async (method: 'sony' | 'sonos', body: SonyCall | SonosCall, signal: AbortSignal): Promise<unknown> => {
        const answer = await link.call(method, body, signal);
        if (answer.status !== 'answered') throw new Error('the speaker did not answer');
        return answer.value;
      };
      return createPlaybackModule({transport: {
        sony: async (endpoint, method, version, signal) => simulatedArtworkReply(await call('sony', {method, version}, signal) as SonyReply, endpoint),
        sonos: async (_endpoint, action, args, signal) => await call('sonos', {action, args}, signal) as SonosReply,
      }, artwork: {fetch: async (candidate, endpoint, signal) => {
        if (signal.aborted) return artworkFailure('unavailable');
        if (!simulatedArtworkCandidate(candidate, endpoint)) return artworkFailure('unsupported');
        const answer = await link.call('artwork-fixture', SIMULATED_ARTWORK_MARKER, signal);
        return answer.status === 'answered' && answer.value === SIMULATED_ARTWORK_BASE64
          ? {ok: true, value: new Uint8Array(Buffer.from(answer.value, 'base64'))}
          : artworkFailure('unavailable');
      }}});
    },
  },
};

export const registration: ModuleRegistration = {...playbackFactory, shipped: true, order: 100, simulation: playbackSimulation};
