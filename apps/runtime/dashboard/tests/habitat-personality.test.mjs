import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createModel} from '../src/habitat/model.js';
const model=createModel();
const {rooms,poseFor}=model;

test('each room offers ten named places in an irregular layout instead of two fixed rows',()=>{
  for(const [id,room] of Object.entries(rooms)){
    assert.equal(room.spots?.length,10,`${id}: ten individually described places`);
    assert.equal(new Set(room.spots.map(s=>s.label)).size,10,`${id}: ten distinct spot names`);
    assert(new Set(room.seats.map(p=>p[1])).size>=6,`${id}: places spread across at least six depths`);
    assert(new Set(room.spots.map(s=>s.type)).size>=3,`${id}: varied furniture and resting places`);
  }
});

test('music has two beanbags, three chairs, a curled rug place, and two dance places',()=>{
  const types=rooms.music.spots?.map(s=>s.type)||[];
  const count=type=>types.filter(t=>t===type).length;
  assert.equal(count('beanbag'),2);
  assert.equal(count('chair'),3);
  assert.equal(count('rug'),1);
  assert.equal(count('dance'),2);
  assert.equal(count('bench'),1);
  assert.equal(count('cushion'),1);
  assert.equal(types.length,10);
});

test('an idle music listener dances or curls up according to its assigned place',()=>{
  const dance=rooms.music.spots?.findIndex(s=>s.type==='dance')??0;
  const rug=rooms.music.spots?.findIndex(s=>s.type==='rug')??0;
  assert.equal(poseFor({id:dance,state:'idle'},'music',true),'dancing');
  assert.equal(poseFor({id:rug,state:'idle'},'music',true),'curled');
  assert.equal(poseFor({id:dance,state:'working'},'workshop',true),'working');
});
