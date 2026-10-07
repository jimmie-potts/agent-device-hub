/** Times are monotonic milliseconds within one process, not wall-clock dates. */
export interface Clock {
  now(): number;
  /** Schedule asynchronously, including zero delay. Return an idempotent cancel function. */
  schedule(delayMs: number, callback: () => void): () => void;
}
export interface OperationOptions {
  generation: number;
  /** Includes time waiting for the writer. Defaults to 5000ms. */
  timeoutMs?: number;
  signal?: AbortSignal;
}
export interface Timing {
  submittedAtMs: number;
  startedAtMs: number | null;
  completedAtMs: number;
  queueMs: number;
  serviceMs: number;
}
export type FailureCode = 'invalid-input' | 'offline' | 'upload-failed' | 'cancelled' | 'timeout' | 'stale-generation' | 'http-error' | 'device-error' | 'protocol-error';
export type OperationResult<T> = { generation: number; timing: Timing } & (
  | { ok: true; value: T }
  | { ok: false; code: FailureCode; priorEffects: 'none' | 'possible'; details?: { httpStatus?: number; deviceCode?: number } }
);
export interface RgbFrame { readonly rgb: Uint8Array; readonly delayMs: number }
export interface Animation { readonly frames: readonly RgbFrame[] }
export type ProbeResult = { mode: 'simulator'; available: true; connected: false }
  | { mode: 'device'; available: true; connected: true; channel: number; brightness?: number; screenOn?: boolean };
export interface UploadResult { estimatedReadyAtMs: number }
export interface DeviceAdapter {
  readonly generation: number;
  invalidateGeneration(): number;
  probe(options: OperationOptions): Promise<OperationResult<ProbeResult>>;
  uploadAnimation(animation: Animation, options: OperationOptions): Promise<OperationResult<UploadResult>>;
  setBrightness(percent: number, options: OperationOptions): Promise<OperationResult<void>>;
  setScreen(on: boolean, options: OperationOptions): Promise<OperationResult<void>>;
}
export const systemClock: Clock = {
  now: () => performance.now(),
  schedule: (delayMs, callback) => {
    if (!Number.isFinite(delayMs) || delayMs < 0) throw new RangeError('Delay must be finite and nonnegative');
    const deadline = performance.now() + delayMs;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      // Native timers cannot represent intervals longer than a signed 32-bit integer.
      timer = setTimeout(() => {
        if (cancelled) return;
        if (performance.now() < deadline) arm();
        else callback();
      }, Math.min(2 ** 31 - 1, Math.ceil(Math.max(0, deadline - performance.now()))));
    };
    arm();
    return () => { cancelled = true; clearTimeout(timer); };
  },
};
