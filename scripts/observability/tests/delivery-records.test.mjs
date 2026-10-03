import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecord } from '@jimmie-potts/bunny-observability';
import { createLogPipeline } from '../log-pipeline.mjs';
import { createDeliveryRecorder } from '../delivery-records.mjs';
const value=()=>createRecord({timestamp:'2026-10-02T00:00:00.000Z',event_name:'process.started',severity_text:'INFO',
  resource:{'service.namespace':'bunny','service.name':'hub','service.version':'0.4.2',
    'service.instance.id':'00000000-0000-4000-8000-000000000001','deployment.environment.name':'test'},
  scope:{name:'bunny.host',version:'1.0.0'},attributes:{'bunny.operation':'startup','bunny.provenance':'source'}}).value;

test('parent reconciles each prequeue identity against transport and queue counters',async()=>{
  const events=[],recorder=createDeliveryRecorder({record:e=>events.push(e)});
  const pipeline=createLogPipeline({observe:recorder.accept,options:{maxRecords:1},sink:()=>{throw new Error('secret');}});
  pipeline.emit(value());pipeline.emit(value());await pipeline.close();
  const result=recorder.finish({logs:pipeline.counts()});
  assert.equal(result.complete,true);assert.equal(result.counts.logs.failed,1);assert.equal(result.counts.logs.dropped,1);
  assert.equal(result.expectedLogs.length,2);assert.equal(events.length,4);
  const altered=pipeline.counts();altered.dropped=0;
  assert.equal(recorder.finish({logs:altered}).complete,false);
});

test('missing settlement, gaps, duplicate settlement and private fields cannot produce complete evidence',()=>{
  const recorder=createDeliveryRecorder({record:()=>{}});
  recorder.accept({signal:'logs',id:1,phase:'expected',value:value()});
  assert.equal(recorder.finish({}).complete,false);
  recorder.accept({signal:'logs',id:1,phase:'dropped'});
  assert.throws(()=>recorder.accept({signal:'logs',id:1,phase:'exported'}),/invalid/);
  assert.equal(recorder.finish({}).complete,false);
  for(const event of [
    {signal:'logs',id:2,phase:'expected',value:value()},
    {signal:'logs',id:1,phase:'expected',value:{...value(),private:'SYNTHETIC_PRIVATE_CANARY'}},
    {signal:'logs',id:1,phase:'failed',error:'SYNTHETIC_PRIVATE_CANARY'},
  ]) {
    const saved=[];const check=createDeliveryRecorder({record:e=>saved.push(e)});
    assert.throws(()=>check.accept(event),/invalid/);assert.equal(saved.length,0);
  }
});
