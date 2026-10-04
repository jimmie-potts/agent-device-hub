import assert from 'node:assert/strict';
import test from 'node:test';
import { collectJournal } from '../dist/journal.js';
import { createRecord } from '../../../packages/observability/dist/index.js';
const now='2026-10-03T12:00:00.000Z';
export const record=createRecord({timestamp:now,severity_text:'ERROR',event_name:'operation.failed',resource:{'service.namespace':'bunny','service.name':'hub','service.version':'1.0.0','service.instance.id':'00000000-0000-4000-8000-000000000001','deployment.environment.name':'test'},scope:{name:'bunny.storage',version:'1.0.0'},attributes:{'bunny.provenance':'source','bunny.operation':'storage','bunny.outcome':'failed','bunny.reason':'sink-error','bunny.device.id':'private-device'}}).value;
export const row=(message=JSON.stringify(record))=>JSON.stringify({_SYSTEMD_USER_UNIT:'hub.service',__REALTIME_TIMESTAMP:String(Date.parse(now)*1000),__CURSOR:'private-cursor',MESSAGE:message})+'\n';
const options={units:['hub.service'],services:['hub'],since:Date.parse(now)-1000,until:Date.parse(now)+1000,maxRows:10,maxBytes:100000};
async function* chunks(...text){for(const t of text)yield Buffer.from(t);}
test('canonical input preserves private originals but groups only public dimensions',async()=>{
 const result=await collectJournal(chunks(row()),options);
 assert.equal(result.accepted.length,1);
 assert.equal(result.accepted[0].message,JSON.stringify(record));
 assert.equal(result.findings.length,1);
 assert.ok(!JSON.stringify(result.findings).includes('private-'));
 assert.equal(result.coverage.status,'partial');
});
test('malformed, oversized and wrong-unit records never become findings',async()=>{
 const wrong=JSON.parse(row());wrong._SYSTEMD_USER_UNIT='other.service';
 const result=await collectJournal(chunks('not-json\n','x'.repeat(70000)+'\n',JSON.stringify(wrong)+'\n',row()),options);
 assert.equal(result.accepted.length,1);
 assert.equal(result.coverage.rejected,3);
});
test('row and byte ceilings preserve partial coverage and bound accepted input',async()=>{
 const capped=await collectJournal(chunks(row()+row()),{...options,maxRows:1});
 assert.equal(capped.accepted.length,1);assert.equal(capped.coverage.capped,true);
 const bytes=await collectJournal(chunks(row()+row()),{...options,maxBytes:10});
 assert.equal(bytes.accepted.length,0);assert.equal(bytes.coverage.capped,true);assert.equal(bytes.coverage.bytes,10);
});
test('an oversized-line flood obeys the row ceiling',async()=>{
 const result=await collectJournal(chunks(('x'.repeat(70000)+'\n').repeat(3)+row()),{...options,maxRows:1,maxBytes:500000});
 assert.ok(result.coverage.rows<=2);
 assert.equal(result.coverage.capped,true);
 assert.equal(result.accepted.length,0);
});
