import {assess,validateAssessment,canonical,recommendationEntry,checkPlanner} from './assessment.mjs';
import {runProcess} from '../dist/process.js';
import {PrivateStore} from '../dist/storage.js';
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {open,lstat,realpath,mkdir} from 'node:fs/promises';
import {resolve,join,dirname,basename,isAbsolute} from 'node:path';
import {spawnSync} from 'node:child_process';

const REPOSITORY='jimmie-potts/agent-device-hub';
export const PROJECT='PVT_kwHOAu24Wc4Bkz2N';
export const STATUS='PVTSSF_lAHOAu24Wc4Bkz2NzhjjEkM';
export const PHASE='PVTSSF_lAHOAu24Wc4Bkz2NzhjjE0g';
const sha256=x=>createHash('sha256').update(x).digest('hex');
const require=(ok,reason)=>{if(!ok)throw new Error(reason);};
const exact=(value,keys)=>value && typeof value==='object' && !Array.isArray(value) &&
 Object.keys(value).sort().join(',')===keys.sort().join(',');
const digest=x=>typeof x==='string' && /^[a-f0-9]{64}$/.test(x);
const number=x=>Number.isSafeInteger(x) && x>0;
const safeReason=error=>/^[a-z][a-z0-9-]{0,90}$/.test(error?.message??'')?error.message:'closeout-evidence-unavailable';

