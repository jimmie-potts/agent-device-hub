import type {Snapshot, Request, Command} from '../../../packages/contracts/src/types';
export type {Snapshot, Command};
export type Component = {id:string;kind:string;controllerId:string;deviceId:string;health:string;pending:number;editorUrl?:string};
export type Context = {apiVersion:'1.0';control:boolean;consumers:string[];components:Component[]};
export function safeEditorUrl(value:unknown):string|undefined {
 try {if(typeof value!=='string')return;const u=new URL(value);if(u.protocol==='http:'&&u.hostname==='127.0.0.1'&&!u.username&&!u.password&&!u.search&&!u.hash)return u.href;}catch{}
}
export function makeCommand(snapshot:Snapshot,command:Command):Request {
 return {apiVersion:'1.0',controllerId:snapshot.identity.controllerId,deviceId:snapshot.identity.deviceId,requestId:structuredClone(snapshot.nextRequestId),expectedConfigurationRevision:snapshot.configurationRevision,expectedGeneration:structuredClone(snapshot.generation),command};
}
export class ApiError extends Error {constructor(public code:string,public status=0,public detail:unknown=undefined){super(code);}}
export class Api {
 constructor(private token:string){}
 async request<T>(path:string,body?:unknown,signal?:AbortSignal):Promise<T> {
  try {
   const response=await fetch(path,{method:body===undefined?'GET':'POST',redirect:'error',cache:'no-store',headers:{authorization:`Bearer ${this.token}`,'content-type':'application/json','x-pixoo-request':'1'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(5000)]):AbortSignal.timeout(5000)});
   const value=await response.json();
   if(!response.ok)throw new ApiError(value.error?.code??value.failure?.code??'unavailable',response.status,value);
   if(value.ok===false)throw new ApiError(value.code??'unavailable',503,value);
   return value as T;
  }catch(error){if(error instanceof ApiError)throw error;throw new ApiError(body===undefined?'connection-unavailable':'uncertain-result');}
 }
 async feed(signal:AbortSignal,onChange:()=>void,onStatus:(connected:boolean)=>void){
  let cursor='',delay=500;
  while(!signal.aborted){
   let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
   const timeout=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
   const touch=()=>{clearTimeout(timer);timer=setTimeout(()=>timeout.abort(),8000);};
   try {
    touch();const response=await fetch('/api/monitor/v1/changes',{headers:{authorization:`Bearer ${this.token}`,...(cursor?{'last-event-id':cursor}:{})},signal:AbortSignal.any([signal,timeout.signal]),cache:'no-store',redirect:'error'});
    if(!response.ok||!response.body)throw new Error('feed-unavailable');
    onStatus(true);delay=500;reader=response.body.getReader();let buffer='';const decoder=new TextDecoder();
    while(!signal.aborted){const chunk=await reader.read();if(chunk.done)break;touch();buffer+=decoder.decode(chunk.value,{stream:true});if(buffer.length>65536)throw new Error('feed-capacity');let end;
     while((end=buffer.indexOf('\n\n'))>=0){const event=buffer.slice(0,end);buffer=buffer.slice(end+2);const id=/^id: (.+)$/m.exec(event)?.[1];if(id)cursor=id;if(/^event: (state|resync)$/m.test(event))onChange();}
    }
   }catch{}finally{clearTimeout(timer);await reader?.cancel().catch(()=>{});}
   if(signal.aborted)return;onStatus(false);
   await new Promise<void>(resolve=>{const done=()=>{clearTimeout(t);signal.removeEventListener('abort',done);resolve();};const t=setTimeout(done,delay);signal.addEventListener('abort',done,{once:true});});delay=Math.min(delay*2,10000);
  }
 }
}
