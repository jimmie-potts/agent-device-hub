import assert from 'node:assert/strict';
import test from 'node:test';
import {known, unknown, type PresenceObservation} from '@jimmie-potts/presence-pro/contracts';
import {apartmentPresence,combinedApartmentPoint} from '../src/apartment-presence.ts';
import type {RuntimeCopy} from '../src/runtime-feeds.ts';
import {furnishedFixture} from './apartment-fixture.ts';

const model=furnishedFixture({id:'a'.repeat(64),width:1,height:1,bytes:70});
export const presenceRecord=(id='presence-a'):PresenceObservation=>({
  id,sensorId:id,revision:1,roomId:'studio',mappingRevision:8,connection:'connected',reason:'none',
  occupancy:{value:'occupied',receivedAtMs:known(1000)},zones:[],held:{value:known(false),receivedAtMs:known(1100)},
  targets:[{slot:1,active:{value:known(true),receivedAtMs:known(1200)},rawMm:{x:known(1000),y:known(2000),xReceivedAtMs:known(1300),yReceivedAtMs:known(1400)},
    apartmentMeters:known({x:4,z:2}),calibrationRevision:known(17)}],
});
const copy=(records:PresenceObservation[],synced=true):RuntimeCopy=>({owner:'bunny/modules/presence-pro',family:'presence-observation',synced,records});
const project=(records:PresenceObservation[],synced=true,connected=true)=>apartmentPresence(model,[copy(records,synced)],connected);

void test('room aggregation uses explicit contributions, keeps disagreements, and never derives occupancy from a point',()=>{
  const a=presenceRecord(),b={...presenceRecord('presence-b'),occupancy:{value:'vacant' as const,receivedAtMs:known(2000)},zones:[{id:'reading-zone',roomId:'reading',value:'occupied' as const,receivedAtMs:known(2100)}]};
  const view=project([a,b]);
  assert.equal(view.rooms.get('studio')?.value,'occupied');
  assert.equal(view.rooms.get('studio')?.disagreement,true);
  assert.equal(view.rooms.get('studio')?.contributors.length,2);
  assert.equal(view.rooms.get('reading')?.value,'occupied');
  assert.equal(view.points.length,2,'same slot numbers and overlapping positions stay separate');
  assert.notEqual(view.points[0]?.id,view.points[1]?.id);
  const pointOnly=project([{...a,occupancy:{...a.occupancy,value:'unknown'}}]);
  assert.equal(pointOnly.points.length,1);assert.equal(pointOnly.rooms.get('studio')?.value,'unknown');
  assert.equal(project([{...b,zones:[]}]).rooms.get('studio')?.value,'vacant');
  assert.equal(project([b,{...a,occupancy:{...a.occupancy,value:'unknown'}}]).rooms.get('studio')?.value,'unknown');
});

void test('SDK loss and sensor loss make usable evidence unknown and preserve only labelled last-known text',()=>{
  const a=presenceRecord();
  for(const view of [project([a],false),project([a],true,false)]){
    assert.equal(view.points.length,0);assert.equal(view.rooms.get('studio')?.value,'unknown');
    assert.equal(view.sensors[0]?.current,false);assert.equal(view.sensors[0]?.record.occupancy.receivedAtMs.status,'known');
  }
  const view=project([a,{...presenceRecord('presence-b'),connection:'disconnected',reason:'unavailable',occupancy:{value:'unknown',receivedAtMs:unknown()},targets:[]}]);
  assert.equal(view.points.length,1);assert.equal(view.rooms.get('studio')?.value,'occupied');
  assert.equal(view.rooms.get('studio')?.contributors.filter(item=>item.value==='unknown').length,1);
  assert.equal(project([{...a,connection:'starting',targets:[]}]).rooms.get('studio')?.value,'unknown');
  assert.equal(project([]).sensors.length,0);
  assert.equal(apartmentPresence(model,[{...copy([a]),owner:'bunny/modules/other'}],true).sensors.length,0);
});

