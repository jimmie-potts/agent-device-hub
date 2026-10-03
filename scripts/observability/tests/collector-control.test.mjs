import assert from 'node:assert/strict';
import {test} from 'node:test';
import {collectorCommand,readCollectorState} from '../collector-control.mjs';

test('Collector effects require an exact positive PID and start time; no general commands',()=>{
  const identity={pid:42,startTicks:'12345'};
  for(const action of ['pause','resume','terminate']) {
    assert.deepEqual(collectorCommand(action,identity).slice(-3),[action,'42','12345']);
    for(const bad of [undefined,{pid:1,startTicks:'12345'},{pid:-42,startTicks:'12345'},
      {pid:42,startTicks:'0'},{pid:42,startTicks:'1; kill -1'},{...identity,other:true}])
      assert.throws(()=>collectorCommand(action,bad));
  }
  assert.throws(()=>collectorCommand('restart',identity));
  assert.throws(()=>collectorCommand('inspect',identity));
  assert.deepEqual(collectorCommand('inspect').slice(-3),['inspect','0','0']);
});

test('Collector readback accepts only bounded neutral process identity or absence',()=>{
  assert.deepEqual(readCollectorState('42 12345 S\n'),{present:true,pid:42,startTicks:'12345',state:'S'});
  assert.deepEqual(readCollectorState('absent\n'),{present:false});
  for(const bad of ['','1 12345 S\n','42 0 T\n','42 12345 Z\n','42 12345 S\n43 44 S\n',
    'SYNTHETIC_PRIVATE_CANARY','42 12345 S\nprivate']) assert.throws(()=>readCollectorState(bad),
      error=>!error.message.includes('SYNTHETIC_PRIVATE_CANARY'));
});
