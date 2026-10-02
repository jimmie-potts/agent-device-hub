import type {Feed} from './feed.js';

type Subscription=AsyncIterable<unknown>&{close?():void};
type Active={subscription:Subscription;iterator:AsyncIterator<unknown>;closed:boolean};

/** Optional feed notices request work; evaluation remains with the publisher. */
export class FeedListener {
  readonly #feed:Pick<Feed<unknown>,'subscribe'>;
  readonly #update:()=>void;
  #stopped=false;
  #active?:Active;
  constructor(feed:Pick<Feed<unknown>,'subscribe'>,update:()=>void){this.#feed=feed;this.#update=update;}
  start():void {
    if(this.#stopped || this.#active || !this.#feed.subscribe)return;
    let subscription:Subscription|undefined,active:Active;
    try {subscription=this.#feed.subscribe();active={subscription,iterator:subscription[Symbol.asyncIterator](),closed:false};}
    catch {try{subscription?.close?.();}catch{}return;}
    this.#active=active;
    void(async()=>{
      try {while(!this.#stopped){const next=await active.iterator.next();if(next.done || this.#stopped)break;this.#update();}}
      catch { /* A later evaluation may retry; polling is independent. */ }
      finally {if(this.#active===active)this.#active=undefined;this.#close(active);}
    })();
  }
  stop():void{this.#stopped=true;const active=this.#active;this.#active=undefined;if(active)this.#close(active);}
  #close(active:Active):void {
    if(active.closed)return;active.closed=true;
    try {active.subscription.close?.();}catch{}
    try {void Promise.resolve(active.iterator.return?.()).catch(()=>{});}catch{}
  }
}
