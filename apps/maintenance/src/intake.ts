import {Config,Request,request,REPOSITORY,fingerprints} from './config.js';
import {Adapters,eligible} from './adapters.js';
import {Finding,Extract} from './journal.js';
import {investigate,Proposal} from './planner.js';
import {PrivateStore,requireValue} from './storage.js';

export type Selection={schemaVersion:1;source:'maintenance';authority:string;repository:typeof REPOSITORY;issue:number;selectionEvidence:string};
export type Response={schemaVersion:1;status:'complete'|'blocked'|'uncertain';selections:Selection[];reason:string};
type FindingState={schemaVersion:1;fingerprint:string;phase:'investigating'|'deferred'|'publishing'|'selected'|'resolved';revision:string;marker:string;body?:string;issue?:number;origin?:'created'|'reused';reason:string};
type Run={schemaVersion:1;runId:string;authority:string;deadline:number;phase:'collecting'|'processing'|'complete';since:number;until:number;fingerprints:string[];selections:Selection[];decisions:Array<{fingerprint:string;reason:string;issue?:number}>;coverage?:Extract['coverage'];sourceRevision?:string;response?:Response};
const marker=(fingerprint:string)=>`<!-- bunny-maintenance:v1:${fingerprint} -->`;
const safeReason=(error:unknown)=>{
 const message=error instanceof Error?error.message:'';
 return /^[a-z][a-z-]{1,80}$/.test(message)?message:'intake-unavailable';
};
function selection(config:Config,run:Run,finding:FindingState):Selection {
 requireValue(Number.isSafeInteger(finding.issue)&&finding.issue!>0,'missing-selected-issue');
 return {schemaVersion:1,source:'maintenance',authority:config.authority,repository:REPOSITORY,issue:finding.issue!,selectionEvidence:`Validated finding ${finding.fingerprint}; intake ${run.runId}; source ${finding.revision}. Delivery remains unverified.`};
}
export function publication(finding:Finding,proposal:Proposal){
 const links=proposal.references.map(ref=>`- ${ref.role}: [${ref.path}](https://github.com/${REPOSITORY}/blob/${proposal.sourceRevision}/${ref.path}#L${ref.start}-L${ref.end})`).join('\n');
 const body=`## Correct the diagnosed ${finding.operation} failure\n\n- Fix the source defect associated with the registered ${finding.event} diagnostic.\n- Reuse the current architecture and existing ${finding.operation} implementation.\n- Add a focused regression for the verified source references below.\n- Preserve configured ownership, permissions, recovery and manual control.\n- Complete delivery through merged-source checks and verified installation.\n\n## Outcome and real setup\n\nBounded Hub diagnostics identified ${finding.service}/${finding.scope}: ${finding.event}, operation ${finding.operation}, outcome ${finding.outcome}, reason ${finding.reason}. Source investigation at ${proposal.sourceRevision} supports a defect. Private observations remain local; this issue contains registered dimensions and public source references only.\n\n## Smallest useful implementation\n\nUse plan-work's source assessment and the references below to reproduce and correct the defect. Refresh current main, related issues, North Star, architecture and reusable patterns before implementation. Keep the change within the existing Hub installation.\n\n${links}\n\n## Behavior and protections to preserve\n\nPreserve versioned contracts, one state owner and device writer, manual controls, private retention and existing recovery. No physical-device commands, new hosts, telemetry expansion or active automation-policy changes are authorized by this finding.\n\n## Observable acceptance and planned evidence\n\n- Demonstrate the defect with a focused regression tied to the cited source, then pass that regression and all owning checks.\n- Obtain independent Standards and Specification reviews of the exact candidate, pass applicable CI, merge through the existing guard and verify merged-main CI.\n- Apply the existing installation procedure under standing authority; verify its receipt, running revision and health before closure.\n\n## Meaningful deferrals\n\nUnrelated improvements, performance claims without representative measurements and physical acceptance remain outside this defect. Missing reproduction or an implementation-changing decision blocks delivery instead of expanding scope.\n\n## Work assessment\n\nComplexity ${proposal.assessment.complexity}; uncertainty ${proposal.assessment.uncertainty}; impact ${proposal.assessment.impact}. The installed planning method inspected the exact current source and existing work. Source citation bytes and line ranges were checked by the intake. Delivery reassesses the diagnosis and current alignment before writes.\n\n## Guide\n\n**Topic:** development-workflow\n\n${marker(finding.fingerprint)}\n`;
 return {title:`Fix ${finding.service} ${finding.operation} ${finding.reason} handling`,body};
}
export class Intake {
 readonly store:PrivateStore;
 constructor(readonly config:Config,readonly adapters?:Adapters){this.store=new PrivateStore(config.stateRoot,config.limits.capacityBytes);}
 async run(input:unknown):Promise<Response>{
  let req:Request|undefined,run:Run|undefined;
  try{
   req=request(input,this.config);await fingerprints(this.config);await this.store.open();
   const saved=await this.store.read(`run-${req.runId}.json`);
   if(saved){
    requireValue(saved.schemaVersion===1&&saved.runId===req.runId&&saved.authority===req.authority&&saved.deadline===req.deadline,'run-identity-mismatch');
    run=saved;
    if(run!.phase==='complete'&&run!.response){await this.report(req,run!);return run!.response;}
    requireValue(req.operation==='reconcile','interrupted-run-needs-reconciliation');
   }else{
    requireValue(req.operation==='intake','unknown-run');
    const until=Date.now(),since=until-this.config.limits.windowSeconds*1000;
    run={schemaVersion:1,runId:req.runId,authority:req.authority,deadline:req.deadline,phase:'collecting',since,until,fingerprints:[],selections:[],decisions:[]};
    await this.store.save(`run-${req.runId}.json`,run);
   }
   const operationDeadline=req.operation==='reconcile'?Date.now()+120000:req.deadline*1000;
   const adapter=this.adapters??new Adapters(this.config,operationDeadline);
   let extract:Extract;
   if(req.operation==='intake'){
    // Reserve evidence and recovery space before reading an owner-selected source.
    await this.store.capacity(this.config.limits.maxBytes*2+4*1024*1024);
    extract=await adapter.journal(run!.since,run!.until);
    await this.store.save(`observations-${req.runId}.json`,extract);
    run!.coverage=extract.coverage;
    run!.fingerprints=extract.findings.slice(0,this.config.limits.maxFindings).map(f=>f.fingerprint);
    if(extract.findings.length>this.config.limits.maxFindings)run!.decisions.push({fingerprint:'remaining',reason:'finding-admission-capped'});
    run!.phase='processing';await this.store.save(`run-${req.runId}.json`,run);
   }else{
    requireValue(run!.phase==='processing','interrupted-before-evidence');
    extract=await this.store.read(`observations-${req.runId}.json`);
    requireValue(extract&&Array.isArray(extract.findings),'missing-retained-evidence');
   }
   if(!run!.fingerprints.length){
    run!.response={schemaVersion:1,status:'complete',selections:[],reason:'no-supported-selection'};
   }else{
    const issues=await adapter.issues();
    if(req.operation==='intake'){run!.sourceRevision=await adapter.source();await this.store.save(`run-${req.runId}.json`,run);}
    let uncertain=false;
    for(const fingerprint of run!.fingerprints){
     requireValue(Date.now()<operationDeadline,'expired-deadline');
     const finding=extract.findings.find(f=>f.fingerprint===fingerprint)!;
     let state:FindingState|undefined=await this.store.read(`finding-${fingerprint}.json`);
     if(state)requireValue(state.schemaVersion===1&&state.fingerprint===fingerprint&&state.marker===marker(fingerprint),'invalid-finding-state');
     if(state?.phase==='publishing'){
      const matches=issues.filter(i=>i.body.includes(state!.marker));
      if(matches.length!==1||matches[0].body!==state.body){uncertain=true;run!.decisions.push({fingerprint,reason:'publication-reconciliation-required'});continue;}
      const authoritative=await adapter.issue(matches[0].number);
      if(authoritative.body!==state.body){uncertain=true;continue;}
      state={...state,issue:authoritative.number,phase:authoritative.state==='closed'?'resolved':'selected',origin:'created',reason:'publication-reconciled'};
      await this.store.save(`finding-${fingerprint}.json`,state);
     }
     if(state?.phase==='selected'||state?.phase==='resolved'){
      const current=await adapter.issue(state.issue!);
      if(current.state==='closed'){state.phase='resolved';state.reason='completed-finding';await this.store.save(`finding-${fingerprint}.json`,state);}
      else if(state.phase==='selected'&&eligible(current)&&!run!.selections.some(s=>s.issue===current.number))run!.selections.push(selection(this.config,run!,state));
      run!.decisions.push({fingerprint,reason:state.phase==='resolved'?'completed-finding':eligible(current)?state.reason:'existing-issue-held',issue:state.issue});continue;
     }
     if(req.operation==='reconcile'){
      run!.decisions.push({fingerprint,reason:'investigation-interrupted-no-publication'});continue;
     }
     if(state?.phase==='deferred'&&state.revision===run!.sourceRevision){run!.decisions.push({fingerprint,reason:state.reason});continue;}
     // Existing markers prevent duplicates; they never replace a supported source investigation.
     const existing=issues.filter(i=>i.body.includes(marker(fingerprint)));
     if(existing.length>1){uncertain=true;run!.decisions.push({fingerprint,reason:'conflicting-existing-issues'});continue;}
     state={schemaVersion:1,fingerprint,phase:'investigating',revision:run!.sourceRevision!,marker:marker(fingerprint),reason:'investigation-started'};
     await this.store.save(`finding-${fingerprint}.json`,state);
     let proposal:Proposal;
     try{proposal=await investigate(this.config,adapter,finding,run!.sourceRevision!,issues,this.store,`${req.runId}-${fingerprint.slice(0,16)}`);}
     catch(error){state.phase='deferred';state.reason=safeReason(error);await this.store.save(`finding-${fingerprint}.json`,state);run!.decisions.push({fingerprint,reason:state.reason});continue;}
     if(proposal.status!=='supported'){state.phase='deferred';state.reason=`deferred-${proposal.kind}`;await this.store.save(`finding-${fingerprint}.json`,state);run!.decisions.push({fingerprint,reason:state.reason});continue;}
     if(existing.length===1&&proposal.existingIssue!==existing[0].number){
      state.phase='deferred';state.reason='existing-marker-needs-supported-reuse';await this.store.save(`finding-${fingerprint}.json`,state);run!.decisions.push({fingerprint,reason:state.reason});continue;
     }
     await fingerprints(this.config);
     requireValue(Date.now()<req.deadline*1000&&await adapter.remoteRevision()===run!.sourceRevision,'source-not-current');
     if(proposal.existingIssue!==null){
      const current=await adapter.issue(proposal.existingIssue);
      state={...state,phase:current.state==='closed'?'resolved':'selected',issue:current.number,origin:'reused',reason:'existing-supported-issue'};
      await this.store.save(`finding-${fingerprint}.json`,state);
      if(eligible(current))run!.selections.push(selection(this.config,run!,state));
      run!.decisions.push({fingerprint,reason:current.state==='closed'?'completed-finding':eligible(current)?state.reason:'existing-issue-held',issue:current.number});continue;
     }
     // Refresh the complete inventory just before recording the one write intent.
     requireValue(!(await adapter.issues()).some(i=>i.body.includes(state!.marker)),'publication-inventory-changed');
     const content=publication(finding,proposal);
     state={...state,phase:'publishing',body:content.body,origin:'created',reason:'publication-intent'};
     await this.store.capacity(256*1024);
     await this.store.save(`intent-${req.runId}-${fingerprint.slice(0,16)}.json`,{runId:req.runId,deadline:req.deadline,repository:REPOSITORY,marker:state.marker,sourceRevision:run!.sourceRevision,payload:content});
     await this.store.save(`finding-${fingerprint}.json`,state);
     try{
      const created=await adapter.create(content.title,content.body),current=await adapter.issue(created.number);
      requireValue(current.body===content.body&&current.state==='open','publication-readback-mismatch');
      state={...state,phase:'selected',issue:current.number,reason:'issue-created'};
      await this.store.save(`finding-${fingerprint}.json`,state);
      if(eligible(current))run!.selections.push(selection(this.config,run!,state));
      run!.decisions.push({fingerprint,reason:eligible(current)?state.reason:'existing-issue-held',issue:current.number});
     }catch{uncertain=true;run!.decisions.push({fingerprint,reason:'publication-reconciliation-required'});}
    }
    run!.response={schemaVersion:1,status:uncertain?'uncertain':'complete',selections:run!.selections,reason:uncertain?'publication-reconciliation-required':'selection-complete'};
   }
   if(run!.response.status==='complete')run!.phase='complete';
   await this.store.save(`run-${req.runId}.json`,run);await this.report(req,run!);return run!.response;
  }catch(error){
   const response:Response={schemaVersion:1,status:'blocked',selections:[],reason:safeReason(error)};
   if(req&&run){run.response=response;await this.store.save(`run-${req.runId}.json`,run).catch(()=>{});await this.report(req,run).catch(()=>{});}
   return response;
  }
 }
 async report(req:Request,run:Run){
  const report=new PrivateStore(req.evidenceDirectory,4*1024*1024);await report.open();
  await report.save('intake-report.json',{schemaVersion:1,runId:run.runId,status:run.response?.status??'uncertain',reason:run.response?.reason??'interrupted',window:{since:run.since,until:run.until},components:this.config.units,coverage:run.coverage??{status:'unavailable',reason:'intake-interrupted'},sourceRevision:run.sourceRevision??'unknown',decisions:run.decisions,selections:run.selections,delivery:'not-observed',queueAdmission:'execution-owner-readback-required',installedVerification:'execution-owner-receipt-required',usage:'see retained planning receipts; observed model unknown',privateEvidenceRoot:this.config.stateRoot});
 }
}
