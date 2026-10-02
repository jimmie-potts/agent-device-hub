import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySnapshot, validateSnapshot, emptyTotals, appCategory } from '../dist/index.js';

const fixture = () => emptySnapshot({namespace:'11111111-1111-4111-8111-111111111111',generation:'22222222-2222-4222-8222-222222222222',now:'2026-10-02T16:00:00.000Z',timezone:'America/New_York'});
test('empty numeric snapshot is valid without language collection', () => {
  const value = fixture();
  const result = validateSnapshot(value);
  assert.equal(result.ok,true);
  assert.equal(result.value.language.availability,'disabled');
  assert.equal(result.value.latestSourceDate,null);
  assert.equal(result.value.lastSuccessAt,null);
  assert.equal(result.value.health,'cleared');
});
test('unknown fields, raw records, invalid dates and incompatible versions reject', () => {
  for (const change of [
    v=>v.transcript='SYNTHETIC_SECRET',
    v=>v.schemaVersion='2.0',
    v=>v.latestSourceDate='2026-02-31',
    v=>v.latestSourceDate='2026-10-02T10:30:00Z',
    v=>v.generatedAt='not-a-date',
    v=>v.timezone='Not/AZone',
    v=>v.numeric.totals.words=-1,
    v=>v.truncated=true,
  ]) {
    const value=fixture();change(value);assert.deepEqual(validateSnapshot(value),{ok:false,code:'invalid-wispr-snapshot'});
  }
});
test('unsafe apps and wrong categories cannot enter the shared contract', () => {
  const value=fixture();
  value.numeric.cells=[{date:'2026-10-02',hour:12,weekday:5,app:'slack',category:'email',archived:false,...emptyTotals()}];
  assert.equal(validateSnapshot(value).ok,false);
  value.numeric.cells[0].category=appCategory('slack');
  assert.equal(validateSnapshot(value).ok,true);
  value.numeric.cells[0].app='C:\\private\\secret';
  assert.equal(validateSnapshot(value).ok,false);
});
test('validation returns a detached JSON value', () => {
  const original=fixture(); const result=validateSnapshot(original);assert.equal(result.ok,true);
  original.numeric.totals.words=20;
  assert.equal(result.value.numeric.totals.words,0);
});
test('positive words require at least one eligible dictation and vice versa',()=>{
 for(const [words,dictations] of [[10,0],[0,1],[1,2]]){
  const value=fixture(),totals={...emptyTotals(),words,dictations};
  value.numeric.cells=[{date:'2026-10-02',hour:12,weekday:5,app:'slack',category:'messaging',archived:false,...totals}];
  value.numeric.totals=totals;assert.equal(validateSnapshot(value).ok,false);
 }
});
