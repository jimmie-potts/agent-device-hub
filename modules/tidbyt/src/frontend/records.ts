import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {SyncHandler, SyncResult, SyncedCopy} from '@jimmie-potts/sdk/remote';

export type TidbytView = {device: DeviceRecord | undefined; live: boolean; pending: boolean; error: string | undefined};
const codeOf = (error: unknown): string => {
  if (typeof error === 'object' && error !== null && 'body' in error) {
    const body = error.body;
    if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'object' && body.error !== null
      && 'code' in body.error && typeof body.error.code === 'string') return body.error.code;
  }
  return 'unavailable';
};

/** The supplied API is already scoped to bunny/modules/tidbyt on the shell participant. */
export function followTidbyt(sync: (changed: SyncHandler<DeviceRecord>) => Promise<SyncResult<DeviceRecord>>, saved: DeviceRecord | undefined, emit: (view: TidbytView) => void): () => void {
  let disposed = false, live = false;
  let failure: string | undefined;
  let copy: SyncedCopy<DeviceRecord> | undefined;
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
  show(true);
  void sync(change => {
    if (disposed || failure !== undefined) return;
    if (change.type === 'failed') { failure = change.error.error.code; live = false; show(false, failure); return; }
    // Initial callbacks precede the returned copy; commit that complete snapshot in the promise below.
    if (copy === undefined) return;
    if (change.type === 'synced') { replace(); live = true; }
    else if (change.type === 'updated') records.set(change.entity.id, change.message.data);
    else records.delete(change.entity.id);
    show();
  }).then(result => {
    if (result.status === 'rejected') { live = false; show(false, result.error.error.code); return; }
    copy = result.copy;
    if (disposed) { void copy.close(); return; }
    replace(); live = failure === undefined; show(false, failure);
  }).catch((error: unknown) => { live = false; failure = codeOf(error); show(false, failure); });
  return () => { disposed = true; void copy?.close(); };
}
