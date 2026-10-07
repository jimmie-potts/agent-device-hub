// Simulated speakers (Hub #929, #846): the transport tests and disposable runs give the playback module, so no speaker
// is touched. They answer each protocol as the qualified speakers do (docs/iphone-apple-music-qualification.md): the
// Sony HT-A9's Audio Control API JSON-RPC and the Sonos Move's AVTransport SOAP, with the replies the old Hub's tests
// recorded, so the module's own parsing runs on them. Like real speakers, they keep their state when the runtime
// restarts. A test can play, pause or stop either one, switch it to another input, make it stop answering or answer
// each call slowly, or make its next command fail or never answer. They ignore the endpoint they are called at.
import type {Scheduler} from '@jimmie-potts/sdk';
import type {PlaybackSection} from './configuration.js';
import type {PlaybackAction} from './playback.js';
import {SONOS_SERVICE, type SonosReply, type SonyReply, type SpeakerTransport} from './transport.js';

export type SimulatedKind = 'sony' | 'sonos';

/**
 * A section that configures the module for the simulated speakers: the Move first, then the HT-A9, at loopback
 * addresses they never use. Tests, the scenario catalog and disposable runs of the shipped list use it.
 */
export const SIMULATED_SECTION: PlaybackSection = {
  id: 'living-room',
  sources: [{kind: 'sonos', endpoint: 'http://127.0.0.1:1400/MediaRenderer/AVTransport/Control'}, {kind: 'sony', endpoint: 'http://127.0.0.1:10000/sony'}],
};
/** How long a slow speaker takes to answer each call: within a call's 1.5-second deadline, but a Sonos read takes three. */
export const SLOW_MS = 400;
/** What one simulated speaker shows, as plain data. */
export type SpeakerState = {
  /** Whether it answers. One that does not never replies, until the call's signal aborts. */
  answering: boolean;
  /** How long it takes to answer each call, reads and commands alike: 0 at once, or more for a slow speaker. */
  delayMs: number;
  /** `airplay` while the phone plays to it over AirPlay; `other` for another input. */
  input: 'airplay' | 'other';
  status: 'playing' | 'paused' | 'stopped';
  title?: string;
  artist?: string;
  album?: string;
  /** How its next command ends: answered, refused before any effect, or never answered. */
  nextCommand: 'answer' | 'refuse' | 'hang';
  /** Every action it received, in order, refused or not. */
  commands: PlaybackAction[];
  /** How many calls it received, reads included, and the most it ever had in progress at once. */
  calls: number;
  peak: number;
};
export type SpeakersState = Readonly<Record<SimulatedKind, SpeakerState>>;
export type Track = {title: string; artist?: string; album?: string};

const SONY_ACTIONS: Readonly<Record<string, PlaybackAction>> = {
  pausePlayingContent: 'pause', setPlayNextContent: 'next', setPlayPreviousContent: 'previous',
};
const SONOS_ACTIONS: Readonly<Record<string, PlaybackAction>> = {Play: 'play', Pause: 'pause', Next: 'next', Previous: 'previous'};
const SONY_STATES = {playing: 'PLAYING', paused: 'PAUSED', stopped: 'STOPPED'} as const;
const SONOS_STATES = {playing: 'PLAYING', paused: 'PAUSED_PLAYBACK', stopped: 'STOPPED'} as const;
const SONOS_AIRPLAY_URI = 'x-sonos-vli:RINCON_000E58FFFFFF01400:2,airplay:1';
const SONOS_OTHER_URI = 'x-rincon-queue:RINCON_000E58FFFFFF01400#0';

const escapeXml = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const envelope = (inner: string): string =>
  `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>${inner}</s:Body></s:Envelope>`;
const soapFault = (code: number): string =>
  envelope(`<s:Fault><faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring><detail><UPnPError xmlns="urn:schemas-upnp-org:control-1-0"><errorCode>${code}</errorCode></UPnPError></detail></s:Fault>`);
const response = (action: string, inner = ''): string => envelope(`<u:${action}Response xmlns:u="${SONOS_SERVICE}">${inner}</u:${action}Response>`);

