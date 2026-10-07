import {expect,it} from 'vitest';
import type {MonitorView} from '../../src/presentation/sources.js';
import {DashboardService} from '../../src/presentation/dashboard-service.js';
import {present} from '../helpers/present.js';
const view=(revision:number):MonitorView=>({connection:'current',snapshot:{revision,collector:'running',sessions:[]}});
const settle=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};
it('holds one active and one newest pending render and cannot publish an obsolete completion',async()=>{
 let now=0;const finishes:Array<(frames:Uint8Array[])=>void>=[],revisions:Array<number|null>=[];
 const service=new DashboardService({clock:()=>now,cadenceMs:3000,render:layout=>{revisions.push(layout.revision);return new Promise(resolve=>finishes.push(resolve));}});
 service.submit(view(1));await settle();
 for(let i=2;i<=100;i++)service.submit(view(i));
 expect(service.status()).toMatchObject({active:1,pending:1,state:'pending',rendition:null});
 present(finishes.shift())([new Uint8Array(12288)]);await settle();
 expect(service.status().rendition).toBeNull();expect(revisions).toEqual([1]);
 now=3000;service.tick();await settle();expect(revisions).toEqual([1,100]);
 present(finishes.shift())([new Uint8Array(12288)]);await settle();
 expect(service.status().rendition?.layout.revision).toBe(100);
 service.close();expect(service.status()).toMatchObject({state:'closed',rendition:null,pending:0});
});
it('retires work on close, retries failure at cadence, isolates returned data and keeps the rendition of an identical view',async()=>{
 let now=0,fail=true;
 const service=new DashboardService({clock:()=>now,cadenceMs:10,render:()=>{if(fail)throw new Error('renderer failed');return [new Uint8Array(12288)];}});
 service.submit(view(1));await settle();await settle();expect(service.status().state).toBe('error');
 fail=false;now=9;service.tick();await settle();expect(service.status().state).toBe('error');
 now=10;service.tick();await settle();await settle();expect(service.status().state).toBe('current');
 const copy=service.status();present(copy.rendition).rgb[0]=255;
 expect(service.status().rendition?.rgb[0]).toBe(0);
 service.submit(view(1));
 expect(service.status().state).toBe('current');
 const closed=new DashboardService({render:()=>new Promise(resolve=>{complete=resolve;})});
 let complete:(frames:Uint8Array[])=>void=()=>{};
 closed.submit(view(1));await settle();closed.close();complete([new Uint8Array(12288)]);await settle();
 expect(closed.status()).toMatchObject({state:'closed',rendition:null});
});
it('resync replaces deleted rows and changes page independently of rendering cadence',async()=>{
 let now=0;const service=new DashboardService({clock:()=>now,cadenceMs:7000});
 const {syntheticDashboardViews}=await import('../../src/presentation/dashboard-examples.js');
 const state=present(syntheticDashboardViews()[0]).view;
 service.submit(state);await settle();await settle();expect(service.status().rendition?.layout.page).toBe(0);
 now=10000;service.tick();await settle();await settle();expect(service.status().rendition?.layout.page).toBe(1);
 now=17000;const empty=view(200);service.submit(empty);await settle();await settle();
 expect(service.status().rendition?.layout).toMatchObject({rows:[],page:0,pages:1});
});
it('publishes every rendered frame at a uniform delay, keeps rgb as the first frame and rejects other frame sets',async()=>{
 let frames=[new Uint8Array(12288).fill(1),new Uint8Array(12288).fill(2)];
 const service=new DashboardService({clock:()=>0,cadenceMs:1,render:()=>frames});
 service.submit(view(1));await settle();await settle();
 const rendition=present(service.status().rendition);
 expect(rendition).toMatchObject({frameDelayMs:500});
 expect(rendition.frames.map(frame=>frame[0])).toEqual([1,2]);
 expect(rendition.rgb).toEqual(rendition.frames[0]);
 for(const invalid of [[],[new Uint8Array(12288),new Uint8Array(12288),new Uint8Array(12288)],[new Uint8Array(12287)]]){
  frames=invalid;const failing=new DashboardService({clock:()=>0,cadenceMs:1,render:()=>frames});
  failing.submit(view(1));await settle();await settle();expect(failing.status()).toMatchObject({state:'error',rendition:null});
 }
});
