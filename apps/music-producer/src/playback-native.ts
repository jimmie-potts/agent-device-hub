import {spawn} from 'node:child_process';
import {errorBody, type ErrorCode, type ErrorDetail} from '@jimmie-potts/event-contracts/v2';
import {Outcome, type Scheduler} from '@jimmie-potts/sdk';
import {systemClock, systemScheduler, type ChildPort, type NativeTermination} from './native.js';
import {nativeClockQualified, type ClockReading} from './timing.js';
import {MAX_PLAYBACK_BYTES, MAX_PLAYBACK_STDERR_BYTES, parsePlaybackRecord, type NativePlaybackAction, type NativePlaybackControl,
  type NativePlaybackRead, type NativePlaybackRecord} from './playback-protocol.js';

export type PlaybackNativeRequest = {mode: 'clock'} | {mode: 'read'} | {mode: 'control'; action: NativePlaybackAction; expectedSourceInstance: string; deadlineMonotonicMs: number};
export type PlaybackNativeLauncher = (request: PlaybackNativeRequest) => ChildPort;
export type PlaybackNativeFailure = {status: 'failure'; error: ErrorDetail; cleanup: 'confirmed' | 'uncertain'; mayHaveSent: boolean};
export type PlaybackNativeReadResult = {status: 'record'; record: NativePlaybackRead; cleanup: 'confirmed'} | PlaybackNativeFailure;
export type PlaybackNativeControlResult = {status: 'record'; record: NativePlaybackControl; cleanup: 'confirmed' | 'uncertain'} | PlaybackNativeFailure;
export type PlaybackControlOptions = {action: NativePlaybackAction; expectedSourceInstance: string; deadlineMonotonicMs: number; signal?: AbortSignal};
export interface PlaybackNativeSource {
  qualifyClock(): Promise<boolean>;
  read(options?: {signal?: AbortSignal}): Promise<PlaybackNativeReadResult>;
  control(options: PlaybackControlOptions): Promise<PlaybackNativeControlResult>;
  close(): Promise<NativeTermination>;
}
export const playbackLauncher = (helper: string): PlaybackNativeLauncher => request => {
  const args = request.mode === 'clock' ? ['--clock'] : request.mode === 'read' ? ['--read-existing-music'] :
    ['--control-existing-music', request.action, request.expectedSourceInstance, String(request.deadlineMonotonicMs)];
  const child = spawn(helper, args, {stdio: ['pipe', 'pipe', 'pipe'], shell: false});
  return {stdin: child.stdin, stdout: child.stdout, stderr: child.stderr,
    onSpawn: callback => {child.once('spawn', callback);}, onError: callback => {child.once('error', callback);},
    onExit: callback => {child.once('close', callback);}, kill: signal => child.kill(signal)};
};
export type PlaybackNativeOptions = {helper: string; launch?: PlaybackNativeLauncher; scheduler?: Scheduler; clock?: () => ClockReading};
type RunResult = {status: 'record'; record: NativePlaybackRecord; cleanup: 'confirmed' | 'uncertain'} | PlaybackNativeFailure;
const failure = (code: ErrorCode, cleanup: 'confirmed' | 'uncertain' = 'confirmed', mayHaveSent = false): PlaybackNativeFailure =>
  ({status: 'failure', cleanup, mayHaveSent, error: errorBody(code, {detail: 'The local Music playback operation did not complete.'}).error});
const finiteTime = (value: number): boolean => Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;

