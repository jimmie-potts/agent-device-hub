// Copied from apps/hub/src/wispr.ts at bf11587c1a2c575c0da155725a386a209836eed9 (Hub #927).
// File/query behavior is unchanged; completion epochs and cancellation belong to the module port.
import {Worker} from 'node:worker_threads';
import {WisprError} from './common.js';
import type {WisprConfig} from './configuration.js';

export type WisprResponse = {status: number; body: string; csv?: boolean};
export type WisprFence = {namespace: string; generation: string; revision: number};
export type WisprWorkerData = WisprConfig & {fence?: WisprFence};
export type WisprWorkerFactory = (data: WisprWorkerData) => Worker;
export const READ_TIMEOUT_MS = 2500;
export const MAX_PENDING_READS = 32;
type Pending = {resolve: (response: WisprResponse) => void; reject: (error: Error) => void; cancel: () => void};
const unavailable = (): WisprError => new WisprError('wispr-unavailable', 503);

/** One lazy worker owns file bytes; only bounded responses and identity fences cross back. */
export function createWispr(initial: WisprConfig, clock: () => number, workerFactory?: WisprWorkerFactory) {
  const config = {...initial};
  let worker: Worker | undefined, retiring: Promise<number> | undefined, closed = false, sequence = 0, epoch = 0;
  // Authority survives disposable worker failures; no private snapshot or text crosses this seam.
  let fence: WisprFence | undefined;
  const pending = new Map<number, Pending>();
  const rejectAll = (): void => {
    for (const item of pending.values()) { item.cancel(); item.reject(unavailable()); }
    pending.clear();
  };
  const stop = (): Promise<number> | undefined => {
    rejectAll();
    if (worker !== undefined) {
      const old = worker; worker = undefined;
      retiring = old.terminate().finally(() => { retiring = undefined; });
    }
    return retiring;
  };
  const start = (): Worker => {
    if (closed || retiring !== undefined) throw unavailable();
    if (worker !== undefined) return worker;
    const data: WisprWorkerData = {...config, ...(fence === undefined ? {} : {fence})};
    const next = workerFactory?.(data) ?? new Worker(new URL('./wispr-worker.js', import.meta.url), {
      workerData: data, resourceLimits: {maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32},
    });
    worker = next;
    next.on('message', (message: {kind: 'fence'; fence: WisprFence} | {kind?: undefined; id: number; response: WisprResponse}) => {
      if (worker !== next) return;
      if (message.kind === 'fence') { fence = message.fence; return; }
      const item = pending.get(message.id);
      if (item === undefined) return;
      pending.delete(message.id); item.cancel(); item.resolve(message.response);
    });
    next.on('error', () => { if (worker === next) void stop(); });
    next.on('exit', () => { if (worker === next) { worker = undefined; rejectAll(); } });
    return next;
  };
  return {
    config,
    pending: () => pending.size,
    epoch: () => epoch,
    request(route: string, query: string, signal?: AbortSignal): Promise<WisprResponse> {
      if (signal?.aborted === true) throw new WisprError('cancelled', 409);
      if (pending.size >= MAX_PENDING_READS) throw new WisprError('capacity', 429);
      const target = start(), requestId = ++sequence, selectedEpoch = epoch;
      let acceptedFence: WisprFence | undefined;
      return new Promise<WisprResponse>((resolve, reject) => {
        const aborted = (): void => {
          const item = pending.get(requestId);
          if (item === undefined) return;
          pending.delete(requestId); item.cancel(); reject(new WisprError('cancelled', 409));
        };
        const timer = setTimeout(() => { void stop(); }, READ_TIMEOUT_MS);
        const cancel = (): void => { clearTimeout(timer); signal?.removeEventListener('abort', aborted); };
        pending.set(requestId, {resolve: response => { acceptedFence = fence; resolve(response); }, reject, cancel});
        signal?.addEventListener('abort', aborted, {once: true});
        try { target.postMessage({id: requestId, route, query, now: clock(), shareText: config.shareTextAggregates}); }
        catch { pending.delete(requestId); cancel(); reject(unavailable()); }
      }).then(response => {
        if (closed || selectedEpoch !== epoch) throw unavailable();
        if (signal?.aborted === true) throw new WisprError('cancelled', 409);
        if (acceptedFence !== undefined && fence !== undefined && (acceptedFence.namespace !== fence.namespace || acceptedFence.generation !== fence.generation)) throw unavailable();
        return response;
      });
    },
    privacy(exposeToDashboard: boolean, shareTextAggregates: boolean): void {
      if (typeof exposeToDashboard !== 'boolean' || typeof shareTextAggregates !== 'boolean') throw new WisprError('invalid-request', 400);
      epoch += 1;
      config.exposeToDashboard = exposeToDashboard; config.shareTextAggregates = shareTextAggregates;
      rejectAll(); worker?.postMessage({kind: 'privacy', shareText: shareTextAggregates});
    },
    async close(): Promise<void> { closed = true; epoch += 1; await stop(); },
  };
}
