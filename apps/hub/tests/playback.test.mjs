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
import {createSonosSource,sonosConfiguration} from '../dist/sonos.js';
import {startHub} from '../dist/server.js';
import {requestBrowserLaunch} from '../dist/browser-launch.js';

const principal={id:'phone',devices:['kitchen','music']};
const playing={status:'playing',title:'Song',artist:'Artist',controls:['pause','next']};

// A source written without any Sony code, to show the shared module needs only the interface. It has no ID: the playback ID belongs to the shared module.
function fakeSource(){
  const sent=[];let report;
  return {sent,report:value=>report(value),start(callback){report=callback;},async command(action){sent.push(action);return 'sent';},closed:false,async close(){this.closed=true;}};
}

test('a non-Sony source uses the shared playback interface unchanged',async()=>{
  const source=fakeSource();let clock=1000;
  const playback=createPlayback('kitchen',[source],()=>clock);
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
  const source=createSonySource({kind:'sony',endpoint:sony.endpoint},{pollMs:60000,timeoutMs:200,...options});
  const playback=createPlayback('living-room',[source],()=>clock);await source.refresh();
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
  const source=createSonySource({kind:'sony',endpoint:sony.endpoint},{pollMs:60000,timeoutMs:200});
  const playback=createPlayback('living-room',[source],()=>clock);
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
  const source=createSonySource({kind:'sony',endpoint:sony.endpoint},{pollMs:20,timeoutMs:200});
  const playback=createPlayback('living-room',[source],Date.now);
  try{
    await Promise.all([source.refresh(),source.refresh()]);
    await delay(250);
    assert.ok(sony.calls.length>=3,'the timer keeps polling');
    assert.equal(sony.peak(),1,'reads never overlap');
    assert.equal(playback.snapshot().availability,'available');
  }finally{await playback.close();await sony.close();}
  const calls=sony.calls.length;await delay(80);assert.equal(sony.calls.length,calls,'closing stops polling');
});


const DIDL=({title='Move Song',artist='Move Artist',album='Move Album'}={})=>`<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"><item id="-1" parentID="-1" restricted="true"><res protocolInfo="x-sonos-vli:*:*:*">x-sonos-vli:RINCON_000E58FFFFFF01400:2,airplay:1</res><r:streamContent></r:streamContent><upnp:albumArtURI>http://127.0.0.1:1400/getaa?s=1&amp;u=x</upnp:albumArtURI>${title===null?'':`<dc:title>${title}</dc:title>`}<upnp:class>object.item.audioItem.musicTrack</upnp:class>${artist===null?'':`<dc:creator>${artist}</dc:creator>`}${album===null?'':`<upnp:album>${album}</upnp:album>`}</item></DIDL-Lite>`;
const escapeXml=value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const envelope=inner=>`<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>${inner}</s:Body></s:Envelope>`;
const soapFault=code=>envelope(`<s:Fault><faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring><detail><UPnPError xmlns="urn:schemas-upnp-org:control-1-0"><errorCode>${code}</errorCode></UPnPError></detail></s:Fault>`);

