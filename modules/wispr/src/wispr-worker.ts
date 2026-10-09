// Copied from apps/hub/src/wispr-worker.ts at bf11587c1a2c575c0da155725a386a209836eed9 (Hub #927); adapted for module lifetime.
import {parentPort,workerData} from 'node:worker_threads';
import {constants,openSync,closeSync,fstatSync,readSync,lstatSync,realpathSync,existsSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {validateSnapshot,validateStatus,MAX_SNAPSHOT_BYTES,type Snapshot,type CollectorStatus} from '@jimmie-potts/wispr-contracts';
import {readerRefusal} from './content.js';
import {WisprError} from './common.js';
import {projectWispr,wisprResponse as encode} from './wispr-query.js';
import type {WisprWorkerData,WisprResponse} from './wispr.js';
const port=(()=>{if(parentPort===null)throw new Error('the Wispr reader requires a worker parent');return parentPort;})();
const config=workerData as WisprWorkerData;
let snapshot:Snapshot|undefined,manifest:CollectorStatus|undefined,namespace=config.fence?.namespace,revision=config.fence?.revision??-1,generation=config.fence?.generation,refreshAt=-Infinity;
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
    if(!stat.isFile()||stat.nlink!==1||stat.size>maximum||stat.uid!==(process.getuid?.() ?? -1))throw new Error('unsafe-file');
    // DrvFS without metadata does not express Windows ACLs as Linux mode bits; the Windows producer owns ACL qualification.
    if(!path.startsWith('/mnt/')&&(stat.mode&0o077)!==0)throw new Error('unsafe-file');
    const bytes=Buffer.alloc(maximum+1);let size=0;
    while(size<bytes.length){const count=readSync(fd,bytes,size,bytes.length-size,null);size+=count;if(count===0)break;}
    if(size>maximum)throw new Error('capacity');
    const value:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,size)));
    const stack:[unknown,number][]=[[value,0]];let nodes=0;
    while(stack.length>0){const entry=stack.pop();if(entry===undefined)break;const [item,depth]=entry;if(++nodes>2500000||depth>16)throw new Error('capacity');if(item!==null&&typeof item==='object')for(const child of Object.values(item))stack.push([child,depth+1]);}
    return value;
  }finally{closeSync(fd);}
}
function suppressText(){if(snapshot?.language.availability==='available')snapshot={...snapshot,language:{availability:'disabled',reason:'not-enabled',tables:[]}};}
function observe():CollectorStatus|undefined {
  try{
    const result=validateStatus(file(config.diagnosticsPath,4096));if(!result.ok)throw new Error('invalid');
    const next=result.value;
    if(namespace!==undefined&&next.namespace!==namespace)throw new Error('identity');
    if(next.revision<revision||(next.revision===revision&&generation!==undefined&&next.generation!==generation))throw new Error('older');
    const changed=namespace!==next.namespace||generation!==next.generation||revision!==next.revision;
    namespace??=next.namespace;
    if(generation!==undefined&&next.generation!==generation){snapshot=undefined;refreshAt=-Infinity;}
    revision=next.revision;generation=next.generation;manifest=next;
    // Delivered before any response, even when the replacement aggregate is unavailable.
    if(changed)port.postMessage({kind:'fence',fence:{namespace,generation,revision}});
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
  if(!snapshot)return encode(503,readerRefusal('wispr-unavailable'));
  const value=snapshot;
  const permitted=shareText&&manifest?.languageEnabled===true&&manifest.generation===value.generation&&manifest.revision===value.revision;
  const result=projectWispr(value,config,route,query,now,problem,permitted);
  const final=observe();
  if(snapshot!==value||final&&final.generation!==value.generation)return encode(503,readerRefusal('wispr-observation-changed'));
  if((route==='language'||new URLSearchParams(query).get('includeText')==='true')&&(!final||!final.languageEnabled||final.revision!==value.revision))return projectWispr(value,config,route,query,now,problem,false);
  if(!final)return projectWispr(value,config,route,query,now,problem,false);
  if(final.revision!==value.revision)return projectWispr(value,config,route,query,now,'snapshot-behind-manifest',false);
  if(!['ok','empty','cleared'].includes(final.health))return projectWispr(value,config,route,query,now,final.health,false);
  return result;
}
type ReadMessage={id:number;route:string;query:string;now:number;shareText:boolean;kind?:undefined};
type PrivacyMessage={kind:'privacy';shareText:boolean};
port.on('message',(message:ReadMessage|PrivacyMessage)=>{
  if(message.kind==='privacy'){if(!message.shareText)suppressText();else refreshAt=-Infinity;return;}
  let response:WisprResponse;
  try{response=answer(message.route,message.query,message.now,message.shareText);}catch(error){response=error instanceof WisprError?encode(error.status,readerRefusal(error.code)):encode(503,readerRefusal('wispr-unavailable'));}
  port.postMessage({id:message.id,response});
});
