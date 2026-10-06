import { snapshotAnimation } from './frames.js';
import {
  systemClock, type Animation, type Clock, type DeviceAdapter, type FailureCode, type OperationOptions,
  type OperationResult, type ProbeResult, type RgbFrame, type Timing, type UploadResult,
} from './contracts.js';

export interface FakeDeviceOptions { clock?: Clock; latencyMs?: number; readyDelayMs?: number; recordHistory?: boolean }
type OperationKind = 'probe' | 'uploadAnimation' | 'setBrightness' | 'setScreen';
/** Per kind: operations the writer admitted to its queue, and those that completed successfully. */
export type OperationCounts = Record<OperationKind, { admitted: number; succeeded: number }>;
export interface OperationRecord {
  id: number;
  kind: OperationKind;
  generation: number;
  timing: Timing;
  outcome: 'success' | FailureCode;
  priorEffects: 'none' | 'possible';
}
type EffectData = { kind: 'frame'; frameIndex: number; frame: RgbFrame }
  | { kind: 'brightness'; percent: number } | { kind: 'screen'; on: boolean };
export type DeviceEffect = EffectData & { operationId: number; generation: number; atMs: number };
interface Work { start(): void; cancel(code: FailureCode): void }

function nonnegative(value: number) { return Number.isFinite(value) && value >= 0; }


/** In-memory simulator only. One instance owns one serialized writer. */
export class FakeDeviceAdapter implements DeviceAdapter {
  private readonly clock: Clock;
  private readonly latencyMs: number;
  private readonly readyDelayMs: number;
  private readonly recordHistory: boolean;
  private nextId = 0;
  private online = true;
  private nextUploadFailure: number | undefined;
  private currentGeneration = 0;
  private pumping = false;
  private waiting: Work[] = [];
  private active: Work | undefined;
  private records: OperationRecord[] = [];
  private recordedEffects: DeviceEffect[] = [];
  private readonly counted: OperationCounts = { probe: { admitted: 0, succeeded: 0 }, uploadAnimation: { admitted: 0, succeeded: 0 },
    setBrightness: { admitted: 0, succeeded: 0 }, setScreen: { admitted: 0, succeeded: 0 } };

  constructor(options: FakeDeviceOptions = {}) {
    this.clock = options.clock ?? systemClock;
    this.latencyMs = options.latencyMs ?? 0;
    this.readyDelayMs = options.readyDelayMs ?? 0;
    this.recordHistory = options.recordHistory ?? true;
    if(typeof this.recordHistory !== 'boolean')throw new TypeError('Recording choice must be boolean');
    if (!nonnegative(this.latencyMs) || !nonnegative(this.readyDelayMs)) throw new RangeError('Fake delays must be finite and nonnegative');
  }
  get operations(): readonly OperationRecord[] { return structuredClone(this.records); }
  get effects(): readonly DeviceEffect[] { return structuredClone(this.recordedEffects); }
  /** Bounded counters kept even when history is disabled, so a simulator run can report what reached its writer. */
  get counts(): OperationCounts { return structuredClone(this.counted); }

  setOnline(online: boolean): void {
    if (typeof online !== 'boolean') throw new TypeError('Online state must be boolean');
    this.online = online;
  }
  /** Zero-based frame index. Consumed by the next valid upload submission. */
  failNextUpload(frameIndex = 0): void {
    if (!Number.isSafeInteger(frameIndex) || frameIndex < 0) throw new RangeError('Failure frame index must be nonnegative');
    this.nextUploadFailure = frameIndex;
  }
  get generation() { return this.currentGeneration; }
  invalidateGeneration(): number {
    if (this.currentGeneration === Number.MAX_SAFE_INTEGER) throw new RangeError('Generation exhausted');
    this.currentGeneration++;
    for (const work of [this.active, ...this.waiting]) work?.cancel('stale-generation');
    return this.currentGeneration;
  }

