import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createModel} from '../src/habitat/model.js';
const model=createModel();import {createNavigation} from '../src/habitat/navigation.js';
const navigation=createNavigation();
const {rooms,workshopApproach}=model;
const nav=navigation.create(rooms),door=[674,385];
test('regression: old waypoint route intersects actual workshop furniture',()=>{
  const old=[door,...workshopApproach(9).map(nav.art)];
  assert(old.some((p,i)=>i&& !nav.segment(old[i-1],p)));
});
test('all ten entry and exit paths keep feet and clearance outside furniture',()=>{
  for(let id=0;id<10;id++)for(const [from,to] of [[door,nav.docks[id]],[nav.docks[id],door]]){
    const route=nav.path(from,to);assert.deepEqual(route[0],from);assert.deepEqual(route.at(-1),to);
    for(let i=1;i<route.length;i++)assert(nav.segment(route[i-1],route[i]),`resident ${id}, segment ${i}`);
  }
});
test('replanning from every midpoint never reverses through a desk',()=>{
  for(let id=0;id<10;id++){const route=nav.path(door,nav.docks[id]);for(let i=1;i<route.length;i++){
    const middle=route[i].map((v,j)=>(v+route[i-1][j])/2);
    for(const to of [door,nav.docks[id]]){const next=nav.path(middle,to);for(let k=1;k<next.length;k++)assert(nav.segment(next[k-1],next[k]));}
  }}
});
test('obstructed walking endpoints fail instead of falling back to straight lines',()=>{
  assert.throws(()=>nav.path(door,[400,470]),/endpoint/);
});
test('saved small station nudges retain a reachable floor boarding point',()=>{
  for(const offset of [[-6,-6],[6,6],[12,-3]]){const adjusted=structuredClone(rooms);for(const s of adjusted.workshop.spots){s.position[0]+=offset[0]*1600/1341;s.position[1]+=offset[1]*1400/1173;}
    const n=navigation.create(adjusted);for(const dock of n.docks){const route=n.path(door,dock);for(let i=1;i<route.length;i++)assert(n.segment(route[i-1],route[i]));}}
});
