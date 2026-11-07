import {followCopy, type CopyRead, type Scheduler} from '@jimmie-potts/sdk/remote';
import type {MicroDuckState} from '../contracts.js';

/** The page shows `state` only while `live`. */
export type MicroDuckView = {state?: MicroDuckState; live: boolean};

/**
 * Follows the MicroDuck state copy on the shell participant. A refused or failed read leaves the state unavailable and
 * every control disabled; a refusal that may clear is read again with the shared backoff. Only the read repeats: a
 * control, gesture or Stop request is never sent again.
 */
export function followMicroDuck(read: CopyRead<MicroDuckState>, emit: (view: MicroDuckView) => void, scheduler?: Scheduler): () => void {
  let current: MicroDuckState | undefined, live = false;
  const show = (): void => { emit({...(current === undefined ? {} : {state: current}), live}); };
  const lost = (): void => { live = false; current = undefined; show(); };
  show();
  return followCopy<MicroDuckState>(read, {
    changed: change => {
      if (change.type === 'removed') { lost(); return; }
      if (change.type === 'synced') live = true;
      else if (current === undefined || change.message.data.revision > current.revision) current = change.message.data;
      show();
    },
    restarted: lost,
    current: copy => { current = copy.states()[0]?.data; live = true; show(); },
    refused: lost,
  }, scheduler);
}
