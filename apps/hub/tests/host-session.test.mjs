import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {startHub} from '../dist/server.js';

// Validate with the stored durable 2.1 rules that a previous release also loads.
const stateEntry=fileURLToPath(import.meta.resolve('@jimmie-potts/agent-state'));
const {Ajv2020}=createRequire(stateEntry)('ajv/dist/2020.js');
const durable21=new Ajv2020({strict:true,allErrors:false}).compile(JSON.parse(await readFile(new URL('../schemas/durable-v2.1.schema.json',new URL(import.meta.resolve('@jimmie-potts/agent-state'))),'utf8')));
const token='t'.repeat(43),desktopId='local_0f8e2c4a-5b6d-4e7f-8a9b-0c1d2e3f4a5b';
const identity=sessionId=>({provider:'claude',client:'code',hostId:'host',sourceId:'source',sessionId});
const headers={authorization:'Bearer '+token,'content-type':'application/json','x-pixoo-request':'1'};
let turn=0;
const event=(sessionId,kind,extra={})=>({apiVersion:'1.2',identity:identity(sessionId),turn:{status:'known',id:`turn-${++turn}`},parent:{status:'unknown'},event:{kind},observedAtMs:Date.now(),ordering:{status:'unknown'},...extra});

test('HTTP snapshot 1.3 carries the Desktop session ID from owner memory; durable bytes and older projections stay unchanged',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'hub-host-session-'));
 const config={directory,ownerId:'owner',consumers:[],controllers:[],credentials:[{id:'operator',digest:createHash('sha256').update(token).digest('hex'),scopes:['read','ingest','control'],devices:[]}]};
 let hub=await startHub(config);
 t.after(async()=>{await hub?.close();await rm(directory,{recursive:true,force:true});});
 const post=async body=>{const response=await fetch(hub.url+'/api/monitor/v1/events',{method:'POST',headers,body:JSON.stringify(body)});assert.equal(response.status,200,await response.text());};
 const read=async query=>{const response=await fetch(hub.url+'/api/monitor/v1/sessions'+query,{headers});assert.equal(response.status,200);return response.json();};
 // A Claude /clear ends the old hook session; the next hook session keeps the Desktop ID.
 await post(event('before-clear','session.started',{hostSessionId:desktopId}));
 await post(event('before-clear','runtime.ended',{hostSessionId:desktopId}));
 await post(event('after-clear','session.started',{hostSessionId:desktopId}));
 await post({...event('cli-session','session.started'),apiVersion:'1.1'});
 const current=await read('?snapshotVersion=1.3');
 assert.equal(current.apiVersion,'1.0');assert.equal(current.snapshot.apiVersion,'1.3');
 assert.deepEqual(current.snapshot.sessions.map(s=>[s.identity.sessionId,s.hostSessionId??null]).sort(),[['after-clear',desktopId],['cli-session',null]]);
 const filtered=await read('?snapshotVersion=1.3&q=after');assert.deepEqual(filtered.matches,[identity('after-clear')]);
 for(const query of ['','?snapshotVersion=1.0','?snapshotVersion=1.1','?snapshotVersion=1.2']){
  const old=await read(query);assert.equal(old.snapshot.apiVersion,query?query.slice(-3):'1.0');assert.ok(!JSON.stringify(old).includes('hostSessionId'));assert.ok(!JSON.stringify(old).includes(desktopId));
 }
 for(const query of ['?snapshotVersion=1.4','?snapshotVersion=1.3&snapshotVersion=1.3'])assert.equal((await fetch(hub.url+'/api/monitor/v1/sessions'+query,{headers})).status,400);
 await hub.close();hub=undefined;
 for(const name of await readdir(directory)){
  const bytes=await readFile(join(directory,name));assert.equal(bytes.includes('hostSessionId'),false,name);assert.equal(bytes.includes(desktopId),false,name);
 }
 const db=new DatabaseSync(join(directory,'state.sqlite'),{readOnly:true});
 let stored;try{stored=JSON.parse(db.prepare('SELECT payload FROM state WHERE id=1').get().payload);}finally{db.close();}
 assert.equal(stored.formatVersion,'2.1');assert.equal(durable21(stored),true);
 assert.deepEqual(stored.sessions.map(s=>s.identity.sessionId).sort(),['after-clear','cli-session']);
 hub=await startHub(config);
 const restarted=await read('?snapshotVersion=1.3');
 assert.ok(restarted.snapshot.sessions.every(s=>s.restartUncertain&&!('hostSessionId' in s)));
 await post(event('after-clear','turn.started',{hostSessionId:desktopId}));
 assert.equal((await read('?snapshotVersion=1.3')).snapshot.sessions.find(s=>s.identity.sessionId==='after-clear').hostSessionId,desktopId);
});
