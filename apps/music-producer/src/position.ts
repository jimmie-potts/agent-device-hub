import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {errorBody, type ErrorCode, type ErrorDetail} from '@jimmie-potts/event-contracts/v2';
import type {Scheduler} from '@jimmie-potts/sdk';
import {systemScheduler, type ChildPort} from './native.js';
import {MAX_POSITION_BYTES, parsePositionRecord, type PositionRecord, type PositionSample} from './position-protocol.js';
export type PositionReadResult = {status: 'sample'; sequence: number; sourceEpoch: string; sample: PositionSample} |
  {status: 'unavailable'; sequence: number; error: ErrorDetail};
export const positionLauncher = (helper: string): (() => ChildPort) => () => {
  const child = spawn(helper, ['--read-existing-music'], {stdio: ['pipe', 'pipe', 'pipe'], shell: false});
  return {stdin: child.stdin, stdout: child.stdout, stderr: child.stderr,
    onSpawn: callback => {child.once('spawn', callback);}, onError: callback => {child.once('error', callback);},
    onExit: callback => {child.once('close', callback);}, kill: signal => child.kill(signal)};
};
const readError = (code: ErrorCode): ErrorDetail => errorBody(code, {detail: 'The local Music position read did not complete.'}).error;

/** A caller-owned single read, with no scheduler for polling or playback integration. */
export class MusicPositionReader {
  readonly #launch: () => ChildPort;
  readonly #scheduler: Scheduler;
  readonly #now: () => number;
  #owned: object | undefined;
  #sequence = 0;
  #instance: {native: string; epoch: string} | undefined;
  constructor({helper, launch = positionLauncher(helper), scheduler = systemScheduler, now = () => Number(process.hrtime.bigint()) / 1e6}:
    {helper: string; launch?: () => ChildPort; scheduler?: Scheduler; now?: () => number}) {
    this.#launch = launch; this.#scheduler = scheduler; this.#now = now;
  }
  read({signal}: {signal?: AbortSignal} = {}): Promise<PositionReadResult> {
    const sequence = ++this.#sequence;
    const unavailable = (error: ErrorDetail): PositionReadResult => ({status: 'unavailable', sequence, error});
    if (this.#owned !== undefined) return Promise.resolve(unavailable(readError('invalid-state')));
    if (signal?.aborted === true) return Promise.resolve(unavailable(readError('cancelled')));
    const before = this.#now();
    if (!Number.isFinite(before) || before < 0) return Promise.resolve(unavailable(readError('invalid-state')));
    const identity = {}; this.#owned = identity;
    let child: ChildPort;
    try {child = this.#launch();} catch {
      this.#owned = undefined; return Promise.resolve(unavailable(readError('unavailable')));
    }
    return new Promise(resolve => {
      let spawned = false, exited = false, settled = false, stopping = false;
      let failure: ErrorDetail | undefined, record: PositionRecord | undefined, pending = Buffer.alloc(0), received = 0, stderrBytes = 0;
      const timers: (() => void)[] = [];
      const settle = (value: PositionReadResult): void => {
        if (settled) return;
        settled = true; pending = Buffer.alloc(0); record = undefined;
        for (const cancel of timers) cancel();
        signal?.removeEventListener('abort', abort); resolve(value);
      };
      const kill = (value: NodeJS.Signals): void => {try {child.kill(value);} catch { /* Only observed exit releases ownership. */ }};
      const stop = (error: ErrorDetail): void => {
        if (settled || stopping) return;
        stopping = true; failure = error; pending = Buffer.alloc(0); record = undefined;
        try {child.stdin.end();} catch { /* Signals bound teardown independently of the pipe. */ }
        kill('SIGTERM');
        timers.push(this.#scheduler.after(500, () => {if (!exited) kill('SIGKILL');}));
        timers.push(this.#scheduler.after(1500, () => {if (!exited) settle(unavailable(readError('uncertain-result')));}));
      };
      const abort = (): void => stop(readError('cancelled'));
      const invalid = (): void => stop(readError('invalid-message'));
      child.stdout.on('data', (bytes: Buffer) => {
        if (stopping || settled) return;
        received += bytes.length;
        if (received > MAX_POSITION_BYTES || record !== undefined) {invalid(); return;}
        pending = Buffer.concat([pending, bytes]);
        const newline = pending.indexOf(10);
        if (newline < 0) return;
        if (newline !== pending.length - 1) {invalid(); return;}
        const value = parsePositionRecord(pending.subarray(0, newline));
        const receivedAt = this.#now();
        if (receivedAt - before >= 5000) {stop(readError('unavailable')); return;}
        if (value === undefined || !Number.isFinite(receivedAt) || receivedAt < before ||
          value.interval.startedMonotonicMs < before || value.interval.endedMonotonicMs > receivedAt) {invalid(); return;}
        record = value; pending = Buffer.alloc(0);
      });
      child.stderr.on('data', (bytes: Buffer) => {stderrBytes += bytes.length; if (stderrBytes > MAX_POSITION_BYTES) invalid();});
      child.stdout.on('error', invalid); child.stderr.on('error', invalid);
      child.stdin.on('error', () => stop(readError('unavailable')));
      child.onSpawn(() => {spawned = true;});
      const exit = (code: number | null, exitSignal: NodeJS.Signals | null): void => {
        if (exited) return;
        exited = true; if (this.#owned === identity) this.#owned = undefined;
        if (settled) return;
        if (failure !== undefined) {settle(unavailable(failure)); return;}
        const exitedAt = this.#now();
        if (!Number.isFinite(exitedAt) || exitedAt < before || exitedAt - before >= 5000) {
          settle(unavailable(readError('unavailable'))); return;
        }
        if (!spawned || exitSignal !== null) {settle(unavailable(readError('unavailable'))); return;}
        if (pending.length !== 0 || record === undefined || (record.status === 'sample' ? code !== 0 : code !== 1)) {
          settle(unavailable(readError('invalid-message'))); return;
        }
        if (record.status === 'unavailable') {settle(unavailable(record.error)); return;}
        if (this.#instance?.native !== record.sourceInstance) this.#instance = {native: record.sourceInstance, epoch: randomUUID()};
        settle({status: 'sample', sequence, sourceEpoch: this.#instance.epoch, sample: record});
      };
      child.onError(() => {if (!spawned) {failure = readError('unavailable'); exit(null, null);} else stop(readError('unavailable'));});
      child.onExit(exit);
      timers.push(this.#scheduler.after(5000, () => stop(readError('unavailable'))));
      signal?.addEventListener('abort', abort, {once: true});
      if (signal?.aborted === true) abort();
    });
  }
}
