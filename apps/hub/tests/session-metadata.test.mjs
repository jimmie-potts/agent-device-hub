import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {startHub} from '../dist/server.js';
const token='t'.repeat(43),identity={provider:'codex',client:'desktop',hostId:'host',sourceId:'desktop',sessionId:'session'};
test('HTTP 1.2 reads title from the configured Desktop home and keeps old readers compatible',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'hub-titles-')),home=await mkdtemp(join(tmpdir(),'desktop-titles-'));
 await writeFile(join(home,'session_index.jsonl'),JSON.stringify({id:'session',thread_name:'Windows title'})+'\n');
 const hub=await startHub({directory,ownerId:'owner',consumers:[],controllers:[],credentials:[{id:'operator',digest:createHash('sha256').update(token).digest('hex'),scopes:['read','ingest','control'],devices:[]}],codexDesktop:{home,hostId:'host',sourceId:'desktop'}});
 t.after(async()=>{await hub.close();await rm(directory,{recursive:true,force:true});await rm(home,{recursive:true,force:true});});
 const headers={authorization:'Bearer '+token,'content-type':'application/json','x-pixoo-request':'1'};
 const event={apiVersion:'1.1',identity,turn:{status:'known',id:'turn'},parent:{status:'unknown'},event:{kind:'turn.started'},observedAtMs:Date.now(),ordering:{status:'unknown'},project:'device-hub'};
 assert.equal((await fetch(hub.url+'/api/monitor/v1/events',{method:'POST',headers,body:JSON.stringify(event)})).status,200);
 const response=await fetch(hub.url+'/api/monitor/v1/sessions?snapshotVersion=1.2&q=Windows',{headers});assert.equal(response.status,200);
 const current=await response.json();assert.equal(current.snapshot.sessions[0].title.value,'Windows title');assert.equal(current.snapshot.sessions[0].project,'device-hub');assert.deepEqual(current.matches,[identity]);
 for(const version of ['1.0','1.1']){const value=await (await fetch(hub.url+'/api/monitor/v1/sessions?snapshotVersion='+version,{headers})).json();assert.equal(value.snapshot.apiVersion,version);assert.equal(value.snapshot.sessions[0].title,undefined);}
 const requestId=current.nextRequestId;
 const label=await fetch(hub.url+'/api/monitor/v1/commands',{method:'POST',headers,body:JSON.stringify({operation:'label',requestId,identity,label:'😀'.repeat(80)})});assert.equal(label.status,200);
 const next=await (await fetch(hub.url+'/api/monitor/v1/sessions?snapshotVersion=1.2',{headers})).json();assert.equal(next.snapshot.sessions[0].labelOrigin,'user');
 assert.equal((await fetch(hub.url+'/api/monitor/v1/commands',{method:'POST',headers,body:JSON.stringify({operation:'label',requestId:next.nextRequestId,identity,label:'😀'.repeat(81)})})).status,400);
});