/** A call that never answers: it rejects once `signal` aborts, as a lost or unanswered request would. */
const silence = (signal: AbortSignal): Promise<never> => new Promise((_, reject) => {
  const lost = (): void => { reject(new Error('the speaker did not answer')); };
  if (signal.aborted) lost();
  else signal.addEventListener('abort', lost, {once: true});
});

const initial = (given: Partial<SpeakerState> = {}): SpeakerState => ({
  answering: true, delayMs: 0, input: 'other', status: 'stopped', nextCommand: 'answer', calls: 0, peak: 0, ...given, commands: [...(given.commands ?? [])],
});
/** Real time, for the runtime's `--simulate` and disposable runs. */
const REAL_TIME: Scheduler = {after: (delayMs, callback) => {
  const timer = setTimeout(callback, delayMs);
  return () => { clearTimeout(timer); };
}};

export type SimulatedSpeakersOptions = {
  /** The scheduler a slow speaker waits on: real time by default, or a test's manual clock. */
  scheduler?: Scheduler;
};

/** A Sony HT-A9 and a Sonos Move, simulated at their protocols. Each starts answering, on another input, unless told otherwise. */
export class SimulatedSpeakers implements SpeakerTransport {
  readonly #speakers: Record<SimulatedKind, SpeakerState>;
  readonly #active: Record<SimulatedKind, number> = {sony: 0, sonos: 0};
  readonly #scheduler: Scheduler;

  constructor(given: Partial<Record<SimulatedKind, Partial<SpeakerState>>> = {}, {scheduler = REAL_TIME}: SimulatedSpeakersOptions = {}) {
    this.#speakers = {sony: initial(given.sony), sonos: initial(given.sonos)};
    this.#scheduler = scheduler;
  }

  sony(_endpoint: string, method: string, _version: string, signal: AbortSignal): Promise<SonyReply> {
    return this.#call('sony', signal, () => this.#sonyReply(method));
  }

  sonos(_endpoint: string, action: string, _args: string, signal: AbortSignal): Promise<SonosReply> {
    return this.#call('sonos', signal, () => this.#sonosReply(action));
  }

  /** The phone plays `track` to the speaker over AirPlay. */
  play(kind: SimulatedKind, track?: Track): void {
    const speaker = this.#speakers[kind];
    speaker.input = 'airplay';
    speaker.status = 'playing';
    if (track !== undefined) {
      const {title, artist, album} = track;
      delete speaker.artist;
      delete speaker.album;
      Object.assign(speaker, {title}, artist === undefined ? {} : {artist}, album === undefined ? {} : {album});
    }
  }

  pause(kind: SimulatedKind): void {
    this.#speakers[kind].status = 'paused';
  }

  stop(kind: SimulatedKind): void {
    this.#speakers[kind].status = 'stopped';
  }

  /** The speaker switches to another input, such as the TV. */
  otherInput(kind: SimulatedKind): void {
    this.#speakers[kind].input = 'other';
  }

  /** The speaker stops answering, as one that is switched off or off the network. */
  silent(kind: SimulatedKind): void {
    this.#speakers[kind].answering = false;
  }

  /** The speaker takes `delayMs` to answer each call, as a busy one or one on a weak network does. */
  slow(kind: SimulatedKind, delayMs = SLOW_MS): void {
    this.#speakers[kind].delayMs = delayMs;
  }

  /** The speaker answers again, and at once. */
  answer(kind: SimulatedKind): void {
    this.#speakers[kind].answering = true;
    this.#speakers[kind].delayMs = 0;
  }

  /** The speaker's next command ends as given, then commands are answered again. */
  nextCommand(kind: SimulatedKind, ending: SpeakerState['nextCommand']): void {
    this.#speakers[kind].nextCommand = ending;
  }

