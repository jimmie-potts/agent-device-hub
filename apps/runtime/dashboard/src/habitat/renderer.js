import {createModel} from './model.js';
import {createNavigation} from './navigation.js';
import {createAppearance} from './appearance.js';
/* Canvas presentation retained from the reviewed habitat. The typed controller supplies session evidence. */
export function mountHabitat(root, callbacks={}) {
  const document=root.ownerDocument,window=document.defaultView,controller=new AbortController();
  let disposed=false,frameId=0,finishReady;const loadedReady=new Promise(resolve=>{finishReady=resolve;});
  const listen=(target,event,handler,options={})=>target.addEventListener(event,handler,{...(typeof options==='boolean'?{capture:options}:options),signal:controller.signal});
  const model=createModel(),navigation=createNavigation(),appearance=createAppearance();
  const assets={background:'/habitat/habitat-desk-entry.webp',sprites:'/habitat/bunnies-sleep-variants.png',platform:'/habitat/work-platform.png',platformFront:'/habitat/work-platform-front.png'};
  const {roomFor,poseFor,bodyBoundsFor,workshopFront,dormFront,mailFront,travelFront,rooms,world}=model;
  const {palette,colorsFrom,tintPixels,validColor}=appearance;
  const $=id=>root.querySelector('[id="'+id+'"]');
  const canvas=$('habitat'),ctx=canvas.getContext('2d');
  if(!ctx){$('loading').textContent='Canvas is unavailable. Use the session status list below.';callbacks.unavailable?.();controller.abort();return null;}
  const W=world.width,H=world.height;
  const labels={working:'Working',idle:'Idle',approval:'Waiting for approval',input:'Waiting for input',question:'Question · continuing',finished:'Finished · unread',interrupted:'Interrupted',unknown:'Activity unknown'};
  const names=['Clover','Pip','Hazel','Fern','Moss','Juniper','Olive','Maple','Sage','Basil'];
  const mixed=['working','working','working','working','idle','idle','approval','finished','idle','input'];
  let storageAvailable=true;
  const readPreference=key=>{try{return localStorage.getItem(key);}catch{storageAvailable=false;return null;}};
  const writePreference=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{storageAvailable=false;return false;}};
  const savedColors=colorsFrom(readPreference('bunny.burrow.aprons.v1'));
  const editableRooms=['workshop','music','dorm','mail'];
  const defaultPlaces=Object.fromEntries(editableRooms.map(room=>[room,rooms[room].spots.map(s=>({position:[...s.position],facing:s.facing}))]));
  const placementKey=room=>`bunny.burrow.${room}-places.${room==='workshop'?'v2':'v1'}`;
  const musicBackupKey='bunny.burrow.music-places.before-workshop-controls.v1';
  const musicRecoveryKey='bunny.burrow.music-recovery.workshop-controls.v1';
  const placementBounds={workshop:{left:90,right:655,top:285,bottom:570},music:{left:90,right:635,top:790,bottom:1000},dorm:{left:745,right:1290,top:245,bottom:555},mail:{left:755,right:1280,top:790,bottom:995}};
  const positionData=room=>rooms[room].spots.map(p=>({x:p.position[0],y:p.position[1],facing:p.facing,layout:p.render.layout||'original'}));
  function loadPositions(room,stored){
    const bounds=placementBounds[room];
    rooms[room].spots.forEach((s,id)=>{
      const p=stored?.[id];
      if(p&&(!s.render.layout||p.layout===s.render.layout)&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=bounds.left*W/1341&&p.x<=bounds.right*W/1341&&p.y>=bounds.top*H/1173&&p.y<=bounds.bottom*H/1173){
        s.position[0]=p.x;s.position[1]=p.y;s.facing=p.facing===-1?-1:1;
      }
    });
  }
  let musicRestored=false,musicBackup=null;
  try{const saved=JSON.parse(readPreference(musicBackupKey));if(Array.isArray(saved))musicBackup=saved;}catch{/* No readable backup is available. */}
  if(!readPreference(musicRecoveryKey)){
    try{
      const previous=JSON.parse(readPreference(placementKey('music')));
      if(Array.isArray(previous)){
        if(writePreference(musicBackupKey,previous)){
          musicBackup=previous;
          musicRestored=writePreference(placementKey('music'),positionData('music'));
        }
      }
      writePreference(musicRecoveryKey,true);
    }catch{/* Unreadable preferences keep the calibrated defaults. */}
  }
  for(const room of editableRooms){
    try{loadPositions(room,JSON.parse(readPreference(placementKey(room))));}catch{/* Malformed positions keep the calibrated defaults. */}
  }
  const placementHistory={workshop:[],music:[],dorm:[],mail:[]};
  const agents=names.map((name,id)=>({id,name,apron:savedColors[id],client:id%2?'Claude':'Codex',state:mixed[id],room:'dorm',targetRoom:'dorm',x:0,y:0,phase:id*1.37,route:[],facing:1,hidden:false,move:0,arrival:0}));
  let selected=0,music=false,musicFocus=false,workshopFocus=false,dormFocus=false,mailFocus=false,motionPaused=false,ready=false,clock=0,previous=0,lastDraw=0,dirty=true,frameCount=0,demoAbort=null,hovered=-1,skipDemoClick=false,showSpots=false;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  let conversationSelection=null;
  const conversation=id=>callbacks.destination?.(id)||{reason:'Demo bunny · no conversation linked.'};
  const background=new Image(),sprites=new Image(),workPlatform=new Image(),frontPlatform=new Image();
  background.src=assets?.background||'assets/habitat-desk-entry.webp';
  sprites.src=assets?.sprites||'assets/bunnies-sleep-variants.png';
  workPlatform.src=assets?.platform||'assets/work-platform.png';
  frontPlatform.src=assets?.platformFront||'assets/work-platform-front.png';
  const spriteWidth=96,spriteHeight=128;
  const paused=()=>motionPaused||reduced.matches;
  const seat=(agent,room)=>rooms[room].seats[agent.id];
  const place=(agent,room)=>rooms[room].spots[agent.id];
  const tunnelEntries=Object.fromEntries(Object.keys(rooms).map(id=>[id,{waiting:[],next:0}]));
  function leaveTunnelQueue(id){for(const entry of Object.values(tunnelEntries))entry.waiting=entry.waiting.filter(waiting=>waiting!==id);}
  let sourcePixels;const coloredAtlases=new Map();
  function tintedAtlas(color){
    if(coloredAtlases.has(color))return coloredAtlases.get(color);
    const c=document.createElement('canvas');c.width=sprites.naturalWidth;c.height=sprites.naturalHeight;
    c.getContext('2d').putImageData(new ImageData(tintPixels(sourcePixels.data,color),c.width,c.height),0,0);
    if(coloredAtlases.size>=24)coloredAtlases.delete(coloredAtlases.keys().next().value);
    coloredAtlases.set(color,c);return c;
  }
  function focusRoom(room){
    musicFocus=room==='music';workshopFocus=room==='workshop';dormFocus=room==='dorm';mailFocus=room==='mail';const focused=musicFocus||workshopFocus||dormFocus||mailFocus;
    canvas.height=focused?1080:H;canvas.parentElement.style.aspectRatio=focused?'1600 / 1080':'1600 / 1400';
    canvas.setAttribute('aria-label',focused?`${rooms[room].name} close-up with ten individually colored bunnies. Select a bunny from the resident list to customize its apron or simulated state.`:'Four-room bunny habitat, with ten unique places in each room. Select a bunny from the resident list to customize its apron or simulated state.');
    $('music-view').textContent=musicFocus?'Show whole burrow':'Music-room preview';$('music-view').setAttribute('aria-pressed',String(musicFocus));
    $('dorm-view').textContent=dormFocus?'Show whole burrow':'Sleeping-area preview';$('dorm-view').setAttribute('aria-pressed',String(dormFocus));
    $('mail-view').textContent=mailFocus?'Show whole burrow':'Mail-room preview';$('mail-view').setAttribute('aria-pressed',String(mailFocus));
    $('workshop-view').textContent=workshopFocus?'Show whole burrow':'Workshop preview';$('workshop-view').setAttribute('aria-pressed',String(workshopFocus));dirty=true;
  }
  const focusMusic=value=>focusRoom(value?'music':null);
  const editingRoom=()=>workshopFocus?'workshop':musicFocus?'music':dormFocus?'dorm':mailFocus?'mail':editableRooms.includes(agents[selected].targetRoom)?agents[selected].targetRoom:'workshop';
  const camera=()=>musicFocus?{x:60*W/1341,y:623*H/1173,width:600*W/1341,height:405*H/1173}:workshopFocus?{x:55*W/1341,y:150*H/1173,width:645*W/1341,height:435*H/1173}:dormFocus?{x:700*W/1341,y:155*H/1173,width:630*W/1341,height:425*H/1173}:mailFocus?{x:710*W/1341,y:623*H/1173,width:620*W/1341,height:418.5*H/1173}:{x:0,y:0,width:W,height:H};
  function refreshControls(){
    const liveHabitat=agents.every(a=>a.liveResident);for(const id of ['all-work','all-idle','all-wait','mixed'])$(id).disabled=liveHabitat;
    $('music').setAttribute('aria-pressed',String(music));$('music-label').textContent=music?'Pause music':'Play music';
    $('music-status').textContent=music?'♫ A record is playing · simulated':'The record is resting';
    $('motion').setAttribute('aria-pressed',String(paused()));$('motion').textContent=reduced.matches?'Reduced motion':motionPaused?'Resume motion':'Pause motion';$('motion').disabled=reduced.matches;
    $('motion-note').textContent=reduced.matches?'Reduced motion · poses update without travel':motionPaused?'Motion paused · poses update without travel':'Candles on. Make yourself at home.';
    const working=agents.filter(a=>a.state==='working'||a.state==='question').length;
    const waiting=agents.filter(a=>a.state==='approval'||a.state==='input').length;
    $('summary').textContent=`10 bunnies · ${working} working${waiting?` · ${waiting} waiting`:''}`;
    for(const a of agents){
      const btn=$(`agent-${a.id}`);btn.dataset.state=a.state;btn.dataset.assigned=String(!!a.liveBound);btn.dataset.uncertain=String(!!a.liveUncertain);btn.setAttribute('aria-pressed',String(a.id===selected));
      btn.style.setProperty('--apron',a.apron);btn.querySelector('.agent-name').textContent=a.name;btn.querySelector('.client').textContent=a.client;
      const dest=a.route.length?` → ${rooms[a.targetRoom].name}`:` · ${rooms[a.room].name}`;
      btn.querySelector('.agent-status-text').textContent=(a.liveBound?(a.liveUncertain?'Live · uncertain · ':'Live · '):a.liveResident?'No session · ':'')+labels[a.state]+dest;
      btn.querySelector('.dot').className='dot'+(['approval','input','finished'].includes(a.state)?' waiting':['unknown','interrupted'].includes(a.state)?' unknown':'');
    }
    const a=agents[selected];$('selected-name').textContent=`${a.id+1}. ${a.name} · ${a.client}`;$('agent-state').value=a.state;$('agent-state').disabled=!!(a.liveResident||a.liveBound);root.querySelector('label[for="agent-state"]').textContent=a.liveBound?'Observed agent state':a.liveResident?'Unassigned resident':'Simulated agent state';
    const target=conversation(selected);
    if(conversationSelection&&(conversationSelection.id!==selected||conversationSelection.key!==target.key||!target.href))conversationSelection=null;
    const hint=target.href?(conversationSelection?`Click Bunny ${selected+1} again to open this conversation in Codex. You can also press Enter or Space on its resident entry.`:`Click Bunny ${selected+1} for details, then click it again to open this conversation in Codex.`):target.reason;
    if($('conversation-hint').textContent!==hint)$('conversation-hint').textContent=hint;
    $('apron-color').value=a.apron;$('apron-value').value=a.apron;$('apron-label').textContent=`${a.name}’s apron color`;
    root.querySelectorAll('.apron-swatch').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.color===a.apron)));
    $('preference-note').textContent=storageAvailable?'Colors are saved in this browser.':'Colors are available for this visit; browser storage is unavailable.';
    const editRoom=editingRoom(),mp=place(a,editRoom),roomName=rooms[editRoom].name;
    $('placement-title').textContent=`Adjust ${roomName.toLowerCase()} position`;
    $('placement-room').textContent=`${roomName} · ${mp.label}`;
    $('placement-bunny').value=String(selected);
    $('placement-note').textContent=storageAvailable?'Arrow buttons move this bunny immediately. Positions are saved separately for each room.':'Arrow buttons move this bunny immediately. Positions are available for this visit.';
    $('spot-position').value=`${Math.round(mp.position[0]*1341/W)}, ${Math.round(mp.position[1]*1173/H)} · ${poseFor(a,editRoom,music)==='sleeping'&&mp.render?.sleepFacing!==undefined?'aligned with bedding':`facing ${mp.facing===1?'right':'left'}`}`;
    $('spot-undo').disabled=!placementHistory[editRoom].length;
    const visible=a.targetRoom===editRoom;
    root.querySelectorAll('[data-nudge],#spot-turn,#spot-reset').forEach(button=>button.disabled=!visible);
    const fixedSleepDirection=visible&&poseFor(a,editRoom,music)==='sleeping'&&mp.render?.sleepFacing!==undefined;
    $('spot-turn').disabled=!visible||fixedSleepDirection;$('spot-turn').title=fixedSleepDirection?'Sleeping direction follows the pillow.':'';
    $('placement-preview').hidden=visible;
    $('placement-preview').textContent=`Open ${roomName.toLowerCase()} preview`;
    $('music-recovery-note').textContent=musicRestored?'Music-room positions restored to the polished layout. The previous positions are backed up.':'Restore the polished music-room layout if its spots were moved by mistake.';
    $('music-restore-undo').disabled=!musicBackup;
    $('destination').textContent=a.liveUncertain?'Paused · session evidence uncertain':a.route.length?`Hopping to ${rooms[a.targetRoom].name.toLowerCase()} · ${place(a,a.targetRoom).label}`:`${rooms[a.room].name} · ${place(a,a.room).label}`;
    for(const room of Object.keys(rooms))$(`count-${room}`).textContent=`${agents.filter(a=>a.room===room).length} / 10`;
    $('spots').setAttribute('aria-pressed',String(showSpots));
    dirty=true;
  }
  const navigationCache=new Map();
  function roomNavigation(room){
    const key=JSON.stringify(rooms[room].seats),cached=navigationCache.get(room);
    if(cached?.key===key)return cached.nav;
    const nav=navigation.create(rooms,room);navigationCache.set(room,{key,nav});return nav;
  }
  function stationHops(path,first,last,kind){
    const out=[],direction=first<=last?1:-1;
    for(let index=first;direction>0?index<=last:index>=last;index+=direction){const [x,y]=path[index];out.push({x,y,kind,stepIndex:index,path,dock:path[0]});}
    return out;
  }
  function settle(a,room){leaveTunnelQueue(a.id);a.room=a.targetRoom=room;[a.x,a.y]=seat(a,room);a.facing=place(a,room).facing??1;a.route=[];a.hidden=false;a.move=0;a.arrival=0;a.onStation=true;a.stationDock=null;a.stationPath=null;a.hopLift=0;}
  function plan(a,instant=false){
    const target=roomFor(a,music,a.room),previousTarget=a.targetRoom;
    if(instant||paused()){settle(a,target);return;}
    if(target===previousTarget&&a.route.length)return;
    if(target===a.room&&!a.route.length)return;
    const active=a.route[0],boarding=['mount','dismount'].includes(active?.kind),nav=roomNavigation(a.room);
    const sourcePath=a.stationPath||nav.stationPath(a.id),last=sourcePath.length-1;
    leaveTunnelQueue(a.id);a.targetRoom=target;a.hidden=false;
    let start=[a.x,a.y],departure=[];
    if(target===a.room){
      if(a.onStation&&!boarding){a.route=[];return;}
      if(boarding){
        const first=active.kind==='mount'?active.stepIndex:active.stepIndex+1;
        a.route=stationHops(sourcePath,first,last,'mount');
      }else a.route=[...nav.walk(start,sourcePath[0]),...stationHops(sourcePath,1,last,'mount')];
      return;
    }
    if(a.onStation||boarding){
      const first=boarding?(active.kind==='mount'?active.stepIndex-1:active.stepIndex):last-1;
      departure=stationHops(sourcePath,first,0,'dismount');start=sourcePath[0];
    }
    const exit=rooms[a.room].portal,entry=rooms[target].portal,destination=roomNavigation(target),path=destination.stationPath(a.id);
    a.route=[...departure,...nav.walk(start,exit),{x:exit[0],y:exit[1],kind:'exit'},
      {kind:'tunnel',remaining:.35,room:target,x:entry[0],y:entry[1]},
      ...destination.walk(entry,path[0]),...stationHops(path,1,path.length-1,'mount')];
  }
  function setStates(values){if(values==='working'||values==='approval'||workshopFocus||dormFocus||mailFocus)focusMusic(false);agents.forEach((a,i)=>{if(a.liveResident||a.liveBound)return;a.state=Array.isArray(values)?values[i]:values;plan(a);});refreshControls();}
  function toggleMusic(){music=!music;if(!music)focusMusic(false);agents.forEach(a=>{if(!a.liveUncertain)plan(a);});refreshControls();}
  function select(id){selected=id;conversationSelection=null;refreshControls();callbacks.selected?.(id);}
  function inspectOrOpen(id,event){
    const target=conversation(id),again=selected===id&&conversationSelection?.key===target.key&&!!target.href;
    select(id);
    if(!event.isTrusted)return;
    if(again){window.location.assign(target.href);return;}
    if(target.href)conversationSelection={id,key:target.key};
    refreshControls();
  }
  for(const a of agents){
    const button=document.createElement('button');button.id=`agent-${a.id}`;button.className='agent';button.type='button';button.setAttribute('aria-pressed','false');
    button.innerHTML=`<span class="agent-id">${a.id+1}</span><span class="agent-main"><span class="agent-line"><span class="agent-name">${a.name}</span><span class="client">${a.client}</span></span><span class="agent-status"><span class="dot"></span><span class="agent-status-text"></span></span></span>`;
    button.setAttribute('aria-describedby','conversation-hint');
    listen(button,'click',event=>inspectOrOpen(a.id,event));$('agents').append(button);
    const option=document.createElement('option');option.value=String(a.id);option.textContent=`${a.id+1}. ${a.name}`;$('placement-bunny').append(option);
  }
  for(const [id,room] of Object.entries(rooms)){const label=document.createElement('div');label.className='room-count';label.innerHTML=`<strong id="count-${id}">0</strong>${room.name}`;$('room-counts').append(label);}
  function setApron(color){if(!validColor(color))return;agents[selected].apron=color.toLowerCase();writePreference('bunny.burrow.aprons.v1',agents.map(a=>a.apron));refreshControls();}
  for(const [name,color] of palette){
    const button=document.createElement('button');button.type='button';button.className='apron-swatch';button.dataset.color=color;button.style.setProperty('--apron',color);button.setAttribute('aria-label',`${name} apron`);button.setAttribute('aria-pressed','false');button.innerHTML='<span aria-hidden="true"></span>';
    listen(button,'click',()=>setApron(color));$('apron-presets').append(button);
  }
  listen($('apron-color'),'input',e=>setApron(e.target.value));
  listen($('apron-reset'),'click',()=>setApron(palette[selected][1]));
  function updateRoomPositions(room){
    for(const a of agents)if(a.targetRoom===room)settle(a,room);
    writePreference(placementKey(room),positionData(room));refreshControls();
  }
  function rememberPositions(room){placementHistory[room].push(positionData(room));if(placementHistory[room].length>40)placementHistory[room].shift();}
  function moveSpot(dx,dy,turn=false,reset=false){
    const room=editingRoom(),a=agents[selected],s=place(a,room),bounds=placementBounds[room];
    if(a.targetRoom!==room)return;
    rememberPositions(room);
    if(reset){s.position[0]=defaultPlaces[room][a.id].position[0];s.position[1]=defaultPlaces[room][a.id].position[1];s.facing=defaultPlaces[room][a.id].facing;}
    else if(turn)s.facing*=-1;
    else{s.position[0]=Math.max(bounds.left*W/1341,Math.min(bounds.right*W/1341,s.position[0]+dx*W/1341));s.position[1]=Math.max(bounds.top*H/1173,Math.min(bounds.bottom*H/1173,s.position[1]+dy*H/1173));}
    settle(a,room);writePreference(placementKey(room),positionData(room));refreshControls();
  }
  root.querySelectorAll('[data-nudge]').forEach(button=>listen(button,'click',()=>moveSpot(...button.dataset.nudge.split(',').map(Number))));
  listen($('spot-turn'),'click',()=>moveSpot(0,0,true));listen($('spot-reset'),'click',()=>moveSpot(0,0,false,true));
  listen($('placement-bunny'),'change',e=>select(Number(e.target.value)));
  listen($('spot-undo'),'click',()=>{const room=editingRoom(),previous=placementHistory[room].pop();if(previous){loadPositions(room,previous);updateRoomPositions(room);}});
  listen($('placement-preview'),'click',()=>$({workshop:'workshop-view',music:'music-view',dorm:'dorm-view',mail:'mail-view'}[editingRoom()]).click());
  listen($('music-restore'),'click',()=>{
    musicBackup=positionData('music');writePreference(musicBackupKey,musicBackup);
    rooms.music.spots.forEach((s,id)=>{s.position[0]=defaultPlaces.music[id].position[0];s.position[1]=defaultPlaces.music[id].position[1];s.facing=defaultPlaces.music[id].facing;});
    musicRestored=true;updateRoomPositions('music');
  });
  listen($('music-restore-undo'),'click',()=>{
    if(musicBackup){loadPositions('music',musicBackup);musicRestored=false;updateRoomPositions('music');}
  });
  listen($('music-view'),'click',()=>{if(agents.some(a=>a.liveResident||a.liveBound)){focusRoom(musicFocus?null:'music');refreshControls();return;}if(musicFocus)focusMusic(false);else{music=true;setStates('idle');focusMusic(true);}refreshControls();});
  listen($('workshop-view'),'click',()=>{if(agents.some(a=>a.liveResident||a.liveBound)){focusRoom(workshopFocus?null:'workshop');refreshControls();return;}if(workshopFocus)focusRoom(null);else{setStates('working');focusRoom('workshop');}refreshControls();});
  listen($('dorm-view'),'click',()=>{if(agents.some(a=>a.liveResident||a.liveBound)){focusRoom(dormFocus?null:'dorm');refreshControls();return;}if(dormFocus)focusRoom(null);else{music=false;setStates('idle');focusRoom('dorm');}refreshControls();});
  listen($('mail-view'),'click',()=>{if(agents.some(a=>a.liveResident||a.liveBound)){focusRoom(mailFocus?null:'mail');refreshControls();return;}if(mailFocus)focusRoom(null);else{setStates('approval');focusRoom('mail');}refreshControls();});
  listen($('all-work'),'click',()=>setStates('working'));
  listen($('all-idle'),'click',()=>setStates('idle'));
  listen($('all-wait'),'click',()=>setStates('approval'));
  listen($('mixed'),'click',()=>{focusMusic(false);music=false;setStates(mixed);});
  listen($('music'),'click',toggleMusic);
  listen($('spots'),'click',()=>{showSpots=!showSpots;refreshControls();});
  listen($('agent-state'),'change',event=>{const a=agents[selected];if(a.liveResident||a.liveBound)return;a.state=event.target.value;plan(a);refreshControls();});
  listen($('motion'),'click',()=>{motionPaused=!motionPaused;if(paused())agents.forEach(a=>{if(!a.liveUncertain)settle(a,a.targetRoom);});refreshControls();});
  listen(reduced,'change',()=>{if(reduced.matches)agents.forEach(a=>{if(!a.liveUncertain)settle(a,a.targetRoom);});refreshControls();});
  function worldPoint(event){const r=canvas.getBoundingClientRect(),c=camera();return {x:c.x+(event.clientX-r.left)*c.width/r.width,y:c.y+(event.clientY-r.top)*c.height/r.height};}
  function hit(event){const p=worldPoint(event);let best=-1,d=70;for(const a of agents){if(a.hidden)continue;const dd=Math.hypot(a.x-p.x,a.y-45-p.y);if(dd<d){best=a.id;d=dd;}}return best;}
  listen(canvas,'click',event=>{if(event.button!==0)return;const id=hit(event);if(id>=0)inspectOrOpen(id,event);else{conversationSelection=null;refreshControls();}});
  listen(canvas,'pointermove',event=>{hovered=hit(event);canvas.style.cursor=hovered>=0?'pointer':'default';dirty=true;});
  listen(canvas,'pointerleave',()=>{hovered=-1;dirty=true;});
  function step(a,dt){
    if(!a.route.length){if(a.arrival>0){a.arrival=Math.max(0,a.arrival-dt);return a.arrival===0;}return false;}
    const p=a.route[0];
    if(p.kind==='tunnel'){
      const entry=tunnelEntries[p.room];
      if(!p.queued){entry.waiting.push(a.id);p.queued=true;}
      a.hidden=true;p.remaining-=dt;
      if(p.remaining<=0&&entry.waiting[0]===a.id&&clock>=entry.next){
        entry.waiting.shift();entry.next=clock+.32;a.enteredAt=clock;a.hidden=false;a.room=p.room;a.x=p.x;a.y=p.y;a.onStation=false;a.stationDock=null;a.stationPath=null;a.hopLift=0;a.route.shift();return true;
      }
      return false;
    }
    if(p.kind==='mount'||p.kind==='dismount'){
      if(!p.origin){p.origin=[a.x,a.y];p.elapsed=0;p.startLift=a.hopLift||0;a.stationPath=p.path;a.stationDock=p.dock;a.onStation=false;
        p.duration=a.room==='workshop'?.55:.34+Math.min(.28,Math.hypot(p.x-a.x,p.y-a.y)/320);}
      p.elapsed+=dt;const t=Math.min(1,p.elapsed/p.duration),ease=t*t*(3-2*t);
      a.x=p.origin[0]+(p.x-p.origin[0])*ease;a.y=p.origin[1]+(p.y-p.origin[1])*ease;
      a.hopLift=a.room==='workshop'?0:(1-ease)*p.startLift+Math.sin(t*Math.PI)*Math.min(23,9+Math.hypot(p.x-p.origin[0],p.y-p.origin[1])*.12);
      if(a.room==='workshop')a.facing=place(a,a.room).facing??1;
      else if(Math.abs(p.x-p.origin[0])>1)a.facing=p.x<p.origin[0]?-1:1;
      if(t===1){
        a.onStation=p.kind==='mount'&&p.stepIndex===p.path.length-1;
        if(p.kind==='dismount'&&p.stepIndex===0){a.stationPath=null;a.stationDock=null;}
        a.route.shift();a.move=0;a.hopLift=0;
        if(!a.route.length){a.facing=place(a,a.room).facing??1;a.arrival=a.room==='music'?.4:0;}
      }
      return true;
    }
    const dx=p.x-a.x,dy=p.y-a.y,d=Math.hypot(dx,dy),speed=(270+a.id*7)*dt;
    if(Math.abs(dx)>1)a.facing=dx<0?-1:1;
    a.move+=dt;
    if(d<=speed){a.x=p.x;a.y=p.y;a.route.shift();if(!a.route.length){a.move=0;a.facing=place(a,a.room).facing??1;a.arrival=a.room==='music'?.4:0;}return true;}
    a.x+=dx/d*speed;a.y+=dy/d*speed;return false;
  }
  function roundRect(x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r);}
  const actorLayer=document.createElement('canvas'),actorContext=actorLayer.getContext('2d');
  function furnitureFront(a,target,lapBand){
    // Cut only the current sprite behind real armrests. Never repaint floor or
    // upholstery over its feet, or erase a previously drawn neighboring bunny.
    target.save();target.globalCompositeOperation='destination-out';target.fillStyle='#000';
    // Seated heads sit above the arms; lower legs hang in front of the seat.
    // Keep both intact even after a saved nudge or a change in facing direction.
    if(lapBand){target.beginPath();target.rect(lapBand.left,lapBand.top,lapBand.width,lapBand.height);target.clip();}
    for(const spot of rooms.music.spots){
      if(!spot.render.front.length||a.y>spot.render.frontDepth*H/1173)continue;
      for(const polygon of spot.render.front){
        target.beginPath();polygon.forEach(([x,y],i)=>{if(i)target.lineTo(x*W/1341,y*H/1173);else target.moveTo(x*W/1341,y*H/1173);});target.closePath();target.fill();
      }
    }
    target.restore();
  }
  function travellingFurnitureFront(a,target){
    target.save();target.globalCompositeOperation='destination-out';target.fillStyle='#000';
    for(const furniture of travelFront[a.room]||[]){
      if(a.y>furniture.depth*H/1173)continue;
      for(const polygon of furniture.polygons){target.beginPath();polygon.forEach(([x,y],i)=>{if(i)target.lineTo(x*W/1341,y*H/1173);else target.moveTo(x*W/1341,y*H/1173);});target.closePath();target.fill();}
    }
    target.restore();
  }
  function workshopFurnitureFront(a,target,only=null){
    target.save();target.globalCompositeOperation='destination-out';target.fillStyle='#000';
    for(const furniture of workshopFront){
      if(only&&furniture.label!==only)continue;
      if(a.y>furniture.depth*H/1173)continue;
      for(const polygon of furniture.polygons){target.beginPath();polygon.forEach(([x,y],i)=>{if(i)target.lineTo(x*W/1341,y*H/1173);else target.moveTo(x*W/1341,y*H/1173);});target.closePath();target.fill();}
    }
    target.restore();
  }
  function sleepingFurnitureFront(a,target,ownId=null){
    target.save();target.globalCompositeOperation='destination-out';target.fillStyle='#000';
    for(const furniture of dormFront){
      if(ownId!==null){if(!furniture.owners.includes(ownId)||rooms.dorm.spots[ownId].render.sleepFacing===undefined&&a.y>furniture.depth*H/1173)continue;}
      else if(a.y>furniture.depth*H/1173)continue;
      for(const polygon of furniture.polygons){target.beginPath();polygon.forEach(([x,y],i)=>{if(i)target.lineTo(x*W/1341,y*H/1173);else target.moveTo(x*W/1341,y*H/1173);});target.closePath();target.fill();}
    }
    target.restore();
  }
  function mailFurnitureFront(a,target,ownId=null){
    target.save();target.globalCompositeOperation='destination-out';target.fillStyle='#000';
    for(const furniture of mailFront){
      if(ownId!==null?!furniture.owners.includes(ownId):a.y>furniture.depth*H/1173)continue;
      for(const polygon of ownId===null?(furniture.walkingPolygons||furniture.polygons):furniture.polygons){target.beginPath();polygon.forEach(([x,y],i)=>{if(i)target.lineTo(x*W/1341,y*H/1173);else target.moveTo(x*W/1341,y*H/1173);});target.closePath();target.fill();}
    }
    target.restore();
  }
  function workshopLampFront(a,target){workshopFurnitureFront(a,target,'Foreground desk lamp');}
  function drawWorkPlatforms(){
    for(const s of rooms.workshop.spots){
      // The island and stump conceal their rear supports completely.
      if(s.render.side!=='front'||!s.render.platform)continue;
      const {width,height}=s.render.platform,[x,y]=s.position,w=width*W/1341,h=height*H/1173;
      const left=Math.floor(x-w/2-3),top=Math.floor(y-h*.22-3);
      actorLayer.width=Math.ceil(w+6);actorLayer.height=Math.ceil(h+6);
      actorContext.imageSmoothingEnabled=false;actorContext.translate(-left,-top);
      actorContext.save();actorContext.translate(x,y-h*.22);actorContext.scale(s.render.platform.facing||1,1);
      // Match the quieter, darker wood of the fixed drafting stool. Color-only
      // canvas lighting preserves the sprite's pixel edges and transparency.
      actorContext.filter='contrast(.93) saturate(.94) brightness(.84)';
      actorContext.drawImage(s.render.platform.variant==='front'?frontPlatform:workPlatform,-w/2,0,w,h);actorContext.restore();
      workshopLampFront({y:y+h*.78},actorContext);
      ctx.drawImage(actorLayer,left,top);
    }
  }
  function drawWorkingHands(a,frame,width,height){
    actorContext.save();actorContext.translate(Math.round(a.x),Math.round(a.y));actorContext.scale(a.facing,1);
    actorContext.translate(-width/2,-height);actorContext.scale(width/96,height/128);
    actorContext.beginPath();
    const stump=place(a,'workshop').render.side==='behind-stump';
    // The stump exposes the wrist edge: the broader island clip also includes
    // apron pixels beneath the forearm, which must stay behind the stump.
    const forearm=stump?(frame===3?
      [[30,82],[39,80],[45,84],[51,89],[60,92],[62,96],[61,100],[54,101],[44,98],[35,93]]:
      [[30,82],[39,80],[46,84],[54,88],[61,91],[62,96],[57,99],[48,98],[39,94],[33,90]]):
      [[30,82],[40,80],[47,83],[58,88],[69,91],[72,98],[67,104],[56,104],[44,99],[34,93]];
    for(const polygon of [[[71,70],[88,71],[96,80],[96,94],[80,101],[68,96],[67,85]],forearm]){
      polygon.forEach(([x,y],i)=>{if(i)actorContext.lineTo(x,y);else actorContext.moveTo(x,y);});actorContext.closePath();
    }
    actorContext.clip();actorContext.drawImage(tintedAtlas(a.apron),frame*96,0,96,128,0,0,96,128);actorContext.restore();
  }
  function drawActor(actor){
    if(actor.hidden)return;
    const sleepDetail=actor.room==='dorm'&&!actor.route.length&&poseFor(actor,actor.room,music)==='sleeping'?place(actor,'dorm').render:null;
    const offset=sleepDetail?.sleepOffset;
    const a=offset?{...actor,x:actor.x+offset[0]*W/1341,y:actor.y+offset[1]*H/1173}:actor;
    const moving=a.route.length>0,stationHop=['mount','dismount'].includes(a.route[0]?.kind),boarding=a.room==='workshop'&&stationHop,pose=boarding?'working':moving?'hopping':poseFor(a,a.room,music);
    const still=paused()||a.liveUncertain;
    const phase=still?a.phase:clock+a.phase;
    let frame=0;
    if(pose==='hopping')frame=1+(Math.floor(phase*5)%2);
    if(pose==='working')frame=Math.floor(phase*3)%2?3:7;
    if(pose==='sleeping')frame=4;
    if(pose==='listening')frame=5;
    if(pose==='waiting')frame=6;
    if(pose==='waiting-seated')frame=8;
    if(pose==='curled')frame=9;
    if(pose==='dancing')frame=10+(Math.floor(phase*3)%2);
    const musicPlace=a.room==='music'&&!moving?place(a,'music'):null;
    const workPlace=a.room==='workshop'&&(!moving||boarding)?place(a,'workshop'):null;
    const sleepPlace=a.room==='dorm'&&!moving?place(a,'dorm'):null;
    const mailPlace=a.room==='mail'&&!moving?place(a,'mail'):null;
    if(mailPlace&&['waiting','waiting-seated','curled'].includes(pose)){
      frame=mailPlace.render.frame;
      if([12,16].includes(frame)&&!still&&phase%6.2>5.75)frame++;
    }
    if(sleepPlace&&pose==='sleeping')frame=sleepPlace.render.frame;
    if(workPlace&&pose==='working')frame=workPlace.render.frames[still?0:Math.floor(phase*3)%2];
    if(musicPlace&&(pose==='listening'||pose==='waiting-seated'&&musicPlace.render.layout)){
      frame=musicPlace.render.frame;
      if([12,16,18].includes(frame)&&!still&&phase%6.2>5.75)frame++;
    }
    const width=musicPlace?musicPlace.render.width:workPlace?workPlace.render.width:mailPlace?mailPlace.render.width:sleepPlace?(pose==='sleeping'?sleepPlace.render.sleepWidth||sleepPlace.render.width:sleepPlace.render.width):pose==='sleeping'?100:pose==='hopping'?88:90,height=width*4/3;
    const bob=still?0:stationHop&&a.room!=='workshop'?-(a.hopLift||0):pose==='hopping'?-Math.abs(Math.sin(phase*13))*6:pose==='dancing'?-Math.abs(Math.sin(phase*8))*2:musicPlace||workPlace||sleepPlace||mailPlace?0:pose==='sleeping'||pose==='curled'?Math.sin(phase*1.5)*.7:Math.sin(phase*2)*.8;
    const arrival=still?0:a.arrival/.4,settleOffset=musicPlace&&pose!=='dancing'?-5*arrival*arrival:0;
    const unknown=a.state==='unknown'||a.state==='interrupted';
    ctx.save();ctx.translate(Math.round(a.x),Math.round(a.y+bob+settleOffset));
    if(a.room!=='workshop'&&a.room!=='dorm'&&a.room!=='mail'&&(!musicPlace||['dance','rug','cushion'].includes(musicPlace.type))){ctx.fillStyle='#100c0744';ctx.beginPath();ctx.ellipse(0,-2,width*.27,4,0,0,Math.PI*2);ctx.fill();}
    if(a.id===selected&&!workPlace&&a.room!=='workshop'&&a.room!=='dorm'&&a.room!=='mail'){ctx.strokeStyle=a.apron;ctx.lineWidth=2.5;ctx.beginPath();ctx.ellipse(0,0,width*.42,8,0,0,Math.PI*2);ctx.stroke();}
    ctx.restore();
    const sleepAngle=(sleepDetail?.sleepAngle||0)*Math.PI/180;
    const corners=[[-width/2,-height],[width/2,-height],[-width/2,0],[width/2,0]].map(([x,y])=>[(x*Math.cos(sleepAngle)-y*Math.sin(sleepAngle))*(sleepDetail?.sleepFacing??a.facing),x*Math.sin(sleepAngle)+y*Math.cos(sleepAngle)]);
    const minX=Math.min(...corners.map(p=>p[0])),maxX=Math.max(...corners.map(p=>p[0])),minY=Math.min(...corners.map(p=>p[1])),maxY=Math.max(...corners.map(p=>p[1]));
    const hopPadding=stationHop?Math.ceil(a.hopLift||0):0;
    const left=Math.floor(a.x+minX-14),top=Math.floor(a.y+minY-14-hopPadding),layerWidth=Math.ceil(maxX-minX+28),layerHeight=Math.ceil(maxY-minY+35+hopPadding),inMusic=a.room==='music',inWorkshop=a.room==='workshop',inDorm=a.room==='dorm',inMail=a.room==='mail',layered=inMusic||inWorkshop||inDorm||inMail;
    const spriteContext=layered?actorContext:ctx;
    if(layered){actorLayer.width=layerWidth;actorLayer.height=layerHeight;actorContext.imageSmoothingEnabled=false;actorContext.translate(-left,-top);}
    if(inWorkshop||inDorm&&(!sleepPlace||sleepPlace.type==='rug')){actorContext.fillStyle='#100c0744';actorContext.beginPath();actorContext.ellipse(Math.round(a.x),Math.round(a.y+bob+settleOffset)-2,width*.27,4,0,0,Math.PI*2);actorContext.fill();}
    if((inWorkshop||inDorm)&&a.id===selected&&!workPlace&&!sleepPlace){actorContext.strokeStyle=a.apron;actorContext.lineWidth=2.5;actorContext.beginPath();actorContext.ellipse(Math.round(a.x),Math.round(a.y+bob+settleOffset),width*.42,8,0,0,Math.PI*2);actorContext.stroke();}
    spriteContext.save();spriteContext.translate(Math.round(a.x),Math.round(a.y+bob+settleOffset));
    spriteContext.globalAlpha=(unknown||a.liveUncertain)?.6:1;if(pose==='dancing'&&!still)spriteContext.rotate(Math.sin(phase*5)*.035);spriteContext.scale(sleepDetail?.sleepFacing??a.facing,1);
    if(sleepAngle)spriteContext.rotate(sleepAngle);
    if(musicPlace&&pose==='listening'&&!still)spriteContext.scale(1,1+Math.sin(phase*1.6)*.003);
    if(sleepPlace&&pose==='sleeping'&&!still)spriteContext.scale(1,1+Math.sin(phase*1.5)*.007);
    if(sleepDetail?.sleepClip){
      spriteContext.beginPath();
      sleepDetail.sleepClip.forEach(([x,y],i)=>{const px=(x/96-.5)*width,py=(y/128-1)*height;if(i)spriteContext.lineTo(px,py);else spriteContext.moveTo(px,py);});
      spriteContext.closePath();spriteContext.clip();
    }
    spriteContext.drawImage(tintedAtlas(a.apron),frame*spriteWidth,0,spriteWidth,spriteHeight,-width/2,-height,width,height);spriteContext.restore();
    if(moving&&!stationHop)travellingFurnitureFront(a,actorContext);
    if(inMusic){
      const seated=musicPlace&&['chair','bench'].includes(musicPlace.type)&&['listening','waiting-seated'].includes(pose);
      const band=seated?{left,top:Math.round(a.y+bob+settleOffset)-height+height*94/128,width:layerWidth,height:height*18/128}:null;
      // A near arm or rear-facing backrest follows the real furniture outline.
      // Front-edge chairs keep their dangling legs in front of the upholstery.
      if(seated&&musicPlace.render.frontOverSeated)furnitureFront(a,actorContext,null);
      else if(!(seated&&musicPlace.type==='chair'))furnitureFront(a,actorContext,band);
      ctx.drawImage(actorLayer,left,top);
    }
    if(inWorkshop){
      if(!workPlace)workshopFurnitureFront(a,actorContext);
      else if(['behind-island','behind-stump'].includes(workPlace.render.side)){
        workshopFurnitureFront(a,actorContext,workPlace.render.side==='behind-stump'?'Carving stump':'Assembly island');
        if(pose==='working')drawWorkingHands(a,frame,width,height);
      }
      if(workPlace)workshopLampFront(a,actorContext);
      ctx.drawImage(actorLayer,left,top);
    }
    if(inDorm){sleepingFurnitureFront(a,actorContext,sleepPlace||stationHop?a.id:null);ctx.drawImage(actorLayer,left,top);}
    if(inMail){
      // Only the seat's designated near furniture covers a seated bunny.
      // Travellers pass behind the chair's full silhouette.
      if(!mailPlace||mailPlace.render.frontOverSeated!==false)mailFurnitureFront(a,actorContext,mailPlace||stationHop?a.id:null);
      ctx.drawImage(actorLayer,left,top);
    }
    const attention=a.liveUncertain||['approval','input','finished','unknown','interrupted','question'].includes(a.state);
    if(!attention&&a.id!==selected&&a.id!==hovered&&!showSpots)return;
    let mark=a.liveUncertain?'?':['approval','input'].includes(a.state)?'!':a.state==='question'?'?':unknown?'?':a.state==='finished'?'✉':String(a.id+1);
    const badgeY=sleepDetail?.badgeOffset!==undefined?a.y+sleepDetail.badgeOffset*H/1173:a.y-height+(['sleeping','curled'].includes(pose)?height*.58:3)+bob;
    ctx.save();ctx.font='600 19px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillStyle=['approval','input','finished'].includes(a.state)?'#ecd19a':'#292515';ctx.strokeStyle='#dfcfaa';ctx.lineWidth=1.4;
    ctx.beginPath();ctx.arc(a.x-24,badgeY,13,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle=['approval','input','finished'].includes(a.state)?'#2a2010':'#f6e6c7';ctx.fillText(mark,a.x-24,badgeY+.5);
    if((a.id===selected||a.id===hovered)&&!workshopFocus&&!dormFocus&&!mailFocus){
      const text=`${a.name} · ${labels[a.state]}`;ctx.font='500 19px system-ui';const tw=ctx.measureText(text).width+24;
      const xx=Math.max(8,Math.min(W-tw-8,a.x-tw/2)),yy=badgeY-44;
      ctx.fillStyle='#1c170ff2';ctx.strokeStyle='#bc9e69';roundRect(xx,yy,tw,30,8);ctx.fill();ctx.stroke();ctx.fillStyle='#fff0cf';ctx.fillText(text,xx+tw/2,yy+16);
    }
    ctx.restore();
  }
  const candles=[[134,280],[271,242],[442,226],[578,215],[610,402],[722,246],[803,216],[924,221],[1163,252],[1279,346],[751,379],[1111,364],[1111,463],[131,677],[310,714],[482,715],[510,678],[101,810],[811,666],[1108,655],[1284,719],[803,756],[741,880]].map(([x,y])=>[x*W/1341,y*H/1173]);
  const recordCenter={x:393*W/1341,y:715*H/1173};
  function draw(){
    canvas.dataset.ready=String(ready);canvas.dataset.frames=String(frameCount);
    if(!ready)return;
    ctx.clearRect(0,0,canvas.width,canvas.height);ctx.save();const view=camera();ctx.scale(canvas.width/view.width,canvas.height/view.height);ctx.translate(-view.x,-view.y);ctx.imageSmoothingEnabled=false;ctx.drawImage(background,0,0,W,H);
    drawWorkPlatforms();
    if(showSpots){
      ctx.save();ctx.font='500 19px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
      for(const [roomId,room] of Object.entries(rooms))room.seats.forEach(([x,y],id)=>{
        const occupied=agents[id].room===roomId&&!agents[id].route.length;
        ctx.fillStyle=id===selected?'#d5dda52e':'#21180f88';ctx.strokeStyle=id===selected?'#d5dda5':'#dcc590b0';ctx.lineWidth=1.7;
        ctx.beginPath();ctx.ellipse(x,y+9,36,13,0,0,Math.PI*2);ctx.fill();ctx.stroke();
        if(!occupied){ctx.fillStyle='#fff0cf';ctx.fillText(String(id+1),x,y+9);}
      });ctx.restore();
    }
    if(!paused())for(let i=0;i<candles.length;i++){
      const [x,y]=candles[i],f=.5+.25*Math.sin(clock*4.1+i*2)+.16*Math.sin(clock*9.3+i);
      const g=ctx.createRadialGradient(x,y,0,x,y,33);g.addColorStop(0,`rgba(255,181,67,${.06+f*.05})`);g.addColorStop(1,'rgba(255,181,67,0)');ctx.fillStyle=g;ctx.fillRect(x-33,y-33,66,66);

    }
    if(music){
      ctx.save();ctx.translate(recordCenter.x,recordCenter.y);ctx.scale(1,.26);ctx.rotate(paused()?0:clock*2);ctx.strokeStyle='#d0b97d';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,12,-.5,.8);ctx.stroke();ctx.restore();
      if(!paused()){ctx.font='24px Georgia';ctx.fillStyle='#f2d18d';for(let i=0;i<3;i++){const p=(clock*.32+i/3)%1;ctx.globalAlpha=Math.sin(p*Math.PI)*.85;ctx.fillText(i%2?'♪':'♫',recordCenter.x+11+Math.sin(p*6+i)*12,recordCenter.y-12-p*52);}ctx.globalAlpha=1;}
    }
    agents.slice().sort((a,b)=>a.y-b.y).forEach(drawActor);ctx.restore();frameCount++;
  }
  function loop(now){
    if(disposed)return;
    if(document.hidden){previous=0;frameId=requestAnimationFrame(loop);return;}
    const dt=previous?Math.min((now-previous)/1000,.05):0;previous=now;
    // Reconcile on the next frame as well as the media-query event: a media
    // preference can become visible before its change callback is delivered.
    if(paused()&&agents.some(a=>a.route.length&&!a.liveUncertain)){agents.forEach(a=>{if(!a.liveUncertain)settle(a,a.targetRoom);});refreshControls();}
    if(!document.hidden&&!paused()){
      clock+=dt;let changed=false;for(const a of agents)if(!a.liveUncertain)changed=step(a,dt)||changed;if(changed)refreshControls();
      if(now-lastDraw>1000/24){draw();lastDraw=now;}
    }else if(dirty){draw();dirty=false;}
    frameId=requestAnimationFrame(loop);
  }
  listen(document,'visibilitychange',()=>{previous=0;dirty=true;if(document.hidden)cancelDemo();});
  function cancelDemo(){if(demoAbort)demoAbort.abort();demoAbort=null;$('demo-cursor').style.display='none';root.querySelectorAll('.demo-target').forEach(el=>el.classList.remove('demo-target'));$('demo-step').textContent='';$('demo').textContent='Play scripted demo';}
  listen(document,'pointerdown',e=>{if(e.isTrusted){if(demoAbort&&e.target.closest('#demo'))skipDemoClick=true;cancelDemo();}},true);
  listen(document,'keydown',e=>{if(e.isTrusted){if(demoAbort&&e.target.closest('#demo')&&['Enter',' '].includes(e.key))skipDemoClick=true;cancelDemo();}},true);
  listen(document,'input',e=>{if(e.isTrusted)cancelDemo();},true);
  function delay(ms,signal){return new Promise((resolve,reject)=>{if(signal.aborted){reject(new Error('cancelled'));return;}const onAbort=()=>{clearTimeout(timer);reject(new Error('cancelled'));};const timer=setTimeout(()=>{signal.removeEventListener('abort',onAbort);resolve();},ms);signal.addEventListener('abort',onAbort,{once:true});});}
  async function demo(){
    if(demoAbort){cancelDemo();return;}
    focusMusic(false);
    const abort=new AbortController();demoAbort=abort;$('demo').textContent='Stop demo';
    const steps=[['mixed','A mixed day in the burrow',1800],['all-work','All ten agents start working',6200],['music','Music starts; working bunnies keep working',1800],['all-idle','The agents become idle and head to the music room',9000],['music','Pause music; idle bunnies return to their beds',8000],['all-wait','Requests for approval bring everyone to the mailroom',8000],['mixed','Return to a mixed day',5000]];
    try{
      for(const [id,text,hold] of steps){
        if(abort.signal.aborted)break;const el=$(id),r=el.getBoundingClientRect(),cursor=$('demo-cursor');
        $('demo-step').textContent=`Scripted demo: ${text}`;el.classList.add('demo-target');cursor.style.display='block';cursor.style.left=`${r.left+r.width*.55}px`;cursor.style.top=`${r.top+r.height*.5}px`;
        await delay(700,abort.signal);
        const pulse=document.createElement('div');pulse.className='click-pulse';pulse.style.left=cursor.style.left;pulse.style.top=cursor.style.top;document.body.append(pulse);setTimeout(()=>pulse.remove(),650);
        el.click();await delay(700,abort.signal);el.classList.remove('demo-target');await delay(hold,abort.signal);
      }
    }catch(_error){if(!abort.signal.aborted)$('demo-step').textContent='Demo stopped.';}finally{if(demoAbort===abort)cancelDemo();}
  }
  listen($('demo'),'click',()=>{if(skipDemoClick){skipDemoClick=false;return;}void demo();});
  function loaded(image){return image.complete&&image.naturalWidth?Promise.resolve():new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('The habitat artwork could not be loaded.'));});}
  Promise.all([loaded(background),loaded(sprites),loaded(workPlatform),loaded(frontPlatform)]).then(()=>{
    if(disposed){finishReady(false);return;}
    const original=document.createElement('canvas');original.width=sprites.naturalWidth;original.height=sprites.naturalHeight;
    const originalContext=original.getContext('2d',{willReadFrequently:true});originalContext.drawImage(sprites,0,0);sourcePixels=originalContext.getImageData(0,0,original.width,original.height);
    agents.forEach(a=>settle(a,roomFor(a,music)));ready=true;$('loading').hidden=true;refreshControls();draw();frameId=requestAnimationFrame(loop);finishReady(true);
  }).catch(()=>{if(!disposed){$('loading').textContent='The habitat artwork could not be loaded.';callbacks.unavailable?.();}finishReady(false);});
  function setLiveUncertainty(a,uncertain){
    if(uncertain&&!a.liveUncertain){
      // A frozen resident keeps its route, but cannot hold the doorway for
      // everyone else. Recovery will queue its tunnel node again.
      leaveTunnelQueue(a.id);if(a.route[0]?.kind==='tunnel')a.route[0].queued=false;
    }
    a.liveUncertain=uncertain;
  }
  const demoIdentities=agents.map(a=>({name:a.name,client:a.client,state:a.state}));
  const liveView={
    select,
    refresh:refreshControls,
    apply(id,data){
      const a=agents[id];if(!a)return;const changed=a.state!==data.state,wasUncertain=a.liveUncertain;
      a.liveResident=true;a.liveBound=true;setLiveUncertainty(a,!!data.uncertain);a.name=data.name;a.client=data.client;
      a.state=data.state;
      if(!a.liveUncertain&&(changed||wasUncertain||!a.liveApplied)){plan(a);a.liveApplied=true;}
      $('demo').disabled=true;refreshControls();
    },
    uncertain(id){const a=agents[id];if(a){a.liveResident=true;a.liveBound=true;setLiveUncertainty(a,true);refreshControls();}},
    unassigned(id){const a=agents[id];if(!a)return;const changed=!a.liveResident||a.liveBound||a.state!=='idle';a.liveResident=true;a.liveBound=false;setLiveUncertainty(a,false);a.liveApplied=false;a.name=demoIdentities[id].name;a.client='Unassigned';a.state='idle';if(changed)plan(a);$('demo').disabled=true;refreshControls();},
    unbind(id){const a=agents[id];if(!a||!a.liveResident&&!a.liveBound)return;Object.assign(a,demoIdentities[id]);a.liveResident=false;a.liveBound=false;a.liveUncertain=false;a.liveApplied=false;plan(a);$('demo').disabled=agents.some(a=>a.liveResident||a.liveBound);refreshControls();},
  };
  // Local inspection supports the typed host controller and geometry checks.
  const prototype={snapshot:()=>({ready,music,musicFocus,workshopFocus,dormFocus,mailFocus,showSpots,storageAvailable,rooms:Object.entries(rooms).map(([id,room])=>({id,name:room.name,seats:room.seats,spots:room.spots})),paused:paused(),reducedMotion:reduced.matches,selected,editingRoom:editingRoom(),frameCount,demoPlaying:!!demoAbort,agents:agents.map(a=>({id:a.id,name:a.name,apron:a.apron,liveResident:!!a.liveResident,liveBound:!!a.liveBound,liveUncertain:!!a.liveUncertain,state:a.state,room:a.room,targetRoom:a.targetRoom,moving:!!a.route.length,hidden:a.hidden,x:a.x,y:a.y,arrival:a.arrival,onStation:!!a.onStation,hopLift:a.hopLift||0,hopProgress:a.route[0]?.elapsed&&a.route[0]?.duration?a.route[0].elapsed/a.route[0].duration:0,movement:a.route[0]?.kind||'resting',route:a.route.map(p=>({x:p.x,y:p.y,kind:p.kind,room:p.room,stepIndex:p.stepIndex})),enteredAt:a.enteredAt,facing:a.facing,spot:place(a,a.targetRoom),bounds:bodyBoundsFor(a,a.room,music),pose:a.route.length?'hopping':poseFor(a,a.room,music)}))})};

  return {...liveView,snapshot:prototype.snapshot,ready:loadedReady,destroy(){disposed=true;cancelDemo();controller.abort();cancelAnimationFrame(frameId);for(const img of [background,sprites,workPlatform,frontPlatform]){img.onload=null;img.onerror=null;}finishReady(false);}};
}
