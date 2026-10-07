// How the Pixoo module reaches its device (Hub #843, #846): `createPixooModule({transport})` takes a transport, so tests and
// disposable runs pass `SimulatedPixoo` and no hardware is touched. The real transport speaks the Pixoo's local HTTP API
// through `HttpDeviceAdapter`, with the hosted-GIF listener when the profile uses it. Opening a transport reaches nothing:
// it builds the device writer and binds the local listener, and the device is first reached by a later call.
import {createHash} from 'node:crypto';
import {
  FakeDeviceAdapter, HttpDeviceAdapter, startHostedFiles, type Animation, type Clock, type DeviceAdapter, type HostedFileConfig, type OperationOptions,
  type OperationResult, type ProbeResult, type UploadResult,
} from '../device/index.js';
import {encodeHostedGif, type MediaProfile} from '../media/index.js';
import {HOSTED_PROFILE} from './configuration.js';

/** What the module opens a transport with, from its configuration. */
export type OpenOptions = {address: string; profile: Readonly<MediaProfile>; clock: Clock; hostedGif?: HostedFileConfig};
/** The device writer the module drives, and what closes it. */
export type OpenedDevice = {adapter: DeviceAdapter; close(): Promise<void>};

export interface PixooTransport {
  /** Whether the transport is simulated: it reaches no device, and the module starts passive, as the simulator did. */
  readonly simulated: boolean;
  /** Builds the device writer. It reaches nothing; the module calls it in `start`. */
  open(options: OpenOptions): Promise<OpenedDevice>;
}

/** The real transport: the Pixoo's local HTTP API at the configured address, the only writer to that device. */
export function httpPixooTransport(): PixooTransport {
  return {
    simulated: false,
    async open({address, profile, clock, hostedGif}) {
      const usesHosted = profile.name === HOSTED_PROFILE;
      const hosted = usesHosted && hostedGif !== undefined ? await startHostedFiles(hostedGif) : undefined;
      const adapter = new HttpDeviceAdapter({
        ip: address, clock, profile: {...profile, evidence: 'observed', readyDelayMs: usesHosted ? 1000 : 0},
        ...(hosted === undefined ? {} : {hosted: {files: hosted, encode: (animation: Animation) => encodeHostedGif(animation.frames)}}),
      });
      return {adapter, close: async () => {
        try {
          await adapter.close();
        } finally {
          await hosted?.close();
        }
      }};
    },
  };
}

/** How the simulated Pixoo answers: at once (`online`), with a refusal to connect (`offline`), or never (`silent`). */
export type SimulatedMode = 'online' | 'offline' | 'silent';
/** What the simulated Pixoo shows, as plain data, so a disposable run can report it. */
export type SimulatedPixooState = {
  mode: SimulatedMode;
  /** What it answered: uploads, display writes and probes. */
  uploads: number; writes: number; probes: number;
  /** Uploads and display writes that reached it, answered or not: a silent Pixoo takes a write and never answers. */
  sent: number;
  /** The animation it shows: its frame count, each frame's delay, and the first 16 hex digits of each frame's SHA-256. */
  shown: {frames: number; delaysMs: number[]; digests: string[]} | null;
  brightness: number | null; screenOn: boolean;
};

/** The first 16 hex digits of a frame's SHA-256, as the simulated Pixoo reports what it shows. */
export const frameDigest = (rgb: Uint8Array): string => createHash('sha256').update(rgb).digest('hex').slice(0, 16);

/**
 * A simulated Pixoo: the in-memory writer from divoom-app-upgrade's simulator mode, behind a panel that remembers what
 * it shows across runtime restarts, as a real device would. A test or run sets it online, offline or silent; a silent
 * Pixoo never answers, so each call ends at its own deadline, and a write that was sent may have taken effect.
 */
export class SimulatedPixoo implements PixooTransport {
  readonly simulated = true;
  #mode: SimulatedMode;
  #state: Omit<SimulatedPixooState, 'mode'> = {uploads: 0, writes: 0, probes: 0, sent: 0, shown: null, brightness: null, screenOn: true};
  readonly #listeners = new Set<(state: SimulatedPixooState) => void>();
  readonly #adapters = new Set<FakeDeviceAdapter>();

  constructor({mode = 'online'}: {mode?: SimulatedMode} = {}) {
    this.#mode = mode;
  }

  open({clock}: OpenOptions): Promise<OpenedDevice> {
    const inner = new FakeDeviceAdapter({clock, recordHistory: false});
    inner.setOnline(this.#mode === 'online');
    this.#adapters.add(inner);
    const adapter = new SimulatedAdapter(inner, clock, () => this.#mode, change => { this.#record(change); }, () => {
      this.#state.sent += 1;
      this.#emit();
    });
    return Promise.resolve({adapter, close: () => {
      this.#adapters.delete(inner);
      inner.invalidateGeneration();
      return Promise.resolve();
    }});
  }

