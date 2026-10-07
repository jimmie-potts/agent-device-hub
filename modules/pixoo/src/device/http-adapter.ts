import {
  systemClock, type Animation, type Clock, type DeviceAdapter, type FailureCode,
  type OperationOptions, type OperationResult, type ProbeResult, type UploadResult,
} from './contracts.js';
import { snapshotAnimation } from './frames.js';
import type {HostedFiles} from './hosted-files.js';
import { createDeviceTransport, DeviceRequestError, validateDeviceIp, type DeviceTransport } from './http-transport.js';

export interface DeviceProfile {
  name: string;
  evidence: 'unverified' | 'observed';
  maxFrames: number;
  minDelayMs: number;
  maxDelayMs: number;
  uniformTiming: boolean;
  readyDelayMs: number;
}
/** Application experiment bounds, not firmware limits or a tested hardware profile. */
export const SPIKE_PROFILE: Readonly<DeviceProfile> = Object.freeze({
  name: 'two-frame-smoke', evidence: 'unverified', maxFrames: 2,
  minDelayMs: 100, maxDelayMs: 1000, uniformTiming: true, readyDelayMs: 0,
});
interface HttpOptions { ip: string; profile: DeviceProfile; clock?: Clock; hosted?:{files:HostedFiles;encode(animation:Animation):Uint8Array} }
interface Work { start(): void; cancel(code: FailureCode): void }
interface Context { signal:AbortSignal;check():void;send(body: Record<string, unknown>, mutating?: boolean): Promise<Record<string, unknown>> }
function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}
function field(value: unknown, min: number, max: number): number {
  if (!integer(value, min, max)) throw new DeviceRequestError('protocol-error');
  return value;
}

