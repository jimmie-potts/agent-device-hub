import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileWorkload } from '../workload-oracle.mjs';
const ticket = n => ({ epoch:'requests-1',sequence:n+1 });
function fixture() {
  return { events: [0,1,2].flatMap(ordinal=>[
    {kind:'dispatch',ordinal,slot:ordinal},
    {kind:'completion',ordinal,slot:ordinal,failed:false,outcome:{status:202,validReceipt:true,
      requestId:ticket(ordinal),receipt:{requestId:ticket(ordinal),outcome:'queued'}}},
  ]), closed:{code:0,reason:null,result:{complete:true,quiescent:true,
    oracle:{effects:3,executed:3,cancelled:0,queued:0,historyDropped:0,diagnosticFailures:0}},
    executions:[0,1,2].map(n=>({requestId:ticket(n),receipt:{requestId:ticket(n),outcome:'sent',
      priorEffects:'confirmed-transmission',completedOperations:['brightness'],uncertainOperations:[]},effects:n+1}))} };
}
test('every dispatched ticket requires a valid queued receipt and exactly one independently observed effect', () => {
  assert.equal(reconcileWorkload(fixture()).complete,true);
  for(const mutate of [
    f=>f.closed.executions.push(f.closed.executions[0]),
    f=>f.closed.executions.pop(),
    f=>f.closed.result.oracle.historyDropped++,
    f=>f.closed.executions[0].receipt.outcome='failed',
    f=>f.events[1].outcome.receipt.outcome='sent',
    f=>f.events.pop(),
    f=>f.events[1].failed=true,
    f=>f.closed.code=2,
  ]) {const f=fixture();mutate(f);assert.equal(reconcileWorkload(f).complete,false);}
});
test('omissions, duplicate completions and unexpected identities cannot become matching outcomes', () => {
  const omitted=fixture();omitted.events.push({kind:'omitted',slot:3});
  assert.equal(reconcileWorkload(omitted).omitted,1);assert.equal(reconcileWorkload(omitted).complete,false);
  const duplicate=fixture();duplicate.events.push(duplicate.events[1]);
  assert.equal(reconcileWorkload(duplicate).complete,false);
  const unexpected=fixture();unexpected.closed.executions[0].requestId=ticket(99);
  assert.equal(reconcileWorkload(unexpected).unexpectedExecutions,1);
});
