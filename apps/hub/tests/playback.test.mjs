import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createPlayback} from '../dist/playback.js';
import {createSonySource,sonyConfiguration} from '../dist/sony.js';
import {startHub} from '../dist/server.js';
import {requestBrowserLaunch} from '../dist/browser-launch.js';

const principal={id:'phone',devices:['kitchen']};
const playing={status:'playing',title:'Song',artist:'Artist',controls:['pause','next']};

// A source written without any Sony code, to show the shared module needs only the interface.
function fakeSource(id='kitchen'){
  const sent=[];let report;
  return {id,sent,report:value=>report(value),start(callback){report=callback;},async command(action){sent.push(action);return 'sent';},closed:false,async close(){this.closed=true;}};
}

test('a non-Sony source uses the shared playback interface unchanged',async()=>{
  const source=fakeSource();let clock=1000;
  const playback=createPlayback(source,()=>clock);
  assert.deepEqual(playback.snapshot(),{apiVersion:'1.0',sourceId:'kitchen',availability:'unavailable',observedAtMs:null,ageMs:null,playback:null});
  source.report(playing);clock+=250;
  assert.deepEqual(playback.snapshot(),{apiVersion:'1.0',sourceId:'kitchen',availability:'available',observedAtMs:1000,ageMs:250,playback:playing});
  const response=await playback.command({requestId:'r1',sourceId:'kitchen',action:'next'},principal);
  assert.deepEqual(response,{status:200,body:{requestId:'r1',sourceId:'kitchen',action:'next',outcome:'sent'}});
  assert.deepEqual(source.sent,['next']);
  await playback.close();assert.equal(source.closed,true);
});

const airplay=(fields={})=>({source:'extInput:airPlay',uri:'extInput:airPlay',output:'',stateInfo:{state:'PLAYING',supplement:''},title:'Song',artist:'Artist',albumName:'Album',
  applicationName:'app',content:{thumbnailUrl:'http://192.168.1.20:60200/thumbnail.jpg'},...fields});
const playingInfo=entries=>({result:[entries]});

// Answers Sony JSON-RPC like the HT-A9. `reply` returns a body, 'hang' or 'drop'.
async function fakeSony(){
  const calls=[],sockets=new Set();let reply=()=>playingInfo([airplay()]),active=0,peak=0;
  const server=createServer(async(req,res)=>{
    let text='';for await(const chunk of req)text+=chunk;
    const request=JSON.parse(text);calls.push({path:req.url,...request});active++;peak=Math.max(peak,active);
    try{
      const value=await reply(request);
      if(value==='hang')return;
      if(value==='drop'){req.socket.destroy();return;}
      if(typeof value==='string'){res.writeHead(200,{'content-type':'application/json'});res.end(value);return;}
      const {status=200,...body}=value;res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify({id:request.id,...body}));
    }finally{active--;}
  });
  server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {endpoint:`http://127.0.0.1:${server.address().port}/sony`,calls,peak:()=>peak,set(next){reply=next;},
    close:()=>new Promise(resolve=>{for(const socket of sockets)socket.destroy();server.close(resolve);})};
}
async function sonyFixture(options={}){
  const sony=await fakeSony();let clock=1000;
  const source=createSonySource({id:'living-room',kind:'sony',endpoint:sony.endpoint},{pollMs:60000,timeoutMs:200,...options});
  const playback=createPlayback(source,()=>clock);await source.refresh();
  return {sony,source,playback,advance:ms=>{clock+=ms;},view:()=>playback.snapshot().playback,
    close:async()=>{await playback.close();await sony.close();}};
}