export class HttpDeviceAdapter implements DeviceAdapter {
  private readonly transport: DeviceTransport;
  private readonly clock: Clock;
  private readonly profile: DeviceProfile;
  private currentGeneration = 0;
  private closed=false;
  private idle: (()=>void)[]=[];
  private waiting: Work[] = [];
  private active: Work | undefined;
  constructor(private readonly options: HttpOptions, transportForTests?: DeviceTransport) {
    validateDeviceIp(options.ip);
    this.profile = { ...options.profile };
    const p = this.profile;
    if (typeof p.name !== 'string' || p.name === '' || !['unverified', 'observed'].includes(p.evidence) || !integer(p.maxFrames, 1, Number.MAX_SAFE_INTEGER) ||
      !integer(p.minDelayMs, 1, 2 ** 31 - 1) || !integer(p.maxDelayMs, p.minDelayMs, 2 ** 31 - 1) ||
      typeof p.uniformTiming !== 'boolean' || !Number.isFinite(p.readyDelayMs) || p.readyDelayMs < 0) throw new TypeError('Invalid device profile');
    this.transport = transportForTests ?? createDeviceTransport(options.ip);
    this.clock = options.clock ?? systemClock;
  }
  get generation() { return this.currentGeneration; }
  invalidateGeneration(): number {
    if (this.currentGeneration === Number.MAX_SAFE_INTEGER) throw new RangeError('Generation exhausted');
    this.currentGeneration++;
    for (const work of [this.active, ...this.waiting]) work?.cancel('stale-generation');
    return this.currentGeneration;
  }
  probe(options: OperationOptions): Promise<OperationResult<ProbeResult>> {
    return this.enqueue(options, true, async context => {
      const channel = field((await context.send({ Command: 'Channel/GetIndex' })).SelectIndex, 0, 2 ** 31 - 1);
      const settings = await context.send({ Command: 'Channel/GetAllConf' });
      const result: ProbeResult = { mode: 'device', available: true, connected: true, channel };
      if (settings.Brightness !== undefined) result.brightness = field(settings.Brightness, 0, 100);
      if (settings.LightSwitch !== undefined) result.screenOn = field(settings.LightSwitch, 0, 1) === 1;
      return result;
    });
  }
  uploadAnimation(animation: Animation, options: OperationOptions): Promise<OperationResult<UploadResult>> {
    const p = this.profile;
    const snapshot = Array.isArray(animation?.frames) && animation.frames.length <= p.maxFrames ? snapshotAnimation(animation) : undefined;
    const valid = !!snapshot && snapshot.frames.length <= p.maxFrames && snapshot.frames.every(frame =>
      frame.delayMs >= p.minDelayMs && frame.delayMs <= p.maxDelayMs && (!p.uniformTiming || frame.delayMs === snapshot.frames[0]?.delayMs));
    return this.enqueue(options, valid, async context => {
      // enqueue runs only valid work, which always has a snapshot.
      if(snapshot===undefined)throw new DeviceRequestError('invalid-input');
      if(this.options.hosted&&snapshot.frames.length>1){
        const bytes=this.options.hosted.encode(snapshot);context.check();
        const file=this.options.hosted.files.publish(bytes,context.signal);
        try{
          await context.send({Command:'Device/PlayTFGif',FileType:2,FileName:file.url},true);
          await file.transferred;context.check();
          return {estimatedReadyAtMs:this.clock.now()+p.readyDelayMs};
        }finally{file.revoke();}
      }
      const id = field((await context.send({ Command: 'Draw/GetHttpGifId' })).PicId, 0, 2 ** 31 - 1);
      for (const [offset, frame] of snapshot.frames.entries()) {
        await context.send({ Command: 'Draw/SendHttpGif', PicNum: snapshot.frames.length, PicWidth: 64,
          PicOffset: offset, PicID: id, PicSpeed: frame.delayMs, PicData: Buffer.from(frame.rgb).toString('base64') }, true);
      }
      return { estimatedReadyAtMs: this.clock.now() + p.readyDelayMs };
    });
  }
  setBrightness(percent: number, options: OperationOptions): Promise<OperationResult<void>> {
    return this.enqueue(options, integer(percent, 0, 100), async context => {
      await context.send({ Command: 'Channel/SetBrightness', Brightness: percent }, true);
    });
  }
  setScreen(on: boolean, options: OperationOptions): Promise<OperationResult<void>> {
    return this.enqueue(options, typeof on === 'boolean', async context => {
      await context.send({ Command: 'Channel/OnOffScreen', OnOff: on ? 1 : 0 }, true);
    });
  }
  /** Explicit experiment only. Never called as automatic recovery. */
  resetAnimationIds(options: OperationOptions): Promise<OperationResult<void>> {
    return this.enqueue(options, true, async context => { await context.send({ Command: 'Draw/ResetHttpGifId' }, true); });
  }
  async close():Promise<void> {
    this.closed=true;
    for(const work of [this.active,...this.waiting])work?.cancel('cancelled');
    if(this.active||this.waiting.length!==0)await new Promise<void>(resolve=>this.idle.push(resolve));
  }
  private pump() {
    if (this.active) return;
    this.active = this.waiting.shift();
    this.active?.start();
    if(!this.active&&this.waiting.length===0)for(const resolve of this.idle.splice(0))resolve();
  }
  private enqueue<T>(options: OperationOptions, valid: boolean, run: (context: Context) => Promise<T>): Promise<OperationResult<T>> {
    const generation = options.generation;
    const submittedAtMs = this.clock.now();
    const timeoutMs = options.timeoutMs ?? 5000;
    const deadline = submittedAtMs + timeoutMs;
    const signal = options.signal;
    const controller = new AbortController();
    let reason: FailureCode | undefined;
    let startedAtMs: number | null = null;
    let priorEffects: 'none' | 'possible' = 'none';
    let done = false;
    let cancelTimer = () => {};
    return new Promise(resolve => {
      const interrupted = (): FailureCode | undefined => reason ??
        (this.closed?'cancelled':generation !== this.currentGeneration ? 'stale-generation' : signal?.aborted === true ? 'cancelled' : this.clock.now() >= deadline ? 'timeout' : undefined);
      const finish = (value?: T, error?: DeviceRequestError) => {
        if (done) return;
        done = true; cancelTimer(); signal?.removeEventListener('abort', abort);
        const completedAtMs = this.clock.now();
        const timing = { submittedAtMs, startedAtMs, completedAtMs, queueMs: (startedAtMs ?? completedAtMs) - submittedAtMs,
          serviceMs: startedAtMs === null ? 0 : completedAtMs - startedAtMs };
        const code = reason ?? error?.code;
        resolve(code !== undefined ? { ok: false, code, priorEffects, generation, timing, ...(error?.details && { details: error.details }) }
          : { ok: true, value: value as T, generation, timing });
        this.waiting = this.waiting.filter(item => item !== work);
        if (this.active === work) this.active = undefined;
        this.pump();
      };
      const cancel = (code: FailureCode) => {
        if (done || reason !== undefined) return;
        reason = code; controller.abort();
        if (startedAtMs === null) finish();
      };
      const abort = () => { cancel('cancelled'); };
      const context: Context = {signal:controller.signal,check:()=>{const code=interrupted();if(code!==undefined)throw new DeviceRequestError(code);},send: async (body, mutating = false) => {
        const code = interrupted(); if (code !== undefined) throw new DeviceRequestError(code);
        if (mutating) priorEffects = 'possible';
        const response = await this.transport(body, controller.signal);
        const after = interrupted(); if (after !== undefined) throw new DeviceRequestError(after);
        return response;
      } };
      const work: Work = { cancel, start: () => {
        startedAtMs = this.clock.now();
        const code = interrupted();
        if (code !== undefined) { finish(undefined, new DeviceRequestError(code)); return; }
        void run(context).then(value => finish(value), error => finish(undefined,
          error instanceof DeviceRequestError ? error : new DeviceRequestError('protocol-error')));
      } };
      if (!valid || !integer(generation, 0, Number.MAX_SAFE_INTEGER) || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(deadline)) {
        finish(undefined, new DeviceRequestError('invalid-input')); return;
      }
      const code = this.closed?'cancelled':interrupted(); if (code !== undefined) { finish(undefined, new DeviceRequestError(code)); return; }
      signal?.addEventListener('abort', abort, { once: true });
      cancelTimer = this.clock.schedule(timeoutMs, () => { cancel('timeout'); });
      this.waiting.push(work); this.pump();
    });
  }
}
