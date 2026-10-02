import test from 'node:test';
import assert from 'node:assert/strict';
import { contribution, aggregate } from '../dist/numeric.js';
import { numericReport, validateSnapshot } from '@jimmie-potts/wispr-contracts';

const row = (id, overrides={}) => ({ id, timestamp:'2026-03-08 06:30:00 +00:00', status:'formatted', numWords:60, duration:60, speechDuration:30, numWordsCorrected:null, numDictionaryReplacements:null, appName:'Slack', invalid:[], ...overrides });
const build = (rows,options={}) => aggregate(rows.map(r=>contribution(r)),{namespace:'11111111-1111-4111-8111-111111111111',generation:'22222222-2222-4222-8222-222222222222',revision:1,now:'2026-03-09T00:00:00.000Z',timezone:'America/New_York',...options});

test('fractional durations remain valid across a large retained history and hourly groups', () => {
  for (const [count,seconds] of [[10000,60.1],[100000,10.1]]) {
    const snapshot=build(Array.from({length:count},(_,i)=>row(String(i),{timestamp:`2026-03-08T${String(i%24).padStart(2,'0')}:00:00Z`,duration:seconds,speechDuration:seconds})),{timezone:'UTC'});
    assert.equal(validateSnapshot(snapshot).ok,true);
    assert.equal(snapshot.numeric.totals.dictations,count);
    assert.equal(snapshot.numeric.totals.words,count*60);
    assert.ok(Math.abs(snapshot.numeric.totals.recordingSeconds-count*seconds)<1e-6);
    assert.ok(Math.abs(snapshot.numeric.totals.speechSeconds-count*seconds)<1e-6);
    assert.equal(numericReport(snapshot,{}).totals.speechSeconds,snapshot.numeric.totals.speechSeconds);
    snapshot.numeric.totals.words++;
    assert.equal(validateSnapshot(snapshot).ok,false);
  }
});

test('hand-calculated weighted rates use matching valid rows and retain exclusions', () => {
  const snapshot=build([
    row('a'),row('b',{timestamp:'2026-03-08 07:30:00 +00:00',numWords:40,duration:20,speechDuration:10,numWordsCorrected:0,numDictionaryReplacements:2}),
    row('c',{numWords:20,duration:0,speechDuration:null}),
    row('d',{numWords:10,duration:-1,speechDuration:-1}),
    row('e',{status:'raw',numWords:500}),row('f',{numWords:0}),row('g',{timestamp:'2026-02-31T12:00:00Z'}),
  ]);
  assert.equal(validateSnapshot(snapshot).ok,true);
  const report=numericReport(snapshot,{});
  assert.equal(report.totals.words,130);assert.equal(report.totals.dictations,4);
  assert.equal(report.totals.speechWords,100);assert.equal(report.totals.speechSeconds,40);
  assert.equal(report.speechWordsPerMinute,150);
  assert.equal(report.recordingWordsPerMinute,75);
  assert.equal(report.totals.zeroRecording,1);assert.equal(report.totals.invalidRecording,1);
  assert.equal(report.totals.correctionSamples,1);assert.equal(report.totals.wordsCorrected,0);
  assert.equal(snapshot.coverage.statuses.raw,1);assert.equal(snapshot.coverage.excluded.words,1);assert.equal(snapshot.coverage.excluded.timestamp,1);
  assert.deepEqual(snapshot.numeric.cells.map(c=>c.hour),[1,3]);
});

test('fall-back hour combines aggregates and offsets preserve the correct date', () => {
  const snapshot=build([
    row('a',{timestamp:'2026-11-01 05:30:00 +00:00'}),row('b',{timestamp:'2026-11-01 06:30:00 +00:00'}),
    row('c',{timestamp:'2026-11-01T00:30:00+02:00'}),
  ],{now:'2026-11-02T02:00:00.000Z'});
  assert.equal(validateSnapshot(snapshot).ok,true);
  assert.deepEqual(snapshot.numeric.cells.map(c=>[c.date,c.hour,c.dictations]),[['2026-10-31',18,1],['2026-11-01',1,2]]);
  assert.equal(snapshot.latestSourceDate,'2026-11-01');
  assert.equal(snapshot.presets[0].validUntil,'2026-11-02T05:00:00.000Z');
  const utc=build([row('c',{timestamp:'2026-11-01T00:30:00+02:00'})],{timezone:'UTC'});
  assert.equal(utc.numeric.cells[0].date,'2026-10-31');
});

test('app/category filters intersect and rollups count observed runs', () => {
  const snapshot=build([
    row('a',{timestamp:'2026-10-01T12:00:00Z',appName:'ChatGPT'}),
    row('b',{timestamp:'2026-10-02T12:00:00Z',appName:'Slack'}),
    row('c',{timestamp:'2026-10-04T12:00:00Z',appName:'C:\\private\\secret.exe'}),
  ],{now:'2026-10-04T18:00:00.000Z'});
  const all=numericReport(snapshot,{});
  assert.equal(all.activeDays,3);assert.equal(all.longestObservedRun,2);assert.equal(all.latestObservedRun,1);
  assert.equal(all.weekly[0].words,180);assert.equal(all.monthly[0].words,180);
  assert.equal(numericReport(snapshot,{app:'slack',category:'ai-prompts'}).totals.words,0);
  assert.equal(numericReport(snapshot,{from:'2026-10-02',to:'2026-10-02',category:'messaging'}).totals.words,60);
  assert.equal(JSON.stringify(snapshot).includes('private'),false);
  assert.throws(()=>numericReport(snapshot,{app:'unknown-app'}),/unsupported-filter/);
});

test('capture boundaries and archival are independent of current source presence', () => {
  const a=contribution(row('a'));a.archived=true;
  const snapshot=aggregate([a],{namespace:'11111111-1111-4111-8111-111111111111',generation:'22222222-2222-4222-8222-222222222222',revision:2,now:'2026-03-09T12:00:00.000Z',timezone:'America/New_York'});
  assert.equal(snapshot.numeric.totals.words,60);assert.equal(snapshot.coverage.archivedRows,1);assert.equal(snapshot.coverage.sourceRows,0);
  assert.equal(snapshot.coverage.retained.from,null);assert.equal(snapshot.health,'empty');
  assert.equal(contribution(row('a'),Date.parse('2026-03-08T06:30:00Z')).exclusion,'before-capture');
});
test('submillisecond source precision stays private and respects an exact millisecond clear boundary',()=>{
  const instant=Date.parse('2026-10-02T04:00:00.000Z');
  const after=contribution(row('a',{timestamp:'2026-10-02 04:00:00.000001 +00:00'}),instant);
  const boundary=contribution(row('b',{timestamp:'2026-10-02 04:00:00.000000 +00:00'}),instant);
  assert.equal(after.exclusion,null);assert.equal(boundary.exclusion,'before-capture');
  const snapshot=build([row('a',{timestamp:'2026-10-02 03:59:59.999999999 +00:00'})],{now:'2026-10-02T16:00:00.000Z'});
  assert.equal(snapshot.numeric.cells[0].date,'2026-10-01');assert.equal(snapshot.numeric.cells[0].hour,23);
  assert.equal('sourceSubmillisNanos' in snapshot.numeric.cells[0],false);
});
