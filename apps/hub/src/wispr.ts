import {Worker} from 'node:worker_threads';
import {isAbsolute,normalize} from 'node:path';
import {isIPv4} from 'node:net';
import {HttpError,id,object} from './common.js';

export type WisprOptions={sourceId:string;aggregatePath:string;diagnosticsPath:string;freshnessMs?:number;exposeToDashboard?:boolean;shareTextAggregates?:boolean};
export type WisprConfig=Required<WisprOptions>;
export type WisprResponse={status:number;body:string;csv?:boolean};
export function wisprConfiguration(value:unknown,aliases:string[]):WisprConfig {
  if(!object(value)||Object.keys(value).some(k=>!['sourceId','aggregatePath','diagnosticsPath','freshnessMs','exposeToDashboard','shareTextAggregates'].includes(k))||
    !id(value.sourceId)||isIPv4(value.sourceId)||value.sourceId==='hub-service'||aliases.includes(value.sourceId))throw new Error('invalid-wispr');
  for(const key of ['aggregatePath','diagnosticsPath']){
    const path=value[key];
    if(typeof path!=='string'||!isAbsolute(path)||normalize(path)!==path||!path.endsWith('.json')||path.length>4096||/[\x00-\x1f\\]/.test(path)||/(?:^|\/)(?:\.git|onedrive[^/]*|dropbox|google drive|icloud drive)(?:\/|$)/i.test(path))throw new Error('invalid-wispr');
  }
  if(value.aggregatePath===value.diagnosticsPath||['exposeToDashboard','shareTextAggregates'].some(k=>value[k]!==undefined&&typeof value[k]!=='boolean')||
    (value.freshnessMs!==undefined&&(!Number.isSafeInteger(value.freshnessMs)||Number(value.freshnessMs)<1000||Number(value.freshnessMs)>86400000)))throw new Error('invalid-wispr');
  return {sourceId:value.sourceId,aggregatePath:value.aggregatePath as string,diagnosticsPath:value.diagnosticsPath as string,freshnessMs:(value.freshnessMs as number|undefined)??600000,exposeToDashboard:value.exposeToDashboard===true,shareTextAggregates:value.shareTextAggregates===true};
}

/** One lazy worker owns private file bytes. Only bounded response strings cross back to HTTP. */
export function createWispr(config:WisprConfig,clock:()=>number,workerFactory?:()=>Worker){
  let worker:Worker|undefined,retiring:Promise<number>|undefined,closed=false,sequence=0;
  const pending=new Map<number,{resolve:(response:WisprResponse)=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout}>();
  const rejectAll=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(new HttpError('wispr-unavailable',503));}pending.clear();};
  const stop=()=>{rejectAll();if(worker){const old=worker;worker=undefined;retiring=old.terminate().finally(()=>{retiring=undefined;});}return retiring;};
  const start=()=>{
    if(closed||retiring)throw new HttpError('wispr-unavailable',503);
    if(worker)return worker;
    const next=workerFactory?.()??new Worker(new URL('./wispr-worker.js',import.meta.url),{workerData:config,resourceLimits:{maxOldGenerationSizeMb:192,maxYoungGenerationSizeMb:32}});worker=next;
    next.on('message',(message:{id:number;response:WisprResponse})=>{
      const item=pending.get(message.id);if(!item)return;pending.delete(message.id);clearTimeout(item.timer);item.resolve(message.response);
    });
    next.on('error',()=>{if(worker===next)void stop();});
    next.on('exit',()=>{if(worker===next){worker=undefined;rejectAll();}});
    return next;
  };
  return {
    config,
    pending:()=>pending.size,
    request(route:string,query:string):Promise<WisprResponse>{
      if(pending.size>=32)throw new HttpError('capacity',429);
      const target=start(),requestId=++sequence;
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{void stop();},2500);
        pending.set(requestId,{resolve,reject,timer});
        target.postMessage({id:requestId,route,query,now:clock(),shareText:config.shareTextAggregates});
      });
    },
    privacy(exposeToDashboard:boolean,shareTextAggregates:boolean){
      if(typeof exposeToDashboard!=='boolean'||typeof shareTextAggregates!=='boolean')throw new Error('invalid-wispr');
      config.exposeToDashboard=exposeToDashboard;config.shareTextAggregates=shareTextAggregates;
      rejectAll();worker?.postMessage({kind:'privacy',shareText:shareTextAggregates});
    },
    async close(){closed=true;await stop();}
  };
}
