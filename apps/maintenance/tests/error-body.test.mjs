// A blocked intake response keeps its 1.x fields and adds the shared 2.0 error body (Hub #921, ADR 0012).
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {errorBody,errorCodes} from '@jimmie-potts/event-contracts/v2';
import {runProcess} from '../dist/process.js';
import {fixture} from './fixture.mjs';

// The approved mapping: each blocked reason intake can return, and its registry code. Any other reason is internal.
// `invalid-or-unavailable-intake` is `invalid-state` instead when the operator's configuration fails to load.
const REASON_CODES={
 'invalid-or-unavailable-intake':'invalid-request','invalid-request':'invalid-request','invalid-operation':'invalid-request','invalid-run':'invalid-request','invalid-evidence-directory':'invalid-request',
 'unauthorized-maintenance':'forbidden',
 'expired-deadline':'expired',
 'unknown-run':'not-found',
 'run-identity-mismatch':'duplicate-conflict','interrupted-run-needs-reconciliation':'invalid-state','interrupted-before-evidence':'invalid-state','missing-retained-evidence':'invalid-state',
 'invalid-finding-state':'invalid-state','missing-selected-issue':'invalid-state','trusted-file-drift':'invalid-state','unsafe-file':'invalid-state','unsafe-directory':'invalid-state',
 'unsafe-name':'invalid-state','unsafe-evidence-entry':'invalid-state','source-repository-mismatch':'invalid-state','issue-is-pr':'invalid-state','issue-inventory-capped':'invalid-state',
 'source-not-current':'revision-conflict','publication-inventory-changed':'revision-conflict',
 'evidence-capacity':'invalid-state','process-output-limit':'invalid-state',
 'process-deadline':'unavailable','process-unavailable':'unavailable','process-failed':'unavailable',
 'invalid-issue-inventory':'unavailable','invalid-issue-response':'unavailable','invalid-source-revision':'unavailable',
 'intake-unavailable':'internal','invalid-query-bounds':'internal','invalid-issue':'internal',
};
async function invoke(f,request=f.request,args=['--config',f.configPath]){
 const r=await runProcess(process.execPath,[f.cli,...args],{deadline:Date.now()+10000,maxBytes:65536,input:typeof request==='string'?request:JSON.stringify(request)});
 return JSON.parse(r.stdout);
}
/** A blocked response keeps schemaVersion, status, selections and reason, and adds `error` with the registry body. */
function assertBlocked(response,reason,code=REASON_CODES[reason]){
 assert.deepEqual(Object.keys(response),['schemaVersion','status','selections','reason','error'],JSON.stringify(response));
 assert.equal(response.schemaVersion,1);assert.equal(response.status,'blocked');assert.deepEqual(response.selections,[]);assert.equal(response.reason,reason);
 assert.deepEqual({error:response.error},errorBody(code,{detail:reason}),reason);
}
/** Complete and uncertain responses are not refusals and keep exactly their 1.x fields. */
const assertUnchanged=response=>assert.deepEqual(Object.keys(response),['schemaVersion','status','selections','reason'],JSON.stringify(response));

