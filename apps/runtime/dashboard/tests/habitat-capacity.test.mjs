import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createModel} from '../src/habitat/model.js';
const model=createModel();
const {rooms,roomFor,bodyBoundsFor}=model;

test('the habitat has only the four selected rooms, each with ten spacious, distinct bunny places',()=>{
  assert.deepEqual(Object.keys(rooms).sort(),['dorm','mail','music','workshop']);
  for(const [name,room] of Object.entries(rooms)){
    assert.equal(room.seats.length,10,`${name}: ten places`);
    assert.equal(new Set(room.seats.map(p=>p.join(','))).size,10,`${name}: unique places`);
    for(let i=0;i<10;i++)for(let j=i+1;j<10;j++){
      const state=name==='workshop'?'working':name==='mail'?'approval':'idle';
      const a=bodyBoundsFor({id:i,state},name,true),b=bodyBoundsFor({id:j,state},name,true);
      assert(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top,`${name}: bunny ${i+1} and ${j+1} have visible-body clearance`);
    }
  }
});

test('unread turns wait in the mailroom now that the study is removed',()=>{
  assert.equal(roomFor({state:'finished'},false,'workshop'),'mail');
  assert.equal(roomFor({state:'finished'},true,'workshop'),'mail');
});
