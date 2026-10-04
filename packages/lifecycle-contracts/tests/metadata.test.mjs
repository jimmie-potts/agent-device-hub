import test from 'node:test';
import assert from 'node:assert/strict';
import {validateEvent} from '../dist/index.js';
const base={apiVersion:'1.1',identity:{provider:'codex',client:'cli',hostId:'host',sourceId:'source',sessionId:'session'},turn:{status:'known',id:'turn'},parent:{status:'unknown'},event:{kind:'turn.started'},observedAtMs:1000,ordering:{status:'unknown'}};
test('1.1 admits bounded title/source, project display name and agent label provenance',()=>{
 const event={...base,title:{value:'Fix café prompts',source:'provider'},project:'device-hub',label:{value:'Hub #424',origin:'agent'}};
 assert.deepEqual(validateEvent(event),{ok:true,value:event});
 assert.equal(validateEvent({...event,apiVersion:'1.0'}).ok,false);
 assert.equal(validateEvent({...base,title:{value:'😀'.repeat(160),source:'user'},project:'😀'.repeat(80),label:{value:'😀'.repeat(80),origin:'user'}}).ok,true);
});
test('metadata rejects bad provenance, controls, secrets, overlong text and undeclared content',()=>{
 for(const fields of [{title:{value:'x',source:'agent'}},{title:{value:'x'.repeat(161),source:'provider'}},{title:{value:'bad\nline',source:'user'}},{title:{value:'Bearer '+'a'.repeat(43),source:'provider'}},{title:{value:'',source:'user'}},{project:'x'.repeat(81)},{label:{value:'x'.repeat(81),origin:'agent'}},{label:{value:'x',origin:'provider'}},{token:'SECRET_CANARY'},{prompt:'not a title'},{response:'not a title'},{transcript:'not a title'}])assert.deepEqual(validateEvent({...base,...fields}),{ok:false,code:'invalid-event'});
});
const desktop={...base,apiVersion:'1.2',identity:{...base.identity,provider:'claude',client:'code'},hostSessionId:'local_0f8e2c4a-5b6d-4e7f-8a9b-0c1d2e3f4a5b'};
test('1.2 admits one optional neutral host session identifier alongside 1.1 metadata',()=>{
 assert.deepEqual(validateEvent(desktop),{ok:true,value:desktop});
 const {hostSessionId,...plain}=desktop;assert.deepEqual(validateEvent(plain),{ok:true,value:plain});
 const titled={...desktop,title:{value:'Fix café prompts',source:'user'},project:'device-hub',label:{value:'Hub #784',origin:'agent'}};
 assert.deepEqual(validateEvent(titled),{ok:true,value:titled});
 assert.equal(validateEvent({...desktop,hostSessionId:'h'.repeat(128)}).ok,true);
});
test('older envelopes, malformed identifiers and child events reject the host session identifier',()=>{
 for(const apiVersion of ['1.0','1.1'])assert.deepEqual(validateEvent({...desktop,apiVersion}),{ok:false,code:'invalid-event'});
 for(const hostSessionId of ['','h'.repeat(129),'local id','local/../x','local_é',7,null,{id:'local_x'},['local_x']])
  assert.deepEqual(validateEvent({...desktop,hostSessionId}),{ok:false,code:'invalid-event'});
 const child={...desktop,identity:{...desktop.identity,sessionId:'child'},parent:{status:'known',identity:desktop.identity}};
 assert.deepEqual(validateEvent(child),{ok:false,code:'invalid-event'});
 const {hostSessionId,...childWithout}=child;assert.equal(validateEvent(childWithout).ok,true);
 assert.equal(validateEvent({...desktop,parent:{status:'top-level'}}).ok,true);
 for(const extra of [{hostSession:'local_x'},{environment:{CLAUDE_CODE_HOST_SESSION_ID:'local_x'}},{entrypoint:'claude-desktop'}])
  assert.deepEqual(validateEvent({...desktop,...extra}),{ok:false,code:'invalid-event'});
});