  probe(options: OperationOptions): Promise<OperationResult<ProbeResult>> {
    return this.submit('probe', [], options, () => ({ mode: 'simulator', available: true, connected: false }));
  }
  uploadAnimation(animation: Animation, options: OperationOptions): Promise<OperationResult<UploadResult>> {
    const snapshot = snapshotAnimation(animation);
    const valid = !!snapshot;
    const effects: EffectData[] = snapshot ? snapshot.frames.map((frame, frameIndex) => ({
      kind: 'frame', frameIndex, frame: { rgb: new Uint8Array(frame.rgb), delayMs: frame.delayMs },
    })) : [];
    const failureAt = valid ? this.nextUploadFailure : undefined;
    if (valid) this.nextUploadFailure = undefined;
    return this.submit('uploadAnimation', effects, options, () => ({ estimatedReadyAtMs: this.clock.now() + this.readyDelayMs }), valid, failureAt);
  }
  setBrightness(percent: number, options: OperationOptions): Promise<OperationResult<void>> {
    return this.submit('setBrightness', [{ kind: 'brightness', percent }], options, () => undefined,
      Number.isInteger(percent) && percent >= 0 && percent <= 100);
  }
  setScreen(on: boolean, options: OperationOptions): Promise<OperationResult<void>> {
    return this.submit('setScreen', [{ kind: 'screen', on }], options, () => undefined, typeof on === 'boolean');
  }
  private pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (!this.active && this.waiting.length) {
        this.active = this.waiting.shift();
        this.active?.start();
      }
    } finally { this.pumping = false; }
  }
  private submit<T>(kind: OperationKind, effects: EffectData[], options: OperationOptions, value: () => T, valid = true, failureAt?: number): Promise<OperationResult<T>> {
    const id = ++this.nextId;
    const generation = options.generation;
    const submittedAtMs = this.clock.now();
    let startedAtMs: number | null = null;
    let count = 0;
    let done = false;
    let cancelStep = () => {};
    let cancelDeadline = () => {};
    const signal = options.signal;
    const timeoutMs = options.timeoutMs ?? 5000;
    const deadline = submittedAtMs + timeoutMs;
    return new Promise(resolve => {
      const abort = () => { finish('cancelled'); };
      const finish = (code?: FailureCode) => {
        if (done) return;
        done = true;
        cancelStep();
        cancelDeadline();
        signal?.removeEventListener('abort', abort);
        const completedAtMs = this.clock.now();
        const timing = { submittedAtMs, startedAtMs, completedAtMs,
          queueMs: (startedAtMs ?? completedAtMs) - submittedAtMs,
          serviceMs: startedAtMs === null ? 0 : completedAtMs - startedAtMs };
        const priorEffects = count ? 'possible' : 'none';
        if(this.recordHistory)this.records.push({ id, kind, generation, timing: { ...timing }, outcome: code ?? 'success', priorEffects });
        if(!code)this.counted[kind].succeeded++;
        resolve(code ? { ok: false, code, priorEffects, generation, timing } : { ok: true, value: value(), generation, timing });
        this.waiting = this.waiting.filter(item => item !== work);
        if (this.active === work) this.active = undefined;
        this.pump();
      };
      const interruption = (): FailureCode | undefined => {
        if (generation !== this.currentGeneration) return 'stale-generation';
        if (signal?.aborted) return 'cancelled';
        if (this.clock.now() >= deadline) return 'timeout';
        return undefined;
      };
      const step = () => {
        cancelStep = this.clock.schedule(this.latencyMs, () => {
          if (done) return;
          const code = interruption();
          if (code) { finish(code); return; }
          if (!this.online) { finish('offline'); return; }
          if (kind === 'uploadAnimation' && count === failureAt) { finish('upload-failed'); return; }
          const effect = effects[count];
          if (effect) {
            if(this.recordHistory)this.recordedEffects.push({ ...effect, operationId: id, generation, atMs: this.clock.now() });
            count++;
          }
          if (count < effects.length) step();
          else finish();
        });
      };
      const work: Work = { cancel: finish, start: () => {
        const code = interruption();
        if (code) { finish(code); return; }
        startedAtMs = this.clock.now();
        step();
      } };
      if (!valid || !Number.isSafeInteger(generation) || generation < 0 || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(deadline)) {
        finish('invalid-input'); return;
      }
      const code = interruption();
      if (code) { finish(code); return; }
      signal?.addEventListener('abort', abort, { once: true });
      cancelDeadline = this.clock.schedule(timeoutMs, () => { finish('timeout'); });
      this.counted[kind].admitted++;
      this.waiting.push(work);
      this.pump();
    });
  }
}
