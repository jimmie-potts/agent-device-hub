// Child counting (Hub #1865): agent-state's `childCounts` (packages/agent-state/src/children.ts), the one copy the core
// keeps. A derived projection only: missing or contradictory evidence is uncertain, never an active child.
import type {SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {sameIdentity} from './model.js';

/** What child counting reads of each record, and the count it sets. */
export type Counted = Pick<SessionRecord, 'identity' | 'parent' | 'activity' | 'unavailable' | 'freshness' | 'children'>;

/** Sets each record's count of its known children: active only with current evidence, otherwise uncertain. */
export function countChildren(records: readonly Counted[]): void {
  for (const parent of records) {
    const counts = {active: 0, uncertain: 0};
    for (const child of records) {
      if (child.parent.status !== 'known' || !sameIdentity(child.parent.identity, parent.identity) ||
        child.unavailable.some(item => item.dimension === 'parent' && item.reason === 'ambiguous')) continue;
      const uncertain = child.activity === 'unknown' || child.unavailable.some(item => item.dimension === 'activity' ||
        ((item.dimension === 'turn' || item.dimension === 'ordering') && item.reason === 'ambiguous'));
      if (uncertain) counts.uncertain += 1;
      else if (child.activity === 'active') counts[child.freshness === 'current' ? 'active' : 'uncertain'] += 1;
    }
    parent.children = counts;
  }
}
