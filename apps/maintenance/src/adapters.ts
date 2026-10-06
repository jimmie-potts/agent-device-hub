import {Config,REPOSITORY} from './config.js';
import {runProcess} from './process.js';
import {collectJournal,Extract} from './journal.js';
import {requireValue} from './storage.js';
export type Issue={number:number;state:'open'|'closed';title:string;body:string;labels:Array<{name:string}>;assignees:unknown[];pull_request?:unknown};
export class Adapters {
 constructor(readonly config:Config,readonly deadline:number){}
 async command(tool:keyof Config['tools'],args:string[],maxBytes=4*1024*1024,input?:string,seconds=30){
  return (await runProcess(this.config.tools[tool],args,{deadline:Math.min(this.deadline,Date.now()+seconds*1000),maxBytes,input,cwd:this.config.checkout})).stdout;
 }
 async api(method:'GET'|'POST',suffix:string,payload?:unknown):Promise<any>{
  // Call sites supply fixed endpoints or validated positive integer identities.
  const args=['api','--hostname','github.com','--method',method];if(payload!==undefined)args.push('--input','-');
  args.push(`repos/${REPOSITORY}/${suffix}`);
  return JSON.parse(await this.command('gh',args,4*1024*1024,payload===undefined?undefined:JSON.stringify(payload)));
 }
 async issues():Promise<Issue[]>{
  const found:Issue[]=[];
  for(let page=1;page<=this.config.limits.maxPages;page++){
   const batch=await this.api('GET',`issues?state=all&sort=created&direction=asc&per_page=100&page=${page}`);
   requireValue(Array.isArray(batch),'invalid-issue-inventory');
   for(const issue of batch){validateIssue(issue);if(!issue.pull_request)found.push(issue);}
   if(batch.length<100)return found;
  }
  throw new Error('issue-inventory-capped');
 }
 async issue(number:number):Promise<Issue>{requireValue(Number.isSafeInteger(number)&&number>0,'invalid-issue');const value=await this.api('GET',`issues/${number}`);validateIssue(value);requireValue(!value.pull_request,'issue-is-pr');return value;}
 async create(title:string,body:string):Promise<Issue>{const value=await this.api('POST','issues',{title,body,labels:['bug','status:ready']});validateIssue(value);return value;}
 async remoteRevision():Promise<string>{const ref=await this.api('GET','git/ref/heads/main');requireValue(/^[a-f0-9]{40}$/.test(ref?.object?.sha??''),'invalid-source-revision');return ref.object.sha;}
 async source():Promise<string>{
  const remote=(await this.command('git',['remote','get-url','origin'],4096)).trim().replace(/\.git$/,'');
  requireValue([`https://github.com/${REPOSITORY}`,`git@github.com:${REPOSITORY}`].includes(remote),'source-repository-mismatch');
  await this.command('git',['fetch','--no-tags','origin','main'],64*1024,undefined,120);
  const revision=(await this.command('git',['rev-parse','refs/remotes/origin/main'],4096)).trim();
  requireValue(revision===await this.remoteRevision(),'source-not-current');return revision;
 }
 async sourceFile(revision:string,path:string):Promise<Buffer>{
  requireValue(/^[a-f0-9]{40}$/.test(revision)&&safeSourcePath(path),'invalid-source-reference');
  const entry=await this.command('git',['ls-tree',revision,'--',path],4096);
  requireValue(new RegExp(`^100(?:644|755) blob [a-f0-9]{40}\\t`).test(entry)&&entry.trimEnd().split('\t')[1]===path,'invalid-source-file');
  return Buffer.from(await this.command('git',['show',`${revision}:${path}`],1024*1024));
 }
 async journal(since:number,until:number):Promise<Extract>{
  const args=['--user','--no-pager','--quiet','--output=json','--all','--output-fields=MESSAGE,__CURSOR,__REALTIME_TIMESTAMP,_SYSTEMD_USER_UNIT',
   '--since',new Date(since).toISOString(),'--until',new Date(until).toISOString()];
  for(const unit of this.config.units)args.push('--unit',unit);
  // The process capture bounds bytes before allocation; collector also bounds
  // every row/message. A failed/capped process never becomes healthy coverage.
  let result;
  try{result=await runProcess(this.config.tools.journalctl,args,{deadline:Math.min(this.deadline,Date.now()+this.config.limits.querySeconds*1000),maxBytes:this.config.limits.maxBytes,partial:true});}
  catch{return {accepted:[],findings:[],coverage:{status:'unavailable',rows:0,bytes:0,rejected:0,capped:false,reason:'journal-query-unavailable'}};}
  async function* chunks(){yield Buffer.from(result!.stdout);}
  const extract=await collectJournal(chunks(),{units:this.config.units,services:['hub'],since,until,maxRows:this.config.limits.maxRows,maxBytes:this.config.limits.maxBytes});
  if(result.reason){extract.coverage.reason='journal-query-incomplete';extract.coverage.capped ||= result.reason==='process-output-limit';}
  return extract;
 }
}
export function safeSourcePath(path:unknown):path is string {
 return typeof path==='string'&&/^[A-Za-z0-9_./-]{1,240}$/.test(path)&&!path.split('/').some(part=>!part||part==='.'||part==='..')&&
  (/^(?:apps\/hub\/(?:src|tests)\/|packages\/|controllers\/|docs\/|tests\/)/.test(path)||['AGENTS.md','README.md'].includes(path));
}
export function validateIssue(value:any):asserts value is Issue {
 requireValue(value&&Number.isSafeInteger(value.number)&&value.number>0&&['open','closed'].includes(value.state)&&typeof value.title==='string'&&
  (typeof value.body==='string'||value.body===null)&&Array.isArray(value.labels)&&value.labels.every((v:any)=>typeof v.name==='string')&&Array.isArray(value.assignees),'invalid-issue-response');
 if(value.body===null)value.body='';
}
export function eligible(issue:Issue){return issue.state==='open'&&!issue.pull_request&&!issue.assignees.length&&!issue.labels.some(label=>['blocked','deferred','idea','status:in-progress','status:review','hold','manual-hold'].includes(label.name));}
