import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {followCopy, type CopyRead, type Scheduler, type SyncedCopy} from '@jimmie-potts/sdk/remote';

export type TidbytView = {device: DeviceRecord | undefined; live: boolean; pending: boolean; error: string | undefined};

/**
 * The supplied API is already scoped to bunny/modules/tidbyt on the shell participant. Each read is a new copy whose
 * complete snapshot replaces membership before it is shown as current. A refused or failed read keeps the saved
 * evidence stale with its registry code; when the code may clear, the shared follower reads again after a second,
 * doubling to half a minute, as the shell repeats its own copies (ADR 0012 retries: a sync is only a read, and no
 * command is ever sent).
 */
export function followTidbyt(sync: CopyRead<DeviceRecord>, saved: DeviceRecord | undefined, emit: (view: TidbytView) => void, scheduler?: Scheduler): () => void {
  let live = false;
  let copy: SyncedCopy<DeviceRecord> | undefined;
  const records = new Map<string, DeviceRecord>();
  if (saved !== undefined) records.set(saved.id, saved);
  const show = (pending = false, error?: string): void => {
    const devices = [...records.values()].filter(value => value.kind === 'tidbyt');
    emit({device: devices.length === 1 ? devices[0] : undefined, live, pending, error});
  };
  const current = (): void => {
    records.clear();
    for (const message of copy?.states() ?? []) records.set(message.data.id, message.data);
    live = true; show();
  };
  show(true);
  return followCopy<DeviceRecord>(sync, {
    changed: change => {
      // Initial callbacks precede the returned copy; commit that complete snapshot when it returns.
      if (copy === undefined) return;
      if (change.type === 'synced') { current(); return; }
      if (change.type === 'updated') records.set(change.entity.id, change.message.data);
      else records.delete(change.entity.id);
      show();
    },
    current: returned => { copy = returned; current(); },
    // A refusal that cannot clear, such as forbidden, waits for Retry records or a change of connection.
    refused: ({code}) => { copy = undefined; live = false; show(false, code); },
  }, scheduler);
}
