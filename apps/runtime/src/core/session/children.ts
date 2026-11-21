// Child counting (Hub #1865): agent-state's `childCounts` (packages/agent-state/src/children.ts), the one copy the core
// keeps, over the stored sessions. A child counts as working only while its own work is active and confirmed (design
// decision 3); missing or contradictory evidence, or work the core no longer confirms, counts as unconfirmed, never as
// a working child.
import {sameIdentity, type StoredSession} from './model.js';

/** What child counting reads of each stored session. */
export type Counted = Pick<StoredSession, 'id' | 'identity' | 'parent' | 'activity' | 'unavailable' | 'restartUnconfirmed'>;

/** Each session's count of its known children, by entity ID: working with confirmed work, otherwise unconfirmed. */
export function countChildren(sessions: readonly Counted[]): Map<string, {working: number; unconfirmed: number}> {
  const counts = new Map<string, {working: number; unconfirmed: number}>();
  for (const parent of sessions) {
    const count = {working: 0, unconfirmed: 0};
    for (const child of sessions) {
      if (child.parent.status !== 'known' || !sameIdentity(child.parent.identity, parent.identity) ||
        child.unavailable.some(item => item.dimension === 'parent' && item.reason === 'ambiguous')) continue;
      const uncertain = child.activity === 'unknown' || child.unavailable.some(item => item.dimension === 'activity' ||
        ((item.dimension === 'turn' || item.dimension === 'ordering') && item.reason === 'ambiguous'));
      if (uncertain) count.unconfirmed += 1;
      else if (child.activity === 'active') count[child.restartUnconfirmed === true ? 'unconfirmed' : 'working'] += 1;
    }
    counts.set(parent.id, count);
  }
  return counts;
}
