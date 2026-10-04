import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,chmod,rm,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {runCloseout as executeCloseout} from '../closeout/closeout.mjs';
import {validateAssessment,canonical,recommendationEntry} from '../closeout/assessment.mjs';
const advice={action:'unchanged',session:'One-shot',surface:'Backend',codex:'gpt-6.1-sol',claude:'opus',effort:'high',codexReviewer:'gpt-6-astra',claudeReviewer:'opus',cheaperClaude:'none',missing:'none'};
const assessment=async(_config,_input,issue,related)=>({status:'complete',selected:{url:issue.url,bodySha256:hash(issue.body),allAcceptanceReviewed:true,requiredAcceptance:['source','installed'],acceptedSourceOnly:null,satisfied:true},affected:related.map(item=>({url:item.url,bodySha256:hash(item.body),changedMeaning:false,hold:'unchanged',recommendation:advice,criteria:[{line:1,kind:'physical',status:'pending',owner:item.url,nextAction:'complete-physical-acceptance',evidenceUrl:null,observationDate:null}]}))});
const runCloseout=(input,config,api,validator,planner=assessment,render=canonical)=>executeCloseout(input,config,api,validator,planner,render);
import {validateInstallReceipt} from '../../../packages/contracts/dist/index.js';
const hash=x=>createHash('sha256').update(x).digest('hex');
const corpus=JSON.parse(await readFile(new URL('../../../packages/contracts/fixtures/install-receipt-v1.json',import.meta.url),'utf8'));
async function fixture(){
 const dir=await mkdtemp(join(process.env.TMPDIR??'/tmp','maintenance-closeout-'));await chmod(dir,0o700);
 const install=structuredClone(corpus.cases.find(x=>x.id==='upgrade-success').value),bytes=JSON.stringify(install);
 await writeFile(join(dir,'install.json'),bytes,{mode:0o600});
 const issue={id:'issue-one',number:1,url:'https://github.com/jimmie-potts/agent-device-hub/issues/1',state:'OPEN',stateReason:null,body:'Supported source and installed defect',labels:['status:in-progress'],parent:null,blockedBy:[],blocking:[],subIssues:[],projects:[]};
 const input={schemaVersion:1,operation:'closeout',repository:'jimmie-potts/agent-device-hub',issue:1,pr:2,merge:'b'.repeat(40),acceptedSourceOnly:null,installationReceipt:{path:join(dir,'install.json'),sha256:hash(bytes)},requirementsBodySha256:hash(issue.body),requiredAcceptance:['source','installed'],deadline:Date.now()/1000+30,evidenceDirectory:dir};
 const calls=[];let comments=[];
 const api={async issue(){return structuredClone(issue);},async pull(){return {merged:true,merge_commit_sha:input.merge};},async comments(){return comments;},async comment(_n,body){calls.push('comment');comments.push({body});},async close(){calls.push('close');issue.state='CLOSED';issue.stateReason='COMPLETED';issue.labels=[];},async projectDone(){calls.push('project');}};
 return {dir,input,issue,api,calls,config:{schemaVersion:1,repository:input.repository,stateDirectory:dir,installationId:'primary',capacityBytes:16*1024*1024},async dispose(){await rm(dir,{recursive:true,force:true});}};
}
test('installed receipt does not discharge physical acceptance',async()=>{
 const f=await fixture();try{f.input.requiredAcceptance.push('physical');const r=await runCloseout(f.input,f.config,f.api,validateInstallReceipt);assert.equal(r.status,'blocked');assert.deepEqual(f.calls,[]);}finally{await f.dispose();}
});
test('closes only the selected installed issue and is idempotent',async()=>{
 const f=await fixture();try{
  const first=await runCloseout(f.input,f.config,f.api,validateInstallReceipt);
  assert.equal(first.status,'complete',first.reason);assert.deepEqual(f.calls,['comment','close']);
  const second=await runCloseout(f.input,f.config,f.api,validateInstallReceipt);
  assert.equal(second.status,'complete',second.reason);assert.deepEqual(f.calls,['comment','close']);
 }finally{await f.dispose();}
});
test('acceptance changes and invalid receipts stop before publication',async()=>{
 const f=await fixture();try{
  f.issue.body+=' extra acceptance';
  assert.equal((await runCloseout(f.input,f.config,f.api,validateInstallReceipt)).reason,'requirements-changed-after-review');
  assert.deepEqual(f.calls,[]);
  f.input.requirementsBodySha256=hash(f.issue.body);f.input.installationReceipt.sha256='0'.repeat(64);
  assert.equal((await runCloseout(f.input,f.config,f.api,validateInstallReceipt)).reason,'installation-not-verified');assert.deepEqual(f.calls,[]);
 }finally{await f.dispose();}
});
test('a lost close response is reconciled by reads without replay',async()=>{
 const f=await fixture();try{
  const close=f.api.close;f.api.close=async()=>{await close();throw new Error('lost-response');};
  assert.equal((await runCloseout(f.input,f.config,f.api,validateInstallReceipt)).status,'uncertain');
  assert.equal((await runCloseout(f.input,f.config,f.api,validateInstallReceipt)).reason,'unfinished-closeout-needs-reconciliation');
  f.input.operation='reconcile';const recovered=await runCloseout(f.input,f.config,f.api,validateInstallReceipt);
  assert.equal(recovered.status,'complete',recovered.reason);assert.deepEqual(f.calls,['comment','close']);
 }finally{await f.dispose();}
});
test('lost publication response cannot replay or close the issue',async()=>{
 const f=await fixture();try{
  const comment=f.api.comment;f.api.comment=async(...args)=>{await comment(...args);throw new Error('lost-response');};
  assert.equal((await runCloseout(f.input,f.config,f.api,validateInstallReceipt)).status,'uncertain');
  f.input.operation='reconcile';assert.equal((await runCloseout(f.input,f.config,f.api,validateInstallReceipt)).reason,'closeout-still-incomplete');
  assert.deepEqual(f.calls,['comment']);assert.equal(f.issue.state,'OPEN');
 }finally{await f.dispose();}
});
test('already published completion reconstructs stable local state',async()=>{
 const f=await fixture();try{
  assert.equal((await runCloseout(f.input,f.config,f.api,validateInstallReceipt)).status,'complete');
  await rm(join(f.dir,`${f.input.issue}-${f.input.merge}.json`));
  assert.equal((await runCloseout(f.input,f.config,f.api,validateInstallReceipt)).status,'complete');
  const again=await runCloseout(f.input,f.config,f.api,validateInstallReceipt);
  assert.equal(again.status,'complete',again.reason);assert.deepEqual(f.calls,['comment','close']);
 }finally{await f.dispose();}
});
test('selected Project status changes preserve parent and unrelated fields',async()=>{
 const f=await fixture();try{
  const project='PVT_kwHOAu24Wc4Bkz2N',status='PVTSSF_lAHOAu24Wc4Bkz2NzhjjEkM',phase='PVTSSF_lAHOAu24Wc4Bkz2NzhjjE0g';
  const parent={...structuredClone(f.issue),id:'parent',number:9,url:'https://github.com/jimmie-potts/agent-device-hub/issues/9',projects:[{id:'parent-project',project,done:'done',values:{[status]:'progress',[phase]:'phase-one',commitment:'later'}}]};
  f.issue.parent={url:parent.url};f.issue.projects=[{id:'selected-project',project,done:'done',values:{[status]:'progress',[phase]:'phase-one',commitment:'selected'}}];
  f.api.issue=async n=>structuredClone(n===9?parent:f.issue);
  f.api.projectDone=async(id,done)=>{assert.equal(id,'selected-project');f.calls.push('project');f.issue.projects[0].values[status]=done;};
  const result=await runCloseout(f.input,f.config,f.api,validateInstallReceipt);
  assert.equal(result.status,'complete',result.reason);assert.equal(parent.state,'OPEN');assert.equal(parent.projects[0].values[status],'progress');
  assert.equal(f.issue.projects[0].values.commitment,'selected');assert.deepEqual(f.calls,['comment','close','project']);
 }finally{await f.dispose();}
});
test('an independent acceptance assessment catches a missed physical criterion',async()=>{
 const f=await fixture();try{
  f.issue.body='Source, installed and physical acceptance are required.';f.input.requirementsBodySha256=hash(f.issue.body);
  const planner=async(...args)=>{const result=await assessment(...args);result.selected.requiredAcceptance.push('physical');return result;};
  const result=await runCloseout(f.input,f.config,f.api,validateInstallReceipt,planner);
  assert.equal(result.reason,'independent-acceptance-pending');assert.equal(result.effects,'none');assert.deepEqual(f.calls,[]);
 }finally{await f.dispose();}
});
test('missing semantic assessment reports tracker pending while retaining installed receipt identity',async()=>{
 const f=await fixture();try{
  const result=await executeCloseout(f.input,f.config,f.api,validateInstallReceipt);
  assert.equal(result.status,'blocked');assert.equal(result.reconciliation,'pending');assert.deepEqual(result.installationReceipt,f.input.installationReceipt);assert.deepEqual(f.calls,[]);
 }finally{await f.dispose();}
});
test('explicit affected links are read and require criterion-specific remaining work',async()=>{
 const f=await fixture();try{
  const linked={...structuredClone(f.issue),number:19,url:'https://github.com/jimmie-potts/agent-device-hub/issues/19',body:'Observe the installed client before completion.'};
  f.issue.body+=' Related remaining acceptance: '+linked.url;f.input.requirementsBodySha256=hash(f.issue.body);
  f.api.issue=async n=>structuredClone(n===19?linked:f.issue);
  let inspected=false;
  const planner=async(...args)=>{inspected=args[3].some(x=>x.url===linked.url);const result=await assessment(...args);result.affected[0].criteria=[];return result;};
  const result=await runCloseout(f.input,f.config,f.api,validateInstallReceipt,planner);
  assert.equal(inspected,true);assert.equal(result.reason,'affected-criteria-missing');assert.deepEqual(f.calls,[]);
 }finally{await f.dispose();}
});
test('canonical recommendation tooling renders and parses separately prepared public text',async()=>{
 const f=await fixture();try{
  const root=new URL('../../../',import.meta.url).pathname;
  const config={deadline:f.input.deadline,planning:{python:'/usr/bin/python3',policyRevision:'a'.repeat(40),recommendations:join(root,'docs/work-guide/work/recommendations.py'),helper:join(root,'apps/maintenance/closeout/recommendation.py')}};
  const entry=recommendationEntry(f.issue,{...advice,action:'refresh'},config,f.input);
  const rendered=await canonical(config,'render',f.issue.body,entry);assert.equal(rendered.parsed.state,'recommended');
  assert.match(rendered.body,/## Execution recommendation/);assert.match(rendered.body,/Two fresh read-only/);
  assert.equal((await canonical(config,'parse',rendered.body)).state,'recommended');
  const insufficient=recommendationEntry(f.issue,{...advice,action:'insufficient',missing:'client-evidence'},config,f.input);
  assert.equal((await canonical(config,'render',f.issue.body,insufficient)).parsed.state,'insufficient');
 }finally{await f.dispose();}
});
test('only the accepted selected dependency hold is removed; parent acceptance stays open',async()=>{
 const f=await fixture();try{
  const dependent={...structuredClone(f.issue),number:19,url:'https://github.com/jimmie-potts/agent-device-hub/issues/19',body:'Deliver the dependent source work.',labels:['blocked'],blockedBy:[{url:f.issue.url,state:'OPEN',stateReason:null}]};
  f.issue.blocking=[{url:dependent.url}];f.api.issue=async n=>structuredClone(n===19?dependent:f.issue);
  f.api.labels=async(n,_repo,labels)=>{assert.equal(n,19);f.calls.push('dependent-labels');dependent.labels=labels;};
  const planner=async(...args)=>{const result=await assessment(...args);result.affected[0].hold='remove-selected-dependency';return result;};
  const result=await runCloseout(f.input,f.config,f.api,validateInstallReceipt,planner);
  assert.equal(result.status,'complete',result.reason);assert.deepEqual(dependent.labels,[]);assert.equal(dependent.state,'OPEN');
  assert.deepEqual(f.calls,['dependent-labels','comment','close']);
 }finally{await f.dispose();}
});
test('repeated closeout applies newly assessed related updates before becoming a no-op',async()=>{
 const f=await fixture();try{
  const dependent={...structuredClone(f.issue),number:19,url:'https://github.com/jimmie-potts/agent-device-hub/issues/19',body:'Deliver the dependent source work.',labels:['blocked'],blockedBy:[{url:f.issue.url,state:'OPEN',stateReason:null}]};
  f.issue.blocking=[{url:dependent.url}];f.api.issue=async n=>structuredClone(n===19?dependent:f.issue);
  f.api.labels=async(n,_repo,labels)=>{assert.equal(n,19);f.calls.push('dependent-labels');dependent.labels=labels;};
  const first=await runCloseout(f.input,f.config,f.api,validateInstallReceipt);
  assert.equal(first.status,'complete',first.reason);assert.deepEqual(dependent.labels,['blocked']);assert.deepEqual(f.calls,['comment','close']);
  dependent.blockedBy[0].state='CLOSED';dependent.blockedBy[0].stateReason='COMPLETED';
  const planner=async(...args)=>{const result=await assessment(...args);result.affected[0].hold='remove-selected-dependency';return result;};
  const second=await runCloseout(f.input,f.config,f.api,validateInstallReceipt,planner);
  assert.equal(second.status,'complete',second.reason);assert.deepEqual(dependent.labels,[]);assert.equal(dependent.state,'OPEN');
  assert.deepEqual(f.calls,['comment','close','dependent-labels']);
  const third=await runCloseout(f.input,f.config,f.api,validateInstallReceipt,planner);
  assert.equal(third.status,'complete',third.reason);assert.deepEqual(f.calls,['comment','close','dependent-labels']);
 }finally{await f.dispose();}
});
test('selected changes during related updates stop before acceptance publication',async()=>{
 for(const change of ['requirements','ownership','acceptance-comment','publication-conflict']){
  const f=await fixture();try{
   const comments=await f.api.comments();f.api.comments=async n=>n===1?comments:[];
   const dependent={...structuredClone(f.issue),number:19,url:'https://github.com/jimmie-potts/agent-device-hub/issues/19',body:'Deliver the dependent source work.',labels:['blocked'],blockedBy:[{url:f.issue.url,state:'OPEN',stateReason:null}]};
   f.issue.blocking=[{url:dependent.url}];f.api.issue=async n=>structuredClone(n===19?dependent:f.issue);
   f.api.labels=async(n,_repo,labels)=>{
    assert.equal(n,19);f.calls.push('dependent-labels');dependent.labels=labels;
    if(change==='requirements')f.issue.body+=' Physical observation is required.';
    if(change==='ownership')f.issue.assignees=['new-owner'];
    if(change==='acceptance-comment')comments.push({id:9,body:'Physical observation is required before closure.'});
    if(change==='publication-conflict')comments.push({id:9,body:`<!-- bunny-closeout:${f.input.issue}:${f.input.merge} -->\nConflicting completion receipt.`});
   };
   const planner=async(...args)=>{const result=await assessment(...args);result.affected[0].hold='remove-selected-dependency';return result;};
   const result=await runCloseout(f.input,f.config,f.api,validateInstallReceipt,planner);
   assert.equal(result.status,'uncertain',change);assert.equal(result.reconciliation,'pending');
   assert.equal(result.reason,change==='requirements'?'requirements-changed-after-review':change==='publication-conflict'?'closeout-publication-conflict':'selected-record-changed');
   assert.deepEqual(f.calls,['dependent-labels'],change);assert.deepEqual(dependent.labels,[]);assert.equal(f.issue.state,'OPEN');
  }finally{await f.dispose();}
 }
});
test('concrete bounded planner independently reads current public acceptance without raw installation evidence',async()=>{
 const {fixture:toolsFixture}=await import('./fixture.mjs');const f=await fixture(),tools=await toolsFixture();
 try{
  const root=new URL('../../../',import.meta.url).pathname,planning={timeoutSeconds:3,codex:tools.config.tools.codex,python:await realpath('/usr/bin/python3'),checkout:tools.config.checkout,planWork:tools.config.planWork,recommendationPolicy:tools.config.planWork,recommendations:join(root,'docs/work-guide/work/recommendations.py'),helper:join(root,'apps/maintenance/closeout/recommendation.py'),model:'gpt-6-astra',policyRevision:'a'.repeat(40),files:{}};
  for(const key of ['codex','python','planWork','recommendationPolicy','recommendations','helper'])planning.files[planning[key]]=hash(await readFile(planning[key]));
  planning.files[join(root,'docs/work-guide/work/story_sections.py')]=hash(await readFile(join(root,'docs/work-guide/work/story_sections.py')));
  const result=await executeCloseout(f.input,{...f.config,planning},f.api,validateInstallReceipt);
  assert.equal(result.status,'complete',result.reason);assert.deepEqual(f.calls,['comment','close']);
  const remote=await tools.read();assert.match(remote.prompt,/complete current acceptance/);assert.ok(!remote.prompt.includes(f.input.installationReceipt.path));
  const receipt=JSON.parse(await readFile(join(f.dir,'assessment-receipt.json'),'utf8'));assert.equal(receipt.observedModel,'unknown');
 }finally{await f.dispose();await tools.close();}
});
test('public acceptance comments reach assessment and related graph drift blocks before close',async()=>{
 const f=await fixture();try{
  const related={...structuredClone(f.issue),number:19,url:'https://github.com/jimmie-potts/agent-device-hub/issues/19',body:'Remaining physical acceptance.',labels:[]};
  f.issue.blocking=[{url:related.url}];f.api.issue=async n=>structuredClone(n===19?related:f.issue);
  const ownComments=f.api.comments;f.api.comments=async n=>n===19?[{id:8,body:'Physical observation is still missing.',html_url:related.url+'#issuecomment-8'}]:ownComments();
  const planner=async(...args)=>{assert.match(args[3][0].acceptanceComments[0].body,/still missing/);const result=await assessment(...args);related.blocking=[{url:'https://github.com/jimmie-potts/agent-device-hub/issues/20',state:'OPEN'}];return result;};
  const result=await runCloseout(f.input,f.config,f.api,validateInstallReceipt,planner);
  assert.equal(result.reason,'affected-record-changed');assert.deepEqual(f.calls,[]);assert.equal(f.issue.state,'OPEN');
 }finally{await f.dispose();}
});
test('concrete GitHub adapter preserves the assessed date through the canonical live CLI',async t=>{
 t.mock.method(globalThis,'Date',class extends Date {constructor(...args){super(...(args.length?args:['2000-01-01T00:00:00.000Z']));}});
 const {closeoutFixture}=await import('./closeout-fixture.mjs');const {cli}=await import('../closeout/closeout.mjs');
 const f=await closeoutFixture({related:true,mode:'closeout-advice'});try{
  const result=await cli(f.configPath,f.request);assert.equal(result.status,'complete',result.reason);
  const remote=await f.read();assert.match(remote.issues[1].body,/\*\*Assessed:\*\* 2000-01-01/);assert.equal(remote.issues[1].state,'open');
  assert.equal(remote.issues[0].state,'closed');assert.equal((await canonical({...f.config,deadline:f.request.deadline},'parse',remote.issues[1].body)).state,'recommended');
 }finally{await f.close();}
});
test('accepted source-only scope closes only selected source work and preserves installation pending',async()=>{
 const f=await fixture();try{
  const installation={...structuredClone(f.issue),number:19,url:'https://github.com/jimmie-potts/agent-device-hub/issues/19',body:'Install the delivered source revision.',labels:[]};
  const reason='Source-only delivery is accepted here because activation has separate host acceptance.';
  f.issue.body=reason+'\nInstallation remains required under '+installation.url;
  f.input={...f.input,requirementsBodySha256:hash(f.issue.body),requiredAcceptance:['source'],installationReceipt:null,acceptedSourceOnly:{reason,installationIssue:installation.url}};
  f.api.issue=async n=>structuredClone(n===19?installation:f.issue);
  const planner=async(...args)=>{const result=await assessment(...args);result.selected.requiredAcceptance=['source'];result.selected.acceptedSourceOnly=f.input.acceptedSourceOnly;return result;};
  const result=await runCloseout(f.input,f.config,f.api,()=>{throw new Error('must-not-validate-nonexistent-installation');},planner);
  assert.equal(result.status,'complete',result.reason);assert.equal(installation.state,'OPEN');
  const receipt=JSON.parse(await readFile(result.receipt.path,'utf8'));assert.equal(receipt.installationReceiptSha256,null);assert.equal(receipt.installationPending.issue,installation.url);
  assert.match((await f.api.comments())[0].body,/Overall installation remains pending/);
 }finally{await f.dispose();}
});
test('a source-only claim without reviewed narrowing and independent confirmation cannot close',async()=>{
 const f=await fixture();try{
  f.input={...f.input,requiredAcceptance:['source'],installationReceipt:null,acceptedSourceOnly:{reason:'Source-only exception.',installationIssue:'https://github.com/jimmie-potts/agent-device-hub/issues/19'}};
  assert.equal((await runCloseout(f.input,f.config,f.api,validateInstallReceipt)).reason,'source-only-exception-not-in-reviewed-body');assert.deepEqual(f.calls,[]);
 }finally{await f.dispose();}
});