async function privateDirectory(path,create=false){
 require(typeof path==='string' && isAbsolute(path),'invalid-private-directory');
 if(create)await mkdir(path,{recursive:true,mode:0o700});
 const info=await lstat(path);
 require(info.isDirectory() && !info.isSymbolicLink() && info.uid===process.getuid() &&
   (info.mode&0o077)===0 && await realpath(path)===resolve(path),'unsafe-private-directory');
}
async function privateRead(path){
 require(isAbsolute(path),'invalid-private-file');
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const before=await file.stat();
  require(before.isFile() && before.nlink===1 && before.uid===process.getuid() &&
   (before.mode&0o077)===0 && before.size<=4*1024*1024,'unsafe-private-file');
  const data=await file.readFile(),after=await file.stat();
  require(data.length===before.size && after.size===before.size && after.mtimeMs===before.mtimeMs &&
   after.ctimeMs===before.ctimeMs,'private-file-changed');
  return data;
 }finally{await file.close();}
}
async function atomic(path,value,capacity=16*1024*1024){
 const store=new PrivateStore(dirname(path),capacity);await store.open();await store.save(basename(path),value);
 return {path,sha256:sha256(await privateRead(path))};
}
async function existing(path){
 try{return JSON.parse((await privateRead(path)).toString());}
 catch(error){if(error.code==='ENOENT')return null;throw error;}
}
function validateInput(input,config){
 require(exact(input,['schemaVersion','operation','repository','issue','pr','merge','installationReceipt','acceptedSourceOnly','requirementsBodySha256','requiredAcceptance','deadline','evidenceDirectory']),'invalid-closeout-input');
 require(config.schemaVersion===1 && config.repository===REPOSITORY && input.schemaVersion===1 &&
  input.repository===REPOSITORY && ['closeout','reconcile'].includes(input.operation) && number(input.issue) &&
  number(input.pr) && /^[a-f0-9]{40}$/.test(input.merge) && digest(input.requirementsBodySha256) &&
  Number.isFinite(input.deadline),'invalid-closeout-identity');
 if(input.acceptedSourceOnly===null)require(exact(input.installationReceipt,['path','sha256']) && digest(input.installationReceipt.sha256),'invalid-installation-reference');
 else require(exact(input.acceptedSourceOnly,['reason','installationIssue'])&&typeof input.acceptedSourceOnly.reason==='string'&&input.acceptedSourceOnly.reason.trim().length>0&&input.acceptedSourceOnly.reason.length<=2000&&/^https:\/\/github\.com\/jimmie-potts\/(agent-device-hub|codex-nanoleaf|divoom-app-upgrade|agent-skills|dotfiles)\/issues\/[1-9][0-9]*$/.test(input.acceptedSourceOnly.installationIssue)&&input.installationReceipt===null,'invalid-source-only-exception');
 require(Array.isArray(input.requiredAcceptance) && input.requiredAcceptance.includes('source') &&
  (input.acceptedSourceOnly!==null||input.requiredAcceptance.includes('installed')) &&
  input.requiredAcceptance.every(x=>['source','installed','client','physical','owner-decision','unknown'].includes(x)),
  'invalid-acceptance-classes');
 require(input.requiredAcceptance.every(x=>['source','installed'].includes(x)),'additional-acceptance-pending');
 if(input.acceptedSourceOnly!==null)require(input.requiredAcceptance.every(x=>x==='source'),'source-only-acceptance-conflict');
 require(typeof config.installationId==='string' && config.installationId.length>0,'missing-installation-owner');
 require(Number.isSafeInteger(config.capacityBytes)&&config.capacityBytes>=1048576&&config.capacityBytes<=1073741824,'invalid-closeout-capacity');
}
const hold=issue=>issue.labels.some(x=>['blocked','hold','on-hold','status:blocked'].includes(x.toLowerCase()));
function selected(issue,input){
 require(issue.number===input.issue && issue.url===`https://github.com/${REPOSITORY}/issues/${input.issue}`,'selected-issue-mismatch');
 require(sha256(issue.body??'')===input.requirementsBodySha256,'requirements-changed-after-review');
 if(input.acceptedSourceOnly!==null)require(issue.body.includes(input.acceptedSourceOnly.reason)&&issue.body.includes(input.acceptedSourceOnly.installationIssue)&&input.acceptedSourceOnly.installationIssue!==issue.url,'source-only-exception-not-in-reviewed-body');
 require(!hold(issue),'selected-issue-held');
 require(issue.blockedBy.every(x=>x.state==='CLOSED' && x.stateReason==='COMPLETED'),'required-input-not-accepted');
 require(issue.state==='OPEN' || issue.state==='CLOSED' && issue.stateReason==='COMPLETED','selected-issue-not-completed');
}
async function evidence(api,issue,marker,rows){
 const repository=issue.url.replace('https://github.com/','').split('/issues/')[0];
 if(rows===undefined)rows=await api.comments(issue.number,repository);
 require(Array.isArray(rows),'acceptance-comments-unavailable');
 return {...issue,acceptanceComments:rows.filter(x=>!x.body?.includes(marker)).map(x=>({id:x.id??null,url:x.html_url??null,body:x.body??'',updatedAt:x.updated_at??null}))};
}
function snapshot(issue,selectedUrl){
 const edges=rows=>rows.map(x=>({url:x.url,...(x.url===selectedUrl?{}:{state:x.state??null,stateReason:x.stateReason??null})})).sort((a,b)=>a.url.localeCompare(b.url));
 return {url:issue.url,body:issue.body,state:issue.state,stateReason:issue.stateReason,labels:issue.labels,assignees:issue.assignees??[],parent:issue.parent,
  blockedBy:edges(issue.blockedBy),blocking:edges(issue.blocking),subIssues:edges(issue.subIssues),projects:issue.projects,acceptanceComments:issue.acceptanceComments};
}
async function affected(api,issue,marker){
 const links=item=>[...(item.body??'').matchAll(/https:\/\/github\.com\/jimmie-potts\/(?:agent-device-hub|codex-nanoleaf|divoom-app-upgrade|agent-skills|dotfiles)\/issues\/[1-9][0-9]*/g)].map(x=>({url:x[0]}));
 const result=[],seen=new Set([issue.url]),pending=[...issue.blockedBy,...issue.blocking,...issue.subIssues,...links(issue)];
 if(issue.parent)pending.push(issue.parent);
 while(pending.length){
  require(result.length<40,'affected-graph-capacity');
  const next=pending.shift();if(seen.has(next.url))continue;seen.add(next.url);
  require(/^https:\/\/github\.com\/jimmie-potts\/(agent-device-hub|codex-nanoleaf|divoom-app-upgrade|agent-skills|dotfiles)\/issues\/[1-9][0-9]*$/.test(next.url),'affected-repository-unavailable');
  const [repository,id]=next.url.replace('https://github.com/','').split('/issues/');
  const item=await evidence(api,await api.issue(Number(id),repository),marker);require(item.url===next.url&&item.number===Number(id),'affected-identity-mismatch');result.push(item);
  if(item.parent)pending.push(item.parent);
  pending.push(...item.blockedBy);
  if(issue.parent?.url===item.url)pending.push(...item.subIssues);
 }
 return result;
}
function projectPlan(issue,related){
 const matches=issue.projects.filter(x=>x.project===PROJECT);require(matches.length<=1,'ambiguous-project-membership');
 if(!matches.length)return null;
 const item=matches[0],parent=related.find(x=>x.url===issue.parent?.url);
 const parentItems=parent?.projects.filter(x=>x.project===PROJECT)??[];
 require(parentItems.length<=1,'ambiguous-parent-project-membership');
 const phase=parentItems[0]?.values[PHASE]??null;
 require(!parent || (item.values[PHASE]??null)===phase,'project-phase-reconciliation-pending');
 return {id:item.id,before:item.values,done:item.done,statusField:STATUS};
}
export async function runCloseout(input,config,api,validateReceipt,planner=assess,render=canonical){
 let mutated=input?.operation==='reconcile';
 config={...config,deadline:input?.deadline};
 const output={schemaVersion:1,status:'blocked',repository:input?.repository,issue:input?.issue,merge:input?.merge};
 try{
  validateInput(input,config);
  const live=()=>require(Date.now()/1000<input.deadline,'closeout-deadline-exhausted');
  live();await privateDirectory(input.evidenceDirectory);
  await privateDirectory(config.stateDirectory,input.operation==='closeout');
  if(input.acceptedSourceOnly===null){
   const installBytes=await privateRead(input.installationReceipt.path),install=JSON.parse(installBytes.toString());
   require(sha256(installBytes)===input.installationReceipt.sha256 && typeof validateReceipt==='function' && validateReceipt(install) &&
   install.runtime==='hub' && install.installationId===config.installationId && install.outcome==='succeeded' &&
   install.target?.kind==='release' && install.target.sourceRevision===input.merge &&
    install.running?.identity?.sourceRevision===input.merge && install.health.status==='healthy','installation-not-verified');
  }
  const marker=`<!-- bunny-closeout:${input.issue}:${input.merge} -->`;
  let issue=await evidence(api,await api.issue(input.issue),marker);selected(issue,input);
  const pull=await api.pull(input.pr);require(pull.merged && pull.merge_commit_sha===input.merge,'merged-revision-mismatch');
  const related=await affected(api,issue,marker),project=projectPlan(issue,related);
  const finish=input.acceptedSourceOnly===null?'The owning delivery supervisor verified source checks, independent reviews, merged-main CI and installed receipt, running identity and health. Required acceptance is source and installed verification.':`The owning delivery supervisor verified source checks, independent reviews and merged-main CI. The reviewed issue explicitly accepts source-only completion. Overall installation remains pending under ${input.acceptedSourceOnly.installationIssue}.`;
  const comment=`${marker}\n\n[PR #${input.pr}](https://github.com/${REPOSITORY}/pull/${input.pr}) merged as \`${input.merge}\`. ${finish} Related parent outcomes remain governed by their own acceptance; this receipt does not close them.\n`;
  const statePath=join(config.stateDirectory,`${input.issue}-${input.merge}.json`);
  let state=await existing(statePath);
  if(state&&!state.complete)mutated=true;
  require(!state || state.bodyHash===input.requirementsBodySha256,'closeout-state-conflict');
  if(input.operation==='closeout')require(!state || state.complete,'unfinished-closeout-needs-reconciliation');
  let assessment;
  if(input.operation==='reconcile'){
   require(state?.assessment,'reconciliation-assessment-missing');
   require(state.snapshots&&related.every(x=>JSON.stringify(snapshot(x,issue.url))===JSON.stringify(state.snapshots[x.url])),'affected-record-changed');
   assessment=validateAssessment(state.assessment,issue,related,input.acceptedSourceOnly);
  }else assessment=validateAssessment(await planner(config,input,issue,related),issue,related,input.acceptedSourceOnly);
  const updates=[];
  for(const item of assessment.affected){
   const original=related.find(x=>x.url===item.url);
   const update={url:item.url,number:original.number,repository:item.url.replace('https://github.com/','').split('/issues/')[0],body:original.body,labels:original.labels};
   if(item.hold==='remove-selected-dependency'){
    require(original.blockedBy.length===1&&original.blockedBy[0].url===issue.url,'unrelated-hold-removal');
    require(!original.labels.some(x=>['hold','on-hold','status:blocked'].includes(x.toLowerCase())),'unresolved-owner-hold');
    update.labels=original.labels.filter(x=>x!=='blocked');
   }
   if(item.recommendation.action==='unchanged'&&/^## Execution recommendation$/m.test(original.body)){
    const parsed=await render(config,'parse',original.body);
    require(['recommended','insufficient'].includes(parsed.state),'current-recommendation-unverified');
   }
   if(item.recommendation.action!=='unchanged'){
    require(original.state==='OPEN','closed-recommendation-update');
    update.entry=recommendationEntry(original,item.recommendation,config,input);
    const rendered=await render(config,'render',original.body,update.entry);
    require(rendered.parsed?.state===update.entry.status&&typeof rendered.body==='string','recommendation-render-incomplete');
    update.body=rendered.body;
    update.criteria=item.criteria.map(criterion=>{
     const text=original.body.split('\n')[criterion.line-1],lines=update.body.split('\n');
     const found=lines.flatMap((line,index)=>line===text?[index+1]:[]);
     require(text.trim()&&found.length===1,'criterion-reference-changed');
     return {...criterion,line:found[0]};
    });
   }
   if(update.body!==original.body||JSON.stringify(update.labels)!==JSON.stringify(original.labels))updates.push(update);
  }
  const publicationMatches=comments=>{
   require(Array.isArray(comments),'acceptance-comments-unavailable');
   const matching=comments.filter(x=>x.body?.includes(marker));require(matching.length<=1,'ambiguous-closeout-publication');
   require(!matching.length || matching[0].body.replace(/\r\n/g,'\n').trim()===comment.trim(),'closeout-publication-conflict');
   return matching;
  };
  const matching=publicationMatches(await api.comments(input.issue));
  const projectCurrent=()=>!project || issue.projects.find(x=>x.id===project.id)?.values[STATUS]===project.done;
  const finished=()=>updates.length===0 && matching.length===1 && issue.state==='CLOSED' && issue.stateReason==='COMPLETED' && projectCurrent() &&
   issue.labels.every(x=>!x.startsWith('status:') && x!=='blocked');
  if(input.operation==='reconcile'){
   require(state,'closeout-state-missing');
   require(finished(),'closeout-still-incomplete');
  }else if(!finished()){
   const currentRelated=await affected(api,issue,marker);
   require(JSON.stringify(currentRelated.map(x=>snapshot(x,issue.url)))===JSON.stringify(related.map(x=>snapshot(x,issue.url))),'affected-record-changed');
   const selectedBack=await evidence(api,await api.issue(input.issue),marker);
   require(JSON.stringify(snapshot(selectedBack,issue.url))===JSON.stringify(snapshot(issue,issue.url)),'selected-record-changed');
   state={schemaVersion:1,repository:REPOSITORY,issue:input.issue,merge:input.merge,bodyHash:input.requirementsBodySha256,complete:false,pending:null,assessment,updates,snapshots:Object.fromEntries(related.map(x=>[x.url,snapshot(x,issue.url)]))};
   const effect=async(name,call)=>{
    live();state.pending=name;await atomic(statePath,state,config.capacityBytes);mutated=true;
    await call();state.pending=null;await atomic(statePath,state,config.capacityBytes);
   };
   for(const update of updates){
    const original=related.find(x=>x.url===update.url);
    const fresh=await evidence(api,await api.issue(update.number,update.repository),marker);
    require(JSON.stringify(snapshot(fresh,issue.url))===JSON.stringify(snapshot(original,issue.url)),'affected-record-changed');
    if(update.body!==original.body){
     require(typeof api.recommendation==='function','canonical-recommendation-tool-unavailable');
     await effect('recommendation-'+update.number,()=>api.recommendation(update.entry,update.body));
    }
    if(JSON.stringify(update.labels)!==JSON.stringify(original.labels)){
     require(typeof api.labels==='function','related-label-adapter-unavailable');
     const beforeLabels=await evidence(api,await api.issue(update.number,update.repository),marker);
     require(JSON.stringify(snapshot({...beforeLabels,body:original.body},issue.url))===JSON.stringify(snapshot(original,issue.url))&&beforeLabels.body===update.body,'affected-record-changed');
     await effect('related-labels-'+update.number,()=>api.labels(update.number,update.repository,update.labels));
    }
    const back=await evidence(api,await api.issue(update.number,update.repository),marker);
    require(back.body===update.body&&JSON.stringify(back.labels)===JSON.stringify(update.labels),'affected-update-readback-failed');
    require(JSON.stringify(snapshot({...back,body:original.body,labels:original.labels},issue.url))===JSON.stringify(snapshot(original,issue.url)),'unrelated-fields-changed');
    const assessed=assessment.affected.find(x=>x.url===update.url);assessed.bodySha256=sha256(back.body);
    if(update.criteria)assessed.criteria=update.criteria;
    state.snapshots[back.url]=snapshot(back,issue.url);
    state.assessment=assessment;await atomic(statePath,state,config.capacityBytes);
   }
   const checkRelated=async()=>{
    const now=await affected(api,issue,marker);
    require(now.length===Object.keys(state.snapshots).length&&now.every(x=>JSON.stringify(snapshot(x,issue.url))===JSON.stringify(state.snapshots[x.url])),'affected-record-changed');
   };
   await checkRelated();
   const publicationIssue=await api.issue(input.issue),publicationComments=await api.comments(input.issue);
   const beforePublication=await evidence(api,publicationIssue,marker,publicationComments);selected(beforePublication,input);
   require(JSON.stringify(snapshot(beforePublication,issue.url))===JSON.stringify(snapshot(issue,issue.url)),'selected-record-changed');
   if(!publicationMatches(publicationComments).length)await effect('publication',()=>api.comment(input.issue,comment));
   const beforeClose=await evidence(api,await api.issue(input.issue),marker);selected(beforeClose,input);
   require(JSON.stringify(snapshot(beforeClose,issue.url))===JSON.stringify(snapshot(issue,issue.url)),'selected-record-changed');
   issue=beforeClose;await checkRelated();
   if(issue.state!=='CLOSED' || issue.labels.some(x=>x.startsWith('status:') || x==='blocked')){
    await effect('selected-close',()=>api.close(input.issue,issue.labels.filter(x=>!x.startsWith('status:') && x!=='blocked')));
   }
   if(project && !projectCurrent()){
    const refreshed=await evidence(api,await api.issue(input.issue),marker);selected(refreshed,input);
    const closed={...issue,state:'CLOSED',stateReason:'COMPLETED',labels:issue.labels.filter(x=>!x.startsWith('status:')&&x!=='blocked')};
    require(JSON.stringify(snapshot(refreshed,issue.url))===JSON.stringify(snapshot(closed,issue.url)),'selected-record-changed');
    const current=refreshed.projects.find(x=>x.id===project.id);
    require(current && JSON.stringify(current.values)===JSON.stringify(project.before),'project-changed-during-closeout');
    await effect('project-status',()=>api.projectDone(project.id,project.done));
   }
  }
  issue=await api.issue(input.issue);selected(issue,input);
  const backComments=await api.comments(input.issue);
  require(issue.state==='CLOSED' && issue.stateReason==='COMPLETED' &&
   issue.labels.every(x=>!x.startsWith('status:') && x!=='blocked') &&
   backComments.filter(x=>x.body?.replace(/\r\n/g,'\n').trim()===comment.trim()).length===1,'selected-closeout-readback-failed');
  if(project){
   const current=issue.projects.find(x=>x.id===project.id);
   require(current && JSON.stringify(current.values)===JSON.stringify({...project.before,[STATUS]:project.done}),'project-readback-failed');
  }
  const refreshed=await affected(api,issue,marker);
  const expected=state?.snapshots??Object.fromEntries(related.map(x=>[x.url,snapshot(x,issue.url)]));
  require(refreshed.length===Object.keys(expected).length&&refreshed.every(x=>JSON.stringify(snapshot(x,issue.url))===JSON.stringify(expected[x.url])),'affected-record-changed');
  validateAssessment(assessment,issue,refreshed,input.acceptedSourceOnly);
  const pending=assessment.affected.flatMap(item=>item.criteria.filter(x=>x.status==='pending').map(criterion=>({url:item.url,...criterion})));
  state={schemaVersion:1,repository:REPOSITORY,issue:input.issue,merge:input.merge,
   bodyHash:input.requirementsBodySha256,...state,assessment,snapshots:expected,complete:true,pending:null};
  await atomic(statePath,state,config.capacityBytes);
  const receipt=await atomic(join(input.evidenceDirectory,'tracker-receipt.json'),{schemaVersion:1,repository:REPOSITORY,issue:input.issue,merge:input.merge,
   requirementsBodySha256:input.requirementsBodySha256,installationReceiptSha256:input.installationReceipt?.sha256??null,
   installationPending:input.acceptedSourceOnly===null?null:{reason:'accepted-source-only',issue:input.acceptedSourceOnly.installationIssue},
   selected:{state:issue.state,stateReason:issue.stateReason,labels:issue.labels},project:project?{id:project.id,status:'Done'}:null,
   reconciliation:'complete',assessment,affected:refreshed.map(x=>({url:x.url,state:x.state,stateReason:x.stateReason})),pending});
  return {...output,status:'complete',effects:'verified',receipt};
 }catch(error){return {...output,status:mutated?'uncertain':'blocked',effects:mutated?'uncertain':'none',reconciliation:'pending',installationReceipt:input?.installationReceipt,reason:safeReason(error)};}
}