test('each blocked reason maps to the approved registry code, and the README lists the same table',async()=>{
 const {REASON_CODES:intake,refusalBody}=await import('../dist/error-body.js');
 assert.deepEqual({...intake},REASON_CODES);
 const readme=await readFile(new URL('../README.md',import.meta.url),'utf8');
 const section=readme.slice(readme.indexOf('### Refusal error body'));
 const rows=[...section.slice(0,section.indexOf('\n## ')).matchAll(/^\| `([a-z-]+)` \| `([a-z-]+)` \| (yes|no) \|$/gm)].map(m=>[m[1],m[2],m[3]]);
 assert.deepEqual(Object.fromEntries(rows.map(([reason,code])=>[reason,code])),REASON_CODES,'the README table names every reason and its code');
 assert.equal(rows.length,Object.keys(REASON_CODES).length,'each reason is listed once');
 for(const [reason,code,retryable] of rows){
  assert.equal(retryable==='yes',errorCodes[code].retryable,`${reason}: the README's Retryable column is the registry flag`);
  assert.equal(retryable==='yes',refusalBody(reason).error.retryable,`${reason}: the README's Retryable column is what intake prints`);
 }
});
test('every body equals the registry errorBody, with the registry retryable flag',async()=>{
 const {refusalBody}=await import('../dist/error-body.js');
 for(const [reason,code] of Object.entries(REASON_CODES)){
  assert.deepEqual(refusalBody(reason),errorBody(code,{detail:reason}),reason);
  assert.equal(refusalBody(reason).error.retryable,errorCodes[code].retryable,reason);
 }
 assert.deepEqual(refusalBody('not-a-listed-reason'),errorBody('internal',{detail:'not-a-listed-reason'}),'an unlisted reason is internal');
 assert.deepEqual(refusalBody('invalid-or-unavailable-intake','invalid-state'),errorBody('invalid-state',{detail:'invalid-or-unavailable-intake'}),'a configuration failure keeps its reason');
});
test('a configuration that is missing, invalid or drifted is the operator\'s state, with the same reason',async()=>{
 const f=await fixture();try{
  assertBlocked(await invoke(f,f.request,['--config',join(f.directory,'missing.json')]),'invalid-or-unavailable-intake','invalid-state');
  const invalid=join(f.directory,'invalid.json');await writeFile(invalid,JSON.stringify({...f.config,model:'not-a-model'}),{mode:0o600});
  assertBlocked(await invoke(f,f.request,['--config',invalid]),'invalid-or-unavailable-intake','invalid-state');
  await writeFile(f.config.planWork,'A changed plan-work skill.');
  assertBlocked(await invoke(f),'invalid-or-unavailable-intake','invalid-state');
  assert.deepEqual((await f.read()).calls,[],'no refusal reached a tool');
 }finally{await f.close();}
});
test('malformed input refused before the request carries the body',async()=>{
 const f=await fixture();try{
  assertBlocked(await invoke(f,'{}',[]),'invalid-or-unavailable-intake');
  assertBlocked(await invoke(f,'not json'),'invalid-or-unavailable-intake');
  assertBlocked(await invoke(f,'x'.repeat(16385)),'invalid-or-unavailable-intake');
 }finally{await f.close();}
});
test('refused requests carry the body: invalid, forbidden, expired and unknown',async()=>{
 const f=await fixture();try{
  const {runId:_unused,...missing}=f.request;
  assertBlocked(await invoke(f,missing),'invalid-request');
  assertBlocked(await invoke(f,{...f.request,operation:'publish'}),'invalid-operation');
  assertBlocked(await invoke(f,{...f.request,runId:'not a run'}),'invalid-run');
  assertBlocked(await invoke(f,{...f.request,evidenceDirectory:'relative/evidence'}),'invalid-evidence-directory');
  assertBlocked(await invoke(f,{...f.request,authority:'owner-queue'}),'unauthorized-maintenance');
  assertBlocked(await invoke(f,{...f.request,deadline:1}),'expired-deadline');
  assertBlocked(await invoke(f,{...f.request,operation:'reconcile',runId:'unknown-run',deadline:1}),'unknown-run');
  assert.deepEqual((await f.read()).calls,[],'no refusal reached a tool');
 }finally{await f.close();}
});
test('state, capacity, availability and internal refusals carry the body',async()=>{
 const f=await fixture({mode:'lost-response'});try{
  assertUnchanged(await invoke(f));
  assertBlocked(await invoke(f),'interrupted-run-needs-reconciliation');
  assertBlocked(await invoke(f,{...f.request,deadline:f.request.deadline+1}),'run-identity-mismatch');
  await f.change({mode:'lookup-unavailable'});
  assertBlocked(await invoke(f,{...f.request,operation:'reconcile'}),'process-failed');
  await writeFile(join(f.config.stateRoot,'run-corrupt-run.json'),'not json',{mode:0o600});
  assertBlocked(await invoke(f,{...f.request,runId:'corrupt-run'}),'intake-unavailable');
  await writeFile(f.configPath,JSON.stringify({...f.config,limits:{...f.config.limits,capacityBytes:1024*1024}}),{mode:0o600});
  assertBlocked(await invoke(f,{...f.request,runId:'small-capacity'}),'evidence-capacity');
 }finally{await f.close();}
});
test('a source that moves during planning is a revision conflict with the body',async()=>{
 const f=await fixture({mode:'stale-source'});try{
  assertBlocked(await invoke(f),'source-not-current');
  assert.equal((await f.read()).creates,0);
 }finally{await f.close();}
});
test('complete responses keep exactly their 1.x fields',async()=>{
 const f=await fixture();try{
  const response=await invoke(f);assertUnchanged(response);assert.equal(response.status,'complete');
 }finally{await f.close();}
});
