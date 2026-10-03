import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
const canary='SYNTHETIC_PRIVATE_CANARY';

/** Fixed synthetic qualification, never a benchmark or a general command API.
 * Domain responses/effects are retained independently of diagnostic records. */
export async function runCommandFaults({hub,fake,fakeOptions,token}) {
  const cases=[],requests=[];let stage='start';
  const command=()=>{const s=fake.snapshot10();return {apiVersion:'1.0',controllerId:s.identity.controllerId,deviceId:s.identity.deviceId,
    requestId:s.nextRequestId,expectedConfigurationRevision:s.configurationRevision,expectedGeneration:s.generation,
    command:{kind:'brightness.set',percent:42}};};
  async function send(body,{unauthenticated=false,malformed=false,query=false}={}) {
    const traceId=randomBytes(16).toString('hex'),parentId=randomBytes(8).toString('hex');
    const response=await fetch(hub.url+'/api/controllers/v1/wall/commands'+(query?'?private='+canary:''),{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(4000),headers:{authorization:'Bearer '+(unauthenticated?canary:token),
        'content-type':'application/json','x-pixoo-request':'1','x-private':canary,baggage:'private='+canary,tracestate:'private='+canary,
        traceparent:`00-${traceId}-${parentId}-${malformed?'zz':'01'}`},body:JSON.stringify(body)});
    const value=await response.json();
    const answer={status:response.status,outcome:value.outcome??null,code:value.error?.code??value.failure?.code??null};
    const codes=[null,'revision-conflict','capacity','uncertain-result','unauthenticated','invalid-request','invalid-input','not-found'];
    assert.ok([null,'queued','sent','failed'].includes(answer.outcome));assert.ok(codes.includes(answer.code));
    requests.push({scenario:stage,traceId,parentId,adopted:!unauthenticated&&!malformed,requestId:body.requestId,answer});
    return answer;
  }
  async function scenario(name,action) {
    stage=name;const before=fake.executionState(),received=fake.commands.length;
    const responses=await action();const after=fake.executionState();
    cases.push({name,responses,effects:after.effects-before.effects,queued:after.queued,
      received:fake.commands.length-received,diagnosticFailures:after.diagnosticFailures-before.diagnosticFailures});
  }
  try {
    await scenario('queued-success',async()=>{
      const answer=await send(command());assert.equal(answer.status,202);assert.equal(answer.outcome,'queued');
      assert.equal(fake.executionState().queued,1);const before=fake.executionState().effects;
      fake.executeQueued();assert.equal(fake.executionState().effects,before+1);return [answer];
    });
    await scenario('duplicate-ticket',async()=>{
      const body=command(),first=await send(body),duplicate=await send(body);assert.equal(first.outcome,'queued');assert.equal(duplicate.outcome,'queued');
      assert.equal(fake.executionState().queued,1);const before=fake.executionState().effects;fake.executeQueued();
      const terminal=await send(body);assert.equal(terminal.outcome,'sent');assert.equal(fake.executionState().effects,before+1);
      assert.equal(fake.executeQueued().length,0);return [first,duplicate,terminal];
    });
    await scenario('rejected-admission',async()=>{
      const body=command();body.expectedConfigurationRevision++;
      const answer=await send(body);assert.equal(answer.code,'revision-conflict');assert.equal(fake.executionState().queued,0);return [answer];
    });
    await scenario('concurrent-capacity',async()=>{
      const body=command(),hold=fake.hold({method:'POST'});let first;
      try {
        first=send(body);first.catch(()=>{});await hold.reached;
        const other=await send(body);assert.equal(other.code,'capacity');hold.release();
        const admitted=await first;assert.equal(admitted.outcome,'queued');fake.executeQueued();return [admitted,other];
      }finally{hold.release();await first?.catch(()=>{});}
    });
    await scenario('timeout-after-admission',async()=>{
      fake.answerNext({mode:'timeout'});const answer=await send(command());
      assert.equal(answer.code,'uncertain-result');assert.equal(fake.executionState().queued,1);
      fake.executeQueued();return [answer];
    });
    await scenario('unauthenticated-context',async()=>{
      const answer=await send(command(),{unauthenticated:true});assert.equal(answer.code,'unauthenticated');return [answer];
    });
    await scenario('malformed-context',async()=>{
      const answer=await send(command(),{malformed:true});assert.equal(answer.outcome,'queued');fake.executeQueued();return [answer];
    });
    await scenario('private-payload',async()=>{
      const answer=await send({...command(),private:canary});assert.ok(['invalid-input','invalid-request'].includes(answer.code));return [answer];
    });
    await scenario('private-query',async()=>{
      const answer=await send(command(),{query:true});assert.equal(answer.status,404);assert.equal(answer.code,'not-found');return [answer];
    });
    await scenario('throwing-diagnostic-observer',async()=>{
      const previous=fakeOptions.diagnostics;
      fakeOptions.diagnostics={request(){throw new Error(canary);}};
      try{const answer=await send(command());assert.equal(answer.outcome,'queued');fake.executeQueued();return [answer];}
      finally{fakeOptions.diagnostics=previous;}
    });
    const expectedEffects=[1,1,0,1,1,0,1,0,0,1],expectedReceived=[1,3,1,1,1,0,1,0,0,1];
    assert.deepEqual(cases.map(value=>value.effects),expectedEffects);assert.deepEqual(cases.map(value=>value.received),expectedReceived);
    assert.ok(cases.every(value=>value.queued===0));assert.equal(fake.executionState().effects,6);
    assert.deepEqual(cases.map(value=>value.diagnosticFailures),[0,0,0,0,0,0,0,0,0,1]);
    return {scope:'command-faults-only',complete:true,stage:'complete',cases,requests};
  }catch{return {scope:'command-faults-only',complete:false,stage,cases,requests};}
}
