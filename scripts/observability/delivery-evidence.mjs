import { MAX_QUEUE_RECORDS } from '@jimmie-potts/bunny-observability';

/** Bounded identity bookkeeping; the observer owns durable evidence outside the
 * application. Observer failures are diagnostic failures, never domain failures. */
export function createDeliveryEvidence(signal, observe) {
  if (!['logs','traces'].includes(signal) || (observe !== undefined && typeof observe !== 'function')) throw new Error('Evidence observer invalid');
  const active=new Set(), counts={expected:0,exported:0,failed:0,dropped:0,pending:0,evidenceFailed:0};
  const fail=()=>{counts.evidenceFailed=Math.min(Number.MAX_SAFE_INTEGER,counts.evidenceFailed+1);};
  function emit(event) {
    if(!observe)return;
    try {
      const returned=observe(structuredClone({signal,...event}));
      if(returned && typeof returned.then==='function'){Promise.resolve(returned).catch(()=>{});fail();}
    } catch {fail();}
  }
  return {
    begin(value) {
      if(counts.expected===Number.MAX_SAFE_INTEGER || active.size>=MAX_QUEUE_RECORDS*2+1){fail();return null;}
      const id=++counts.expected;active.add(id);emit({id,phase:'expected',value});return id;
    },
    project(id,value) {if(!active.has(id)){fail();return;}emit({id,phase:'projected',value});},
    settle(id,phase) {
      if(!['exported','failed','dropped','pending'].includes(phase) || !active.delete(id)){fail();return;}
      counts[phase]++;emit({id,phase});
    },
    counts:()=>({...counts,inFlight:active.size}),
  };
}