void test('approximate positions use producer meters, preserve hold and independent receipts, and have no age or revision-equivalence gate',()=>{
  const a=presenceRecord(),target=a.targets[0];assert.ok(target!==undefined);
  const point=project([a]).points[0];assert.ok(point!==undefined);
  assert.deepEqual(point.position,[4,.04,2]);assert.equal(point.held,false);
  assert.equal(project([{...a,held:{value:known(true),receivedAtMs:known(9)}}]).points[0]?.held,true);
  assert.equal(project([{...a,held:{value:unknown(),receivedAtMs:unknown()}}]).points[0]?.held,undefined);
  assert.equal(project([{...a,mappingRevision:100,targets:[{...target,calibrationRevision:known(200)}]}]).points.length,1);
  assert.equal(project([a]).sensors[0]?.record.targets[0]?.rawMm.yReceivedAtMs.status,'known');
  for(const replacement of [
    {...target,apartmentMeters:unknown()}, {...target,calibrationRevision:unknown()},
    {...target,active:{value:known(false),receivedAtMs:known(1)}},
    {...target,apartmentMeters:known({x:NaN,z:2})},
  ])assert.equal(project([{...a,targets:[replacement]}]).points.length,0);
});

void test('point geometry is presentation only; boundaries, outside points and missing assignments do not pick a room',()=>{
  const a=presenceRecord(),target=a.targets[0];assert.ok(target!==undefined);
  const boundary={...a,targets:[{...target,apartmentMeters:known({x:4.5,z:2})}]};
  const view=project([boundary]);assert.equal(view.points.length,0);
  assert.equal(view.sensors[0]?.slots[0]?.reason,'Room boundary is ambiguous.');
  assert.equal(view.rooms.get('reading')?.value,'unknown');
  assert.equal(project([{...a,targets:[{...target,apartmentMeters:known({x:99,z:99})}]}]).points.length,0);
  const missing=project([{...a,roomId:'removed-room'}]);
  assert.equal(missing.rooms.get('studio')?.value,'unknown');
  assert.equal(missing.points.length,0,'an unlisted source mapping is not silently repaired by geometry');
  assert.equal(project([a]).rooms.get('reading')?.contributors.length,0);
});

function positioned(record:PresenceObservation,x:number,z=2):PresenceObservation {
  return {...record,targets:record.targets.map(target=>({...target,apartmentMeters:known({x,z})}))};
}

void test('compatible reports produce one midpoint and expiry leaves both source points intact',()=>{
  const a=positioned(presenceRecord(),3.5);
  const b=presenceRecord('presence-b');
  const view=project([a,b]);
  const combined=combinedApartmentPoint(model,view,1800);
  assert.ok(combined);
  assert.deepEqual(combined.position,[3.75,.04,2]);
  assert.equal(combined.roomId,'studio');
  assert.equal(combined.expiresAtMs,3800);
  assert.equal(combinedApartmentPoint(model,view,3800),undefined);
  assert.ok(combinedApartmentPoint(model,project([a,{...b,held:{...b.held,value:unknown()}}]),1800));
  assert.equal(view.points.length,2);
  assert.equal(view.rooms.get('studio')?.value,'occupied');
});

void test('distance, room, stale or held evidence and multiple candidates prevent a combined dot',()=>{
  const a=positioned(presenceRecord(),3.5);
  const b=presenceRecord('presence-b');
  const target=b.targets[0];assert.ok(target);
  const incompatible:PresenceObservation[]=[
    positioned(b,2.7),
    {...b,held:{...b.held,value:known(true)}},
    {...b,connection:'disconnected',targets:[]},
    {...b,targets:[target,{...target,slot:2}]},
    {...b,targets:[{...target,rawMm:{...target.rawMm,xReceivedAtMs:known(20)}}]},
    {...b,targets:[{...target,rawMm:{...target.rawMm,yReceivedAtMs:known(2000)}}]},
    {...b,targets:[{...target,rawMm:{...target.rawMm,yReceivedAtMs:unknown()}}]},
  ];
  for(const replacement of incompatible)assert.equal(combinedApartmentPoint(model,project([a,replacement]),1800),undefined);
  assert.equal(combinedApartmentPoint(model,project([a,b],false),1800),undefined);
  assert.equal(combinedApartmentPoint(model,project([a]),1800),undefined);
  assert.equal(combinedApartmentPoint(model,project([positioned(a,4.4),positioned(b,4.6)]),1800),undefined);
});

void test('the midpoint cannot map through a notch in the same room',()=>{
  const studio=model.rooms.find(room=>room.id==='studio');assert.ok(studio);
  const concave:typeof model={...model,rooms:[{...studio,footprint:[[0,0],[3,0],[3,3],[1.5,3],[1.5,1],[1.25,1],[1.25,3],[0,3]]}]};
  const points=[positioned(presenceRecord(),1.2),positioned(presenceRecord('presence-b'),1.55)];
  const view=apartmentPresence(concave,[copy(points)],true);
  assert.equal(view.points.length,2);
  assert.equal(combinedApartmentPoint(concave,view,1800),undefined);
});
