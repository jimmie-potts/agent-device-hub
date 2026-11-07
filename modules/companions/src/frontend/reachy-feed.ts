import type {CompanionState} from '@jimmie-potts/event-contracts/v2/companions';
import {followCopy, type CopyRead, type Scheduler, type SyncedCopy} from '@jimmie-potts/sdk/remote';

/** What Reachy's copy reports to its page and to speech's final check. */
export type ReachyFeed = {
  /** A live record before the copy is current again. */
  updated: (state: CompanionState) => void;
  /** The copy holds Reachy's complete current record. */
  current: (state: CompanionState) => void;
  /** Reachy's record is unavailable: refused, failed or removed. */
  unavailable: () => void;
  /** The copy restarted its sync and is not current until it completes. */
  restarted: () => void;
};

/**
 * Follows Reachy's companion state on the shell participant. A refused or failed read leaves Reachy unavailable and
 * speech not live; a refusal that may clear is read again with the shared backoff. Only the read repeats: no setting,
 * fixture or speech command is sent again.
 */
export function followReachy(read: CopyRead<CompanionState>, feed: ReachyFeed, scheduler?: Scheduler): () => void {
  let replacing = false;
  let copy: SyncedCopy<CompanionState> | undefined;
  const show = (): void => {
    const current = copy?.states().find(message => message.data.id === 'reachy');
    if (current !== undefined) feed.current(current.data);
    else feed.unavailable();
  };
  return followCopy<CompanionState>(read, {
    changed: (change, own) => {
      if (change.type === 'updated') feed.updated(change.message.data);
      else if (change.type === 'synced') {replacing = false; if (own !== undefined) show();}
      else if (change.entity.id === 'reachy') feed.unavailable();
    },
    restarted: () => {replacing = true; feed.restarted();},
    current: returned => {copy = returned; if (!replacing) show();},
    // The next read is a new copy, so it waits for no earlier restart.
    refused: () => {copy = undefined; replacing = false; feed.unavailable();},
  }, scheduler);
}
