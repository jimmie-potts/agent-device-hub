import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {Browser,Page,Response} from 'playwright';
import {syntheticApartmentArtwork} from '../../dist/tests/fixtures/apartment.js';
import {furnishedFixture} from './apartment-fixture.ts';
import {changes,feed,type World} from './harness.ts';

const panel=(page:Page)=>page.getByRole('region',{name:'Reported anonymous presence',exact:true});
const marker=(page:Page)=>page.locator('[data-presence-marker]:visible');

async function watchDocumentReload(page:Page,url:string):Promise<()=>Promise<Response|null>> {
  const session=await page.context().newCDPSession(page);
  await Promise.all([session.send('Page.enable'),session.send('Network.enable')]);
  const document=new URL('/',url).href;
  let reloading=false,started=false,committed=false,requestId:string|undefined,status:number|undefined,failed=false;
  session.on('Page.frameStartedNavigating',event=>{
    if(reloading&&event.navigationType==='reload')started=true;
  });
  session.on('Page.frameNavigated',event=>{
    if(reloading&&event.frame.parentId===undefined)committed=true;
  });
  session.on('Network.requestWillBeSent',event=>{
    if(reloading&&event.type==='Document'&&event.request.url===document)requestId=event.requestId;
  });
  session.on('Network.responseReceived',event=>{
    if(event.requestId===requestId)status=event.response.status;
  });
  session.on('Network.loadingFailed',event=>{
    if(event.requestId===requestId)failed=true;
  });
  return async()=>{
    // The connected feed and room controls are the readiness checks after the new document commits.
    reloading=true;
    try{
      return await page.reload({waitUntil:'commit'});
    }catch(error){
      const runtimeStatus=await fetch(document,{signal:AbortSignal.timeout(1000)})
        .then(async response=>{await response.arrayBuffer();return response.status;})
        .catch(()=>null);
      const browser={started,requested:requestId!==undefined,status:status??null,failed,committed};
      console.error(JSON.stringify({journey:'anonymous-apartment-presence',step:'reload after restart',browser,runtimeStatus}));
      throw error;
    }finally{reloading=false;}
  };
}

