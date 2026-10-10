import {createHash, randomBytes} from 'node:crypto';
import {errorBody, type ErrorBody, type ErrorCode} from '@jimmie-potts/event-contracts/v2';
import {DeviceAvailability, noSpans, SdkError, startSpan, type Clock, type Logger, type Scheduler, type Span, type SpanRecorder, type TraceContext} from '@jimmie-potts/sdk';
import {ConnectionFailure} from './failure.js';
import {validateConfig, validateSession, type Config, type Session} from './private.js';
export type VendorJson = null | boolean | number | string | VendorJson[] | {[key: string]: VendorJson};
export type ReadOptions = {signal?: AbortSignal; timeoutMs?: number; trace?: TraceContext};
export type Reading<T> = {ok: true; value: T; observedAt: string} | {ok: false; error: ErrorBody};
export type WireRequest = {method: 'get_status' | 'get_consumable' | 'get_clean_summary' | 'get_clean_record' | 'get_room_mapping' | 'get_map_v1'; params: readonly unknown[]; id: number; seq: number; seconds: number; nonce: Uint8Array};
export type WireResult = {kind: 'json'; value: unknown} | {kind: 'map'; bytes: Buffer};
export type Wire = (config: Config, session: Session, request: WireRequest, signal: AbortSignal) => Promise<WireResult>;
export type Diagnostics = {clock?: Clock; scheduler?: Scheduler; log?: Logger; trace?: SpanRecorder};
export type Dependencies = Diagnostics & {local: Wire; mqtt: Wire};
export interface ReadTransport {
  readStatus(options?: ReadOptions): Promise<Reading<VendorJson>>;
  readConsumables(options?: ReadOptions): Promise<Reading<VendorJson>>;
  readCleanSummary(options?: ReadOptions): Promise<Reading<VendorJson>>;
  readCleanRecord(startTime: number, options?: ReadOptions): Promise<Reading<VendorJson>>;
  readRoomMapping(options?: ReadOptions): Promise<Reading<VendorJson>>;
  readCurrentMap(options?: ReadOptions): Promise<Reading<Buffer>>;
  stop(): void;
}
type Job = {
  request: WireRequest; options: ReadOptions; controller: AbortController;
  resolve: (value: Reading<VendorJson | Buffer>) => void; dispose: () => void;
  settled: boolean; generation: number; span: Span | undefined;
};
const noLog: Logger = {debug: () => {}, info: () => {}, warn: () => {}, error: () => {}};
const realScheduler: Scheduler = {after: (ms, run) => {const timer = setTimeout(run, ms); return () => clearTimeout(timer);}};
const failed = (code: ErrorCode): Reading<never> => ({ok: false, error: errorBody(code)});

