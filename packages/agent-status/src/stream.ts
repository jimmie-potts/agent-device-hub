import {systemTimers, type PublisherTimers} from './loop.js';

export type StatusNotice = {kind:'state'|'resync'; revision:number};
export type StatusSubscription = AsyncIterable<StatusNotice> & {close():void};
const FRAME_LIMIT=8192, CHUNK_LIMIT=65536, STREAM_LIMIT=1048576;
const unavailable=():never=>{throw new Error('feed-unavailable');};

/** One consumer, one pending latest-state hint, no replay cursor or history queue. */
export class HubStatusSubscription implements StatusSubscription, AsyncIterator<StatusNotice> {
  readonly #url:string;
  readonly #token:string;
  readonly #owner:string;
  readonly #fetch:typeof fetch;
  readonly #timers:PublisherTimers;
  #closed=false;
  #started=false;
  #claimed=false;
  #pending?:StatusNotice;
  #waiting?: (result:IteratorResult<StatusNotice>)=>void;
  #abort?:AbortController;
  #reader?:ReadableStreamDefaultReader<Uint8Array>;
  #timer?:unknown;
  #wake?:()=>void;

  constructor(url:string,token:string,owner:string,fetcher:typeof fetch=fetch,timers:PublisherTimers=systemTimers) {
    this.#url=url;this.#token=token;this.#owner=owner;this.#fetch=fetcher;this.#timers=timers;
  }
  [Symbol.asyncIterator]():AsyncIterator<StatusNotice> {
    if(this.#claimed)throw new Error('subscription-already-consumed');
    this.#claimed=true;return this;
  }
  next():Promise<IteratorResult<StatusNotice>> {
    if(this.#closed)return Promise.resolve({done:true,value:undefined});
    if(this.#waiting)return Promise.reject(new Error('subscription-read-pending'));
    if(this.#pending){const value=this.#pending;this.#pending=undefined;return Promise.resolve({done:false,value});}
    const next=new Promise<IteratorResult<StatusNotice>>(resolve=>{this.#waiting=resolve;});
    if(!this.#started){this.#started=true;void this.#run();}
    return next;
  }
  return():Promise<IteratorResult<StatusNotice>>{this.close();return Promise.resolve({done:true,value:undefined});}
  close():void {
    if(this.#closed)return;
    this.#closed=true;this.#pending=undefined;this.#abort?.abort();
    // Do not make shutdown await a third-party stream's cancellation promise.
    void this.#reader?.cancel().catch(()=>{});
    this.#clearTimer();this.#wake?.();this.#wake=undefined;
    this.#waiting?.({done:true,value:undefined});this.#waiting=undefined;
  }
  #clearTimer():void{if(this.#timer!==undefined)this.#timers.clearTimeout(this.#timer);this.#timer=undefined;}
  #deadline(ms:number):void{this.#clearTimer();this.#timer=this.#timers.setTimeout(()=>{this.#abort?.abort();void this.#reader?.cancel().catch(()=>{});},ms);}
  #emit(notice:StatusNotice):void {
    if(this.#closed)return;
    if(this.#waiting){const waiting=this.#waiting;this.#waiting=undefined;waiting({done:false,value:notice});}
    else this.#pending=notice;
  }
  #frame(frame:string):boolean {
    if(!frame || frame.split('\n').every(line=>!line || line.startsWith(':')))return false;
    let event='',data='',id='';
    for(const line of frame.split('\n')) {
      if(!line || line.startsWith(':'))continue;
      const colon=line.indexOf(':');const field=colon<0?line:line.slice(0,colon);
      const value=colon<0?'':line.slice(colon+1).replace(/^ /,'');
      if(field==='event'){if(event)unavailable();event=value;}
      else if(field==='data')data+=(data?'\n':'')+value;
      else if(field==='id'){if(id)unavailable();id=value;}
      else unavailable(); // The existing route emits no retry or extension fields.
    }
    if(!['state','resync'].includes(event) || !/^[0-9a-f-]{36}:[0-9]{1,16}$/.test(id))unavailable();
    const sequence=Number(id.slice(id.lastIndexOf(':')+1));if(!Number.isSafeInteger(sequence))unavailable();
    const value=JSON.parse(data) as Record<string,unknown>;
    const keys=['apiVersion','ownerId','revision','connection','collector','lossCount','admissionRejected','uncertain'];
    if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).length!==keys.length || !keys.every(k=>Object.hasOwn(value,k)) ||
      value.apiVersion!=='1.0' || value.ownerId!==this.#owner || value.connection!=='current' ||
      !['running','quiesced','faulted','closed'].includes(value.collector as string) ||
      !['revision','lossCount','admissionRejected','uncertain'].every(k=>Number.isSafeInteger(value[k]) && Number(value[k])>=0))unavailable();
    this.#emit({kind:event as StatusNotice['kind'],revision:value.revision as number});return true;
  }
  async #run():Promise<void> {
    let delay=1000;
    while(!this.#closed) {
      const abort=new AbortController();this.#abort=abort;let healthy=false;
      try {
        this.#deadline(2500);
        const response=await this.#fetch(this.#url,{headers:{Authorization:`Bearer ${this.#token}`,Accept:'text/event-stream'},redirect:'error',signal:abort.signal});
        if(this.#closed || abort.signal.aborted || !response.ok || !response.body || response.headers.get('content-type')?.split(';')[0].trim()!=='text/event-stream') {
          void response.body?.cancel().catch(()=>{});unavailable();
        }
        const reader=response.body!.getReader();this.#reader=reader;
        const decoder=new TextDecoder('utf-8',{fatal:true});let frame='',line='',bytes=0,frameBytes=0,skipLF=false;
        this.#deadline(10000);
        for(;;) {
          const next=await reader.read();
          if(this.#closed || abort.signal.aborted || next.done)break;
          if(next.value.byteLength>CHUNK_LIMIT || (bytes+=next.value.byteLength)>STREAM_LIMIT)unavailable();
          const text=decoder.decode(next.value,{stream:true});
          for(const char of text) {
            if(skipLF){skipLF=false;if(char==='\n')continue;}
            frameBytes+=Buffer.byteLength(char,'utf8');if(frameBytes>FRAME_LIMIT)unavailable();
            if(char==='\r' || char==='\n') {
              skipLF=char==='\r';
              if(!line){healthy=this.#frame(frame)||healthy;frame='';frameBytes=0;this.#deadline(10000);}
              else {frame+=line+'\n';line='';}
            } else line+=char;
          }
        }
      } catch { /* Fixed polling remains operational; no payload or credential is logged. */ }
      finally {
        this.#clearTimer();abort.abort();
        const reader=this.#reader;this.#reader=undefined;void reader?.cancel().catch(()=>{});
      }
      if(this.#closed)return;
      if(healthy)delay=1000;
      await new Promise<void>(resolve=>{this.#wake=resolve;this.#timer=this.#timers.setTimeout(resolve,delay);});
      this.#wake=undefined;this.#clearTimer();delay=Math.min(delay*2,30000);
    }
  }
}