/** Real stock-report owner, authenticated SDK copies and apartment renderer over fictional inputs. */
export async function apartmentPresenceJourney(browser:Browser,world:World):Promise<void> {
  const {bytes,image}=syntheticApartmentArtwork(),model=furnishedFixture(image);
  const folder=join(world.stateDir,'modules/core/apartment');await mkdir(join(folder,'assets'),{recursive:true,mode:0o700});
  await writeFile(join(folder,'active.json'),JSON.stringify(model),{mode:0o600});
  await writeFile(join(folder,'assets',image.id+'.png'),bytes,{mode:0o600});
  const report=(id:string,key:number,value:number|string|boolean|null,missing=false):void=>world.presence.act({device:'presence-pro',action:'report',id,key,value,missing});
  const source=(id:string,action:'offline'|'online'):void=>world.presence.act({device:'presence-pro',action,id});
  const capture=async(page:Page,name:string,section=false):Promise<void>=>{
    if(process.env.DASHBOARD_RECEIPTS===undefined)return;
    await page.evaluate(()=>{if(document.activeElement instanceof HTMLElement)document.activeElement.blur();});
    const path=join(process.env.DASHBOARD_RECEIPTS,name);
    if(section)await panel(page).screenshot({path});
    else await page.getByRole('region',{name:'Apartment 3D model',exact:true}).screenshot({path});
  };
  const desktop=await browser.newContext({viewport:{width:1280,height:1000}});
  try{
    const page=await desktop.newPage();page.setDefaultTimeout(10_000);
    const reload=await watchDocumentReload(page,world.url);
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    const sent=changes(page);await page.goto(world.url+'/#/rooms');await feed(page,'connected');
    const layout={rooms:[{id:'studio',name:'Studio'},{id:'reading',name:'Reading room'}],assignments:[],groups:[],home:null};
    const saved=await page.request.post(world.url+'/api/v2/commands/lighting-layout-set',{headers:{origin:world.url,'bunny-request':'1'},data:{target:'lighting',requestId:'presence-fixture-layout',data:{expectedRevision:0,layout}}});
    assert.equal(saved.status(),200);const baseline=sent.length;
    const view=panel(page),studio=view.locator('[data-presence-room=studio]'),reading=view.locator('[data-presence-room=reading]');
    await studio.locator('strong').getByText('Studio · occupied',{exact:true}).waitFor();
    await reading.locator('strong').getByText('Reading room · occupied',{exact:true}).waitFor();
    await page.waitForFunction(()=>document.querySelectorAll('[data-presence-marker]:not([hidden])').length===2);
    const sensorA=view.locator('[data-presence-sensor=presence-a]');await sensorA.locator('summary').click();
    await sensorA.getByText(/Approximate device-reported position X 4.00 m, Z 2.00 m/).waitFor();
    assert.match(await sensorA.innerText(),/Active last report received .*; X .*; Y /);
    const lastReport=await studio.innerText();
    await page.clock.install();await page.clock.fastForward(120_000);
    assert.equal(await studio.innerText(),lastReport,'silence does not turn connected reports unknown');
    assert.equal(await marker(page).count(),2);
    report('presence-b',1,false);await studio.getByText('Sources disagree',{exact:false}).waitFor();
    assert.equal(await studio.getAttribute('data-occupancy'),'occupied');
    report('presence-a',1,false);await studio.locator('strong').getByText('Studio · vacant',{exact:true}).waitFor();
    assert.equal(await marker(page).count(),2,'positions never infer room occupancy');
    report('presence-a',5,true);await sensorA.locator('summary').getByText(/held/).waitFor();
    await page.locator('[data-presence-marker][data-held=true]').waitFor();
    report('presence-a',5,null,true);await sensorA.locator('summary').getByText(/hold unknown/).waitFor();
    await page.locator('[data-presence-marker][data-held=unknown]').waitFor();
    report('presence-a',8,15);await sensorA.getByText(/No usable calibrated point reported/).waitFor();
    await page.waitForFunction(()=>document.querySelectorAll('[data-presence-marker]').length===1);
    report('presence-a',8,0);report('presence-a',2,1000);report('presence-a',3,2000);
    await page.waitForFunction(()=>document.querySelectorAll('[data-presence-marker]').length===2);
    report('presence-a',4,false);await page.waitForFunction(()=>document.querySelectorAll('[data-presence-marker]').length===1);
    report('presence-a',4,true);report('presence-a',2,1000);
    assert.equal(await page.locator('[data-presence-marker]').count(),1,'reactivation cannot reuse the previous Y');
    report('presence-a',3,2500);await sensorA.getByText(/Room boundary is ambiguous/).waitFor();
    assert.equal(await page.locator('[data-presence-marker]').count(),1);
    report('presence-a',3,2000);await page.waitForFunction(()=>document.querySelectorAll('[data-presence-marker]').length===2);
    await page.route('**/api/sdk/v1/stream',route=>route.abort());world.dropDashboardStreams();
    await view.getByRole('status').filter({hasText:'Presence reports are last-known.'}).waitFor();
    assert.equal(await page.locator('[data-presence-marker]').count(),0);
    assert.equal(await studio.getAttribute('data-occupancy'),'unknown');
    await sensorA.locator('summary').getByText(/Last-known connection: connected.*Last-known hold unknown/).waitFor();
    await sensorA.getByText(/Last-known source status: connected/).waitFor();
    await capture(page,'presence-last-known.png',true);
    await page.unroute('**/api/sdk/v1/stream');await feed(page,'connected');
    await page.waitForFunction(()=>document.querySelectorAll('[data-presence-marker]').length===2);
    source('presence-a','offline');await sensorA.locator('summary').getByText(/disconnected/).waitFor();
    await page.waitForFunction(()=>document.querySelectorAll('[data-presence-marker]').length===1);
    assert.equal(await studio.getAttribute('data-occupancy'),'unknown','one vacant plus one disconnected is unknown');
    source('presence-b','offline');await reading.locator('strong').getByText('Reading room · unknown',{exact:true}).waitFor();
    assert.equal(await page.locator('[data-presence-marker]').count(),0);
    source('presence-a','online');source('presence-b','online');
    await page.waitForFunction(()=>document.querySelectorAll('[data-presence-marker]').length===2);
    const frame=page.getByRole('combobox',{name:'Frame the apartment or a room'});
    await frame.selectOption({label:'Reading room'});
    await page.waitForFunction(()=>document.querySelectorAll('[data-presence-marker]:not([hidden])').length===1);
    assert.equal(await view.locator('[data-presence-room=studio]').count(),0);
    await world.restart();
    const reloaded=await reload();
    assert.equal(reloaded?.status(),200,'the restarted runtime serves the dashboard document');
    await feed(page,'connected');
    await studio.locator('strong').getByText('Studio · vacant',{exact:true}).waitFor();
    await capture(page,'presence-desktop.png');
    await frame.selectOption({label:'Reading room'});
    await page.waitForFunction(()=>document.querySelectorAll('[data-presence-marker]:not([hidden])').length===1);
    assert.equal(await studio.count(),0,'the restored Reading room frame hides the Studio');
    assert.equal(sent.length,baseline,'reports, camera, loss and restart send zero new commands');
    const fallback=await desktop.newPage();await fallback.addInitScript(()=>{HTMLCanvasElement.prototype.getContext=()=>null;});
    const fallbackSent=changes(fallback);await fallback.goto(world.url+'/#/rooms');await feed(fallback,'connected');
    await fallback.getByText('3D rendering is unavailable. The fixture list and lighting controls remain available.',{exact:true}).waitFor();
    await panel(fallback).getByText('Studio · vacant',{exact:true}).waitFor();
    assert.equal(fallbackSent.length,0);await fallback.close();assert.deepEqual(errors,[]);
  }finally{await desktop.close();}
  const phoneContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  try{
    const phone=await phoneContext.newPage(),sent=changes(phone);phone.setDefaultTimeout(10_000);
    await phone.goto(world.url+'/#/rooms');await feed(phone,'connected');
    await panel(phone).getByText('Studio · vacant',{exact:true}).waitFor();
    await phone.waitForFunction(()=>document.querySelectorAll('[data-presence-marker]:not([hidden])').length===2);
    await panel(phone).locator('[data-presence-sensor=presence-b] summary').tap();
    await panel(phone).getByText(/Approximate device-reported position X 6.00 m, Z 2.00 m/).waitFor();
    await phone.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth);
    await capture(phone,'presence-phone.png');
    assert.equal(sent.length,0);
  }finally{await phoneContext.close();}
  console.log(JSON.stringify({journey:'anonymous-apartment-presence',sources:2,roomOnly:true,approximate:true,held:true,invalidCalibration:true,boundaryAmbiguous:true,sdkStale:true,reconnect:true,phone:true,zeroCommands:true,physical:false}));
}