  /** Sets how the simulated Pixoo answers from now on. */
  set(mode: SimulatedMode): void {
    this.#mode = mode;
    for (const adapter of this.#adapters) adapter.setOnline(mode === 'online');
    this.#emit();
  }

  state(): SimulatedPixooState {
    return structuredClone({mode: this.#mode, ...this.#state});
  }

  /** Hears every change of what the simulated Pixoo shows; returns what stops it. */
  onChange(listener: (state: SimulatedPixooState) => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  #record(change: Change): void {
    switch (change.kind) {
      case 'upload':
        this.#state.uploads += 1;
        this.#state.shown = {frames: change.animation.frames.length, delaysMs: change.animation.frames.map(frame => frame.delayMs), digests: change.animation.frames.map(frame => frameDigest(frame.rgb))};
        break;
      case 'brightness':
        this.#state.writes += 1;
        this.#state.brightness = change.percent;
        break;
      case 'screen':
        this.#state.writes += 1;
        this.#state.screenOn = change.on;
        break;
      case 'probe':
        this.#state.probes += 1;
        break;
    }
    this.#emit();
  }

  #emit(): void {
    const state = this.state();
    for (const listener of this.#listeners) {
      try {
        listener(state);
      } catch {
        // A listener that fails never changes what the device shows.
      }
    }
  }
}

type Change = {kind: 'upload'; animation: Animation} | {kind: 'brightness'; percent: number} | {kind: 'screen'; on: boolean} | {kind: 'probe'};

/** The simulated writer: the in-memory adapter, which reports what reached it, and which never answers while silent. */
class SimulatedAdapter implements DeviceAdapter {
  readonly #inner: FakeDeviceAdapter;
  readonly #clock: Clock;
  readonly #mode: () => SimulatedMode;
  readonly #record: (change: Change) => void;
  readonly #sent: () => void;

  constructor(inner: FakeDeviceAdapter, clock: Clock, mode: () => SimulatedMode, record: (change: Change) => void, sent: () => void) {
    this.#inner = inner;
    this.#clock = clock;
    this.#mode = mode;
    this.#record = record;
    this.#sent = sent;
  }

  get generation(): number {
    return this.#inner.generation;
  }

  invalidateGeneration(): number {
    return this.#inner.invalidateGeneration();
  }

  probe(options: OperationOptions): Promise<OperationResult<ProbeResult>> {
    return this.#call(options, false, () => this.#inner.probe(options), () => ({kind: 'probe'}));
  }

  uploadAnimation(animation: Animation, options: OperationOptions): Promise<OperationResult<UploadResult>> {
    return this.#call(options, true, () => this.#inner.uploadAnimation(animation, options), () => ({kind: 'upload', animation}));
  }

  setBrightness(percent: number, options: OperationOptions): Promise<OperationResult<void>> {
    return this.#call(options, true, () => this.#inner.setBrightness(percent, options), () => ({kind: 'brightness', percent}));
  }

  setScreen(on: boolean, options: OperationOptions): Promise<OperationResult<void>> {
    return this.#call(options, true, () => this.#inner.setScreen(on, options), () => ({kind: 'screen', on}));
  }

  async #call<T>(options: OperationOptions, mutating: boolean, run: () => Promise<OperationResult<T>>, change: () => Change): Promise<OperationResult<T>> {
    // An offline Pixoo refuses the connection, so nothing reaches it; an online or silent one takes the request.
    if (mutating && this.#mode() !== 'offline') this.#sent();
    if (this.#mode() !== 'silent') {
      const result = await run();
      if (result.ok) this.#record(change());
      return result;
    }
    // A silent device takes the request and never answers: the call ends at its deadline or when it is cancelled, and a
    // write may have reached the device.
    const submittedAtMs = this.#clock.now(), timeoutMs = options.timeoutMs ?? 5000;
    const code = await new Promise<'timeout' | 'cancelled'>(resolve => {
      const cancel = this.#clock.schedule(timeoutMs, () => { finish('timeout'); });
      const abort = (): void => { finish('cancelled'); };
      const finish = (ending: 'timeout' | 'cancelled'): void => {
        cancel();
        options.signal?.removeEventListener('abort', abort);
        resolve(ending);
      };
      if (options.signal?.aborted === true) finish('cancelled');
      else options.signal?.addEventListener('abort', abort, {once: true});
    });
    const completedAtMs = this.#clock.now();
    return {
      ok: false, code, priorEffects: mutating ? 'possible' : 'none', generation: options.generation,
      timing: {submittedAtMs, startedAtMs: submittedAtMs, completedAtMs, queueMs: 0, serviceMs: completedAtMs - submittedAtMs},
    };
  }
}
