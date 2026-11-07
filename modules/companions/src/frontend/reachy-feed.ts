import type {CompanionState} from '@jimmie-potts/event-contracts/v2/companions';
import type {CopyRead, Scheduler, SyncedCopy} from '@jimmie-potts/sdk/remote';

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

/** Follows Reachy's companion state on the shell participant. */
export function followReachy(read: CopyRead<CompanionState>, feed: ReachyFeed, _scheduler?: Scheduler): () => void {
  let active = true;
  let replacing = false;
  let copy: SyncedCopy<CompanionState> | undefined;
  let close: (() => Promise<void>) | undefined;
  const show = (): void => {
    const current = copy?.states().find(message => message.data.id === 'reachy');
    if (current !== undefined) feed.current(current.data);
    else feed.unavailable();
  };
  void read(change => {
    if (!active) return;
    if (change.type === 'updated') feed.updated(change.message.data);
    else if (change.type === 'failed') {replacing = true; feed.unavailable();}
    else if (change.type === 'synced') {replacing = false; if (copy !== undefined) show();}
    else if (change.entity.id === 'reachy') feed.unavailable();
  }, {onRestarted: () => {if (active) {replacing = true; feed.restarted();}}}).then(result => {
    if (result.status !== 'synced') {if (active) feed.unavailable(); return;}
    if (!active) {void result.copy.close(); return;}
    close = () => result.copy.close();
    copy = result.copy;
    if (!replacing) show();
  }, () => {if (active) feed.unavailable();});
  return () => {active = false; void close?.();};
}
