import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {evaluateCi} from '../scripts/delivery-preflight/ci.mjs';
import {parseWorkflow,expectedJobs} from '../scripts/delivery-preflight/workflows.mjs';
import {CI_PROVIDERS} from '../scripts/delivery-preflight/context.mjs';
import {noticeMessage,selectChecks} from '../scripts/ci-selection/selection.mjs';
import {ownerHash} from '../scripts/ci-selection/standalone.mjs';
const sha='a'.repeat(40),base='b'.repeat(40),repo='owner/repo',branch='feature';
const changes=[{filename:'modules/wemo/tests/module.test.ts',status:'modified',mode:'100644',beforeMode:'100644'}];
const files=changes.map(row=>row.filename),provider=CI_PROVIDERS.find(row=>row.id==='github-actions');
const workflowFiles=Object.fromEntries(['checks.yml','workflow.yml'].map(file=>[file,readFileSync(new URL('../.github/workflows/'+file,import.meta.url),'utf8')]));
function world(){
 const selection=selectChecks({event:'pull_request',paths:files,changes,complete:true});
 const expected=expectedJobs(Object.entries(workflowFiles).map(([file,text])=>parseWorkflow(file,text)),{event:'pull_request',branch:'main',files,changes,filesComplete:true},provider);
 const checks=expected.jobs.map((row,i)=>({id:100+i,name:row.name,head_sha:sha,app:{slug:'github-actions',id:15368},check_suite:{id:9},status:'completed',conclusion:row.selected?'success':'skipped',started_at:'2026-11-02T10:00:00Z',completed_at:'2026-11-02T10:01:00Z',details_url:`https://github.com/${repo}/actions/runs/41/job/${100+i}`,output:{annotations_count:0}}));
 const core=checks.find(row=>row.name==='Build, lint and core tests on ubuntu-latest');
 const selector=checks.find(row=>row.name==='Select affected checks');
 selector.output.annotations_count=1;core.output.annotations_count=1;
 const command={schema:'standalone-command/1',owner:'wemo',head:sha,runId:41,attempt:1,commandHash:ownerHash('wemo'),result:'success',coverage:{file:'modules/wemo/dist/tests/module.test.js',tests:29,passed:29,changedTests:6,failed:0,cancelled:0,skipped:0}};
 return {checks,core,selector,command,selection,suite:{id:9,head_sha:sha,head_branch:branch,repository:{full_name:repo},app:{slug:'github-actions',id:15368}},
  annotations:{[selector.id]:[{annotation_level:'notice',title:'Affected checks',message:noticeMessage(selection)}],
   [core.id]:[{annotation_level:'notice',title:'Standalone command',message:JSON.stringify(command)}]},
  run:{id:41,head_sha:sha,head_branch:branch,event:'pull_request',repository:{full_name:repo},path:'.github/workflows/checks.yml',check_suite_id:9,run_attempt:1,status:'completed',conclusion:'success'},
  job:{id:core.id,run_id:41,run_attempt:1,head_sha:sha,name:core.name,check_run_url:`https://api.github.com/repos/${repo}/check-runs/${core.id}`,status:'completed',conclusion:'success',started_at:core.started_at,completed_at:core.completed_at,steps:[{name:'Run complete standalone owning commands',status:'completed',conclusion:'success'}]}};
}
async function evaluate(state){
 const problems=[],gate={evidence:{},unresolved:message=>problems.push(message),note:()=>{}};
 const get=async url=>{
  if(url.includes('/git/trees/'))return {truncated:false,tree:changes.map(row=>({path:row.filename,type:'blob',mode:'100644'}))};
  if(url===`/repos/${repo}/contents/.depot/workflows?ref=${sha}`)return [];
  if(url===`/repos/${repo}/contents/.github/workflows?ref=${sha}`)return Object.keys(workflowFiles).map(file=>({type:'file',name:file,path:'.github/workflows/'+file}));
  const file=Object.keys(workflowFiles).find(file=>url===`/repos/${repo}/contents/.github/workflows/${file}?ref=${sha}`);
  if(file)return {content:Buffer.from(workflowFiles[file]).toString('base64')};
  if(url===`/repos/${repo}/actions/runs/41`)return state.run;
  throw new Error('unexpected GET '+url);
 };
 const getAll=async url=>{
  if(url.includes('/check-runs?'))return state.checks;
  if(url.includes('/check-suites?'))return [state.suite];
  if(url.includes('/jobs?'))return [state.job];
  const match=url.match(/check-runs\/(\d+)\/annotations/);if(match)return state.annotations[match[1]]??[];
  throw new Error('unexpected paginated GET '+url);
 };
 const ctx={repo,github:{get,getAll},read:async(_gate,fn)=>{try{return {ok:true,value:await fn()};}catch(error){problems.push(error.message);return {ok:false};}}};
 await evaluateCi(ctx,gate,{sha,event:'pull_request',branch:'main',checkBranch:branch,paths:files,changes:changes.map(({filename,status})=>({filename,status})),filesComplete:true,requiredContexts:[],baseline:base});
 return {problems,evidence:gate.evidence};
}
test('preflight accepts only native exact-head complete owning execution',async()=>{
 const result=await evaluate(world());assert.deepEqual(result.problems,[]);assert.equal(result.evidence.standaloneCommands.receipts[0].coverage.changedTests,6);
});
for(const [label,mutate] of [
 ['missing notice',s=>{s.annotations[s.core.id]=[];}],
 ['duplicate notice',s=>{s.annotations[s.core.id].push(s.annotations[s.core.id][0]);}],
 ['wrong-head receipt',s=>{s.command.head=base;}],
 ['empty changed entry',s=>{s.command.coverage.changedTests=0;}],
 ['skipped test',s=>{s.command.coverage.skipped=1;}],
 ['wrong command',s=>{s.command.commandHash='0'.repeat(64);} ],
 ['wrong native source',s=>{s.run.head_sha=base;}],
 ['wrong native event',s=>{s.run.event='workflow_dispatch';}],
 ['wrong workflow',s=>{s.run.path='.github/workflows/other.yml';}],
 ['wrong native attempt',s=>{s.job.run_attempt=2;}],
 ['wrong suite source',s=>{s.suite.head_sha=base;}],
 ['wrong suite app',s=>{s.suite.app.id=1;}],
 ['wrong native app',s=>{s.core.app.id=1;}],
 ['missing completion step',s=>{s.job.steps=[];}],
 ['skipped completion step',s=>{s.job.steps[0].conclusion='skipped';}],
 ['failed job',s=>{s.core.conclusion='failure';}],
 ['unexpected App skip',s=>{s.annotations[s.selector.id][0].message=noticeMessage({mode:'full',groups:['runtime','maintenance','modules','chompi','shared']});s.core.conclusion='cancelled';}],
])test('preflight refuses '+label,async()=>{
 const state=world();mutate(state);
 if(!['missing notice','duplicate notice'].includes(label))state.annotations[state.core.id][0].message=JSON.stringify(state.command);
 assert.ok((await evaluate(state)).problems.length>0);
});
