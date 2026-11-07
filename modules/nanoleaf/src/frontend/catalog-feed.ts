import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {followCopy, type CopyRead, type Scheduler} from '@jimmie-potts/sdk/remote';
import type {WallRecord} from './model.js';

export type CatalogRecord = DeviceRecord | WallRecord;
export type Catalog = {live: boolean; pending: boolean; error: boolean; walls: WallRecord[]; devices: DeviceRecord[]};

/**
 * One wall catalog copy over the kept records, which stay explicitly stale after a failure. A refusal that may clear is
 * read again with the shared backoff; any other waits for Retry Nanoleaf records. Only the read repeats, on the
 * shell's participant: no polling, second connection or wall command.
 */
export function followCatalog(read: CopyRead<CatalogRecord>, records: Map<string, CatalogRecord>, emit: (catalog: Catalog) => void, scheduler?: Scheduler): () => void {
  let live = false;
  const show = (error = false): void => {
    const values = [...records.values()];
    emit({live, error, pending: false,
      walls: values.filter((value): value is WallRecord => 'elements' in value).sort((a, b) => a.id.localeCompare(b.id)),
      devices: values.filter((value): value is DeviceRecord => 'capabilities' in value && value.kind === 'nanoleaf'),
    });
  };
  return followCopy<CatalogRecord>(read, {
    changed: change => {
      switch (change.type) {
        case 'updated': records.set(`${change.entity.family}/${change.entity.id}`, change.message.data); show(); break;
        case 'removed': records.delete(`${change.entity.family}/${change.entity.id}`); show(); break;
        case 'synced': live = true; show(); break;
      }
    },
    current: copy => {
      records.clear();
      for (const state of copy.states()) records.set(`${'elements' in state.data ? 'nanoleaf-wall' : 'device'}/${state.data.id}`, state.data);
      live = true; show();
    },
    refused: () => { live = false; show(true); },
  }, scheduler);
}
