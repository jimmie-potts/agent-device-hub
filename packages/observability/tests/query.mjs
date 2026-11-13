// Synthetic contract evidence only: this fixture does not claim backend ingestion.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createRecord,projectRecord,queryRecords,toOtlp,catalog} from '../dist/index.js';
import {record} from './sample.mjs';
const trace='1234567890abcdef1234567890abcdef';
// One synthetic local monotonic clock: enqueue at 100 ms, dequeue at 112.5 ms.
// These values are never subtracted across processes or wall clocks.
const queueWaitMs=112.5-100;
const ticket={'bunny.ticket.epoch':'synthetic-epoch-1','bunny.ticket.sequence':7,'bunny.request.id':'synthetic-request-1'};
const hub=createRecord({...record,event_name:'command.admitted',trace_id:trace,span_id:'1234567890abcdef',trace_flags:'01',
 attributes:{...record.attributes,...ticket,'bunny.operation':'brightness','bunny.outcome':'accepted'}}).value;
const input={...hub,event_name:'command.completed',resource:{...hub.resource,'service.name':'nanoleaf-worker'},span_id:'abcdef1234567890',
 attributes:{...hub.attributes,'bunny.outcome':'uncertain','bunny.reason':'timeout','bunny.write.possible':true,'bunny.queue.wait_ms':queueWaitMs}};
const python=spawnSync(process.env.PYTHON??'python3',['-c',
 'import json,sys; sys.path.insert(0,sys.argv[1]); from bunny_observability import create_record; print(json.dumps(create_record(json.load(sys.stdin))["value"]))',
 fileURLToPath(new URL('../python',import.meta.url))],{input:JSON.stringify(input),encoding:'utf8'});
assert.equal(python.status,0,python.stderr);
const worker=projectRecord(JSON.parse(python.stdout),'1.0').value;
const records=[hub,worker];
const spans=[{name:'bunny.command.request',traceId:trace,spanId:hub.span_id,attributes:ticket},
 {name:'bunny.command.execute',traceId:trace,spanId:worker.span_id,links:[{traceId:trace,spanId:hub.span_id}],attributes:ticket}];
assert.ok(spans.every(span=>catalog.span_names.includes(span.name)));
assert.equal(queryRecords(records,ticket).length,2);
assert.equal(queryRecords(records,{trace_id:trace}).length,2);
assert.deepEqual(toOtlp(worker).resourceLogs[0].scopeLogs[0].logRecords[0].attributes.find(a=>a.key==='bunny.queue.wait_ms').value,{doubleValue:queueWaitMs});
assert.equal(queryRecords(records,{'bunny.outcome':'uncertain'})[0].attributes['bunny.write.possible'],true);
for(const record of records){
 const log=toOtlp(record).resourceLogs[0].scopeLogs[0].logRecords[0];
 assert.ok(spans.some(span=>span.traceId===log.traceId&&span.spanId===log.spanId));
 assert.equal(log.attributes.find(attr=>attr.key==='bunny.ticket.sequence').value.intValue,'7');
}
// The private Grafana query selects received warnings by the recorded UTC hour,
// independent of the time the diagnostic writer stamped after commit.
const fixtures=JSON.parse(readFileSync(new URL('../fixtures/records.json',import.meta.url),'utf8')).cases;
const warning=fixtures.find(({name})=>name==='history-alarm-1.9').record;
const hourKey='bunny.history.hour_start_at_ms';
const currentHour=warning.attributes[hourKey], previousHour=currentHour-3_600_000;
const alarms=[currentHour-7_200_000,previousHour,currentHour,currentHour+3_600_000].map(hour=>({
 ...warning,attributes:{...warning.attributes,[hourKey]:hour},
}));
const alarmRecords=queryRecords([...records,...alarms],{'service.name':'runtime',event_name:'history.entity.noisy','bunny.module':'core'});
assert.deepEqual(alarmRecords.filter(({attributes})=>attributes[hourKey]>=previousHour&&attributes[hourKey]<=currentHour)
 .map(({attributes})=>attributes[hourKey]),[previousHour,currentHour]);
const warningLog=toOtlp(warning).resourceLogs[0].scopeLogs[0].logRecords[0];
assert.equal(warningLog.eventName,'history.entity.noisy');
assert.equal(warningLog.attributes.find(({key})=>key===hourKey).value.intValue,String(currentHour));
console.log(JSON.stringify({synthetic:true,languages:['typescript','python'],versions:['1.1','1.0'],matchedRecords:2,matchedSpans:2,historyWarnings:2,ingested:false}));
