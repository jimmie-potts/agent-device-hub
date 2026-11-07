import type {CopyRead, Scheduler, SyncedCopy} from '@jimmie-potts/sdk/remote';
import type {MicroDuckState} from '../contracts.js';

/** The page shows `state` only while `live`. */
export type MicroDuckView = {state?: MicroDuckState; live: boolean};

/** Follows the MicroDuck state copy on the shell participant. */
export function followMicroDuck(read: CopyRead<MicroDuckState>, emit: (view: MicroDuckView) => void, _scheduler?: Scheduler): () => void {
  let closed = false, current: MicroDuckState | undefined, copy: SyncedCopy<MicroDuckState> | undefined, live = false;
  const show = (): void => { if (!closed) emit({...(current === undefined ? {} : {state: current}), live}); };
  show();
  void read(change => {
    if (closed) return;
    if (change.type === 'updated') { if (current === undefined || change.message.data.revision > current.revision) current = change.message.data; }
    else if (change.type === 'synced') live = true;
    else { live = false; current = undefined; }
    show();
  }, {onRestarted: () => { live = false; current = undefined; show(); }}).then(result => {
    if (result.status !== 'synced') return;
    if (closed) { void result.copy.close(); return; }
    copy = result.copy; current = copy.states()[0]?.data; live = true; show();
  }).catch(() => { live = false; show(); });
  return () => { closed = true; void copy?.close(); };
}
