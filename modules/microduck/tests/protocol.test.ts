import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseState} from '../src/protocol.js';
const state = {head:[0,0,.1,0],targets:Array<number>(15).fill(.02),joints:Array<number>(15).fill(.019),t:1,
  loop:{hz:50},policy:'walk',move:{requested:[0,0,0],applied:[0,0,0]},safety:{fallen:false,limp:false,picked_up:false}};
const wire = (token: string): string => JSON.stringify({jsonrpc:'2.0',method:'robot.state',params:state}).replace('"params":{','"params":{"t_ns":'+token+',');
void test('state preserves the original unsigned sensor token beyond Number precision',()=>{
  const result=parseState(wire('9007199254740993'),'fixture-one');
  assert.equal(result.sensorNs,'9007199254740993');assert.deepEqual(result.head,[0,0,.1,0]);
  assert.deepEqual(result.backend,{kind:'vendor-mujoco',apiVersion:47,daemonVersion:'0.18.3',revision:'b2b0d213a402caeac492dd662ea891faa17f67c0'});
  assert.deepEqual(result.syntheticJointIndices,[9]);assert.equal(result.session,'fixture-one');assert.equal(result.healthy,true);assert.equal(result.zeroVelocity,true);
});
void test('malformed vectors, unsafe timestamps and synthetic shapes cannot become source evidence',()=>{
  for(const token of ['0','-1','1.5','1e9','"123"','18446744073709551616'])assert.throws(()=>parseState(wire(token),'fixture-one'));
  for(const line of [wire('123').replace('"head":[0,0,0.1,0]','"head":[0]'),wire('123').replace('"hz":50','"hz":1e999'),wire('123').replace('"robot.state"','"other"')])assert.throws(()=>parseState(line,'fixture-one'));
});
