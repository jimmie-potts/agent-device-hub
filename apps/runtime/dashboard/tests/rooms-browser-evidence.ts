import {setTimeout as delay} from 'node:timers/promises';
import type {CDPSession,Page} from 'playwright';

type Field = string | number | boolean;
const phases = new Set(['init','DOMContentLoaded','load']);
const maxEvents = 32;

/** Observe the synthetic main document without waiting for selectors or retaining response data. */
export async function watchRoomsBrowser(page:Page,cdp:CDPSession) {
  let frameId:string|undefined,loaderId:string|undefined;
  let documentRequest:{id:string;loaderId:string}|undefined;
  let errors=0,lastPageErrorAtMs:number|undefined,crashAtMs:number|undefined,closeAtMs:number|undefined;
  const events:Record<string,Field>[]=[];
  function mark(event:string,fields:Record<string,Field>={}):void {
    if(events.length===maxEvents)events.shift();
    events.push({event,atMs:Date.now(),...fields});
  }
  cdp.on('Page.frameNavigated',({frame})=>{
    if(frame.parentId!==undefined)return;
    frameId=frame.id;loaderId=frame.loaderId;
    mark('commit',{loaderId});
  });
  cdp.on('Page.lifecycleEvent',event=>{
    if(event.frameId===frameId&&phases.has(event.name))mark('cdp-'+event.name,{loaderId:event.loaderId});
  });
  cdp.on('Network.requestWillBeSent',event=>{
    if(event.type!=='Document'||event.frameId!==frameId)return;
    documentRequest={id:event.requestId,loaderId:event.loaderId};
    mark('document-request',{loaderId:event.loaderId});
  });
  cdp.on('Network.responseReceived',event=>{
    if(event.requestId===documentRequest?.id)mark('document-response',{loaderId:event.loaderId,status:event.response.status});
  });
  cdp.on('Network.loadingFinished',event=>{
    if(event.requestId===documentRequest?.id)mark('document-complete',{loaderId:documentRequest.loaderId});
  });
  cdp.on('Network.loadingFailed',event=>{
    if(event.requestId===documentRequest?.id)mark('document-failed',{loaderId:documentRequest.loaderId,cancelled:event.canceled??false});
  });
  page.on('domcontentloaded',()=>mark('playwright-DOMContentLoaded',loaderId===undefined?{}:{loaderAtEvent:loaderId}));
  page.on('load',()=>mark('playwright-load',loaderId===undefined?{}:{loaderAtEvent:loaderId}));
  page.on('pageerror',()=>{errors++;lastPageErrorAtMs=Date.now();});
  page.on('crash',()=>{crashAtMs=Date.now();});
  page.on('close',()=>{closeAtMs=Date.now();});
  const [networkEnabled,lifecycleEnabled]=await Promise.all([
    cdp.send('Network.enable').then(()=>true,()=>false),
    (async ()=>{
      await cdp.send('Page.enable');
      const {frameTree}=await cdp.send('Page.getFrameTree');
      ({id:frameId,loaderId}=frameTree.frame);
      await cdp.send('Page.setLifecycleEventsEnabled',{enabled:true});
    })().then(()=>true,()=>false),
  ]);

  async function readDocument():Promise<unknown> {
    const requestedAtMs=Date.now(),loaderAtRequest=loaderId;
    const reply=await cdp.send('Runtime.evaluate',{returnByValue:true,expression:`(() => {
      const main=document.querySelector('main#main');
      const text=selector=>main?.querySelector(selector)?.textContent?.slice(0,180);
      return {readyState:document.readyState,mainPresent:main!==null,
        route:['#/rooms','#/devices',''].includes(location.hash)?location.hash:'other',
        feed:main?.getAttribute('data-feed'),
        card:text('.apartment-selection [data-light-card="lamp-b"] [role="status"]'),
        fixture:text('[data-apartment-fixture-status="sample-sconce"]'),
        workspace:text('.lighting-workspace > [role="status"]')};
    })()`});
    if(reply.exceptionDetails!==undefined)return 'unavailable';
    const document:unknown=reply.result.value;
    return {requestedAtMs,observedAtMs:Date.now(),loaderAtRequest,loaderAtObservation:loaderId,document};
  }

  async function onFailure(extra:Record<string,Promise<unknown>>={}) {
    const timer=new AbortController();
    const reads={...extra,browser:readDocument(),lateBrowser:delay(1500,undefined,{signal:timer.signal}).then(readDocument)};
    const evidence:Record<string,unknown>=Object.fromEntries(Object.keys(reads).map(key=>[key,'unavailable']));
    try{
      await Promise.race([
        Promise.allSettled(Object.entries(reads).map(async ([key,read])=>{evidence[key]=await read;})),
        delay(2000,undefined,{signal:timer.signal}),
      ]);
    }finally{timer.abort();}
    return {...evidence,navigation:{networkEnabled,lifecycleEnabled,loaderId,events},
      page:{errorCount:errors,lastPageErrorAtMs,crashAtMs,closeAtMs}};
  }

  return {networkEnabled,mark,currentLoader:()=>loaderId,onFailure};
}
