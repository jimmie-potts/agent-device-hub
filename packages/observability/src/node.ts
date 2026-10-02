import {AsyncLocalStorage} from 'node:async_hooks';
import pino from 'pino';
import {createRecord,encodeRecord,parseTraceparent,MAX_QUEUE_RECORDS,MAX_QUEUE_BYTES,MAX_FLUSH_MS,type TraceContext} from './index.js';

export class DiagnosticContext {
  readonly #storage=new AsyncLocalStorage<TraceContext|undefined>();
  current():TraceContext|undefined {return this.#storage.getStore();}
  capture():TraceContext|undefined {const value=this.current();return value?Object.freeze({...value}):undefined;}
  run<T>(value:TraceContext|undefined,action:()=>T):T {
    const validated=value?parseTraceparent(`00-${value.trace_id}-${value.span_id}-${value.trace_flags}`,{authenticated:true,owned:true}):undefined;
    return this.#storage.run(validated,action);
  }
}
export type SinkOptions={maxRecords?:number;maxBytes?:number;flushMs?:number;minimumSeverity?:number};
export type Sink=(line:string)=>void|Promise<void>;
const saturating=(value:number)=>Math.min(Number.MAX_SAFE_INTEGER,value+1);
function bounded(value:number|undefined,fallback:number):number {
  return value===undefined?fallback:Number.isInteger(value)&&value>0&&value<=fallback?value:fallback;
}
/** The injected sink must return promptly; promises may settle asynchronously. */
export function createPinoEmitter(sink:Sink,options:SinkOptions={}) {
  const maxRecords=bounded(options.maxRecords,MAX_QUEUE_RECORDS),maxBytes=bounded(options.maxBytes,MAX_QUEUE_BYTES);
  const flushMs=bounded(options.flushMs,MAX_FLUSH_MS);
  const minimum=[1,5,9,13,17,21].includes(options.minimumSeverity??9)?options.minimumSeverity??9:9;
  const queue:Array<{line:string;bytes:number}>=[];
  let bytes=0,accepted=0,dropped=0,failed=0,active=false,closing=false,closed=false;
  let notify:(()=>void)|undefined;
  const countDrop=()=>{dropped=saturating(dropped);};
  const drain=()=>{
    if(active || closed)return;
    const item=queue[0];if(!item){notify?.();return;}
    active=true;
    // A microtask prevents a synchronous host sink from running in a product call.
    void Promise.resolve().then(()=>sink(item.line)).then(()=>finish(false),()=>finish(true));
    function finish(error:boolean) {
      if(closed)return;
      if(error)failed=saturating(failed);
      queue.shift();bytes-=item.bytes;active=false;drain();
    }
  };
  let lastAccepted=false;
  const logger=pino({level:'trace',base:null,timestamp:false,
    formatters:{level:(_label,number)=>({severity_number:({10:1,20:5,30:9,40:13,50:17,60:21} as Record<number,number>)[number]})}}, {
    write(line:string) {
      const size=Buffer.byteLength(line);
      if(closing || closed || queue.length>=maxRecords || bytes+size>maxBytes){countDrop();return;}
      queue.push({line,bytes:size});bytes+=size;accepted=saturating(accepted);lastAccepted=true;drain();
    },
  });
  const methods:Record<number,'trace'|'debug'|'info'|'warn'|'error'|'fatal'>={1:'trace',5:'debug',9:'info',13:'warn',17:'error',21:'fatal'};
  return {
    emit(input:unknown):boolean {
      if(closing || closed){countDrop();return false;}
      try {
        const result=createRecord(input);
        if(!result.ok || !encodeRecord(result.value)){countDrop();return false;}
        if(result.value.severity_number<minimum)return false;
        const {severity_number,...fields}=result.value;
        lastAccepted=false;logger[methods[severity_number]](fields);return lastAccepted;
      } catch {failed=saturating(failed);return false;}
    },
    counts:()=>({accepted,dropped,failed,queued:queue.length,bytes}),
    async close():Promise<void> {
      if(closed)return;
      if(closing)return;
      closing=true;
      if(queue.length)await new Promise<void>(resolve=>{
        const timer=setTimeout(resolve,flushMs);
        notify=()=>{clearTimeout(timer);resolve();};
      });
      closed=true;notify=undefined;
      dropped=Math.min(Number.MAX_SAFE_INTEGER,dropped+queue.length);
      queue.length=0;bytes=0;
    },
  };
}
