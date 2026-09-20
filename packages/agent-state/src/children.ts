import {identityKey} from './memory-storage.js';
import type {Identity,SessionSnapshot} from './types.js';

/** Derived projection only: uncertain evidence never becomes an active count. */
export function childCounts(sessions:SessionSnapshot[],parent:Identity):SessionSnapshot['children'] {
  const counts={active:0,uncertain:0};
  for(const child of sessions){
    if(child.parent.status!=='known'||identityKey(child.parent.identity)!==identityKey(parent)||
      child.unavailable.some(item=>item.dimension==='parent'&&item.reason==='ambiguous'))continue;
    const uncertain=child.activity==='unknown'||child.unavailable.some(item=>item.dimension==='activity'||
      (['turn','ordering'].includes(item.dimension)&&item.reason==='ambiguous'));
    if(uncertain)counts.uncertain++;
    else if(child.activity==='active')counts[child.freshness==='current'?'active':'uncertain']++;
  }
  return counts;
}