// Answers UPnP AVTransport SOAP like the Sonos Move. `state` drives the default replies; `set` overrides them with a body, {status, body}, 'hang' or 'drop'.
async function fakeSonos(){
  const calls=[],sockets=new Set();let reply,active=0,peak=0;
  const state={transport:'PLAYING',uri:'x-sonos-vli:RINCON_000E58FFFFFF01400:2,airplay:1',metadata:DIDL(),actions:'Set, Stop, Pause, Play, Next, Previous',duration:'0:03:41',rel:'0:01:03'};
  const responses={
    GetTransportInfo:()=>`<u:GetTransportInfoResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><CurrentTransportState>${state.transport}</CurrentTransportState><CurrentTransportStatus>OK</CurrentTransportStatus><CurrentSpeed>1</CurrentSpeed></u:GetTransportInfoResponse>`,
    GetPositionInfo:()=>`<u:GetPositionInfoResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><Track>1</Track><TrackDuration>${state.duration}</TrackDuration><TrackMetaData>${escapeXml(state.metadata)}</TrackMetaData><TrackURI>${escapeXml(state.uri)}</TrackURI><RelTime>${state.rel}</RelTime><AbsTime>NOT_IMPLEMENTED</AbsTime><RelCount>2147483647</RelCount><AbsCount>2147483647</AbsCount></u:GetPositionInfoResponse>`,
    GetCurrentTransportActions:()=>`<u:GetCurrentTransportActionsResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><Actions>${state.actions}</Actions></u:GetCurrentTransportActionsResponse>`};
  const server=createServer(async(req,res)=>{
    let text='';for await(const chunk of req)text+=chunk;
    const action=/^"urn:schemas-upnp-org:service:AVTransport:1#(\w+)"$/.exec(req.headers.soapaction??'')?.[1];
    const call={path:req.url,action,soapaction:req.headers.soapaction,contentType:req.headers['content-type'],body:text};calls.push(call);active++;peak=Math.max(peak,active);
    try{
      const value=reply?await reply(call):undefined;
      if(value==='hang')return;
      if(value==='drop'){req.socket.destroy();return;}
      if(value!==undefined){const {status=200,body}=typeof value==='string'?{body:value}:value;res.writeHead(status,{'content-type':'text/xml; charset="utf-8"'});res.end(body);return;}
      if(!action||req.url!=='/MediaRenderer/AVTransport/Control'){res.writeHead(500,{'content-type':'text/xml; charset="utf-8"'});res.end(soapFault(401));return;}
      const inner=responses[action]?.()??`<u:${action}Response xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"></u:${action}Response>`;
      res.writeHead(200,{'content-type':'text/xml; charset="utf-8"'});res.end(envelope(inner));
    }finally{active--;}
  });
  server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {endpoint:`http://127.0.0.1:${server.address().port}/MediaRenderer/AVTransport/Control`,calls,state,peak:()=>peak,set(next){reply=next;},
    close:()=>new Promise(resolve=>{for(const socket of sockets)socket.destroy();server.close(resolve);})};
}
async function sonosFixture(options={}){
  const sonos=await fakeSonos();let clock=1000;
  const source=createSonosSource({kind:'sonos',endpoint:sonos.endpoint},{pollMs:60000,timeoutMs:200,...options});
  const playback=createPlayback('music',[source],()=>clock);await source.refresh();
  return {sonos,source,playback,advance:ms=>{clock+=ms;},view:()=>playback.snapshot().playback,
    close:async()=>{await playback.close();await sonos.close();}};
}
const sonosCommands=sonos=>sonos.calls.filter(call=>!call.action?.startsWith('Get'));

