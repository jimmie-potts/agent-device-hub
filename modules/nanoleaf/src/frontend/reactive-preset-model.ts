import type {SyncHandler, SyncResult, SyncedCopy} from '@jimmie-potts/sdk/remote';
import {REACTIVE_TARGET, reactiveCatalog, type ReactiveCatalog} from '../music-preset-data.js';

export type ReactiveCatalogView = {value: ReactiveCatalog | undefined; live: boolean; pending: boolean; failed: boolean};
export type ReactiveSync = (changed: SyncHandler<ReactiveCatalog>, options: {onRestarted: () => void}) => Promise<SyncResult<ReactiveCatalog>>;

/** One module-page catalog copy, with no timers, commands or second participant. */
export function followReactivePresets(sync: ReactiveSync, show: (view: ReactiveCatalogView) => void, retained?: ReactiveCatalog): () => void {
  let disposed = false, copy: SyncedCopy<ReactiveCatalog> | undefined;
  let completed = false, restarted = false;
  let view: ReactiveCatalogView = {value: retained, live: false, pending: true, failed: false};
  const update = (next: ReactiveCatalogView): void => {view = next; if (!disposed) show(next);};
  const stale = (): void => {completed = false; restarted = true; update({...view, live: false, pending: true});};
  const failed = (): void => {completed = false; restarted = true; update({...view, live: false, pending: false, failed: true});};
  const snapshot = (qualified: boolean): void => {
    if (copy === undefined) return;
    const received = copy.states().find(message => message.data.id === REACTIVE_TARGET)?.data;
    let value: ReactiveCatalog | undefined;
    if (received !== undefined) {
      try {value = reactiveCatalog(received);} catch {failed(); return;}
    }
    update({value, live: qualified && value !== undefined, pending: !qualified && view.pending, failed: value === undefined || !qualified && view.failed});
  };
  update(view);
  void sync(change => {
    if (disposed) return;
    if (change.type === 'failed') {failed(); return;}
    if (change.type === 'updated' && change.message.data.id === REACTIVE_TARGET) {
      try {update({...view, value: reactiveCatalog(change.message.data)});} catch {failed();}
    }
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

export function canSaveReactive(options: {control: boolean; connected: boolean; catalogLive: boolean; operationsLive: boolean;
  locked: boolean; sending: boolean; valid: boolean; full: boolean; unchanged: boolean}): boolean {
  return options.control && options.connected && options.catalogLive && options.operationsLive && !options.locked
    && !options.sending && options.valid && !options.full && !options.unchanged;
}
