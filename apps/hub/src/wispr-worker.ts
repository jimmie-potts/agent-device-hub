import {parentPort,workerData} from 'node:worker_threads';
import {constants,openSync,closeSync,fstatSync,readSync,lstatSync,realpathSync,existsSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {validateSnapshot,validateStatus,MAX_SNAPSHOT_BYTES,type Snapshot,type CollectorStatus} from '@jimmie-potts/wispr-contracts';
import {HttpError} from './common.js';
import {projectWispr,wisprResponse as encode} from './wispr-query.js';
import type {WisprConfig,WisprResponse} from './wispr.js';
const config=workerData as WisprConfig;
let snapshot:Snapshot|undefined,manifest:CollectorStatus|undefined,namespace:string|undefined,revision=-1,generation:string|undefined,refreshAt=-Infinity;
let problem:string|null=null;
function file(path:string,maximum:number):unknown {
  if(realpathSync(path)!==path)throw new Error('unsafe-file');
  for(let dir=dirname(path);;dir=dirname(dir)){
    if(existsSync(join(dir,'.git'))||lstatSync(dir).isSymbolicLink())throw new Error('unsafe-file');
    if(dirname(dir)===dir)break;
  }
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const stat=fstatSync(fd);
    if(!stat.isFile()||stat.nlink!==1||stat.size>maximum||stat.uid!==process.getuid!())throw new Error('unsafe-file');
    // DrvFS without metadata does not express Windows ACLs as Linux mode bits; the Windows producer owns ACL qualification.
    if(!path.startsWith('/mnt/')&&(stat.mode&0o077)!==0)throw new Error('unsafe-file');
    const bytes=Buffer.alloc(maximum+1);let size=0;
    while(size<bytes.length){const count=readSync(fd,bytes,size,bytes.length-size,null);size+=count;if(!count)break;}
    if(size>maximum)throw new Error('capacity');
    const value:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,size)));
    const stack:[unknown,number][]=[[value,0]];let nodes=0;
    while(stack.length){const [item,depth]=stack.pop()!;if(++nodes>2500000||depth>16)throw new Error('capacity');if(item&&typeof item==='object')for(const child of Object.values(item))stack.push([child,depth+1]);}
    return value;
  }finally{closeSync(fd);}
}
function suppressText(){if(snapshot?.language.availability==='available')snapshot={...snapshot,language:{availability:'disabled',reason:'not-enabled',tables:[]}};}
function observe():CollectorStatus|undefined {
  try{
    const result=validateStatus(file(config.diagnosticsPath,4096));if(!result.ok)throw new Error('invalid');
    const next=result.value;
    if(namespace&&next.namespace!==namespace)throw new Error('identity');
    if(next.revision<revision||(next.revision===revision&&generation&&next.generation!==generation))throw new Error('older');
    namespace??=next.namespace;
    if(generation&&next.generation!==generation){snapshot=undefined;refreshAt=-Infinity;}
    revision=next.revision;generation=next.generation;manifest=next;
    if(!next.languageEnabled)suppressText();
    return next;
  }catch{manifest=undefined;suppressText();problem='manifest-unavailable';return undefined;}
}
function refresh(now:number,shareText:boolean){
  const status=observe();
  if(!status)return;
  if(now<refreshAt||now-refreshAt>=30000||!snapshot){
    refreshAt=now;
    try{
      const result=validateSnapshot(file(config.aggregatePath,MAX_SNAPSHOT_BYTES));if(!result.ok)throw new Error('invalid');
      const next=result.value;
      if(next.namespace!==status.namespace||next.generation!==status.generation||next.revision!==status.revision||next.lastSuccessAt!==status.lastSuccessAt||next.latestSourceDate!==status.latestSourceDate)throw new Error('mismatch');
      snapshot=next;problem=null;
    }catch{problem='snapshot-unavailable';suppressText();}
  }
  if(snapshot&&snapshot.revision!==status.revision){problem='snapshot-behind-manifest';suppressText();}
  if(!['ok','empty','cleared'].includes(status.health)){problem=status.health;suppressText();}
  if(!shareText||!status.languageEnabled)suppressText();
}
function answer(route:string,query:string,now:number,shareText:boolean):WisprResponse {
  refresh(now,shareText);
  if(!snapshot)return encode(503,{error:{code:'wispr-unavailable'}});
  const value=snapshot;
  const permitted=shareText&&manifest?.languageEnabled===true&&manifest.generation===value.generation&&manifest.revision===value.revision;
  const result=projectWispr(value,config,route,query,now,problem,permitted);
  const final=observe();
  if(snapshot!==value||final&&final.generation!==value.generation)return encode(503,{error:{code:'wispr-observation-changed'}});
  if((route==='language'||new URLSearchParams(query).get('includeText')==='true')&&(!final||!final.languageEnabled||final.revision!==value.revision))return projectWispr(value,config,route,query,now,problem,false);
  if(!final)return projectWispr(value,config,route,query,now,problem,false);
  if(final.revision!==value.revision)return projectWispr(value,config,route,query,now,'snapshot-behind-manifest',false);
  if(!['ok','empty','cleared'].includes(final.health))return projectWispr(value,config,route,query,now,final.health,false);
  return result;
}
parentPort!.on('message',message=>{
  if(message.kind==='privacy'){if(!message.shareText)suppressText();else refreshAt=-Infinity;return;}
  let response:WisprResponse;
  try{response=answer(message.route,message.query,message.now,message.shareText);}catch(error){response=error instanceof HttpError?encode(error.status,{error:{code:error.code}}):encode(503,{error:{code:'wispr-unavailable'}});}
  parentPort!.postMessage({id:message.id,response});
});
