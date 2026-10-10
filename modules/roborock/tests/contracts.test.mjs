import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Ajv2020} from 'ajv/dist/2020.js';
import {statusSchema, runsSchema, runDocumentSchema, samplesSchema, roborockValidator} from '../dist/src/families.js';
import {emptyStatus, STATUS_SCHEMA} from '../dist/src/contracts.js';
const at = 1_700_000_000_000;
const data = {...emptyStatus('vacuum'), revision: 1, observedAtMs: {status:'known',value:at}, availability:'available'};
const envelope = payload => ({specversion:'1.0',bunnyprofile:'2.0',id:'message-1',source:'bunny/modules/roborock',kind:'state',type:'org.bunny.roborock-vacuum.updated',subject:'vacuum',time:new Date(at).toISOString(),datacontenttype:'application/json',dataschema:STATUS_SCHEMA,traceparent:'00-11111111111111111111111111111111-1111111111111111-01',data:payload});
test('standalone and bus schemas agree on units, bounds, missingness and closed fields', () => {
  const validate = new Ajv2020({strict:true}).compile(statusSchema);
  assert.equal(validate(data),true); assert.equal(roborockValidator().validate(envelope(data)).ok,true);
  for (const bad of [{...data,id:'BAD_ID'}, {...data,revision:-1}, {...data,observedAtMs:{status:'known',value:1.1}}, {...data,status:{...data.status,batteryPercent:{status:'known',value:101}}}, {...data,status:{...data.status,cleanTimeSeconds:{status:'known',value:'10'}}}, {...data,privateMap:'bytes'}, {...data,observedAtMs:{status:'unknown',value:0}}]) {
    assert.equal(validate(bad),false);assert.equal(roborockValidator().validate(envelope(bad)).ok,false);
  }
});
test('bus identity/time checks reject unrelated entity or future evidence', () => {
  assert.equal(roborockValidator().validate(envelope({...data,id:'other'})).ok,false);
  assert.equal(roborockValidator().validate(envelope({...data,observedAtMs:{status:'known',value:at+1}})).ok,false);
});
const unknown={status:'unknown'};
const run={recordId:1_700_000_000,observedAtMs:at+60_000,startAtMs:at,endAtMs:{status:'known',value:at+60_000},durationSeconds:{status:'known',value:50},areaMm2:{status:'known',value:12_000_000},cleanedAreaMm2:unknown,errorCode:{status:'known',value:-1},complete:unknown,startType:unknown,cleanType:unknown,finishReason:unknown,avoidCount:unknown,washCount:unknown,battery:{availability:'partial',samples:1,clock:'unqualified'},map:{availability:'unverified',reason:'candidate-window'}};
test('run list and detail use shared instants, retain raw codes and refuse private fields',()=>{
  const ajv=new Ajv2020({strict:true}),list=ajv.compile(runsSchema),detail=ajv.compile(runDocumentSchema);
  const page={schema:'roborock-runs/2.0',id:'vacuum',revision:1,history:'partial',runs:[run],next:unknown};
  const doc={schema:'roborock-run/2.0',id:'vacuum',revision:1,run};
  assert.equal(list(page),true);assert.equal(detail(doc),true);
  for(const bad of [{...page,id:'BAD'}, {...page,runs:Array(26).fill(run)}, {...page,next:{status:'known',value:'x'.repeat(129)}}, {...page,next:{status:'known',value:''}}, {...page,rawMap:'private'}]) assert.equal(list(bad),false);
  for(const bad of [{...run,startAtMs:-1}, {...run,endAtMs:{status:'known',value:0.5}}, {...run,beginUnixSeconds:1_700_000_000}, {...run,roomNames:['private']}, {...run,battery:{...run.battery,samples:-1}}, {...run,map:{availability:'verified',reason:'candidate-window'}}]) assert.equal(detail({...doc,run:bad}),false);
  assert.equal(list({...page,runs:Array(25).fill(run),next:{status:'known',value:'x'.repeat(128)}}),true);
});
test('sample and gap documents are closed, bounded and have explicit unknown gap ends',()=>{
  const validate=new Ajv2020({strict:true}).compile(samplesSchema),sample={observationId:'observation-1',observedAtMs:at,batteryPercent:80},gap={startAtMs:at+1,endAtMs:unknown,reason:'restart'};
  const doc={schema:'roborock-samples/2.0',id:'vacuum',revision:1,recordId:run.recordId,clock:'unqualified',samples:[sample],gaps:[gap],next:unknown};
  assert.equal(validate(doc),true);
  for(const bad of [{...doc,samples:Array(101).fill(sample)}, {...doc,gaps:Array(101).fill(gap)}, {...doc,samples:[{...sample,batteryPercent:101}]}, {...doc,samples:[{...sample,observedAtMs:1.5}]}, {...doc,gaps:[{...gap,secret:'private'}]}, {...doc,gaps:[{...gap,endAtMs:{status:'unknown',value:0}}]}, {...doc,next:{status:'known',value:'x'.repeat(129)}}, {...doc,recordId:0}]) assert.equal(validate(bad),false);
  const maximum={...doc,samples:Array(100).fill(sample),gaps:Array(100).fill(gap),next:{status:'known',value:'x'.repeat(128)}};
  assert.equal(validate(maximum),true);assert.ok(Buffer.byteLength(JSON.stringify(maximum))<256*1024);
  assert.ok(Buffer.byteLength(JSON.stringify({schema:'roborock-runs/2.0',id:'vacuum',revision:1,history:'partial',runs:Array(25).fill(run),next:unknown}))<256*1024);
});