test('Sony AirPlay observations normalize metadata, status and controls',async()=>{
  const {sony,source,view,close}=await sonyFixture();
  try{
    assert.deepEqual(view(),{status:'playing',title:'Song',artist:'Artist',album:'Album',controls:['pause','next','previous']});
    assert.deepEqual(sony.calls[0],{path:'/sony/avContent',method:'getPlayingContentInfo',id:sony.calls[0].id,params:[{output:''}],version:'1.2'});
    sony.set(()=>playingInfo([airplay({stateInfo:{state:'PAUSED'},albumName:'',title:'  Padded  '})]));await source.refresh();
    assert.deepEqual(view(),{status:'paused',title:'Padded',artist:'Artist',controls:['next','previous']},'the owner live check of 2026-09-25 qualified next and previous while paused');
    sony.set(()=>playingInfo([airplay({stateInfo:{state:'STOPPED'},title:undefined,artist:undefined,albumName:undefined,content:undefined})]));await source.refresh();
    assert.deepEqual(view(),{status:'stopped',controls:[]});
    sony.set(()=>({result:[airplay({stateInfo:{state:'BUFFERING'},title:'x'.repeat(300)})]}));await source.refresh();
    assert.deepEqual(view(),{status:'unknown',title:'x'.repeat(256),artist:'Artist',album:'Album',controls:[]});
    sony.set(()=>playingInfo([{source:'extInput:tv',uri:'extInput:tv',stateInfo:{state:'PLAYING'},title:'TV'}]));await source.refresh();
    assert.deepEqual(view(),{status:'inactive',controls:[]});
  }finally{await close();}
});

test('only successful Sony reads refresh freshness, which ages through stale to unavailable',async()=>{
  const sony=await fakeSony();let clock=1000;
  sony.set(()=>({error:[7,'Illegal State']}));
  const source=createSonySource({id:'living-room',kind:'sony',endpoint:sony.endpoint},{pollMs:60000,timeoutMs:200});
  const playback=createPlayback(source,()=>clock);
  try{
    await source.refresh();
    assert.deepEqual(playback.snapshot(),{apiVersion:'1.0',sourceId:'living-room',availability:'unavailable',observedAtMs:null,ageMs:null,playback:null});
    sony.set(()=>playingInfo([airplay()]));await source.refresh();
    const first=playback.snapshot();assert.equal(first.availability,'available');assert.equal(first.observedAtMs,1000);
    clock+=4000;await source.refresh();
    assert.deepEqual([playback.snapshot().observedAtMs,playback.snapshot().ageMs],[5000,0],'an unchanged read refreshes the observation time');
    const failures=[()=>({error:[7,'Illegal State']}),()=>({status:500,result:[[airplay()]]}),()=>'not json',()=>({result:'wrong'}),()=>'drop',()=>'hang',()=>({id:'other',result:[[airplay()]]})];
    for(const failure of failures){sony.set(failure);clock+=100;await source.refresh();}
    const failed=playback.snapshot();
    assert.equal(failed.observedAtMs,5000,'failed reads do not refresh the observation time');
    clock=5000+4999;assert.equal(playback.snapshot().availability,'available');
    clock=5000+5000;assert.deepEqual([playback.snapshot().availability,playback.snapshot().playback],['stale',first.playback],'a stale snapshot keeps the last playback');
    clock=5000+29999;assert.equal(playback.snapshot().availability,'stale');
    clock=5000+30000;assert.deepEqual(playback.snapshot(),{apiVersion:'1.0',sourceId:'living-room',availability:'unavailable',observedAtMs:5000,ageMs:30000,playback:null});
    sony.set(()=>playingInfo([airplay({title:'Next song'})]));await source.refresh();
    assert.deepEqual([playback.snapshot().availability,playback.snapshot().playback.title],['available','Next song'],'the next successful read recovers');
  }finally{await playback.close();await sony.close();}
});

test('Sony reads poll on a timer without overlapping',async()=>{
  const sony=await fakeSony();
  sony.set(async()=>{await delay(60);return playingInfo([airplay()]);});
  const source=createSonySource({id:'living-room',kind:'sony',endpoint:sony.endpoint},{pollMs:20,timeoutMs:200});
  const playback=createPlayback(source,Date.now);
  try{
    await Promise.all([source.refresh(),source.refresh()]);
    await delay(250);
    assert.ok(sony.calls.length>=3,'the timer keeps polling');
    assert.equal(sony.peak(),1,'reads never overlap');
    assert.equal(playback.snapshot().availability,'available');
  }finally{await playback.close();await sony.close();}
  const calls=sony.calls.length;await delay(80);assert.equal(sony.calls.length,calls,'closing stops polling');
});

const hash=value=>createHash('sha256').update(value).digest('hex');
const tokens={controller:'a'.repeat(43),reader:'b'.repeat(43),other:'c'.repeat(43)};
const credentials=[{id:'controller',digest:hash(tokens.controller),scopes:['read','control'],devices:['living-room','kitchen']},
  {id:'reader',digest:hash(tokens.reader),scopes:['read'],devices:['living-room']},
  {id:'other',digest:hash(tokens.other),scopes:['read','control'],devices:[]}];
