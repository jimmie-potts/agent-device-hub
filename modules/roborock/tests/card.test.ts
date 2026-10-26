import assert from 'node:assert/strict';
import test from 'node:test';
import {emptyStatus, UNKNOWN, type RunRecord, type RunsPage, type VacuumStatus} from '../src/contracts.js';
import {freshness, ROBOROCK_MAX_AGE_MS, roborockCardData} from '../src/frontend/card-data.js';

const known = (value: number): {status: 'known'; value: number} => ({status: 'known', value});
function status(): VacuumStatus {
  const doc = emptyStatus('vacuum');
  doc.availability = 'available'; doc.activity = 'cleaning'; doc.observedAtMs = known(1_000);
  doc.status.batteryPercent = known(78); doc.status.state = known(5);
  doc.status.cleanTimeSeconds = known(1080); doc.status.cleanAreaMm2 = known(22_000_000);
  doc.consumables.observedAtMs = known(1_000); doc.consumables.mainBrushSeconds = known(93_600);
  return doc;
}
function runs(complete = 1): RunsPage {
  const run: RunRecord = {recordId: 100, observedAtMs: 100_000, startAtMs: 80_000, endAtMs: known(90_000),
    durationSeconds: known(2160), areaMm2: known(99_000_000), cleanedAreaMm2: known(48_000_000),
    errorCode: UNKNOWN, complete: known(complete), startType: UNKNOWN, cleanType: UNKNOWN, finishReason: UNKNOWN,
    avoidCount: UNKNOWN, washCount: UNKNOWN, battery: {availability: 'missing', samples: 0, clock: 'unqualified'},
    map: {availability: 'missing', reason: 'not-observed'}};
  return {schema: 'roborock-runs/2.0', id: 'vacuum', revision: 1, history: 'partial', runs: [run], next: UNKNOWN};
}
function data(doc: VacuumStatus | undefined = status(), list: RunsPage | undefined = runs(), now = 10_000, live = true) {
  return roborockCardData({doc, live, now, runs: list, error: undefined, runsError: undefined});
}

void test('the card uses observed cleaning counters and independent cleaned area', () => {
  const value = data();
  assert.equal(value.title, 'Cleaning'); assert.equal(value.battery, '78%');
  assert.equal(value.duration, '18 min'); assert.equal(value.area, '22 m²'); assert.equal(value.cleaning, true);
  assert.equal(value.run.duration, '36 min'); assert.equal(value.run.area, '48 m²');
  assert.equal(value.run.label, 'Completed'); assert.equal(value.care[0]?.[1], '26 h');
});
void test('a known end or unknown complete code never establishes completion', () => {
  assert.equal(data(status(), runs(0)).run.label, 'Not completed');
  const list = runs(); const run = list.runs[0]; assert.ok(run !== undefined); run.complete = UNKNOWN;
  assert.equal(data(status(), list).run.label, 'Completion unknown');
  run.cleanedAreaMm2 = UNKNOWN;
  assert.equal(data(status(), list).run.area, 'Unknown', 'reported area is not a substitute');
  run.complete = known(999);
  assert.equal(data(status(), list).run.label, 'Complete code 999', 'an unfamiliar code is not proof of non-completion');
});
void test('time alone ages status without a new reading and care has its own timestamp', () => {
  const doc = status();
  assert.equal(data(doc, runs(), 1_000 + ROBOROCK_MAX_AGE_MS).availability, 'current');
  const stale = data(doc, runs(), 1_001 + ROBOROCK_MAX_AGE_MS);
  assert.equal(stale.title, 'Stale'); assert.equal(stale.cleaning, false); assert.equal(stale.batteryLabel, 'Last battery');
  doc.observedAtMs = known(200_000);
  const mixed = data(doc, runs(), 201_000);
  assert.equal(mixed.title, 'Cleaning'); assert.equal(mixed.careNote, 'Last observed usage');
  assert(mixed.notices.some(value => value.includes('Care usage')));
});
void test('unknown, future, unavailable and disconnected evidence is never current', () => {
  assert.equal(freshness(UNKNOWN, 10_000, true), 'unknown');
  assert.equal(freshness(known(20_000), 10_000, true), 'unknown');
  assert.equal(freshness(known(1_000), 10_000, false), 'stale');
  assert.equal(data(status(), runs(), 10_000, false).cleaning, false);
  const doc = status(); doc.availability = 'unavailable';
  assert.equal(data(doc).title, 'Unavailable'); assert.equal(data(doc).cleaning, false);
});
void test('other vendor states, zero values and unknown measurements remain distinct', () => {
  const doc = status(); doc.activity = 'other'; doc.status.state = known(8); doc.status.batteryPercent = known(0);
  assert.equal(data(doc).title, 'State 8'); assert.equal(data(doc).cleaning, false); assert.equal(data(doc).battery, '0%');
  doc.status.state = UNKNOWN; doc.status.batteryPercent = UNKNOWN;
  assert.equal(data(doc).title, 'Unknown'); assert.equal(data(doc).battery, 'Unknown');
  assert.equal(data(doc).care[1]?.[1], 'Unknown');
});
void test('missing, loading, empty and refused history are distinct from a completed run', () => {
  const empty = runs(); empty.runs = [];
  assert.equal(data(status(), empty).run.label, 'No retained runs');
  const args = {doc: status(), live: true, now: 10_000, runs: undefined, error: undefined, runsError: undefined};
  assert.equal(roborockCardData(args).run.label, 'Loading history');
  const refused = roborockCardData({...args, error: 'forbidden', runsError: 'invalid-message'});
  assert.equal(refused.availability, 'unavailable'); assert.equal(refused.run.label, 'History unavailable');
  assert(refused.notices.includes('Roborock read refused: forbidden.'));
  assert(refused.notices.includes('Run history read refused: invalid-message.'));
});
void test('raw warnings use no invented maintenance thresholds or vendor meanings', () => {
  const doc = status(); doc.status.dockErrorStatus = known(3); doc.status.errorCode = known(9999);
  const value = data(doc);
  assert(value.notices.includes('Dock reported code 3. Check the Roborock app.'));
  assert(value.notices.includes('Roborock reported code 9999. Check the Roborock app.'));
  assert(!JSON.stringify(value).match(/replace|remaining|lifespan|dock(ed)?"/i));
});
