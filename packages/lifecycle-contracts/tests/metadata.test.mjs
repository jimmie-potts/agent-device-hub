import test from 'node:test';
import assert from 'node:assert/strict';
import {validateEvent} from '../dist/index.js';
import {validateEvent as validate12,deduplicationKey as key12,ARTIFACT_VERSION,API_VERSIONS} from '../dist/v1.2.js';
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
 assert.deepEqual(validate12(desktop),{ok:true,value:desktop});
 const {hostSessionId,...plain}=desktop;assert.deepEqual(validate12(plain),{ok:true,value:plain});
 const titled={...desktop,title:{value:'Fix café prompts',source:'user'},project:'device-hub',label:{value:'Hub #784',origin:'agent'}};
 assert.deepEqual(validate12(titled),{ok:true,value:titled});
 assert.equal(validate12({...desktop,hostSessionId:'h'.repeat(128)}).ok,true);
});
test('older envelopes, malformed identifiers and child events reject the host session identifier',()=>{
 for(const apiVersion of ['1.0','1.1'])assert.deepEqual(validate12({...desktop,apiVersion}),{ok:false,code:'invalid-event'});
 for(const hostSessionId of ['','h'.repeat(129),'local id','local/../x','local_é',7,null,{id:'local_x'},['local_x']])
  assert.deepEqual(validate12({...desktop,hostSessionId}),{ok:false,code:'invalid-event'});
 const child={...desktop,identity:{...desktop.identity,sessionId:'child'},parent:{status:'known',identity:desktop.identity}};
 assert.deepEqual(validate12(child),{ok:false,code:'invalid-event'});
 const {hostSessionId,...childWithout}=child;assert.equal(validate12(childWithout).ok,true);
 assert.equal(validate12({...desktop,parent:{status:'top-level'}}).ok,true);
 for(const extra of [{hostSession:'local_x'},{environment:{CLAUDE_CODE_HOST_SESSION_ID:'local_x'}},{entrypoint:'claude-desktop'}])
  assert.deepEqual(validate12({...desktop,...extra}),{ok:false,code:'invalid-event'});
});
test('the frozen 1.0/1.1 module rejects every 1.2 envelope; the 1.2 module keeps earlier results and keys',async()=>{
 const {hostSessionId,...plain}=desktop;
 for(const input of [desktop,plain])assert.deepEqual(validateEvent(input),{ok:false,code:'invalid-event'});
 const earlier=await import('../dist/index.js');
 for(const input of [base,{...base,apiVersion:'1.0',label:{origin:'user',value:'x'}},{...base,title:{value:'x',source:'user'}}]){
  assert.deepEqual(validate12(input),earlier.validateEvent(input));assert.deepEqual(key12(input),earlier.deduplicationKey(input));
 }
 assert.equal(earlier.ARTIFACT_VERSION,'1.1.0');assert.equal(ARTIFACT_VERSION,'1.2.0');assert.deepEqual(API_VERSIONS,['1.0','1.1','1.2']);
});