const NODE=`id number url state stateReason body updatedAt assignees(first:100){nodes{login}pageInfo{hasNextPage}} labels(first:100){nodes{name}pageInfo{hasNextPage}} parent{id number url}
 blockedBy(first:100){nodes{number url state stateReason}pageInfo{hasNextPage}}
 blocking(first:100){nodes{number url state stateReason}pageInfo{hasNextPage}}
 subIssues(first:100){nodes{number url state stateReason}pageInfo{hasNextPage}}
 projectItems(first:100){nodes{id project{id}fieldValues(first:100){nodes{... on ProjectV2ItemFieldSingleSelectValue{optionId field{... on ProjectV2SingleSelectField{id}}}}pageInfo{hasNextPage}}}pageInfo{hasNextPage}}`;
function completeGraph(value){
 if(value && typeof value==='object'){
  require(!value.hasNextPage,'tracker-pagination-capacity');
  for(const child of Object.values(value))completeGraph(child);
 }
}
export function githubAdapter(config,deadline){
 const call=(args,data)=>{
  const remaining=Math.floor((deadline-Date.now()/1000)*1000);require(remaining>0,'closeout-deadline-exhausted');
  const r=spawnSync(config.gh,['api',...args,...(data?['--input','-']:[])],{input:data?JSON.stringify(data):undefined,
   encoding:'utf8',timeout:Math.min(30000,remaining),maxBuffer:8*1024*1024});
  require(!r.error && r.status===0,'github-result-unavailable');return r.stdout?JSON.parse(r.stdout):null;
 };
 const graph=query=>{const value=call(['graphql'],{query});require(value.data && !value.errors,'tracker-graph-unavailable');completeGraph(value.data);return value.data;};
 const endpoint=n=>`repos/${REPOSITORY}/issues/${n}`;
 return {
  async issue(n,repository=REPOSITORY){
   const [owner,name]=repository.split('/');
   const d=graph(`{repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}){issue(number:${n}){${NODE}}}
    node(id:"${PROJECT}"){... on ProjectV2{fields(first:100){nodes{... on ProjectV2SingleSelectField{id name options{id name}}}pageInfo{hasNextPage}}}}}`);
   const issue=d.repository?.issue;require(issue,'affected-issue-unavailable');
   const status=d.node?.fields.nodes.find(x=>x.id===STATUS);require(status?.name==='Status','project-policy-changed');
   const done=status.options.filter(x=>x.name==='Done');require(done.length===1,'project-done-option-unavailable');
   return {...issue,assignees:issue.assignees.nodes.map(x=>x.login),labels:issue.labels.nodes.map(x=>x.name),blockedBy:issue.blockedBy.nodes,blocking:issue.blocking.nodes,subIssues:issue.subIssues.nodes,
    projects:issue.projectItems.nodes.map(x=>({id:x.id,project:x.project.id,done:done[0].id,
     values:Object.fromEntries(x.fieldValues.nodes.filter(y=>y.field).map(y=>[y.field.id,y.optionId]))}))};
  },
  async pull(n){return call([`repos/${REPOSITORY}/pulls/${n}`]);},
  async comments(n,repository=REPOSITORY){
   const all=[];for(let page=1;page<=20;page++){const rows=call([`repos/${repository}/issues/${n}/comments?per_page=100&page=${page}`]);
    require(Array.isArray(rows),'comments-unavailable');all.push(...rows);if(rows.length<100)return all;}
   throw new Error('comments-pagination-capacity');
  },
  async comment(n,body){return call(['--method','POST',`${endpoint(n)}/comments`],{body});},
  async close(n,labels){return call(['--method','PATCH',endpoint(n)],{state:'closed',state_reason:'completed',labels});},
  async labels(n,repository,labels){return call(['--method','PATCH',`repos/${repository}/issues/${n}`],{labels});},
  async recommendation(entry,expected){
   const p=await checkPlanner(config);
   require(config.gh.endsWith('/gh'),'canonical-gh-path-unqualified');
   const file=join(config.stateDirectory,`recommendation-${entry.repo}-${entry.number}.json`);
   await atomic(file,[entry],config.capacityBytes);
   const args=[p.recommendations,'upsert','--input',file];
   const env={...process.env,PATH:dirname(config.gh)+':'+process.env.PATH,PYTHONDONTWRITEBYTECODE:'1'};
   const report=text=>JSON.parse(text.split('\n')[0]);
   const dry=report((await runProcess(p.python,[...args,'--dry-run'],{deadline:deadline*1000,maxBytes:4*1024*1024,env,cwd:p.checkout})).stdout);
   require(dry.key===`${entry.repo}#${entry.number}`&&dry.outcome!=='error','recommendation-dry-run-blocked');
   const result=report((await runProcess(p.python,[...args,'--receipt',file+'.receipt'],{deadline:deadline*1000,maxBytes:4*1024*1024,env,cwd:p.checkout})).stdout);
   require(result.key===`${entry.repo}#${entry.number}`&&result.outcome!=='error','recommendation-upsert-uncertain');
   const back=call([`repos/jimmie-potts/${entry.repo}/issues/${entry.number}`]);require(back.body===expected,'recommendation-readback-mismatch');
  },
  async projectDone(id,option){
   return graph(`mutation{updateProjectV2ItemFieldValue(input:{projectId:"${PROJECT}",itemId:${JSON.stringify(id)},fieldId:"${STATUS}",value:{singleSelectOptionId:${JSON.stringify(option)}}}){projectV2Item{id}}}`);
  }
 };
}
export async function cli(configPath,input){
 const config=JSON.parse((await privateRead(configPath)).toString());
 require(typeof config.gh==='string' && isAbsolute(config.gh),'invalid-github-executable');
 const {validateInstallReceipt}=await import('@jimmie-potts/device-contracts');
 await checkPlanner(config);return runCloseout(input,config,githubAdapter(config,input.deadline),validateInstallReceipt);
}
