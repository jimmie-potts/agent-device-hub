import {verifyNanoleaf,type NanoleafRoute} from './setup-consumer.js';
import {managedPixooConsumer,type ManagedOwner} from './migration.js';
import {DatabaseSync} from 'node:sqlite';
import {open,lstat,realpath,mkdir,rename,rm,readFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {validateSnapshot,type Snapshot,type Consumer} from '@jimmie-potts/agent-state';
import {createEmitter,type SourceConfiguration} from '@jimmie-potts/agent-state/providers';
import {object,exact,loopbackEndpoint,responseJson,canonical} from './common.js';
export type StagedRoute={readonly kind:'producer'|'pixoo';readonly digest:string};
type File={path:string;bytes:Buffer;value:Record<string,unknown>};
type Stage={file:File;lock:string;enabled:boolean;kind:StagedRoute['kind'];intent:Intent;unlock:()=>void};
type Intent={version:1;pid:number;start:string;kind:StagedRoute['kind'];enabled:boolean;before:string;after:string};
async function processStart(pid:number):Promise<string|null>{try{const stat=await readFile('/proc/'+pid+'/stat','utf8');return stat.slice(stat.lastIndexOf(')')+2).split(' ')[19];}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}}
async function writeIntent(lock:string,intent:Intent){const temporary=join(lock,randomUUID()+'.tmp');const file=await open(temporary,'wx',0o600);try{await file.writeFile(JSON.stringify(intent));await file.sync();}finally{await file.close();}await rename(temporary,join(lock,'intent.json'));const directory=await open(lock,'r');try{await directory.sync();}finally{await directory.close();}const parent=await open(dirname(lock),'r');try{await parent.sync();}finally{await parent.close();}}
const held=new Set<string>();
const failedStages=new Set<string>();
async function lockRoute(path:string):Promise<()=>void>{
 if(held.has(path))throw new Error('route-owner-live');held.add(path);let db:DatabaseSync|undefined;
 try{const file=await open(path+'.migration-lease.sqlite',constants.O_CREAT|constants.O_RDWR|constants.O_NOFOLLOW|constants.O_NONBLOCK,0o600);
  try{const stat=await file.stat();if(!stat.isFile()||stat.nlink!==1||stat.uid!==process.getuid!()||(stat.mode&0o077)!==0)throw new Error('invalid-route-lock');}finally{await file.close();}
  db=new DatabaseSync(path+'.migration-lease.sqlite');db.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE');
  return ()=>{db!.close();held.delete(path);};
 }catch(error){db?.close();held.delete(path);throw error;}
}
const stages=new WeakMap<StagedRoute,Stage>();
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const validToken=(token:string)=>/^[A-Za-z0-9_-]{43}(?![\s\S])/.test(token);
async function read(path:string,maximum=8192):Promise<File>{
 if(process.platform!=='linux'||resolve(path)!==path||path.startsWith('/mnt/')||await realpath(path)!==path)throw new Error('invalid-route-file');
 for(let parent=dirname(path);;parent=dirname(parent)){
  try{const marker=await lstat(join(parent,'.git'));if(marker.isFile())throw new Error('route-in-checkout');await lstat(join(parent,'.git','HEAD'));throw new Error('route-in-checkout');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(parent===dirname(parent))break;
 }
 const directory=await lstat(dirname(path));if((directory.mode&0o077)!==0||directory.uid!==process.getuid!())throw new Error('invalid-route-directory');
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const info=await file.stat();if(!info.isFile()||info.nlink!==1||info.uid!==process.getuid!()||(info.mode&0o077)!==0||info.size>maximum)throw new Error('invalid-route-file');
  const buffer=Buffer.alloc(maximum+1);let size=0;while(size<buffer.length){const part=await file.read(buffer,size,buffer.length-size,null);size+=part.bytesRead;if(!part.bytesRead)break;}if(size>maximum)throw new Error('invalid-route-file');
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
 const lock=path+'.migration-lock',unlock=await lockRoute(path),temporary=lock+'.'+randomUUID()+'.tmp';
 let published=false;
 try{
  try{await lstat(lock);throw new Error('route-recovery-required');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const next=transform(file.value),intent:Intent={version:1,pid:process.pid,start:(await processStart(process.pid))!,kind,enabled:file.value.enabled===true,before:file.bytes.toString('base64'),after:Buffer.from(JSON.stringify(next)+'\n').toString('base64')};
  await mkdir(temporary,{mode:0o700});await writeIntent(temporary,intent);await rename(temporary,lock);published=true;
  const parent=await open(dirname(path),'r');try{await parent.sync();}finally{await parent.close();}
  const updated=await replace(file,next),receipt=Object.freeze({kind,digest:hash(updated.bytes)});
  stages.set(receipt,{file:updated,lock,enabled:intent.enabled,kind,intent,unlock});return receipt;
 }catch(error){try{if(published)failedStages.add(path);else await rm(temporary,{recursive:true,force:true});}finally{unlock();}throw error;}
}
/** Recover only a dead coordinator's durable intent. An unknown phase or external edit fails closed. */
export async function recoverRoute(path:string,expected:string):Promise<StagedRoute>{
 const file=await read(path);if(hash(file.bytes)!==expected)throw new Error('route-changed');
 const lock=path+'.migration-lock',unlock=await lockRoute(path);
 try{
  const saved=(await read(join(lock,'intent.json'),32768)).value;
  if(!exact(saved,['version','pid','start','kind','enabled','before','after'])||saved.version!==1||!Number.isSafeInteger(saved.pid)||(saved.pid as number)<1||typeof saved.start!=='string'||!['producer','pixoo'].includes(saved.kind as string)||typeof saved.enabled!=='boolean'||typeof saved.before!=='string'||typeof saved.after!=='string')throw new Error('invalid-route-intent');
  const intent=saved as unknown as Intent;
  if(await processStart(intent.pid)===intent.start && !(intent.pid===process.pid&&failedStages.has(path)))throw new Error('route-owner-live');
  const before=Buffer.from(intent.before,'base64'),after=Buffer.from(intent.after,'base64');
  if(!file.bytes.equals(before)&&!file.bytes.equals(after))throw new Error('route-changed');
  intent.pid=process.pid;intent.start=(await processStart(process.pid))!;
  await writeIntent(lock,intent);
  const next=JSON.parse(after.toString('utf8')) as Record<string,unknown>;
  if(intent.kind==='producer')next.enabled=false;
  intent.before=file.bytes.toString('base64');intent.after=Buffer.from(JSON.stringify(next)+'\n').toString('base64');await writeIntent(lock,intent);
  const updated=await replace(file,next),receipt=Object.freeze({kind:intent.kind,digest:hash(updated.bytes)});
  stages.set(receipt,{file:updated,lock,enabled:intent.enabled,kind:intent.kind,intent,unlock});failedStages.delete(path);return receipt;
 }catch(error){failedStages.add(path);unlock();throw error;}
}
async function updateStage(record:Stage,next:Record<string,unknown>){
 record.intent.before=record.file.bytes.toString('base64');record.intent.after=Buffer.from(JSON.stringify(next)+'\n').toString('base64');
 await writeIntent(record.lock,record.intent);record.file=await replace(record.file,next);
}
export async function retargetRoute(receipt:StagedRoute,ownerId:string,endpoint:string,token:string):Promise<void>{
 const record=stages.get(receipt);if(!record||!validToken(token))throw new Error('unstaged-route');
 const url=loopbackEndpoint(endpoint);if(url.pathname!==(record.kind==='producer'?'/api/monitor/v1/events':'/api/monitor/v1'))throw new Error('invalid-route');
 if(record.kind==='pixoo'&&record.file.value.ownerId!==ownerId)throw new Error('wrong-owner');
 await updateStage(record,{...record.file.value,endpoint,token,...(record.kind==='producer'?{enabled:false}:{})});
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
export async function releaseRoute(route:StagedRoute):Promise<void>{
 const staged=stages.get(route);if(!staged)return;stages.delete(route);
 try{
  const current=await read(staged.file.path);
  if(!current.bytes.equals(staged.file.bytes))throw new Error('route-changed');
  if(staged.kind==='producer'&&current.value.enabled!==staged.enabled)failedStages.add(staged.file.path);
  else await rm(staged.lock,{recursive:true});
 }catch(error){failedStages.add(staged.file.path);throw error;}
 finally{staged.unlock();}
}

export type ActivationPlan={producers:StagedRoute[];consumers:({id:string;route:StagedRoute;owner:ManagedOwner}|{id:'nanoleaf';nanoleaf:NanoleafRoute})[]};
async function get(endpoint:string,token:string):Promise<unknown>{
 const response=await fetch(endpoint,{redirect:'error',signal:AbortSignal.timeout(2500),headers:{authorization:`Bearer ${token}`}});
 const value=await responseJson(response,16*1024*1024);if(!response.ok)throw new Error('route-not-ready');return value;
}
/** Files are enabled while admission is STILL fenced. The caller opens admission synchronously afterward. */
export async function prepareActivation(plan:ActivationPlan,origin:string,ownerId:string,consumers:Consumer[],snapshot:()=>Snapshot):Promise<void>{
 if(!object(plan))throw new Error('incomplete-routes');
 if(!Array.isArray(plan.producers)||plan.producers.length<1||plan.producers.length>32||!Array.isArray(plan.consumers)||plan.consumers.length!==consumers.length||new Set(plan.consumers.map(c=>c.id)).size!==consumers.length||consumers.some(c=>!plan.consumers.some(route=>route.id===c.id)))throw new Error('incomplete-routes');
 if(plan.consumers.some(c=>!object(c)||!(c.id==='pixoo'&&exact(c,['id','route','owner'])||c.id==='nanoleaf'&&exact(c,['id','nanoleaf']))))throw new Error('consumer-not-ready');
 const pixoo=plan.consumers.filter((c):c is {id:string;route:StagedRoute;owner:ManagedOwner}=>'route' in c);
 const records=[...plan.producers,...pixoo.map(c=>c.route)];if(new Set(records).size!==records.length)throw new Error('duplicate-route');
 const selected=records.map(receipt=>{const record=stages.get(receipt);if(!record)throw new Error('unstaged-route');return record;});
 const checkFiles=async()=>{for(const record of selected)if(!(await read(record.file.path)).bytes.equals(record.file.bytes))throw new Error('route-changed');};
 await checkFiles();
 for(const receipt of plan.producers){const record=stages.get(receipt)!;
  if(record.kind!=='producer'||record.file.value.endpoint!==origin+'/api/monitor/v1/events'||record.file.value.enabled!==false)throw new Error('wrong-producer-route');
  const authority=await get(origin+'/api/hub/v1/authority?scope=ingest',record.file.value.token as string);
  if(!object(authority)||authority.ownerId!==ownerId||authority.scope!=='ingest')throw new Error('producer-not-ready');
 }
 for(const consumer of pixoo){const record=stages.get(consumer.route)!;
  if(record.kind!=='pixoo'||consumer.id!=='pixoo'||record.file.value.endpoint!==origin+'/api/monitor/v1'||record.file.value.ownerId!==ownerId)throw new Error('wrong-consumer-route');
  const facade=managedPixooConsumer(consumer.owner,record.file.path,hash(record.file.bytes));if(facade.endpoint===origin+'/api/monitor/v1')throw new Error('consumer-not-ready');
  const authority=await get(origin+'/api/hub/v1/authority?scope=control',record.file.value.token as string);
  if(!object(authority)||authority.ownerId!==ownerId||authority.scope!=='control')throw new Error('consumer-not-ready');
  const value=await get(facade.endpoint+'/sessions',facade.token);
  if(!object(value)||value.ownerId!==ownerId||value.connection!=='current')throw new Error('consumer-not-ready');
  const checked=validateSnapshot(value.snapshot),current=snapshot();
  // Clock/freshness projection may advance between reads; compare durable session fields.
  const durable=(state:Snapshot)=>state.sessions.map(({observationAgeMs,freshness,restartUncertain,children,...session})=>session);
  if(!checked.ok||checked.value.revision!==current.revision||canonical(durable(checked.value))!==canonical(durable(current))||checked.value.collector!==current.collector)throw new Error('consumer-not-ready');
 }
 for(const consumer of plan.consumers)if('nanoleaf' in consumer)await verifyNanoleaf(consumer.nanoleaf,origin,ownerId,snapshot());
 await checkFiles();
 for(const receipt of plan.producers){const record=stages.get(receipt)!;await updateStage(record,{...record.file.value,enabled:record.enabled});}
 await checkFiles();
 for(const consumer of pixoo){const record=stages.get(consumer.route)!;managedPixooConsumer(consumer.owner,record.file.path,hash(record.file.bytes));}
 for(const consumer of plan.consumers)if('nanoleaf' in consumer)await verifyNanoleaf(consumer.nanoleaf,origin,ownerId,snapshot());
 // Locks remain held until the caller commits activation or explicitly abandons the attempt.
}
