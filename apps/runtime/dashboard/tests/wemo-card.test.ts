import assert from 'node:assert/strict';
import test from 'node:test';
import {device} from './devices.test.ts';
import {wemoCardState} from '../src/wemo.ts';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
const record:DeviceRecord={...device,id:'desk-lamp',kind:'wemo',observed:{status:'known',observedAtMs:1000,power:{status:'known',value:false},brightness:{status:'unknown'}}};
void test('Wemo selection follows reported power rather than desired or accepted power',()=>{
  assert.equal(wemoCardState(record,true,true,true,false,2000).power,false);
  assert.equal(wemoCardState({...record,observed:{status:'unknown'}},true,true,true,false,2000).power,undefined);
  assert.equal(wemoCardState({...record,observed:{...record.observed,status:'known',observedAtMs:1000,power:{status:'unknown'},brightness:{status:'unknown'}}},true,true,true,false,2000).power,undefined);
});
void test('Wemo controls retain authority, freshness, capability, held and pending gates',()=>{
  assert.equal(wemoCardState(record,true,true,true,false,2000).disabled,false);
  for(const result of [
    wemoCardState(record,false,true,true,false,2000),wemoCardState(record,true,false,true,false,2000),
    wemoCardState(record,true,true,false,false,2000),wemoCardState(record,true,true,true,true,2000),
    wemoCardState(record,true,true,true,false,17000),
    wemoCardState({...record,availability:'unavailable'},true,true,true,false,2000),
    wemoCardState({...record,pending:1},true,true,true,false,2000),
    wemoCardState({...record,capabilities:{...record.capabilities,power:{supported:false}}},true,true,true,false,2000),
    wemoCardState({...record,externalControl:{status:'known',owner:'external',observedAtMs:1000}},true,true,true,false,2000),
    wemoCardState({...record,held:{requestId:'held',heldAtMs:1000}},true,true,true,false,2000),
  ])assert.equal(result.disabled,true);
  assert.equal(wemoCardState(record,false,true,true,false,2000).status,'Stale');
  assert.equal(wemoCardState({...record,availability:'unavailable'},true,true,true,false,2000).power,undefined);
});
