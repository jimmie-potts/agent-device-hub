import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createModel} from '../src/habitat/model.js';
const model=createModel();import {createNavigation} from '../src/habitat/navigation.js';
const navigation=createNavigation();
const {rooms}=model,{create}=navigation;
test('sleeping room has clear floor entry and exit routes for all ten resting places',()=>{
 const nav=create(rooms,'dorm'),door=nav.art(rooms.dorm.portal);
 for(let id=0;id<10;id++)for(const [from,to] of [[door,nav.docks[id]],[nav.docks[id],door]]){
  const path=nav.path(from,to);assert.deepEqual(path[0],from);assert.deepEqual(path.at(-1),to);
  for(let i=1;i<path.length;i++)assert(nav.segment(path[i-1],path[i]),`resident ${id+1} floor segment stays outside furniture`);
 }
});
test('music and mail have bidirectional furniture-free aisle routes for every resident',()=>{
 for(const room of ['music','mail']){const nav=create(rooms,room),door=nav.art(rooms[room].portal);
  for(let id=0;id<10;id++)for(const [from,to] of [[door,nav.docks[id]],[nav.docks[id],door]]){const path=nav.path(from,to);for(let i=1;i<path.length;i++)assert(nav.segment(path[i-1],path[i]),`${room} resident ${id+1}`);}
 }
});
test('boarding paths preserve saved resting positions and upper bunks use short ladder hops',()=>{
 const saved=structuredClone(rooms);
 for(const room of ['dorm','music','mail']){const nav=create(rooms,room);for(let id=0;id<10;id++){
  const path=nav.stationPath(id);assert.deepEqual(path[0],nav.dock(id));assert.deepEqual(path.at(-1),rooms[room].seats[id]);
  for(let i=1;i<path.length;i++){const a=nav.art(path[i-1]),b=nav.art(path[i]);assert(Math.hypot(a[0]-b[0],a[1]-b[1])<110,`${room} resident ${id+1} boarding hop length`);}
  if(room==='dorm'&&[0,2].includes(id))assert(path.length>=4,'upper bunk uses ladder steps');
 }}assert.deepEqual(rooms,saved);
});
test('new rooms reject blocked floor endpoints and can replan mid-aisle',()=>{
 for(const room of ['dorm','music','mail']){const nav=create(rooms,room),door=nav.art(rooms[room].portal);
  const blocked=room==='dorm'?[1035,520]:room==='music'?[290,935]:[1000,965];assert.throws(()=>nav.path(door,blocked),/endpoint/);
  for(const dock of nav.docks){const p=nav.path(door,dock);for(let i=1;i<p.length;i++){const mid=p[i].map((v,j)=>(v+p[i-1][j])/2);for(const target of [door,dock]){const reverse=nav.path(mid,target);for(let j=1;j<reverse.length;j++)assert(nav.segment(reverse[j-1],reverse[j]));}}}
 }
});
test('mail routes avoid the basket of rolled letters beside the green chair',()=>{
 const nav=create(rooms,'mail');assert.equal(nav.clear([817,854]),false);
});
test('swept walking segments reject corner grazes between sampling points',()=>{
 assert.equal(create(rooms,'dorm').segment([1164,456],[1020,440]),false);
 assert.equal(create(rooms,'mail').segment([836,944],[868,904]),false);
});