test('Sonos AirPlay observations normalize metadata, status, session and controls',async()=>{
  const {sonos,source,view,close}=await sonosFixture();
  try{
    assert.deepEqual(view(),{status:'playing',title:'Move Song',artist:'Move Artist',album:'Move Album',controls:['pause','next','previous']});
    assert.deepEqual(sonos.calls.map(call=>call.action),['GetTransportInfo','GetPositionInfo','GetCurrentTransportActions'],'one read is three sequential calls');
    for(const call of sonos.calls){
      assert.equal(call.path,'/MediaRenderer/AVTransport/Control');
      assert.equal(call.soapaction,`"urn:schemas-upnp-org:service:AVTransport:1#${call.action}"`);
      assert.match(call.contentType,/^text\/xml; charset="utf-8"$/);
      assert.ok(call.body.includes(`<u:${call.action} xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID></u:${call.action}>`),call.body);
    }
    sonos.state.transport='PAUSED_PLAYBACK';sonos.state.metadata=DIDL({title:'  Song &amp; Co  ',album:null});await source.refresh();
    assert.deepEqual(view(),{status:'paused',title:'Song & Co',artist:'Move Artist',controls:['play','next','previous']},'entities are decoded once per layer and a missing album stays absent');
    sonos.state.actions='Set, Stop, Pause, Next, Previous';await source.refresh();
    assert.deepEqual(view().controls,['next','previous'],'a control is declared only while the Move advertises its action');
    sonos.state.actions='Set, Stop, Pause, Play';await source.refresh();
    assert.deepEqual(view().controls,['play']);
    sonos.state.transport='PLAYING';await source.refresh();
    assert.deepEqual(view().controls,['pause'],'next and previous follow the advertised actions while playing too');
    sonos.state.actions='Set, Stop, Pause, Play, Next, Previous';
    sonos.state.transport='STOPPED';await source.refresh();
    assert.deepEqual(view(),{status:'stopped',title:'Song & Co',artist:'Move Artist',controls:[]});
    sonos.state.transport='TRANSITIONING';await source.refresh();
    assert.deepEqual(view().status,'unknown');assert.deepEqual(view().controls,[]);
    sonos.state.transport='PLAYING';sonos.state.metadata=DIDL({title:'x'.repeat(300),artist:'',album:'Album'});await source.refresh();
    assert.deepEqual(view(),{status:'playing',title:'x'.repeat(256),album:'Album',controls:['pause','next','previous']},'text is limited to 256 characters and empty text is absent');
    sonos.state.metadata='NOT_IMPLEMENTED';await source.refresh();
    assert.deepEqual(view(),{status:'playing',controls:['pause','next','previous']});
    sonos.state.metadata=DIDL();sonos.state.uri='x-rincon-queue:RINCON_000E58FFFFFF01400#0';await source.refresh();
    assert.deepEqual(view(),{status:'inactive',controls:[]},'a track that is not the AirPlay session is another input');
    sonos.state.uri='';await source.refresh();
    assert.deepEqual(view(),{status:'inactive',controls:[]});
    assert.ok(!JSON.stringify(view()).includes('getaa')&&!JSON.stringify(view()).includes('0:03'),'no artwork URL, position or duration');
  }finally{await close();}
});

test('only complete Sonos reads refresh freshness',async()=>{
  const sonos=await fakeSonos();let clock=1000;
  sonos.set(()=>({status:500,body:soapFault(701)}));
  const source=createSonosSource({kind:'sonos',endpoint:sonos.endpoint},{pollMs:60000,timeoutMs:200});
  const playback=createPlayback('music',[source],()=>clock);
  try{
    await source.refresh();
    assert.deepEqual(playback.snapshot(),{apiVersion:'1.0',sourceId:'music',availability:'unavailable',observedAtMs:null,ageMs:null,playback:null});
    sonos.set(undefined);await source.refresh();
    assert.deepEqual([playback.snapshot().availability,playback.snapshot().observedAtMs],['available',1000]);
    const failures=[()=>({status:500,body:soapFault(701)}),()=>({status:404,body:'missing'}),()=>'not xml at all',()=>envelope('<u:GetTransportInfoResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"></u:GetTransportInfoResponse>'),
      call=>call.action==='GetCurrentTransportActions'?'hang':undefined,call=>call.action==='GetPositionInfo'?'drop':undefined,()=>({status:200,body:'<'.repeat(70000)})];
    for(const failure of failures){sonos.set(failure);clock+=100;await source.refresh();}
    assert.equal(playback.snapshot().observedAtMs,1000,'a read with any failed call reports nothing');
    sonos.set(undefined);await source.refresh();
    assert.equal(playback.snapshot().observedAtMs,1700,'the next complete read recovers');
  }finally{await playback.close();await sonos.close();}
});