export function reader(config: Config, session: Session, dependencies: Dependencies): ReadTransport {
  config = validateConfig(config); session = validateSession(session, config);
  const hash = (input: string): string => createHash('md5').update(input).digest('hex');
  const secrets = [session.localKey, session.rriot.u, session.rriot.s, session.rriot.k,
    hash(`${session.rriot.u}:${session.rriot.k}`).slice(2, 10), hash(`${session.rriot.s}:${session.rriot.k}`).slice(16)];
  const encodedSecrets = secrets.map(secret => JSON.stringify(secret).slice(1, -1));
  const clock = dependencies.clock ?? {now: () => Date.now()};
  const scheduler = dependencies.scheduler ?? realScheduler;
  const availability = new DeviceAvailability({log: dependencies.log ?? noLog, clock});
  const queue: Job[] = [];
  let active: Job | undefined;
  let stopped = false;
  let generation = 0;
  // Random start; each attempt has one identity on its own retired connection.
  let nextId = randomBytes(2).readUInt16BE(0) % 32768 + 1;
  const retired = (job: Job): boolean => stopped || job.settled || job.generation !== generation;
  function settle(job: Job, result: Reading<VendorJson | Buffer>): void {
    if (job.settled) return;
    job.settled = true; job.dispose(); job.controller.abort(); job.span?.end(result.ok ? 'unset' : 'error');
    const index = queue.indexOf(job); if (index >= 0) queue.splice(index, 1);
    if (active === job) active = undefined;
    job.resolve(result); drain();
  }
  function safeValue(value: WireResult, map: boolean): VendorJson | Buffer {
    if (map) {
      if (value.kind !== 'map' || !Buffer.isBuffer(value.bytes) || value.bytes.length > 2 * 1024 * 1024) throw new SdkError(errorBody('unavailable'));
      if (secrets.some(secret => value.bytes.includes(Buffer.from(secret)))) throw new SdkError(errorBody('unavailable'));
      return Buffer.from(value.bytes);
    }
    if (value.kind !== 'json') throw new SdkError(errorBody('unavailable'));
    let encoded: string | undefined;
    try { encoded = JSON.stringify(value.value); } catch { throw new SdkError(errorBody('unavailable')); }
    if (encoded === undefined || Buffer.byteLength(encoded) > 65536) throw new SdkError(errorBody('unsupported-capability'));
    // Preserve domain values while refusing account material, including JSON escapes.
    if (encodedSecrets.some(secret => encoded.includes(secret))) throw new SdkError(errorBody('unavailable'));
    return JSON.parse(encoded) as VendorJson;
  }
  async function backoff(job: Job): Promise<void> {
    await new Promise<void>(resolve => {
      const done = (): void => { cancel(); job.controller.signal.removeEventListener('abort', done); resolve(); };
      const cancel = scheduler.after(250, done);
      job.controller.signal.addEventListener('abort', done, {once: true});
      if (job.controller.signal.aborted) done();
    });
  }
  async function execute(job: Job): Promise<void> {
    const span = startSpan(dependencies.trace ?? noSpans, 'bunny.device.call', {parent: job.options.trace, kind: 'client'});
    job.span = span;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (retired(job)) return;
        try {
          job.request = {...job.request, seconds: Math.floor(clock.now() / 1000)};
          const wire = job.request.method === 'get_map_v1' ? dependencies.mqtt : dependencies.local;
          const result = await wire(config, session, job.request, job.controller.signal);
          if (retired(job)) return;
          const value = safeValue(result, job.request.method === 'get_map_v1');
          availability.reached('roborock', span.context);
          settle(job, {ok: true, value, observedAt: new Date(clock.now()).toISOString()});
          return;
        } catch (error) {
          if (retired(job)) return;
          if (error instanceof ConnectionFailure && attempt === 0) {
            await backoff(job);
            if (retired(job)) return;
            if (nextId > 65535) nextId = 1;
            job.request = {...job.request, id: nextId++, seq: randomBytes(4).readUInt32BE(0), seconds: Math.floor(clock.now() / 1000), nonce: randomBytes(16)};
            continue;
          }
          const code = error instanceof SdkError ? error.body.error.code : 'internal';
          availability.unreachable('roborock', code, span.context);
          span.end('error'); settle(job, failed(code)); return;
        }
      }
    } finally { span.end(); }
  }
  function drain(): void {
    if (stopped || active !== undefined) return;
    const job = queue.shift(); if (job === undefined) return;
    active = job; void execute(job);
  }
  function enqueue(method: WireRequest['method'], params: readonly unknown[], options: ReadOptions = {}): Promise<Reading<VendorJson | Buffer>> {
    if (stopped || options.signal?.aborted === true) return Promise.resolve(failed('cancelled'));
    const timeout = options.timeoutMs ?? 10000;
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 30000) return Promise.resolve(failed('invalid-request'));
    if (nextId > 65535) nextId = 1;
    if (active !== undefined && queue.length >= 8) return Promise.resolve(failed('capacity'));
    return new Promise(resolve => {
      const job: Job = {request: {method, params, id: nextId++, seq: randomBytes(4).readUInt32BE(0), seconds: Math.floor(clock.now() / 1000), nonce: randomBytes(16)}, options, controller: new AbortController(), resolve, dispose: () => {}, settled: false, generation, span: undefined};
      const abort = (): void => { settle(job, failed('cancelled')); };
      const cancelDeadline = scheduler.after(timeout, () => {settle(job, failed('unavailable'));});
      options.signal?.addEventListener('abort', abort, {once: true});
      job.dispose = () => {cancelDeadline(); options.signal?.removeEventListener('abort', abort);};
      queue.push(job); drain();
    });
  }
  function json(method: WireRequest['method'], params: readonly unknown[], options?: ReadOptions): Promise<Reading<VendorJson>> {
    return enqueue(method, params, options) as Promise<Reading<VendorJson>>;
  }
  return {
    readStatus: options => json('get_status', [], options),
    readConsumables: options => json('get_consumable', [], options),
    readCleanSummary: options => json('get_clean_summary', [], options),
    readCleanRecord: (startTime, options) => Number.isInteger(startTime) && startTime >= 0 && startTime <= 0xffffffff ? json('get_clean_record', [startTime], options) : Promise.resolve(failed('invalid-request')),
    readRoomMapping: options => json('get_room_mapping', [], options),
    readCurrentMap: options => enqueue('get_map_v1', [], options) as Promise<Reading<Buffer>>,
    stop: () => {if (stopped) return; stopped = true; generation++; if (active !== undefined) settle(active, failed('cancelled')); for (const job of [...queue]) settle(job, failed('cancelled'));},
  };
}