const commandCalls=sony=>sony.calls.filter(call=>call.method!=='getPlayingContentInfo');

async function hubFixture(migration){
  const sony=await fakeSony(),directory=await mkdtemp(join(tmpdir(),'hub-playback-'));let clock=Date.now();
  const hub=await startHub({directory,ownerId:'owner',consumers:[],credentials,controllers:[],clock:()=>clock,
    playback:{selected:'living-room',sources:[{id:'living-room',kind:'sony',endpoint:sony.endpoint}]}},migration);
  const call=(path,body,{token=tokens.controller,headers={}}={})=>fetch(hub.url+path,{method:body===undefined?'GET':'POST',
    headers:{authorization:`Bearer ${token}`,'content-type':'application/json','x-pixoo-request':'1',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const snapshot=async()=>(await call('/api/playback/v1/snapshot')).json();
  const until=async predicate=>{for(let i=0;i<120;i++){if(predicate(await snapshot()))return;await delay(50);}throw new Error('timed out');};
  const command=(requestId,action,options)=>call('/api/playback/v1/commands',{requestId,sourceId:'living-room',action},options);
  return {sony,hub,directory,call,snapshot,until,command,advance:ms=>{clock+=ms;},
    close:async()=>{await hub.close();await sony.close();await rm(directory,{recursive:true,force:true});}};
}

test('playback routes require authentication, scope and the source grant',async()=>{
  const {sony,call,until,command,close}=await hubFixture();
  try{
    await until(value=>value.availability==='available');
    assert.equal((await call('/api/playback/v1/snapshot',undefined,{token:'d'.repeat(43)})).status,401);
    assert.equal((await call('/api/playback/v1/snapshot',undefined,{token:tokens.other})).status,403);
    const read=await call('/api/playback/v1/snapshot',undefined,{token:tokens.reader});
    const body=await read.json();
    assert.equal(read.status,200);
    assert.deepEqual([body.sourceId,body.availability,body.playback.title],['living-room','available','Song']);
    assert.ok(!JSON.stringify(body).includes('127.0.0.1')&&!JSON.stringify(body).includes('thumbnail'),'no receiver address or artwork URL');
    assert.equal((await command('r1','pause',{token:tokens.reader})).status,403);
    assert.equal((await command('r1','pause',{token:tokens.other})).status,403);
    assert.equal((await command('r1','pause',{headers:{'x-pixoo-request':'0'}})).status,403);
    assert.equal((await command('r1','pause',{token:'d'.repeat(43)})).status,401);
    assert.deepEqual(commandCalls(sony),[]);
  }finally{await close();}
});

test('playback commands go only to the configured source and only for declared controls',async()=>{
  const {sony,call,until,command,advance,close}=await hubFixture();
  try{
    await until(value=>value.availability==='available');
    const redirect=await call('/api/playback/v1/commands',{requestId:'r1',sourceId:'living-room',action:'pause',endpoint:'http://127.0.0.1:1/sony'});
    assert.equal(redirect.status,400);
    const other=await call('/api/playback/v1/commands',{requestId:'r1',sourceId:'kitchen',action:'pause'});
    assert.deepEqual([other.status,(await other.json()).error.code],[404,'unknown-source']);
    assert.equal((await command('r1','resume')).status,400);
    const oversized=await call('/api/playback/v1/commands',{requestId:'r1',sourceId:'living-room',action:'pause',padding:'x'.repeat(1100)});
    assert.deepEqual([oversized.status,(await oversized.json()).error.code],[413,'capacity']);
    const play=await command('r1','play');
    assert.deepEqual([play.status,(await play.json()).error.code],[422,'unsupported-control']);
    sony.set(()=>playingInfo([airplay({stateInfo:{state:'PAUSED'}})]));
    await until(value=>value.playback?.status==='paused');
    const paused=await command('r1','pause');
    assert.deepEqual([paused.status,(await paused.json()).error.code],[422,'unsupported-control']);
    const pausedNext=await command('r-paused-next','next');
    assert.deepEqual([pausedNext.status,(await pausedNext.json()).outcome],[200,'sent'],'next stays available while paused');
    sony.set(()=>playingInfo([airplay()]));await until(value=>value.playback?.status==='playing');
    advance(5000);
    const stale=await command('r1','pause');
    assert.deepEqual([stale.status,(await stale.json()).error.code],[503,'source-unavailable']);
    assert.deepEqual(commandCalls(sony).map(item=>item.method),['setPlayNextContent']);
    assert.ok(sony.calls.every(item=>item.path==='/sony/avContent'));
  }finally{await close();}
});

test('a launcher browser session reads and commands the configured playback source',async()=>{
  const {sony,hub,directory,call,until,close}=await hubFixture();
  try{
    await until(value=>value.availability==='available');
    const launch=await requestBrowserLaunch(directory);
    const issued=await fetch(hub.url+'/api/dashboard/v1/launch',{method:'POST',headers:{'content-type':'application/json','x-pixoo-request':'1',origin:hub.url},body:JSON.stringify({code:launch.code})});
    const {token}=await issued.json();
    const context=await call('/api/dashboard/v1/context',undefined,{token});
    assert.deepEqual((await context.json()).playback,{sourceId:'living-room'});
    const read=await call('/api/playback/v1/snapshot',undefined,{token});
    assert.deepEqual([read.status,(await read.json()).sourceId],[200,'living-room']);
    const sent=await call('/api/playback/v1/commands',{requestId:'browser-1',sourceId:'living-room',action:'next'},{token});
    assert.deepEqual([sent.status,(await sent.json()).outcome],[200,'sent']);
    assert.deepEqual(commandCalls(sony).map(item=>item.method),['setPlayNextContent']);
    assert.equal((await call('/api/monitor/v1/events',{},{token})).status,403,'the playback grant adds no ingest scope');
  }finally{await close();}
});

test('the dashboard context names the playback source only for credentials that grant it',async()=>{
  const {until,call,close}=await hubFixture();
  try{
    await until(value=>value.availability==='available');
    const view=async token=>(await call('/api/dashboard/v1/context',undefined,{token})).json();
    assert.deepEqual((await view(tokens.reader)).playback,{sourceId:'living-room'});
    assert.equal('playback' in await view(tokens.other),false);
  }finally{await close();}
});

test('duplicate and concurrent playback commands reach the receiver once',async()=>{
  const {sony,until,command,close}=await hubFixture();
  try{
    await until(value=>value.availability==='available');
    const sent={requestId:'r1',sourceId:'living-room',action:'next',outcome:'sent'};
    const first=await command('r1','next'),second=await command('r1','next');
    assert.deepEqual([first.status,await first.json(),second.status,await second.json()],[200,sent,200,sent]);
    const conflict=await command('r1','previous');
    assert.deepEqual([conflict.status,(await conflict.json()).error.code],[409,'request-conflict']);
    assert.deepEqual(commandCalls(sony).map(item=>[item.method,item.version,item.params]),[['setPlayNextContent','1.0',[{output:''}]]]);
    sony.set(async request=>{if(request.method!=='getPlayingContentInfo')await delay(300);return request.method==='getPlayingContentInfo'?playingInfo([airplay()]):{result:[]};});
    const results=await Promise.all([command('r2','next'),command('r3','previous')]);
    assert.deepEqual(results.map(item=>item.status).sort(),[200,429]);
    assert.equal((await results.find(item=>item.status===429).json()).error.code,'capacity');
    assert.equal(commandCalls(sony).length,2);
  }finally{await close();}
});

test('failed and uncertain playback results are reported and never resent',async()=>{
  const {sony,until,command,close}=await hubFixture();
  try{
    await until(value=>value.availability==='available');
    sony.set(request=>request.method==='getPlayingContentInfo'?playingInfo([airplay()]):{error:[40000,'refused']});
    const failed=await command('r1','previous');
    assert.deepEqual([failed.status,await failed.json()],[502,{requestId:'r1',sourceId:'living-room',action:'previous',outcome:'failed'}]);
    sony.set(request=>request.method==='getPlayingContentInfo'?playingInfo([airplay()]):'hang');
    const uncertain={requestId:'r2',sourceId:'living-room',action:'pause',outcome:'uncertain'};
    const first=await command('r2','pause');
    assert.deepEqual([first.status,await first.json()],[503,uncertain]);
    const again=await command('r2','pause');
    assert.deepEqual([again.status,await again.json()],[503,uncertain]);
    assert.deepEqual(commandCalls(sony).map(item=>item.method),['setPlayPreviousContent','pausePlayingContent']);
  }finally{await close();}
});

test('a staged hub serves playback snapshots but rejects commands',async()=>{
  const {sony,until,command,close}=await hubFixture({staged:true});
  try{
    await until(value=>value.availability==='available');
    const rejected=await command('r1','pause');
    assert.deepEqual([rejected.status,(await rejected.json()).error.code],[503,'owner-quiesced']);
    assert.deepEqual(commandCalls(sony),[]);
  }finally{await close();}
});

test('playback configuration needs one selected Sony source at a private address',async()=>{
  const base={id:'living-room',kind:'sony',endpoint:'http://192.168.1.20:10000/sony'};
  const options=(playback,controllers=[])=>({directory:'/nonexistent/hub-playback',ownerId:'owner',consumers:[],credentials,controllers,playback});
  const controller={id:'living-room',kind:'pixoo',controllerId:'pixoo',deviceId:'pixoo',token:'e'.repeat(43),endpoint:'http://127.0.0.1:9/controller/v1'};
  for(const endpoint of ['http://10.0.0.5:10000/sony','http://172.31.2.3:10000/sony','http://127.0.0.1:10000/sony'])
    assert.deepEqual(sonyConfiguration({...base,endpoint}),{...base,endpoint});
  const invalid=[null,{selected:'living-room',sources:[]},{selected:'kitchen',sources:[base]},{selected:'living-room',sources:[base,{...base,id:'kitchen'}]},
    {selected:'living-room',sources:[base],extra:true},{selected:'living-room',sources:[{...base,kind:'sonos'}]},{selected:'living-room',sources:[{...base,extra:true}]},
    {selected:'hub-service',sources:[{...base,id:'hub-service'}]},{selected:'bad id',sources:[{...base,id:'bad id'}]},
    {selected:'192.168.1.20',sources:[{...base,id:'192.168.1.20'}]},{selected:'10.0.0.9',sources:[{...base,id:'10.0.0.9'}]},{selected:'sony-192.168.1.20',sources:[{...base,id:'sony-192.168.1.20'}]}];
  for(const endpoint of ['https://192.168.1.20:10000/sony','http://8.8.8.8:10000/sony','http://172.32.0.1:10000/sony','http://soundbar.local:10000/sony',
    'http://192.168.1.20/sony','http://192.168.1.20:10000/sony/','http://192.168.1.20:10000/other','http://user:pw@192.168.1.20:10000/sony',
    'http://192.168.1.20:10000/sony?x=1','http://192.168.1.20:10000/sony#x','http://[::1]:10000/sony','not a url'])
    invalid.push({selected:'living-room',sources:[{...base,endpoint}]});
  for(const playback of invalid)await assert.rejects(startHub(options(playback)),/invalid-playback/,JSON.stringify(playback));
  await assert.rejects(startHub(options({selected:'living-room',sources:[base]},[controller])),/invalid-playback/);
});

test('freshness follows the monotonic clock and receipts stay bounded',async()=>{
  const source=fakeSource();let wall=100000,elapsed=0;
  const playback=createPlayback(source,()=>wall,()=>elapsed);
  const unavailable=playback.command({requestId:'early',sourceId:'kitchen',action:'next'},principal);
  await assert.rejects(unavailable,{code:'source-unavailable',status:503});
  source.report(playing);
  wall-=60000;elapsed+=5000;
  assert.deepEqual([playback.snapshot().availability,playback.snapshot().observedAtMs,playback.snapshot().ageMs],['stale',100000,5000],'a wall-clock step back does not keep a source available');
  wall+=60000+30000;
  assert.deepEqual([playback.snapshot().availability,playback.snapshot().ageMs],['unavailable',30000],'a suspend that pauses the monotonic clock does not keep a source available');
  wall=100000;
  elapsed=0;source.report(playing);
  for(let index=0;index<65;index++)await playback.command({requestId:'r'+index,sourceId:'kitchen',action:'next'},principal);
  await playback.command({requestId:'r1',sourceId:'kitchen',action:'next'},principal);
  assert.equal(source.sent.length,65,'a retained receipt is replayed');
  await playback.command({requestId:'r0',sourceId:'kitchen',action:'next'},principal);
  assert.equal(source.sent.length,66,'the oldest of 65 receipts was evicted');
  await playback.close();
});
