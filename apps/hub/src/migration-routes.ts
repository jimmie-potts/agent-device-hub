import {open,lstat,realpath,mkdir,rename,rm} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {validateSnapshot,type Snapshot,type Consumer} from '@jimmie-potts/agent-state';
import {createEmitter,type SourceConfiguration} from '@jimmie-potts/agent-state/providers';
import {object,exact,loopbackEndpoint,responseJson,canonical} from './common.js';
export type StagedRoute={readonly kind:'producer'|'pixoo';readonly digest:string};
type File={path:string;bytes:Buffer;value:Record<string,unknown>};
type Stage={file:File;lock:string;enabled:boolean;kind:StagedRoute['kind']};
const stages=new WeakMap<StagedRoute,Stage>();
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const validToken=(token:string)=>/^[A-Za-z0-9_-]{43}(?![\s\S])/.test(token);
async function read(path:string):Promise<File>{
 if(process.platform!=='linux'||resolve(path)!==path||path.startsWith('/mnt/')||await realpath(path)!==path)throw new Error('invalid-route-file');
 for(let parent=dirname(path);;parent=dirname(parent)){
  try{const marker=await lstat(join(parent,'.git'));if(marker.isFile())throw new Error('route-in-checkout');await lstat(join(parent,'.git','HEAD'));throw new Error('route-in-checkout');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(parent===dirname(parent))break;
 }
 const directory=await lstat(dirname(path));if((directory.mode&0o077)!==0||directory.uid!==process.getuid!())throw new Error('invalid-route-directory');
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const info=await file.stat();if(!info.isFile()||info.nlink!==1||info.uid!==process.getuid!()||(info.mode&0o077)!==0||info.size>8192)throw new Error('invalid-route-file');
  const buffer=Buffer.alloc(8193);let size=0;while(size<buffer.length){const part=await file.read(buffer,size,buffer.length-size,null);size+=part.bytesRead;if(!part.bytesRead)break;}if(size>8192)throw new Error('invalid-route-file');
  const bytes=buffer.subarray(0,size),value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!object(value))throw new Error('invalid-route-file');return {path,bytes,value};
 }finally{await file.close();}
}
async function replace(file:File,value:Record<string,unknown>):Promise<File>{
 const current=await read(file.path);if(!current.bytes.equals(file.bytes))throw new Error('route-changed');
 const temporary=file.path+'.'+randomUUID()+'.tmp',bytes=Buffer.from(JSON.stringify(value)+'\n');
 try{const output=await open(temporary,'wx',0o600);try{await output.writeFile(bytes);await output.sync();}finally{await output.close();}
  if(!(await read(file.path)).bytes.equals(file.bytes))throw new Error('route-changed');
  await rename(temporary,file.path);const directory=await open(dirname(file.path),'r');try{await directory.sync();}finally{await directory.close();}return {path:file.path,bytes,value};
 }finally{await rm(temporary,{force:true});}
}
export async function routeDigest(path:string):Promise<string>{return hash((await read(path)).bytes);}
async function stage(path:string,expected:string,kind:StagedRoute['kind'],transform:(value:Record<string,unknown>)=>Record<string,unknown>):Promise<StagedRoute>{
 const file=await read(path);if(hash(file.bytes)!==expected)throw new Error('route-changed');
 const lock=path+'.migration-lock';await mkdir(lock,{mode:0o700});
 try{const next=transform(file.value),updated=await replace(file,next),receipt=Object.freeze({kind,digest:hash(updated.bytes)});
  stages.set(receipt,{file:updated,lock,enabled:file.value.enabled===true,kind});return receipt;
 }catch(error){await rm(lock,{recursive:true});throw error;}
}
/** Only the explicitly named producer file changes. Qualification and source identity remain unchanged. */
export async function stageProducer(path:string,expected:string,endpoint:string,token:string):Promise<StagedRoute>{
 if(loopbackEndpoint(endpoint).pathname!=='/api/monitor/v1/events'||!validToken(token))throw new Error('invalid-producer-route');
 return stage(path,expected,'producer',value=>{
  if(!exact(value,['enabled','qualified','source','endpoint','token'])||typeof value.enabled!=='boolean'||typeof value.qualified!=='boolean')throw new Error('invalid-producer-file');
  const emitter=createEmitter({source:value.source as SourceConfiguration,enabled:false,qualified:value.qualified,send:async()=>{}});emitter.close();
  return {...value,enabled:false,endpoint,token};
 });
}
export async function stagePixooSource(path:string,expected:string,ownerId:string,endpoint:string,token:string):Promise<StagedRoute>{
 if(loopbackEndpoint(endpoint).pathname!=='/api/monitor/v1'||!validToken(token))throw new Error('invalid-consumer-route');
 return stage(path,expected,'pixoo',value=>{
  if(value.version!==1||value.ownerId!==ownerId||!['embedded','remote'].includes(value.mode as string))throw new Error('invalid-consumer-file');
  return {version:1,mode:'remote',ownerId,endpoint,token};
 });
}
/** Releases the coordinator's lock; it never restores a stale source route or enables a producer. */
export async function releaseRoute(route:StagedRoute):Promise<void>{const staged=stages.get(route);if(!staged)return;stages.delete(route);await rm(staged.lock,{recursive:true});}
export type ActivationPlan={producers:StagedRoute[];consumers:{id:string;route:StagedRoute;endpoint:string;token:string}[]};
async function get(endpoint:string,token:string):Promise<unknown>{
 const response=await fetch(endpoint,{redirect:'error',signal:AbortSignal.timeout(2500),headers:{authorization:`Bearer ${token}`}});
 const value=await responseJson(response,16*1024*1024);if(!response.ok)throw new Error('route-not-ready');return value;
}
/** Files are enabled while admission is STILL fenced. The caller opens admission synchronously afterward. */
export async function prepareActivation(plan:ActivationPlan,origin:string,ownerId:string,consumers:Consumer[],snapshot:()=>Snapshot):Promise<void>{
 if(!Array.isArray(plan.producers)||plan.producers.length<1||plan.producers.length>32||!Array.isArray(plan.consumers)||plan.consumers.length!==consumers.length||new Set(plan.consumers.map(c=>c.id)).size!==consumers.length||consumers.some(c=>!plan.consumers.some(route=>route.id===c.id)))throw new Error('incomplete-routes');
 const records=[...plan.producers,...plan.consumers.map(c=>c.route)];if(new Set(records).size!==records.length)throw new Error('duplicate-route');
 const selected=records.map(receipt=>{const record=stages.get(receipt);if(!record)throw new Error('unstaged-route');return record;});
 const checkFiles=async()=>{for(const record of selected)if(!(await read(record.file.path)).bytes.equals(record.file.bytes))throw new Error('route-changed');};
 await checkFiles();
 for(const receipt of plan.producers){const record=stages.get(receipt)!;
  if(record.kind!=='producer'||record.file.value.endpoint!==origin+'/api/monitor/v1/events'||record.file.value.enabled!==false)throw new Error('wrong-producer-route');
  const authority=await get(origin+'/api/hub/v1/authority?scope=ingest',record.file.value.token as string);
  if(!object(authority)||authority.ownerId!==ownerId||authority.scope!=='ingest')throw new Error('producer-not-ready');
 }
 for(const consumer of plan.consumers){const record=stages.get(consumer.route)!;
  if(record.kind!=='pixoo'||record.file.value.endpoint!==origin+'/api/monitor/v1'||record.file.value.ownerId!==ownerId||loopbackEndpoint(consumer.endpoint).pathname!=='/api/monitor/v1'||!validToken(consumer.token))throw new Error('wrong-consumer-route');
  const authority=await get(origin+'/api/hub/v1/authority?scope=control',record.file.value.token as string);
  if(!object(authority)||authority.ownerId!==ownerId||authority.scope!=='control')throw new Error('consumer-not-ready');
  const value=await get(consumer.endpoint+'/sessions',consumer.token);
  if(!object(value)||value.ownerId!==ownerId||value.connection!=='current')throw new Error('consumer-not-ready');
  const checked=validateSnapshot(value.snapshot),current=snapshot();
  // Clock/freshness projection may advance between reads; compare durable session fields.
  const durable=(state:Snapshot)=>state.sessions.map(({observationAgeMs,freshness,restartUncertain,children,...session})=>session);
  if(!checked.ok||checked.value.revision!==current.revision||canonical(durable(checked.value))!==canonical(durable(current))||checked.value.collector!=='quiesced')throw new Error('consumer-not-ready');
 }
 await checkFiles();
 for(const receipt of plan.producers){const record=stages.get(receipt)!;record.file=await replace(record.file,{...record.file.value,enabled:record.enabled});}
 // Locks remain held until the caller commits activation or explicitly abandons the attempt.
}
