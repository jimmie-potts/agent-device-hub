import {spawn} from 'node:child_process';
import type {Readable, Writable} from 'node:stream';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {Outcome, SdkError, type Scheduler} from '@jimmie-potts/sdk';
import {NativeLines, nativeFailure, type NativeFailure, type NativeFrame, type NativeRecord} from './protocol.js';
import {nativeClockQualified, type ClockReading} from './timing.js';

export const systemClock = (): ClockReading => ({wallMs: Date.now(), monotonicMs: Number(process.hrtime.bigint()) / 1e6});
export const systemScheduler: Scheduler = {after: (delay, callback) => {const timer = setTimeout(callback, delay); return () => clearTimeout(timer);}};
export type NativeTermination = {status: 'stopped'} | {status: 'failed' | 'uncertain'; error: NativeFailure};
export type NativeRun = {ended: Promise<NativeTermination>; stop(): Promise<NativeTermination>};
export interface NativeSource {
  qualifyClock(): Promise<boolean>;
  start(onFrame: (frame: NativeFrame) => void): NativeRun;
}
export interface ChildPort {
  stdout: Readable; stderr: Readable; stdin: Writable;
  onSpawn(callback: () => void): void;
  onError(callback: () => void): void;
  onExit(callback: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  kill(signal: NodeJS.Signals): boolean;
}
export type NativeLauncher = (mode: '--clock' | '--capture') => ChildPort;
export const nativeLauncher = (helper: string): NativeLauncher => mode => {
  const child = spawn(helper, [mode], {stdio: ['pipe', 'pipe', 'pipe'], shell: false});
  return {stdin: child.stdin, stdout: child.stdout, stderr: child.stderr,
    onSpawn: callback => {child.once('spawn', callback);}, onError: callback => {child.once('error', callback);},
    onExit: callback => {child.once('close', callback);}, kill: signal => child.kill(signal)};
};

/** Owns at most one helper. Construction, clock checks and import never capture audio. */
export class NativeCapture implements NativeSource {
  readonly #launch: NativeLauncher;
  readonly #scheduler: Scheduler;
  readonly #clock: () => ClockReading;
  #owned: object | undefined;
  constructor({helper, launch = nativeLauncher(helper), scheduler = systemScheduler, clock = systemClock}:
    {helper: string; launch?: NativeLauncher; scheduler?: Scheduler; clock?: () => ClockReading}) {
    this.#launch = launch; this.#scheduler = scheduler; this.#clock = clock;
  }
  async qualifyClock(): Promise<boolean> {
    const beforeMs = this.#clock().monotonicMs;
    let value: number | undefined, valid = true;
    const run = this.#open('--clock', record => {
      if (record.schema !== 'music-native-clock/1.0' || value !== undefined) {valid = false; return false;}
      value = record.monotonicMs; return true;
    });
    const cancel = this.#scheduler.after(2000, () => {valid = false; void run.stop();});
    const end = await run.ended;
    cancel();
    return valid && end.status === 'stopped' && value !== undefined &&
      nativeClockQualified({beforeMs, nativeMs: value, afterMs: this.#clock().monotonicMs});
  }
  start(onFrame: (frame: NativeFrame) => void): NativeRun {
    let previous: NativeFrame | undefined;
    return this.#open('--capture', record => {
      if (record.schema !== 'music-native-frame/1.0') return false;
      const {schema: _schema, ...frame} = record;
      if (previous !== undefined && (frame.sequence <= previous.sequence || frame.endMonotonicMs <= previous.endMonotonicMs ||
        frame.channels !== previous.channels || frame.sampleRateHz !== previous.sampleRateHz)) return false;
      if (previous === undefined || frame.sequence !== previous.sequence + 1) frame.discontinuity = true;
      previous = frame;
      onFrame(frame);
      return true;
    });
  }
  #open(mode: '--clock' | '--capture', record: (value: NativeRecord) => boolean): NativeRun {
    if (this.#owned !== undefined) throw new SdkError(errorBody('invalid-state', {detail: 'The native helper has not confirmed exit.'}));
    const identity = {};
    this.#owned = identity;
    let resolveEnd: (value: NativeTermination) => void = () => {};
    const ended = new Promise<NativeTermination>(resolve => {resolveEnd = resolve;});
    let child: ChildPort;
    try {child = this.#launch(mode);} catch {
      this.#owned = undefined;
      resolveEnd({status: Outcome.failed, error: nativeFailure('unavailable')});
      return {ended, stop: () => ended};
    }
    let spawned = false, exited = false, settled = false, stopping = false, fenced = false;
    let failure: NativeFailure | undefined, terminal = false, cleanupUnknown = false, stderrBytes = 0;
    const timers: (() => void)[] = [];
    const settle = (result: NativeTermination): void => {
      if (settled) return;
      settled = true; fenced = true; for (const cancel of timers) cancel(); resolveEnd(result);
    };
    const kill = (signal: NodeJS.Signals): void => {try {child.kill(signal);} catch { /* Exit observation, not a kill return, decides cleanup. */ }};
    const stop = (): Promise<NativeTermination> => {
      fenced = true;
      if (stopping || exited || settled) return ended;
      stopping = true;
      try {child.stdin.end('stop\n');} catch { /* The bounded signal path remains available. */ }
      timers.push(this.#scheduler.after(500, () => {if (!exited) kill('SIGTERM');}));
      timers.push(this.#scheduler.after(2500, () => {if (!exited) kill('SIGKILL');}));
      timers.push(this.#scheduler.after(3500, () => {
        if (!exited) settle({status: Outcome.uncertain, error: nativeFailure('uncertain-result')});
      }));
      return ended;
    };
    const invalid = (): void => {failure ??= nativeFailure('invalid-message'); void stop();};
    const lines = new NativeLines(value => {
      if (fenced) return;
      if (value.schema === 'music-native-terminal/1.0') {
        terminal = true; failure = nativeFailure(value.error.code);
        cleanupUnknown = value.error.detail === 'Music capture cleanup did not complete.';
        void stop(); return;
      }
      try {if (!record(value)) invalid();} catch {invalid();}
    }, invalid);
    child.stdin.on('error', () => {if (!stopping) {failure = nativeFailure('unavailable'); void stop();}});
    child.stdout.on('error', invalid);
    child.stderr.on('error', invalid);
    child.stdout.on('data', (bytes: Buffer) => {if (!fenced) lines.push(bytes);});
    child.stderr.on('data', (bytes: Buffer) => {stderrBytes += bytes.length; if (stderrBytes > 8192) invalid();});
    child.onSpawn(() => {spawned = true;});
    const exit = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (exited) return;
      exited = true; if (this.#owned === identity) this.#owned = undefined;
      lines.finish();
      if (!spawned) {settle({status: Outcome.failed, error: failure ?? nativeFailure('unavailable')}); return;}
      if (signal !== null || cleanupUnknown || (code !== 0 && !terminal)) {
        settle({status: Outcome.uncertain, error: nativeFailure('uncertain-result')}); return;
      }
      if (failure !== undefined) {settle({status: Outcome.failed, error: failure}); return;}
      settle(code === 0 && (stopping || mode === '--clock') ? {status: 'stopped'} : {status: Outcome.failed, error: nativeFailure('unavailable')});
    };
    child.onError(() => {
      failure = nativeFailure('unavailable');
      if (!spawned) exit(null, null); else void stop();
    });
    child.onExit(exit);
    return {ended, stop};
  }
}