  state(): SpeakersState {
    const copy = (speaker: SpeakerState): SpeakerState => ({...speaker, commands: [...speaker.commands]});
    return {sony: copy(this.#speakers.sony), sonos: copy(this.#speakers.sonos)};
  }

  async #call<T>(kind: SimulatedKind, signal: AbortSignal, reply: () => T | 'hang'): Promise<T> {
    const speaker = this.#speakers[kind];
    speaker.calls += 1;
    this.#active[kind] += 1;
    speaker.peak = Math.max(speaker.peak, this.#active[kind]);
    try {
      if (speaker.delayMs > 0) await this.#wait(speaker.delayMs, signal);
      if (!speaker.answering) return await silence(signal);
      // A slow speaker answers with what it shows when it answers.
      const answer = reply();
      return answer === 'hang' ? await silence(signal) : answer;
    } finally {
      this.#active[kind] -= 1;
    }
  }

  /** Waits `ms` on the scheduler, or rejects once `signal` aborts, as a call that ran out of time would. */
  #wait(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      let cancel = (): void => {};
      const lost = (): void => {
        cancel();
        reject(new Error('the speaker did not answer'));
      };
      if (signal.aborted) {
        lost();
        return;
      }
      signal.addEventListener('abort', lost, {once: true});
      cancel = this.#scheduler.after(ms, () => {
        signal.removeEventListener('abort', lost);
        resolve();
      });
    });
  }

  /** The command's ending: `answer` unless a test set another for this one command. */
  #ending(speaker: SpeakerState, action: PlaybackAction): SpeakerState['nextCommand'] {
    speaker.commands.push(action);
    const ending = speaker.nextCommand;
    speaker.nextCommand = 'answer';
    return ending;
  }

  #sonyReply(method: string): SonyReply | 'hang' {
    const speaker = this.#speakers.sony;
    if (method === 'getPlayingContentInfo') {
      if (speaker.input !== 'airplay') return {result: [[{source: 'extInput:tv', uri: 'extInput:tv', stateInfo: {state: 'PLAYING'}, output: ''}]]};
      const {title, artist, album} = speaker;
      return {result: [[{
        source: 'extInput:airPlay', uri: 'extInput:airPlay', output: '', stateInfo: {state: SONY_STATES[speaker.status], supplement: ''},
        ...(title === undefined ? {} : {title}), ...(artist === undefined ? {} : {artist}), ...(album === undefined ? {} : {albumName: album}),
        applicationName: 'app',
      }]]};
    }
    const action = SONY_ACTIONS[method];
    if (action === undefined) return {error: [12, 'No Such Method']};
    const ending = this.#ending(speaker, action);
    if (ending === 'hang') return 'hang';
    if (ending === 'refuse') return {error: [40000, 'refused']};
    if (action === 'pause') speaker.status = 'paused';
    return {result: []};
  }

  #sonosReply(action: string): SonosReply | 'hang' {
    const speaker = this.#speakers.sonos;
    const ok = (body: string): SonosReply => ({status: 200, body});
    switch (action) {
      case 'GetTransportInfo':
        return ok(response(action, `<CurrentTransportState>${SONOS_STATES[speaker.status]}</CurrentTransportState><CurrentTransportStatus>OK</CurrentTransportStatus><CurrentSpeed>1</CurrentSpeed>`));
      case 'GetPositionInfo': {
        const airplay = speaker.input === 'airplay';
        const {title, artist, album} = speaker;
        const didl = `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"><item id="-1" parentID="-1" restricted="true">${title === undefined ? '' : `<dc:title>${escapeXml(title)}</dc:title>`}${artist === undefined ? '' : `<dc:creator>${escapeXml(artist)}</dc:creator>`}${album === undefined ? '' : `<upnp:album>${escapeXml(album)}</upnp:album>`}</item></DIDL-Lite>`;
        return ok(response(action, `<Track>1</Track><TrackDuration>0:03:41</TrackDuration><TrackMetaData>${escapeXml(didl)}</TrackMetaData><TrackURI>${escapeXml(airplay ? SONOS_AIRPLAY_URI : SONOS_OTHER_URI)}</TrackURI><RelTime>0:01:03</RelTime>`));
      }
      case 'GetCurrentTransportActions':
        return ok(response(action, '<Actions>Set, Stop, Pause, Play, Next, Previous</Actions>'));
      default:
        break;
    }
    const played = SONOS_ACTIONS[action];
    if (played === undefined) return {status: 500, body: soapFault(401)};
    const ending = this.#ending(speaker, played);
    if (ending === 'hang') return 'hang';
    if (ending === 'refuse') return {status: 500, body: soapFault(701)};
    if (played === 'pause') speaker.status = 'paused';
    if (played === 'play') speaker.status = 'playing';
    return ok(response(action));
  }
}
