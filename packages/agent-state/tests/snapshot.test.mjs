import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateSnapshot} from '../dist/index.js';
const fixtures=JSON.parse(readFileSync(new URL('../fixtures/snapshots-v1.json',import.meta.url),'utf8'));
fixtures.cases.push(...JSON.parse(readFileSync(new URL('../fixtures/snapshots-v1.2.json',import.meta.url),'utf8')).cases);
for(const entry of fixtures.cases)test(`snapshot contract: ${entry.id}`,()=>{
  const before=structuredClone(entry.input),result=validateSnapshot(entry.input);
  assert.equal(result.ok,entry.valid);assert.deepEqual(entry.input,before);
  if(result.ok){assert.deepEqual(result.value,entry.input);assert.notEqual(result.value,entry.input);}
  else assert.deepEqual(result,{ok:false,code:'invalid-state'});
});
test('snapshot validation does not invoke getters or serialize excluded errors',()=>{
  let reads=0;const value={};Object.defineProperty(value,'prompt',{enumerable:true,get(){reads++;throw new Error('PRIVATE_CANARY');}});
  assert.deepEqual(validateSnapshot(value),{ok:false,code:'invalid-state'});assert.equal(reads,0);
});
