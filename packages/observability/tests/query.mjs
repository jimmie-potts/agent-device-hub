// Synthetic contract evidence only: this fixture does not claim backend ingestion.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRecord,projectRecord,queryRecords,toOtlp,catalog} from '../dist/index.js';
import {record} from './sample.mjs';
const trace='1234567890abcdef1234567890abcdef';
const ticket={'bunny.ticket.epoch':'synthetic-epoch-1','bunny.ticket.sequence':7,'bunny.request.id':'synthetic-request-1'};
const hub=createRecord({...record,event_name:'command.admitted',trace_id:trace,span_id:'1234567890abcdef',trace_flags:'01',
 attributes:{...record.attributes,...ticket,'bunny.operation':'brightness','bunny.outcome':'accepted'}}).value;
const input={...hub,event_name:'command.completed',resource:{...hub.resource,'service.name':'nanoleaf-worker'},span_id:'abcdef1234567890',
 attributes:{...hub.attributes,'bunny.outcome':'uncertain','bunny.reason':'timeout','bunny.write.possible':true}};
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
assert.equal(queryRecords(records,{'bunny.outcome':'uncertain'})[0].attributes['bunny.write.possible'],true);
for(const record of records){
 const log=toOtlp(record).resourceLogs[0].scopeLogs[0].logRecords[0];
 assert.ok(spans.some(span=>span.traceId===log.traceId&&span.spanId===log.spanId));
 assert.equal(log.attributes.find(attr=>attr.key==='bunny.ticket.sequence').value.intValue,'7');
}
console.log(JSON.stringify({synthetic:true,languages:['typescript','python'],versions:['1.1','1.0'],matchedRecords:2,matchedSpans:2,ingested:false}));