/** Owns one finite helper invocation. An unobserved exit continues to exclude another child. */
export class MusicPlaybackNative implements PlaybackNativeSource {
  readonly #launch: PlaybackNativeLauncher;
  readonly #scheduler: Scheduler;
  readonly #clock: () => ClockReading;
  #closed = false;
  #owned: {stop(): void; ended: Promise<RunResult>} | undefined;
  constructor({helper, launch = playbackLauncher(helper), scheduler = systemScheduler, clock = systemClock}: PlaybackNativeOptions) {
    this.#launch = launch; this.#scheduler = scheduler; this.#clock = clock;
  }
  async qualifyClock(): Promise<boolean> {
    const beforeMs = this.#clock().monotonicMs, result = await this.#run({mode: 'clock'}, 2000);
    return result.status === 'record' && result.cleanup === 'confirmed' && result.record.schema === 'music-playback-clock/1.0' &&
      nativeClockQualified({beforeMs, nativeMs: result.record.monotonicMs, afterMs: this.#clock().monotonicMs});
  }
  async read({signal}: {signal?: AbortSignal} = {}): Promise<PlaybackNativeReadResult> {
    const result = await this.#run({mode: 'read'}, 5000, signal);
    if (result.status === 'failure') return result;
    return result.record.schema === 'music-playback-read/1.0' && result.cleanup === 'confirmed'
      ? {status: 'record', record: result.record, cleanup: 'confirmed'} : failure('invalid-message', result.cleanup);
  }
  async control({action, expectedSourceInstance, deadlineMonotonicMs, signal}: PlaybackControlOptions): Promise<PlaybackNativeControlResult> {
    const remaining = deadlineMonotonicMs - this.#clock().monotonicMs;
    if (!finiteTime(deadlineMonotonicMs) || remaining <= 0) return failure('expired');
    if (!/^[a-f0-9]{64}$/.test(expectedSourceInstance)) return failure('invalid-request');
    const result = await this.#run({mode: 'control', action, expectedSourceInstance, deadlineMonotonicMs}, Math.min(3000, remaining), signal);
    if (result.status === 'failure') return result;
    return result.record.schema === 'music-playback-control/1.0' ? {...result, record: result.record} : failure('invalid-message', result.cleanup, true);
  }
  async close(): Promise<NativeTermination> {
    this.#closed = true;
    const owned = this.#owned;
    if (owned === undefined) return {status: 'stopped'};
    owned.stop(); const result = await owned.ended;
    return result.cleanup === 'confirmed' ? {status: 'stopped'} : {status: Outcome.uncertain, error: errorBody('uncertain-result').error};
  }
  #run(request: PlaybackNativeRequest, budgetMs: number, signal?: AbortSignal): Promise<RunResult> {
    if (this.#closed || this.#owned !== undefined) return Promise.resolve(failure('invalid-state', this.#owned === undefined ? 'confirmed' : 'uncertain'));
    if (signal?.aborted === true) return Promise.resolve(failure('cancelled'));
    const before = this.#clock().monotonicMs;
    if (!finiteTime(before)) return Promise.resolve(failure('invalid-state'));
    let child: ChildPort;
    try {child = this.#launch(request);} catch {return Promise.resolve(failure('unavailable'));}
    let resolve: (value: RunResult) => void = () => {};
    const ended = new Promise<RunResult>(done => {resolve = done;});
    let spawned = false, exited = false, settled = false, stopping = false, spawnFailed = false;
    let error: ErrorCode | undefined, record: NativePlaybackRecord | undefined, pending = Buffer.alloc(0), received = 0, stderrBytes = 0;
    const timers: (() => void)[] = [];
    const settle = (cleanup: 'confirmed' | 'uncertain'): void => {
      if (settled) return;
      settled = true; pending = Buffer.alloc(0); for (const cancel of timers) cancel(); signal?.removeEventListener('abort', abort);
      const canKeep = record !== undefined && (request.mode === 'control' || error === undefined);
      resolve(canKeep && record !== undefined ? {status: 'record', record, cleanup}
        : failure(error ?? 'invalid-message', cleanup, request.mode === 'control' && !spawnFailed));
    };
    const kill = (value: NodeJS.Signals): void => {try {child.kill(value);} catch { /* Ownership ends only at observed exit. */ }};
    const stop = (code: ErrorCode): void => {
      error ??= code;
      if (settled || stopping || exited) return;
      stopping = true;
      if (request.mode !== 'control') {record = undefined; pending = Buffer.alloc(0);}
      try {child.stdin.end();} catch { /* Signals remain independent of stdin. */ }
      kill('SIGTERM');
      timers.push(this.#scheduler.after(500, () => {if (!exited) kill('SIGKILL');}));
      timers.push(this.#scheduler.after(1500, () => {if (!exited) settle('uncertain');}));
    };
    const abort = (): void => stop('cancelled');
    const invalid = (): void => {record = undefined; stop('invalid-message');};
    const owned = {stop: abort, ended}; this.#owned = owned;
    child.stdout.on('data', (bytes: Buffer) => {
      if (settled || (stopping && request.mode !== 'control')) return;
      received += bytes.length;
      if (received > MAX_PLAYBACK_BYTES || record !== undefined) {invalid(); return;}
      pending = Buffer.concat([pending, bytes]);
      const newline = pending.indexOf(10);
      if (newline < 0) return;
      if (newline !== pending.length - 1) {invalid(); return;}
      const value = parsePlaybackRecord(pending.subarray(0, newline)), now = this.#clock().monotonicMs;
      if (!finiteTime(now) || now < before || value === undefined) {invalid(); return;}
      if (request.mode !== 'control' && now - before >= budgetMs) {stop('unavailable'); return;}
      if (value.schema === 'music-playback-clock/1.0') {
        if (request.mode !== 'clock' || value.monotonicMs < before || value.monotonicMs > now) {invalid(); return;}
      } else {
        if (value.interval.startedMonotonicMs < before || value.interval.endedMonotonicMs > now) {invalid(); return;}
        if (request.mode === 'read' && value.schema !== 'music-playback-read/1.0') {invalid(); return;}
        if (request.mode === 'clock') {invalid(); return;}
        if (request.mode === 'control' && (value.schema !== 'music-playback-control/1.0' || value.action !== request.action ||
          value.expectedSourceInstance !== request.expectedSourceInstance ||
          (value.sendInterval !== null && value.sendInterval.startedMonotonicMs >= request.deadlineMonotonicMs))) {invalid(); return;}
      }
      record = value; pending = Buffer.alloc(0);
    });
    child.stderr.on('data', (bytes: Buffer) => {stderrBytes += bytes.length; if (stderrBytes > MAX_PLAYBACK_STDERR_BYTES) invalid();});
    child.stdout.on('error', invalid); child.stderr.on('error', invalid); child.stdin.on('error', () => stop('unavailable'));
    child.onSpawn(() => {spawned = true;});
    const exit = (code: number | null, exitSignal: NodeJS.Signals | null): void => {
      if (exited) return;
      exited = true; if (this.#owned === owned) this.#owned = undefined;
      if (settled) return;
      const now = this.#clock().monotonicMs;
      if (request.mode !== 'control' && (!finiteTime(now) || now < before || now - before >= budgetMs)) {error ??= 'unavailable'; record = undefined;}
      if (!spawned || exitSignal !== null) error ??= 'unavailable';
      if (pending.length !== 0 || record === undefined) error ??= 'invalid-message';
      if (request.mode !== 'control' && record !== undefined) {
        const expectedCode = record.schema === 'music-playback-read/1.0' && record.status === 'unavailable' ? 1 : 0;
        if (code !== expectedCode) {record = undefined; error ??= 'invalid-message';}
      }
      settle('confirmed');
    };
    child.onError(() => {if (!spawned) {spawnFailed = true; error = 'unavailable'; exit(null, null);} else stop('unavailable');});
    child.onExit(exit);
    timers.push(this.#scheduler.after(budgetMs, () => stop('unavailable')));
    signal?.addEventListener('abort', abort, {once: true});
    const aborted = (): boolean => signal?.aborted === true;
    if (aborted()) abort();
    return ended;
  }
}
