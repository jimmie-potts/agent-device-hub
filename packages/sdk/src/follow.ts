// One page copy that reads again after a refusal that may clear (Hub #1540). A sync only reads, so ADR 0012 lets it
// repeat with capped backoff; nothing here sends, repeats or replays a command.
import type {ErrorBody} from '@jimmie-potts/event-contracts/v2/errors';
import type {Cancel, Scheduler} from './sdk.js';
import type {SyncChange, SyncedCopy, SyncHandler, SyncResult} from './sync.js';

/** The first repeat waits a second and each later one twice as long, up to half a minute: the dashboard shell's own backoff. */
export const FIRST_READ_RETRY_MS = 1000;
export const MAX_READ_RETRY_MS = 30_000;

/** Why a read ended: its registry code, and whether that code says the condition may clear. */
export type ReadRefusal = {readonly code: string; readonly retryable: boolean};
/** One sync of the page's families. Each call opens a new copy; `onRestarted` belongs to that copy alone. */
export type CopyRead<T> = (changed: SyncHandler<T>, options: {onRestarted: () => void}) => Promise<SyncResult<T>>;
export type CopyHandlers<T> = {
  /**
   * Each change of the current read except its failure, in order. Changes that arrive before the read returns its copy
   * pass `copy` as undefined.
   */
  changed?: (change: Exclude<SyncChange<T>, {type: 'failed'}>, copy: SyncedCopy<T> | undefined) => void;
  /** The current read's copy restarted its sync after an overflow. It stays the current read. */
  restarted?: () => void;
  /** The current read returned its copy with a complete snapshot. The backoff starts again from its first delay. */
  current: (copy: SyncedCopy<T>) => void;
  /**
   * The current read was refused, its copy failed or the call threw. Its copy is closed. A retryable refusal is read
   * again after the backoff delay; any other waits for the page to start a new follow, such as from its Retry control.
   */
  refused: (refusal: ReadRefusal) => void;
};

const timers: Scheduler = {after: (delayMs, callback) => {
  const timer = setTimeout(callback, delayMs);
  return () => { clearTimeout(timer); };
}};
const fromBody = ({error}: ErrorBody): ReadRefusal => ({code: error.code, retryable: error.retryable});

/**
 * The refusal a thrown read reports. An error that carries a registry body, such as an `SdkError`, keeps that body's
 * code and flag; any other failure is the retryable `unavailable`.
 */
export function readRefusal(error: unknown): ReadRefusal {
  if (typeof error === 'object' && error !== null && 'body' in error) {
    const body = error.body;
    if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'object' && body.error !== null
      && 'code' in body.error && typeof body.error.code === 'string') {
      return {code: body.error.code, retryable: 'retryable' in body.error && body.error.retryable === true};
    }
  }
  return {code: 'unavailable', retryable: true};
}

/**
 * Follows one copy for a mounted page. A read that is refused, fails or throws is closed and reported; when its code
 * may clear, a new read starts after 1 s, doubling to 30 s, until one returns its copy. The returned function stops
 * following: it cancels a pending read, closes the current copy and closes a copy that returns later. After it runs,
 * no handler is called.
 */
export function followCopy<T>(read: CopyRead<T>, handlers: CopyHandlers<T>, scheduler: Scheduler = timers): () => void {
  let disposed = false;
  let delayMs = FIRST_READ_RETRY_MS;
  let cancel: Cancel = () => {};
  let held: SyncedCopy<T> | undefined;
  const attempt = (): void => {
    if (disposed) return;
    let own: SyncedCopy<T> | undefined, ended = false;
    const end = (refusal: ReadRefusal): void => {
      ended = true;
      if (own !== undefined && held === own) held = undefined;
      void own?.close();
      if (disposed) return;
      handlers.refused(refusal);
      if (disposed || !refusal.retryable) return;
      const wait = delayMs;
      delayMs = Math.min(delayMs * 2, MAX_READ_RETRY_MS);
      cancel = scheduler.after(wait, attempt);
    };
    let pending: Promise<SyncResult<T>>;
    try {
      pending = read(change => {
        if (disposed || ended) return;
        if (change.type === 'failed') { end(fromBody(change.error)); return; }
        handlers.changed?.(change, own);
      }, {onRestarted: () => { if (!disposed && !ended) handlers.restarted?.(); }});
    } catch (error) {
      pending = Promise.reject(error);
    }
    void pending.then(result => {
      if (result.status === 'rejected') { if (!ended) end(fromBody(result.error)); return; }
      if (disposed || ended) { void result.copy.close(); return; }
      own = result.copy; held = own; delayMs = FIRST_READ_RETRY_MS;
      handlers.current(own);
    }).catch((error: unknown) => { if (!ended) end(readRefusal(error)); });
  };
  attempt();
  return () => { disposed = true; cancel(); void held?.close(); };
}
