import assert from 'node:assert/strict';

export async function until(condition){
 const deadline=Date.now()+10000;
 while(!condition()){
  if(Date.now()>deadline)throw new Error('isolation-barrier-timeout');
  await new Promise(resolve=>setTimeout(resolve,10));
 }
}

// Installed before navigation so pause can drain every wall read already admitted
// by this browser. Later wall polls wait before reaching the hub's one-slot client.
// Orders: finish one wall read before Pixoo admission; park wall before Pixoo
// admission; or admit Pixoo before parking wall. None retries a controller read.
export async function isolateWallReads(page,f){
 let armed=false,released=false,order,wallOrdered=false,firstWall=true,startCount=0;
 const active=new Set();
 const wallPattern='**/api/controllers/v1/wall/**';
 const pixelPattern='**/api/controllers/v1/pixel/snapshot';
 const pixelRequest=()=>f.requests.slice(startCount).find(r=>r.id==='pixel'&&r.url==='/controller/v1/snapshot');
 const wallRoute=async route=>{
  if(armed&&!released){
   if(order==='wall-drained'&&firstWall){
    firstWall=false;
    const response=await route.fetch({maxRetries:0});await route.fulfill({response});
    wallOrdered=true;return;
   }
   if(order==='pixel-first')await until(()=>!!pixelRequest());
   wallOrdered=true;
   await until(()=>released);
  }
  if(released){await route.continue();return;}
  const request=(async()=>{const response=await route.fetch({maxRetries:0});await route.fulfill({response});})();
  active.add(request);try{await request;}finally{active.delete(request);}
 };
 const pixelRoute=async route=>{
  if(armed&&!released&&order!=='pixel-first')await until(()=>wallOrdered);
  await route.continue();
 };
 await page.route(wallPattern,wallRoute);await page.route(pixelPattern,pixelRoute);
 return {
  async arm(nextOrder){order=nextOrder;startCount=f.requests.length;armed=true;await Promise.all(active);},
  async pendingPixel(){await until(()=>!!pixelRequest()&&wallOrdered);return pixelRequest();},
  release(){released=true;},
 };
}

export async function independentWallRead(f,pixel,read=()=>fetch(f.hub.url+'/api/controllers/v1/wall/snapshot',{headers:f.headers,signal:AbortSignal.timeout(2000)})){
 assert.equal(pixel.finished,false,'the slow Pixoo read is still pending before the wall read');
 const start=performance.now(),wall=await read();
 assert.equal(wall.status,200);
 await wall.json();
 const elapsed=performance.now()-start;
 assert.ok(elapsed<700,'wall does not await pixel');
 assert.equal(pixel.finished,false,'wall responds while the slow Pixoo read is still pending');
 return elapsed;
}
