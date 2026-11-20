import assert from 'node:assert/strict';
import {mkdir,unlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {Browser,Page} from 'playwright';
import {PACKET} from '@jimmie-potts/lifx';
import {apartmentArtPath,parseApartmentModel} from '../../src/apartment-model.ts';
import {syntheticApartmentArtwork} from '../../dist/tests/fixtures/apartment.js';
import {furnishedFixture} from './apartment-fixture.ts';
import {changes,feed,holdDashboardStream,type World} from './harness.ts';
import {openDirectory} from './navigation-helpers.ts';

declare global {
  interface Window {
    readonly apartmentTestResources:{buffers:number;textures:number;programs:number;closedBitmaps:number;pending:number;aborted:number};
  }
}

const panel=(page:Page)=>page.getByRole('region',{name:'Apartment 3D model',exact:true});
const selectLight=(page:Page,name:string)=>panel(page).getByRole('button',{name:`Select ${name}`,exact:true}).click();

export async function apartmentJourney(browser:Browser,world:World):Promise<void> {
  const {bytes,image}=syntheticApartmentArtwork(),model=furnishedFixture(image);
  assert.ok(parseApartmentModel(model),'synthetic room placements obey the prepared model contract');
  const folder=join(world.stateDir,'modules/core/apartment'),assets=join(folder,'assets'),file=join(assets,image.id+'.png');
  await mkdir(assets,{recursive:true,mode:0o700});
  await writeFile(join(folder,'active.json'),JSON.stringify(model),{mode:0o600});
  await writeFile(file,bytes,{mode:0o600});
  // Keep the card's flip animation out of the guarded command and recovery checks.
  const desktop=await browser.newContext({viewport:{width:1280,height:1000},reducedMotion:'reduce'});
  try{
    const page=await desktop.newPage();page.setDefaultTimeout(10_000);
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    const sent=changes(page);
    // Count live GPU objects through the real API so leaving Rooms proves release at this boundary.
    await page.addInitScript(()=>{
      const gl=WebGLRenderingContext.prototype;
      const buffers=new Set<WebGLBuffer>(),textures=new Set<WebGLTexture>(),programs=new Set<WebGLProgram>();
      let pending=0,aborted=0,closedBitmaps=0;
      function track<T>(key:string,live:Set<T>,type:{new():T}):(this:WebGLRenderingContext)=>T {
        const original:unknown=Reflect.get(gl,key);
        if(typeof original!=='function')throw new Error('WebGL creation method is unavailable');
        return function(){
          const value:unknown=Reflect.apply(original,this,[]);
          if(!(value instanceof type))throw new Error('Unexpected WebGL resource');
          live.add(value);return value;
        };
      }
      function release<T>(key:string,live:Set<T>):(this:WebGLRenderingContext,value:T|null)=>void {
        const original:unknown=Reflect.get(gl,key);
        if(typeof original!=='function')throw new Error('WebGL cleanup method is unavailable');
        return function(value){if(value!==null)live.delete(value);Reflect.apply(original,this,[value]);};
      }
      gl.createBuffer=track('createBuffer',buffers,WebGLBuffer);
      gl.createTexture=track('createTexture',textures,WebGLTexture);
      gl.createProgram=track('createProgram',programs,WebGLProgram);
      gl.deleteBuffer=release('deleteBuffer',buffers);
      gl.deleteTexture=release('deleteTexture',textures);
      gl.deleteProgram=release('deleteProgram',programs);
      const fetchContent=window.fetch.bind(window);
      const closeBitmap:unknown=Object.getOwnPropertyDescriptor(ImageBitmap.prototype,'close')?.value;
      if(typeof closeBitmap!=='function')throw new Error('ImageBitmap.close is unavailable');
      ImageBitmap.prototype.close=function(){closedBitmaps++;Reflect.apply(closeBitmap,this,[]);};
      window.fetch=(input,init)=>{
        if(typeof input==='string'&&input.startsWith('/modules/core/content/apartment-art-')){
          pending++;
          const onAbort=():void=>{aborted++;};
          init?.signal?.addEventListener('abort',onAbort,{once:true});
          return fetchContent(input,init).finally(()=>{pending--;init?.signal?.removeEventListener('abort',onAbort);});
        }
        return fetchContent(input,init);
      };
      Object.defineProperty(window,'apartmentTestResources',{get:()=>({buffers:buffers.size,textures:textures.size,programs:programs.size,closedBitmaps,pending,aborted})});
    });
    const layout={rooms:[{id:'studio',name:'Studio'},{id:'reading',name:'Reading room'}],assignments:[{room:'studio',device:'lamp-a'},{room:'reading',device:'lamp-b'}],groups:[],home:null};
    await page.goto(world.url+'/#/rooms');await feed(page,'connected');
    const replaceLayout=async(requestId:string,next:typeof layout):Promise<void>=>{
      const current=await page.request.get(world.url+'/api/v2/snapshot?families=lighting-layout&owner=bunny%2Fcore');
      const snapshot=await current.json() as {records:{'lighting-layout':{revision:number}[]}};
      const expectedRevision=snapshot.records['lighting-layout'][0]?.revision;
      const reply=await page.request.post(world.url+'/api/v2/commands/lighting-layout-set',{headers:{origin:world.url,'bunny-request':'1'},data:{target:'lighting',requestId,data:{expectedRevision:expectedRevision??0,layout:next}}});
      assert.equal(reply.status(),200);
    };
    await replaceLayout('apartment-assign-fixtures',layout);
    const view=panel(page),canvas=view.locator('canvas[data-rendered=true]'),frame=view.getByRole('combobox',{name:'Frame the apartment or a room'});
    await canvas.waitFor();
    const sensors=view.getByRole('button',{name:'Sensors',exact:true});
    await sensors.click();
    await view.getByText('Sensor details',{exact:true}).click();
    await view.getByText('No presence sensors configured or reports available.',{exact:true}).waitFor();
    await sensors.click();
    assert.ok(Number(await canvas.getAttribute('width'))*Number(await canvas.getAttribute('height'))<=2_005_000);
    assert.equal(await canvas.getAttribute('data-frame'),'apartment');
    await view.getByText('Artwork unavailable: Reading room print.',{exact:true}).waitFor();
    await page.waitForFunction(()=>window.apartmentTestResources.textures===1);
    assert.equal(await page.evaluate(()=>window.apartmentTestResources.closedBitmaps),1,'the GPU has the print and the decoded bitmap is closed');
    const guest=await fetch(world.url+apartmentArtPath(image.id),{redirect:'manual'});assert.equal(guest.status,401);
    if(process.env.DASHBOARD_RECEIPTS!==undefined)await view.screenshot({path:process.env.DASHBOARD_RECEIPTS+'/apartment-desktop.png'});
    await view.getByRole('button',{name:'Overhead',exact:true}).click();
    await view.locator('canvas[data-camera=overhead]').waitFor();
    await view.getByRole('checkbox',{name:'Cutaway walls'}).uncheck();await view.locator('canvas[data-cutaway=false]').waitFor();
    await view.getByRole('checkbox',{name:'Cutaway walls'}).check();
    await frame.selectOption({label:'Reading room'});await view.locator('canvas[data-frame=reading]').waitFor();
    await view.getByText(/room geometry unresolved/).waitFor();
    assert.equal(await view.getByRole('button',{name:'Select Studio floor light',exact:true}).count(),0);
    await selectLight(page,'Unpaired reading lamp');await view.locator('.apartment-selection').getByText('No device is bound to this fixture.').waitFor();
    await view.getByRole('button',{name:'Select Reading wall light in apartment model',exact:true}).click();
    const card=view.getByRole('article',{name:'Reading wall light',exact:true});await card.waitFor();
    assert.equal(sent.length,0,'camera, framing, artwork and selecting a fixture send no command');
    const untouched=world.lifxState().bulbs['192.0.2.42']?.power;
    const nextPower=world.lifxState().bulbs['192.0.2.43']?.power!==true;
    await card.getByRole('button',{name:nextPower?'On':'Off',exact:true}).click();
    const report=view.locator('[data-apartment-fixture-status=sample-sconce]');
    await card.locator(`.light-power button[aria-pressed=true]:not(:disabled):text-is("${nextPower?'On':'Off'}")`).waitFor();
    assert.equal(world.lifxState().bulbs['192.0.2.43']?.power,nextPower);
    assert.equal(world.lifxState().bulbs['192.0.2.42']?.power,untouched);
    assert.equal(sent.length,1,'one deliberate action targeted the existing owner and exact room member');
    assert.match(await report.innerText(),nextPower?/Off · reported/:/On · reported/,'a write acknowledgement is not a fresh observation');
    await world.restart();await page.reload();await feed(page,'connected');await selectLight(page,'Reading wall light');
    await report.filter({hasText:nextPower?'On · reported':'Off · reported'}).waitFor();
    assert.equal(sent.length,1,'reconnect shows the latest reading and does not repeat the command');
    const deviceSnapshot=await page.request.get(world.url+'/api/v2/snapshot?families=device&owner=bunny%2Fmodules%2Flifx');
    assert.equal(deviceSnapshot.status(),200);
    const snapshot:unknown=await deviceSnapshot.json();
    assert.ok(typeof snapshot==='object'&&snapshot!==null&&'records' in snapshot);
    const {records}=snapshot;
    assert.ok(typeof records==='object'&&records!==null&&'device' in records&&Array.isArray(records.device));
    const target:unknown=records.device.find((device:unknown)=>typeof device==='object'&&device!==null&&'id' in device&&device.id==='lamp-b');
    assert.ok(typeof target==='object'&&target!==null&&'configurationRevision' in target&&'generation' in target);
    const releaseStream=await holdDashboardStream(page);world.dropDashboardStreams();
    await view.locator('.apartment-selection').getByText('Room assignments are stale.').waitFor();
    releaseStream();await feed(page,'connected');await card.waitFor();
    await replaceLayout('apartment-reassign',{...layout,assignments:[{room:'studio',device:'lamp-a'},{room:'studio',device:'lamp-b'}]});
    await view.locator('.apartment-selection').getByText('This device is not assigned to this room.').waitFor();
    assert.equal(await card.count(),0);
    await replaceLayout('apartment-restore',layout);await card.waitFor();
    const writes=()=>world.lifxState().packets.filter(packet=>packet.type!==PACKET.lightGet);
    const wallPowerWrite={address:'192.0.2.43',type:PACKET.setPower};
    assert.deepEqual(writes(),[wallPowerWrite],'reassignment and reconnect send no device write');
    world.loseDeviceReply();
    const [acceptance]=await Promise.all([
      page.waitForResponse(reply=>reply.request().method()==='POST'&&reply.url()===world.url+'/api/v2/commands/power-set'),
      card.getByRole('button',{name:nextPower?'Off':'On',exact:true}).click(),
    ]);
    const command:unknown=acceptance.request().postDataJSON();
    assert.ok(typeof command==='object'&&command!==null&&'requestId' in command&&typeof command.requestId==='string'&&command.requestId.length>0);
    assert.deepEqual(command,{target:'lamp-b',requestId:command.requestId,data:{on:!nextPower,
      expectedConfigurationRevision:target.configurationRevision,expectedGeneration:target.generation}});
    assert.equal(acceptance.status(),200);
    assert.deepEqual(await acceptance.json(),{schema:'command-reply/2.0',status:'accepted',requestId:command.requestId});
    assert.equal(sent.length,2,'one deliberate action sent the uncertain request');
    // Hosted CI observed the terminal operation near 10s, with almost no time left to observe it in the card.
    await card.getByRole('status').filter({hasText:/Uncertain/}).waitFor({timeout:15_000});
    assert.equal(world.lifxState().bulbs['192.0.2.43']?.power,!nextPower);
    assert.equal(world.lifxState().bulbs['192.0.2.42']?.power,untouched);
    const writesAfterUncertainty=[wallPowerWrite,wallPowerWrite,wallPowerWrite];
    assert.deepEqual(writes(),writesAfterUncertainty,'the owner made its two allowed protocol attempts for the single lost-reply command');
    // Keep recovery reads from changing availability during the later artwork checks.
    world.offlineLifx(wallPowerWrite.address);
    await page.reload();await feed(page,'connected');await selectLight(page,'Reading wall light');
    await card.getByRole('status').filter({hasText:/Uncertain/}).waitFor();
    assert.equal(await card.getByRole('button',{name:'Off',exact:true}).isDisabled(),true);
    assert.equal(sent.length,2,'reload never retries a retained request with an uncertain result');
    assert.deepEqual(writes(),writesAfterUncertainty,'reload does not replay the uncertain write');
    await page.waitForFunction(()=>window.apartmentTestResources.textures===1);
    await openDirectory(page);
    await page.waitForFunction(()=>{const r=window.apartmentTestResources;return r.buffers===0&&r.textures===0&&r.programs===0;});
    await page.route('**/modules/core/content/apartment-art-*',async route=>{
      // Keep the response body incomplete while leaving the route, then release the test interception.
      await page.waitForFunction(()=>window.apartmentTestResources.aborted===1);
      await route.abort();
    });
    await page.getByRole('link',{name:'Rooms',exact:true}).click();await canvas.waitFor();
    await page.waitForFunction(()=>window.apartmentTestResources.pending===1);
    await openDirectory(page);
    await page.waitForFunction(()=>{const r=window.apartmentTestResources;return r.aborted===1&&r.buffers===0&&r.textures===0&&r.programs===0;});
    await page.unrouteAll({behavior:'wait'});
    await unlink(file);
    await page.getByRole('link',{name:'Rooms',exact:true}).click();await canvas.waitFor();
    await view.getByText('Artwork unavailable: Abstract sun print, Reading room print.',{exact:true}).waitFor();
    await selectLight(page,'Reading wall light');await card.waitFor();
    await report.filter({hasText:'Device unavailable; current light state is unknown.'}).waitFor();
    assert.equal(await card.getByText('Brightness · observed',{exact:false}).count(),0);
    await card.getByText('Brightness · requested',{exact:false}).waitFor();
    if(process.env.DASHBOARD_RECEIPTS!==undefined)await view.screenshot({path:process.env.DASHBOARD_RECEIPTS+'/apartment-missing-art.png'});
    assert.equal(sent.length,2,'missing artwork and departure send no light command');
    assert.deepEqual(writes(),writesAfterUncertainty);
    assert.deepEqual(errors,[]);
    const fallback=await desktop.newPage();
    await fallback.addInitScript(()=>{HTMLCanvasElement.prototype.getContext=()=>null;});
    const fallbackSent=changes(fallback);
    await fallback.goto(world.url+'/#/rooms');await feed(fallback,'connected');
    await panel(fallback).getByText('3D rendering is unavailable. The fixture list and lighting controls remain available.',{exact:true}).waitFor();
    await selectLight(fallback,'Reading wall light');await panel(fallback).getByRole('article',{name:'Reading wall light',exact:true}).waitFor();
    assert.equal(fallbackSent.length,0);
    await fallback.close();
  }finally{await desktop.close();}
  await writeFile(file,bytes,{mode:0o600});
  const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  try{
    const phone=await mobile.newPage(),mobileSent=changes(phone);
    await phone.goto(world.url+'/#/rooms');await feed(phone,'connected');
    const view=panel(phone),canvas=view.locator('canvas[data-rendered=true]');
    await canvas.waitFor();await canvas.scrollIntoViewIfNeeded();
    await phone.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth);
    await view.getByText('Artwork unavailable: Reading room print.',{exact:true}).waitFor();
    if(process.env.DASHBOARD_RECEIPTS!==undefined)await phone.screenshot({path:process.env.DASHBOARD_RECEIPTS+'/apartment-phone.png'});
    const box=await canvas.boundingBox();assert.ok(box!==null);
    const yaw=await canvas.getAttribute('data-yaw'),touch=await mobile.newCDPSession(phone),x=box.x+box.width*.48,y=box.y+box.height*.82;
    await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x-43,y,id:1}]});
    await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+18,y:y-12,id:1}]});
    await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await phone.waitForFunction(before=>document.querySelector('.apartment-viewport canvas')?.getAttribute('data-yaw')!==before,yaw);
    const distance=Number(await canvas.getAttribute('data-distance'));
    await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x-28,y,id:1},{x:x+28,y,id:2}]});
    await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-68,y,id:1},{x:x+68,y,id:2}]});
    await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await phone.waitForFunction(before=>Number(document.querySelector('.apartment-viewport canvas')?.getAttribute('data-distance'))<before,distance);
    await view.getByRole('combobox').selectOption({label:'Studio'});await view.locator('canvas[data-frame=studio]').waitFor();
    await view.getByRole('button',{name:'Overhead',exact:true}).tap();await view.locator('canvas[data-camera=overhead]').waitFor();
    assert.equal(mobileSent.length,0,'phone inspection sends no light command');
  }finally{await mobile.close();}
  console.log(JSON.stringify({journey:'furnished-apartment',rooms:2,artwork:true,roomFrame:true,webglFallback:true,unmountReleasesResources:true,readCancelled:true,
    touchOrbit:true,touchPinch:true,guardedFixture:true,stale:true,reassignment:true,uncertainNoReplay:true,physical:false}));
}
