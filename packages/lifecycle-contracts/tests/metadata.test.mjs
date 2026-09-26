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
