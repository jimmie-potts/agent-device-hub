import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {ErrorBody} from '@jimmie-potts/event-contracts/v2/errors';
import type {Scheduler, SyncHandler, SyncResult, SyncedCopy} from '@jimmie-potts/sdk/remote';

export type TidbytView = {device: DeviceRecord | undefined; live: boolean; pending: boolean; error: string | undefined};
type Refusal = {code: string; retryable: boolean};
/** A refused or failed read is repeated after a second, doubling to half a minute, as the shell repeats its own copies. */
const FIRST_RETRY_MS = 1000;
const MAX_RETRY_MS = 30_000;
const timers: Scheduler = {after: (delayMs, callback) => {
  const timer = setTimeout(callback, delayMs);
  return () => { clearTimeout(timer); };
}};
const refusalOf = ({error}: ErrorBody): Refusal => ({code: error.code, retryable: error.retryable});
const thrown = (error: unknown): Refusal => {
  if (typeof error === 'object' && error !== null && 'body' in error) {
    const body = error.body;
    if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'object' && body.error !== null
      && 'code' in body.error && typeof body.error.code === 'string') {
      return {code: body.error.code, retryable: 'retryable' in body.error && body.error.retryable === true};
    }
  }
  return {code: 'unavailable', retryable: true};
};

/**
 * The supplied API is already scoped to bunny/modules/tidbyt on the shell participant. Each read is a new copy whose
 * complete snapshot replaces membership before it is shown as current. A refused or failed read keeps the saved
 * evidence stale with its registry code; when the code may clear, the read is repeated with capped backoff until one
 * succeeds (ADR 0012 retries: a sync is only a read, and no command is ever sent).
 */
export function followTidbyt(
  sync: (changed: SyncHandler<DeviceRecord>) => Promise<SyncResult<DeviceRecord>>, saved: DeviceRecord | undefined, emit: (view: TidbytView) => void,
  scheduler: Scheduler = timers,
): () => void {
  let disposed = false, live = false;
  let copy: SyncedCopy<DeviceRecord> | undefined;
  let retryMs = FIRST_RETRY_MS;
  let cancelRetry = (): void => {};
  const records = new Map<string, DeviceRecord>();
  if (saved !== undefined) records.set(saved.id, saved);
  const show = (pending = false, error?: string): void => {
    if (disposed) return;
    const devices = [...records.values()].filter(value => value.kind === 'tidbyt');
    emit({device: devices.length === 1 ? devices[0] : undefined, live, pending, error});
  };
  const replace = (): void => {
    records.clear();
    for (const message of copy?.states() ?? []) records.set(message.data.id, message.data);
  };
  const current = (): void => {
    replace(); live = true; retryMs = FIRST_RETRY_MS; show();
  };
  // A refusal that cannot clear, such as forbidden, waits for Retry records or a change of connection.
  const refused = ({code, retryable}: Refusal): void => {
    live = false; show(false, code);
    if (disposed || !retryable) return;
    const delayMs = retryMs;
    retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
    cancelRetry = scheduler.after(delayMs, read);
  };
  function read(): void {
    if (disposed) return;
    let own: SyncedCopy<DeviceRecord> | undefined, failed = false;
    const stop = (refusal: Refusal): void => {
      failed = true;
      if (own !== undefined && copy === own) copy = undefined;
      void own?.close();
      refused(refusal);
    };
    void sync(change => {
      if (disposed || failed) return;
      if (change.type === 'failed') { stop(refusalOf(change.error)); return; }
      // Initial callbacks precede the returned copy; commit that complete snapshot in the promise below.
      if (own === undefined) return;
      if (change.type === 'synced') { current(); return; }
      if (change.type === 'updated') records.set(change.entity.id, change.message.data);
      else records.delete(change.entity.id);
      show();
    }).then(result => {
      if (result.status === 'rejected') { if (!failed) stop(refusalOf(result.error)); return; }
      if (disposed || failed) { void result.copy.close(); return; }
      own = result.copy; copy = own;
      current();
    }).catch((error: unknown) => { if (!failed) stop(thrown(error)); });
  }
  show(true);
  read();
  return () => { disposed = true; cancelRetry(); void copy?.close(); };
}
