import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {CopyRead, Scheduler, SyncChange, SyncedCopy} from '@jimmie-potts/sdk/remote';
import type {WallRecord} from './model.js';

export type CatalogRecord = DeviceRecord | WallRecord;
export type Catalog = {live: boolean; pending: boolean; error: boolean; walls: WallRecord[]; devices: DeviceRecord[]};

/** One wall catalog copy over the kept records, which stay explicitly stale after a failure. No polling or second connection. */
export function followCatalog(read: CopyRead<CatalogRecord>, records: Map<string, CatalogRecord>, emit: (catalog: Catalog) => void, _scheduler?: Scheduler): () => void {
  let disposed = false, live = false;
  let copy: SyncedCopy<CatalogRecord> | undefined;
  const show = (error = false): void => {
    if (disposed) return;
    const values = [...records.values()];
    emit({live, error, pending: false,
      walls: values.filter((value): value is WallRecord => 'elements' in value).sort((a, b) => a.id.localeCompare(b.id)),
      devices: values.filter((value): value is DeviceRecord => 'capabilities' in value && value.kind === 'nanoleaf'),
    });
  };
  const changed = (change: SyncChange<CatalogRecord>): void => {
    if (disposed) return;
    switch (change.type) {
      case 'updated': records.set(`${change.entity.family}/${change.entity.id}`, change.message.data); show(); break;
      case 'removed': records.delete(`${change.entity.family}/${change.entity.id}`); show(); break;
      case 'synced': live = true; show(); break;
      case 'failed': live = false; show(true); break;
    }
  };
  void read(changed, {onRestarted: () => {}}).then(result => {
    if (result.status === 'rejected') { show(true); return; }
    if (disposed) { void result.copy.close(); return; }
    copy = result.copy;
    records.clear();
    for (const state of copy.states()) records.set(`${'elements' in state.data ? 'nanoleaf-wall' : 'device'}/${state.data.id}`, state.data);
    live = true; show();
  }).catch(() => { live = false; show(true); });
  return () => { disposed = true; void copy?.close(); };
}