test('Sonos reads poll on a timer without overlapping',async()=>{
  const sonos=await fakeSonos();
  sonos.set(async()=>{await delay(20);return undefined;});
  const source=createSonosSource({kind:'sonos',endpoint:sonos.endpoint},{pollMs:20,timeoutMs:200});
  const playback=createPlayback('music',[source],Date.now);
  try{
    await Promise.all([source.refresh(),source.refresh()]);
    await delay(300);
    assert.ok(sonos.calls.length>=6,'the timer keeps polling');
    assert.equal(sonos.peak(),1,'calls never overlap');
    assert.equal(playback.snapshot().availability,'available');
  }finally{await playback.close();await sonos.close();}
  const calls=sonos.calls.length;await delay(80);assert.equal(sonos.calls.length,calls,'closing stops polling');
});

test('Sonos commands post one SOAP action and report sent, failed or uncertain',async()=>{
  const {sonos,source,playback,close}=await sonosFixture();
  const music={id:'phone',devices:['music']};
  try{
    sonos.state.transport='PAUSED_PLAYBACK';await source.refresh();
    const play=await playback.command({requestId:'r1',sourceId:'music',action:'play'},music);
    assert.deepEqual(play,{status:200,body:{requestId:'r1',sourceId:'music',action:'play',outcome:'sent'}});
    assert.equal(sonosCommands(sonos).length,1);
    assert.ok(sonosCommands(sonos)[0].body.includes('<u:Play xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID><Speed>1</Speed></u:Play>'),'Play carries speed 1');
    sonos.set(call=>call.action==='Next'?{status:500,body:soapFault(701)}:undefined);
    const failed=await playback.command({requestId:'r2',sourceId:'music',action:'next'},music);
    assert.deepEqual([failed.status,failed.body.outcome],[502,'failed']);
    sonos.set(call=>call.action==='Previous'?'hang':undefined);
    const uncertain=await playback.command({requestId:'r3',sourceId:'music',action:'previous'},music);
    assert.deepEqual([uncertain.status,uncertain.body.outcome],[503,'uncertain']);
    sonos.set(call=>call.action==='Previous'?{status:500,body:'<broken'}:undefined);
    const malformed=await playback.command({requestId:'r4',sourceId:'music',action:'previous'},music);
    assert.deepEqual([malformed.status,malformed.body.outcome],[503,'uncertain'],'a 500 without a SOAP fault is uncertain');
    sonos.set(undefined);sonos.state.transport='PLAYING';await source.refresh();
    const pause=await playback.command({requestId:'r5',sourceId:'music',action:'pause'},music);
    assert.equal(pause.body.outcome,'sent');
    assert.deepEqual(sonosCommands(sonos).map(call=>call.action),['Play','Next','Previous','Previous','Pause']);
    assert.ok(sonosCommands(sonos).every(call=>!call.body.includes('<Speed>')||call.action==='Play'));
  }finally{await close();}
});

