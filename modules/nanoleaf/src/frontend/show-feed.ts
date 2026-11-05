import type {SyncHandler, SyncResult, SyncedCopy} from '@jimmie-potts/sdk/remote';
import {SHOW_TARGET, type ShowCatalog} from '../music-show-data.js';

export type CatalogView = {value: ShowCatalog | undefined; live: boolean; pending: boolean; failed: boolean};
export type ShowSync = (changed: SyncHandler<ShowCatalog>, options: {onRestarted: () => void}) => Promise<SyncResult<ShowCatalog>>;

/** One module-page catalog copy, with no timers, commands or second participant. */
export function followShows(sync: ShowSync, show: (view: CatalogView) => void, retained?: ShowCatalog): () => void {
  let disposed = false, copy: SyncedCopy<ShowCatalog> | undefined;
  let completed = false, restarted = false;
  let view: CatalogView = {value: retained, live: false, pending: true, failed: false};
  const update = (next: CatalogView): void => {view = next; if (!disposed) show(next);};
  const stale = (): void => {completed = false; restarted = true; update({...view, live: false, pending: true});};
  const failed = (): void => {completed = false; restarted = true; update({...view, live: false, pending: false, failed: true});};
  const snapshot = (qualified: boolean): void => {
    if (copy === undefined) return;
    const value = copy.states().find(message => message.data.id === SHOW_TARGET)?.data;
    update({value, live: qualified && value !== undefined, pending: !qualified && view.pending, failed: value === undefined || !qualified && view.failed});
  };
  update(view);
  void sync(change => {
    if (disposed) return;
    if (change.type === 'failed') {failed(); return;}
    if (change.type === 'updated' && change.message.data.id === SHOW_TARGET) update({...view, value: change.message.data});
    if (change.type === 'removed') {completed = false; restarted = true; update({value: undefined, live: false, pending: false, failed: true});}
    if (change.type === 'synced') {completed = true; snapshot(true);}
  }, {onRestarted: stale}).then(result => {
    if (result.status === 'rejected') {failed(); return;}
    if (disposed) {void result.copy.close(); return;}
    copy = result.copy;
    snapshot(completed || !restarted);
  }).catch(failed);
  return () => {disposed = true; void copy?.close();};
}
