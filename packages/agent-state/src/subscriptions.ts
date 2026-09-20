import {LIMITS,type Change,type Subscription} from './types.js';

const size=(change:Change)=>Buffer.byteLength(JSON.stringify(change));
const add=(a:number,b:number)=>Math.min(Number.MAX_SAFE_INTEGER,a+b);

class Channel implements Subscription {
  #queue:Change[]=[];
  #bytes=0;
  #dropped=0;
  #closed=false;
  #waiting:((value:IteratorResult<Change>)=>void)|null=null;
  constructor(private readonly onClose:()=>void){}
  [Symbol.asyncIterator](){return this;}
  next():Promise<IteratorResult<Change>>{
    if(this.#queue.length){const value=this.#queue.shift()!;this.#bytes-=size(value);return Promise.resolve({done:false,value});}
    if(this.#closed)return Promise.resolve({done:true,value:undefined});
    if(this.#waiting)return Promise.reject(new Error('pending-read'));
    return new Promise(resolve=>{this.#waiting=resolve;});
  }
  return():Promise<IteratorResult<Change>>{this.close();return Promise.resolve({done:true,value:undefined});}
  close(){
    if(this.#closed)return;
    this.#closed=true;this.#queue=[];this.#bytes=0;
    this.#waiting?.({done:true,value:undefined});this.#waiting=null;this.onClose();
  }
  stats(){return Object.freeze({pending:this.#queue.length,bytes:this.#bytes,dropped:this.#dropped});}
  push(change:Change){
    if(this.#closed)return;
    let value=change;
    if(this.#waiting){const waiting=this.#waiting;this.#waiting=null;waiting({done:false,value});return;}
    if(this.#queue[0]?.kind==='resync'||this.#queue.length>=LIMITS.pendingEvents||this.#bytes+size(change)>LIMITS.pendingBytes){
      this.#dropped=add(this.#dropped,this.#queue[0]?.kind==='resync'?1:this.#queue.length+1);
      this.#queue=[];this.#bytes=0;
      value=Object.freeze({apiVersion:'1.0',kind:'resync',revision:change.revision,dropped:this.#dropped});
    }
    this.#queue.push(value);this.#bytes+=size(value);
  }
}

export class Feeds {
  #channels=new Map<string,Channel>();
  #history:Change[]=[];
  constructor(private readonly initialRevision:number){}
  publish(revision:number){
    const change:Change=Object.freeze({apiVersion:'1.0',kind:'change',revision,dropped:0});
    this.#history.push(change);if(this.#history.length>LIMITS.pendingEvents)this.#history.shift();
    for(const channel of this.#channels.values())channel.push(change);
  }
  subscribe(id:string,revision:number,cursor?:number):Subscription{
    if(this.#channels.has(id))throw new Error('consumer-already-subscribed');
    const channel=new Channel(()=>{this.#channels.delete(id);});this.#channels.set(id,channel);
    const earliest=this.#history[0]?.revision??this.initialRevision+1;
    if(cursor===undefined||!Number.isSafeInteger(cursor)||cursor<earliest-1||cursor>revision){
      channel.push(Object.freeze({apiVersion:'1.0',kind:'resync',revision,dropped:0}));
    }else for(const change of this.#history)if(change.revision>cursor)channel.push(change);
    return channel;
  }
  close(){for(const channel of this.#channels.values())channel.close();}
}