test('the presented source follows session, freshness and configured order under one playback ID',async()=>{
  const move=fakeSource(),sony=fakeSource();let clock=1000;
  const playback=createPlayback('music',[move,sony],()=>clock);
  const view=()=>playback.snapshot(),send=(requestId,action)=>playback.command({requestId,sourceId:'music',action},principal);
  const inactive={status:'inactive',controls:[]},stopped={status:'stopped',controls:[]};
  const sonyPlaying={status:'playing',title:'Sony song',controls:['pause','next','previous']};
  const movePlaying={status:'playing',title:'Move song',controls:['pause','next','previous']},movePaused={...movePlaying,status:'paused',controls:['play','next','previous']};
  assert.deepEqual(view(),{apiVersion:'1.0',sourceId:'music',availability:'unavailable',observedAtMs:null,ageMs:null,playback:null});
  sony.report(sonyPlaying);
  assert.deepEqual([view().availability,view().playback.title],['available','Sony song'],'an unobserved first source does not hide the second');
  move.report(inactive);
  assert.equal(view().playback.title,'Sony song','Sony alone: the Move answers inactive');
  await send('r1','next');
  assert.deepEqual([move.sent,sony.sent],[[],['next']]);
  move.report(movePlaying);
  assert.equal(view().playback.title,'Move song','grouped: both play and the Move is configured first');
  await send('r2','pause');
  assert.deepEqual([move.sent,sony.sent],[['pause'],['next']]);
  sony.report(inactive);move.report(movePaused);
  assert.deepEqual(view().playback.controls,['play','next','previous']);
  await send('r3','play');
  assert.deepEqual([move.sent,sony.sent],[['pause','play'],['next']],'play goes to the Move only');
  move.report(movePlaying);clock+=5000;sony.report(inactive);
  assert.deepEqual([view().availability,view().playback.title,view().observedAtMs,view().ageMs],['stale','Move song',1000,5000],'a Move that stops answering stays presented as stale');
  await assert.rejects(send('r4','pause'),{code:'source-unavailable',status:503});
  clock+=24999;sony.report(inactive);
  assert.equal(view().availability,'stale');
  clock+=1;sony.report(inactive);
  assert.deepEqual([view().availability,view().playback,view().observedAtMs],['available',inactive,31000],'after 30 seconds the Sony is presented');
  move.report(stopped);sony.report(sonyPlaying);
  assert.equal(view().playback.title,'Sony song','a stopped Move does not outrank a playing Sony');
  move.report({status:'unknown',controls:[]});
  assert.equal(view().playback.title,'Sony song','an unrecognized state is not a session');
  move.report(inactive);sony.report(stopped);
  assert.equal(view().playback.status,'inactive','nothing playing: ties go to configured order');
  clock+=6000;sony.report(stopped);
  assert.deepEqual([view().availability,view().playback.status],['available','stopped'],'nothing playing: the fresher source is presented');
  move.report(movePaused);sony.report(sonyPlaying);
  assert.deepEqual(view().playback.controls,['play','next','previous']);
  move.report(inactive);
  await assert.rejects(send('r5','play'),{code:'unsupported-control',status:422});
  assert.deepEqual([move.sent,sony.sent],[['pause','play'],['next']],'a command checked after the presented source changed is not redirected');
  await assert.rejects(playback.command({requestId:'r6',sourceId:'kitchen',action:'next'},principal),{code:'unknown-source',status:404});
  await assert.rejects(playback.command({requestId:'r7',sourceId:'sony',action:'next'},{id:'phone',devices:['sony','music']}),{code:'unknown-source',status:404});
  assert.deepEqual([move.sent,sony.sent],[['pause','play'],['next']]);
  await playback.close();assert.deepEqual([move.closed,sony.closed],[true,true]);
});

test('closing playback closes every source and reports the first failure afterwards',async()=>{
  const good=fakeSource(),bad={...fakeSource(),async close(){throw new Error('close-failed');}};
  const playback=createPlayback('music',[bad,good],()=>1000);
  await assert.rejects(playback.close(),/close-failed/);
  assert.equal(good.closed,true);
});

const hash=value=>createHash('sha256').update(value).digest('hex');
const tokens={controller:'a'.repeat(43),reader:'b'.repeat(43),other:'c'.repeat(43)};
const credentials=[{id:'controller',digest:hash(tokens.controller),scopes:['read','control'],devices:['living-room','kitchen']},
  {id:'reader',digest:hash(tokens.reader),scopes:['read'],devices:['living-room']},
  {id:'other',digest:hash(tokens.other),scopes:['read','control'],devices:[]}];
const commandCalls=sony=>sony.calls.filter(call=>call.method!=='getPlayingContentInfo');

