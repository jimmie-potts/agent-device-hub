import assert from 'node:assert/strict';
import test from 'node:test';
import type {LightingLayout} from '@jimmie-potts/event-contracts/v2/families';
import type {RoomAnchor} from '../../src/room-model.ts';
import {roomBinding,roomObservation} from '../src/room-bindings.ts';
import {device} from './devices.test.ts';
const anchor:RoomAnchor={id:'a',label:'Desk lamp',position:[0,1,0],group:'fixture-a',deviceId:'wall',owner:'bunny/modules/nanoleaf'};
const layout:LightingLayout={rooms:[{id:'studio',name:'Studio'}],assignments:[{room:'studio',device:'wall'}],groups:[],home:null};
const light={record:device,owner:'bunny/modules/nanoleaf',live:true};
void test('room selection requires current membership and one exact configured owner',()=>{
  const bound=roomBinding(anchor,'studio',layout,[light],true);assert.ok('card' in bound);assert.deepEqual(bound.card.members,['wall']);assert.equal(bound.card.name,'Desk lamp');
  for(const result of [roomBinding(anchor,'studio',layout,[light],false),roomBinding(anchor,'elsewhere',layout,[light],true),
    roomBinding(anchor,'studio',{...layout,assignments:[]},[light],true),roomBinding(anchor,'studio',layout,[light,light],true),
    roomBinding({...anchor,owner:'bunny/modules/other'},'studio',layout,[light],true),roomBinding({...anchor,deviceId:null,owner:null},'studio',layout,[light],true)])assert.ok('reason' in result);
});
void test('model telemetry uses reported power only and discards stale or unavailable copies',()=>{
  const bind=(live=true,availability=light.record.availability)=>roomBinding(anchor,'studio',layout,[{...light,live,record:{...device,availability,observed:{status:'known',observedAtMs:1,power:{status:'known',value:false},brightness:{status:'known',value:42}}}}],true);
  assert.equal(roomObservation(bind()).power,false,'desired on is never presented as reported on');
  assert.equal(roomObservation(bind(false)).power,undefined);assert.equal(roomObservation(bind(true,'unavailable')).power,undefined);
  assert.equal(roomObservation(roomBinding(anchor,'studio',layout,[light],true)).power,undefined);
});
