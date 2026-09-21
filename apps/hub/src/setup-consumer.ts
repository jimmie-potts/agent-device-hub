import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import type {Snapshot} from '@jimmie-potts/agent-state';
import {readPrivate,digest} from './setup-files.js';
import {canonical,object,loopbackEndpoint} from './common.js';
export type NanoleafCommand={executable:string;args:string[];environment:Record<string,string>};
export type NanoleafRoute={readonly kind:'nanoleaf';readonly id:'nanoleaf'};
type RouteRecord={command:NanoleafCommand;config:string;digest:string;endpoint:string;ownerId:string};
const routes=new WeakMap<NanoleafRoute,RouteRecord>();
async function call(command:NanoleafCommand,args:string[]):Promise<unknown>{
 if(resolve(command.executable)!==command.executable||!Array.isArray(command.args)||command.args.some(a=>typeof a!=='string'))throw new Error('invalid-consumer-command');
 return new Promise((done,reject)=>{
  const child=spawn(command.executable,[...command.args,...args],{env:command.environment,stdio:['ignore','pipe','pipe']});
  let output='',failed=false;const timer=setTimeout(()=>{failed=true;child.kill('SIGKILL');},5000);
  child.stderr.resume();child.stdout.on('data',chunk=>{output+=chunk.toString();if(Buffer.byteLength(output)>1048576){failed=true;child.kill('SIGKILL');}});
  child.on('error',()=>{clearTimeout(timer);reject(new Error('consumer-command-failed'));});
  child.on('close',code=>{clearTimeout(timer);if(code!==0||failed){reject(new Error('consumer-command-failed'));return;}try{done(JSON.parse(output));}catch{reject(new Error('consumer-command-invalid'));}});
 });
}
/** Explicit installed-operation boundary. This invokes the owning CLI, which can start its designated worker. */
export async function prepareNanoleaf(command:NanoleafCommand,config:string,endpoint:string,ownerId:string):Promise<NanoleafRoute>{
 if(loopbackEndpoint(endpoint).pathname!=='/api/monitor/v1')throw new Error('invalid-consumer-route');
 const raw=(await readPrivate(config))!,value=JSON.parse(raw);
 if(value.ownerId!==ownerId||value.endpoint!==endpoint||value.consumerId!=='nanoleaf'||value.clearOnNewTurn!==true)throw new Error('wrong-consumer-route');
 await call(command,['shared-configure','--config',config]);
 const checked=await call(command,['shared-preflight']);if(!object(checked)||checked.feed!=='verified'||checked.ownerId!==ownerId)throw new Error('consumer-not-ready');
 if(await readPrivate(config)!==raw)throw new Error('consumer-configuration-changed');
 await call(command,['shared-select','shared']);
 const route=Object.freeze({kind:'nanoleaf' as const,id:'nanoleaf' as const});routes.set(route,{command:structuredClone(command),config,digest:digest(raw),endpoint,ownerId});return route;
}
export async function verifyNanoleaf(route:NanoleafRoute,origin:string,ownerId:string,snapshot:Snapshot):Promise<void>{
 const record=routes.get(route);if(!record||record.endpoint!==origin+'/api/monitor/v1'||record.ownerId!==ownerId||digest((await readPrivate(record.config))!)!==record.digest)throw new Error('consumer-not-ready');
 // Preflight checks the selected persisted endpoint again, not the config file alone.
 const preflight=await call(record.command,['shared-preflight']);
 const state=await call(record.command,['shared-status']);
 if(!object(preflight)||preflight.ownerId!==ownerId||preflight.revision!==snapshot.revision||!object(state)||state.source!=='shared'||state.ownerId!==ownerId||state.consumerId!=='nanoleaf'||state.clearOnNewTurn!==true||state.connection!=='current'||state.revision!==snapshot.revision||!Array.isArray(state.sessions)||canonical(state.sessions.map(s=>s.identity))!==canonical(snapshot.sessions.map(s=>s.identity)))throw new Error('consumer-not-ready');
}
export async function rollbackNanoleaf(command:NanoleafCommand):Promise<void>{
 await call(command,['shared-select','legacy']);const state=await call(command,['shared-status']);if(!object(state)||state.source!=='legacy')throw new Error('consumer-rollback-unverified');
}
export async function inspectNanoleaf(command:NanoleafCommand){
 const state=await call(command,['shared-status']);if(!object(state))throw new Error('consumer-status-invalid');
 // Re-project only fields owned by this API; never forward arbitrary CLI output.
 return {source:['legacy','shared'].includes(state.source as string)?state.source:'unknown',configured:state.configured===true,connection:['current','stale','unavailable'].includes(state.connection as string)?state.connection:'unknown'};
}