async function hubFixture(migration,{withSonos=false}={}){
  const sony=await fakeSony(),sonos=withSonos?await fakeSonos():undefined,directory=await mkdtemp(join(tmpdir(),'hub-playback-'));let clock=Date.now();
  if(sonos)sonos.state.uri='x-rincon-queue:RINCON_000E58FFFFFF01400#0';
  const hub=await startHub({directory,ownerId:'owner',consumers:[],credentials,controllers:[],clock:()=>clock,
    playback:{id:'living-room',sources:[...(sonos?[{kind:'sonos',endpoint:sonos.endpoint}]:[]),{kind:'sony',endpoint:sony.endpoint}]}},migration);
  const call=(path,body,{token=tokens.controller,headers={}}={})=>fetch(hub.url+path,{method:body===undefined?'GET':'POST',
    headers:{authorization:`Bearer ${token}`,'content-type':'application/json','x-pixoo-request':'1',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const snapshot=async()=>(await call('/api/playback/v1/snapshot')).json();
  const until=async predicate=>{for(let i=0;i<120;i++){if(predicate(await snapshot()))return;await delay(50);}throw new Error('timed out');};
  const command=(requestId,action,options)=>call('/api/playback/v1/commands',{requestId,sourceId:'living-room',action},options);
  return {sony,sonos,hub,directory,call,snapshot,until,command,advance:ms=>{clock+=ms;},
    close:async()=>{await hub.close();await sony.close();await sonos?.close();await rm(directory,{recursive:true,force:true});}};
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


test('a hub with both sources serves and commands the presented one under the configured ID',async()=>{
  const {sony,sonos,call,snapshot,until,command,close}=await hubFixture(undefined,{withSonos:true});
  try{
    await until(value=>value.availability==='available'&&value.playback?.title==='Song');
    assert.deepEqual((await snapshot()).playback.controls,['pause','next','previous'],'the Sony is presented while the Move reports another input');
    sonos.state.uri='x-sonos-vli:RINCON_000E58FFFFFF01400:2,airplay:1';sonos.state.transport='PAUSED_PLAYBACK';
    await until(value=>value.playback?.title==='Move Song');
    const view=await snapshot();
    assert.deepEqual([view.sourceId,view.playback.status,view.playback.controls],['living-room','paused',['play','next','previous']]);
    assert.ok(!JSON.stringify(view).includes('127.0.0.1')&&!JSON.stringify(view).includes('sonos'),'no address and no source name');
    const play=await command('r1','play');
    assert.deepEqual([play.status,await play.json()],[200,{requestId:'r1',sourceId:'living-room',action:'play',outcome:'sent'}]);
    assert.deepEqual(sonosCommands(sonos).map(item=>item.action),['Play']);
    assert.deepEqual(commandCalls(sony),[],'the Sony receives nothing while the Move is presented');
    for(const [sourceId,status] of [['kitchen',404],['sonos',403],['sony',403]]){
      const other=await call('/api/playback/v1/commands',{requestId:'r-'+sourceId,sourceId,action:'pause'});
      assert.equal(other.status,status,sourceId);
    }
    assert.deepEqual(sonosCommands(sonos).map(item=>item.action),['Play']);
    const context=await call('/api/dashboard/v1/context');
    assert.deepEqual((await context.json()).playback,{sourceId:'living-room'});
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

test('playback configuration needs one ID and one or two sources of distinct kinds at private addresses',async()=>{
  const sony={kind:'sony',endpoint:'http://192.168.1.20:10000/sony'},sonos={kind:'sonos',endpoint:'http://192.168.1.30:1400/MediaRenderer/AVTransport/Control'};
  const options=(playback,controllers=[])=>({directory:'/nonexistent/hub-playback',ownerId:'owner',consumers:[],credentials,controllers,playback});
  const controller={id:'living-room',kind:'pixoo',controllerId:'pixoo',deviceId:'pixoo',token:'e'.repeat(43),endpoint:'http://127.0.0.1:9/controller/v1'};
  for(const endpoint of ['http://10.0.0.5:10000/sony','http://172.31.2.3:10000/sony','http://127.0.0.1:10000/sony'])
    assert.deepEqual(sonyConfiguration({...sony,endpoint}),{...sony,endpoint});
  for(const endpoint of ['http://10.0.0.5:1400/MediaRenderer/AVTransport/Control','http://127.0.0.1:1400/MediaRenderer/AVTransport/Control'])
    assert.deepEqual(sonosConfiguration({...sonos,endpoint}),{...sonos,endpoint});
  const invalid=[null,{id:'living-room',sources:[]},{id:'living-room',sources:[sony,sonos,sony]},{id:'living-room',sources:[sony,{...sony,endpoint:'http://192.168.1.21:10000/sony'}]},
    {id:'living-room',sources:[sonos,{...sonos,endpoint:'http://192.168.1.31:1400/MediaRenderer/AVTransport/Control'}]},{id:'living-room',sources:[sony],extra:true},
    {id:'living-room',sources:[{...sony,kind:'airplay'}]},{id:'living-room',sources:[{...sony,extra:true}]},{id:'living-room',sources:[{...sony,id:'living-room'}]},
    {selected:'living-room',sources:[{id:'living-room',kind:'sony',endpoint:sony.endpoint}]},{selected:'living-room',sources:[sony]},
    {id:'hub-service',sources:[sony]},{id:'bad id',sources:[sony]},{id:'192.168.1.20',sources:[sony]},{id:'10.0.0.9',sources:[sony]},
    {id:'sony-192.168.1.20',sources:[sony]},{id:'move-192.168.1.30',sources:[sonos,sony]},{id:'living-room',sources:'sony'}];
  for(const endpoint of ['https://192.168.1.20:10000/sony','http://8.8.8.8:10000/sony','http://172.32.0.1:10000/sony','http://soundbar.local:10000/sony',
    'http://192.168.1.20/sony','http://192.168.1.20:10000/sony/','http://192.168.1.20:10000/other','http://user:pw@192.168.1.20:10000/sony',
    'http://192.168.1.20:10000/sony?x=1','http://192.168.1.20:10000/sony#x','http://[::1]:10000/sony','not a url'])
    invalid.push({id:'living-room',sources:[{...sony,endpoint}]});
  for(const endpoint of ['https://192.168.1.30:1400/MediaRenderer/AVTransport/Control','http://8.8.8.8:1400/MediaRenderer/AVTransport/Control','http://move.local:1400/MediaRenderer/AVTransport/Control',
    'http://192.168.1.30/MediaRenderer/AVTransport/Control','http://192.168.1.30:1400/','http://192.168.1.30:1400/MediaRenderer/AVTransport/Event','http://192.168.1.30:1400/MediaRenderer/AVTransport/Control/',
    'http://user:pw@192.168.1.30:1400/MediaRenderer/AVTransport/Control','http://192.168.1.30:1400/MediaRenderer/AVTransport/Control?x=1','http://192.168.1.30:1400/MediaRenderer/AVTransport/Control#x','not a url'])
    invalid.push({id:'living-room',sources:[{...sonos,endpoint}]});
  for(const playback of invalid)await assert.rejects(startHub(options(playback)),/invalid-playback/,JSON.stringify(playback));
  await assert.rejects(startHub(options({id:'living-room',sources:[sony]},[controller])),/invalid-playback/);
  for(const sources of [[sony],[sonos],[sonos,sony],[sony,sonos]]){
    const directory=await mkdtemp(join(tmpdir(),'hub-playback-config-'));
    const hub=await startHub({...options({id:'living-room',sources}),directory});
    try{
      const read=await fetch(hub.url+'/api/playback/v1/snapshot',{headers:{authorization:`Bearer ${tokens.controller}`}});
      assert.deepEqual([read.status,(await read.json()).sourceId],[200,'living-room'],JSON.stringify(sources));
    }finally{await hub.close();await rm(directory,{recursive:true,force:true});}
  }
});

test('freshness follows the monotonic clock and receipts stay bounded',async()=>{
  const source=fakeSource();let wall=100000,elapsed=0;
  const playback=createPlayback('kitchen',[source],()=>wall,()=>elapsed);
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
