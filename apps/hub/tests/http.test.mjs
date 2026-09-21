import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {startHub} from '../dist/server.js';

const token='a'.repeat(43),readToken='b'.repeat(43);
const hash=value=>createHash('sha256').update(value).digest('hex');
const credentials=[{id:'writer',digest:hash(token),scopes:['read','ingest','control','admin'],devices:[]},
  {id:'reader',digest:hash(readToken),scopes:['read'],devices:[]}];
const event={apiVersion:'1.0',identity:{provider:'codex',client:'cli',hostId:'h',sourceId:'s',sessionId:'one'},
 turn:{status:'known',id:'turn'},parent:{status:'unknown'},event:{kind:'session.started'},observedAtMs:1,ordering:{status:'unknown'}};

test('authenticated Pixoo-compatible reads, scoped writes, replay and restart fence',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'hub-http-'));let hub;
  try {
    hub=await startHub({directory,ownerId:'owner',consumers:[{id:'pixoo',clearOnNewTurn:true}],credentials,controllers:[]});
    const call=async(path,body,credential=token,headers={})=>fetch(hub.url+path,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${credential}`,'x-pixoo-request':'1','content-type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
    assert.equal((await fetch(hub.url+'/api/monitor/v1/sessions')).status,401);
    assert.equal((await call('/api/monitor/v1/events',event,readToken)).status,403);
    assert.equal((await call('/api/monitor/v1/events',event,token,{origin:'http://evil.invalid'})).status,403);
    assert.equal((await call('/api/monitor/v1/events',{...event,prompt:'PRIVATE_CANARY'})).status,400);
    assert.equal((await call('/api/monitor/v1/events',event)).status,200);
    let view=await (await call('/api/monitor/v1/sessions')).json();
    assert.equal(view.ownerId,'owner');assert.equal(view.snapshot.sessions.length,1);
    const command={operation:'label',requestId:view.nextRequestId,identity:event.identity,label:'Explicit label'};
    const first=await (await call('/api/monitor/v1/commands',command)).json();
    assert.deepEqual(await (await call('/api/monitor/v1/commands',command)).json(),first);
    assert.equal((await call('/api/monitor/v1/commands',{...command,label:'Different'})).status,409);
    view=await (await call('/api/monitor/v1/sessions')).json();
    assert.equal(view.snapshot.sessions[0].label,'Explicit label');
    assert.equal((await call('/api/monitor/v1/commands',{operation:'quiesce',requestId:view.nextRequestId})).status,200);
    assert.equal((await call('/api/monitor/v1/events',event)).status,503);
    await hub.close();hub=undefined;
    await assert.rejects(startHub({directory,ownerId:'owner',consumers:[{id:'pixoo',clearOnNewTurn:true}],credentials,controllers:[]}),/owner-quiesced/);
  } finally {await hub?.close();await rm(directory,{recursive:true,force:true});}
});
