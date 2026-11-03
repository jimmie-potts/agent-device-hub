// Snapshots into facts (#615 AC2): repeated, delayed and out-of-order samples add nothing, and a missing observation stays
// unknown. All values are synthetic.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {VolcanoLink, VolcanoObservation, VolcanoReading} from '@jimmie-potts/event-contracts/v2/families';
import {STALE_MS, admit, emptyContinuity, reduce, stale, type Continuity, type Fact} from '../src/facts.js';
import {BUTTON_PUMP, FEED, HEATING, IDLE, SELF_PUMP, START, reading} from './support.js';

type Step = {at: number; link?: VolcanoLink; reading?: Partial<VolcanoReading> | null; epoch?: string};

/** Plays snapshots through admission and the reducer, as the module does, and returns each admitted fact. */
function play(steps: readonly Step[], from: Continuity = emptyContinuity()): {state: Continuity; facts: Fact[]; dropped: number} {
  let state = from, sequence = from.sequence, dropped = 0;
  const facts: Fact[] = [];
  for (const step of steps) {
    sequence += 1;
    const snapshot: VolcanoObservation = {
      feed: FEED, observedAtMs: START + step.at, collectorEpoch: step.epoch ?? from.epoch ?? 'epoch-a', sequence, link: step.link ?? 'connected',
      reading: step.reading === null || (step.link !== undefined && step.link !== 'connected') ? null : reading(step.reading),
    };
    const admission = admit(state, snapshot, START + step.at);
    if (!admission.take) {
      dropped += 1;
      state = {...state, baselineMs: admission.baselineMs};
      continue;
    }
    const result = reduce(state, snapshot, START + step.at + 25);
    state = result.state;
    facts.push(...result.facts);
  }
  return {state, facts, dropped};
}
const kinds = (facts: readonly Fact[]): string[] => facts.map(fact => fact.kind);
const only = <K extends Fact['kind']>(facts: readonly Fact[], kind: K): Extract<Fact, {kind: K}>[] => facts.filter((fact): fact is Extract<Fact, {kind: K}> => fact.kind === kind);

void test('every fact keeps its observation and receipt times apart', () => {
  const {facts} = play([{at: 0, reading: {status1: HEATING}}]);
  assert.ok(facts.length > 0);
  for (const fact of facts) {
    assert.equal(fact.observedAtMs, START);
    assert.equal(fact.receivedAtMs, START + 25);
  }
});

void test('heater and pump transitions keep the raw register, and a pump run never reads as a press', () => {
  const {facts} = play([
    {at: 0, reading: {status1: IDLE}}, {at: 5000, reading: {status1: HEATING}},
    {at: 10_000, reading: {status1: SELF_PUMP}}, {at: 11_000, reading: {status1: HEATING}},
    {at: 15_000, reading: {status1: BUTTON_PUMP}}, {at: 18_000, reading: {status1: HEATING}}, {at: 20_000, reading: {status1: IDLE}},
  ]);
  assert.deepEqual(only(facts, 'heater').map(({on, edge, status1}) => [on, edge, status1]), [[false, 'first-observation', IDLE], [true, 'observed', HEATING], [false, 'observed', IDLE]]);
  assert.deepEqual(only(facts, 'pump').map(({on, status1}) => [on, status1]), [[true, SELF_PUMP], [false, HEATING], [true, BUTTON_PUMP], [false, HEATING]]);
  assert.ok(only(facts, 'pump').every(fact => !Object.hasOwn(fact, 'pressed')), 'nothing claims a press');
});

void test('status2 bit 13 flipping by itself changes nothing, and only bit 9 sets the display unit', () => {
  const steps: Step[] = [0, 5000, 10_000, 15_000].map((at, index) => ({at, reading: {status2: index % 2 === 0 ? 0x0200 : 0x2200}}));
  const {facts, state} = play(steps);
  assert.deepEqual(kinds(facts).filter(kind => kind !== 'link' && kind !== 'setpoint' && kind !== 'counter' && kind !== 'heater'), [], 'no activity from the flipping bit');
  assert.equal(state.displayFahrenheit, true);
  assert.equal(play([{at: 0, reading: {status2: 0x2000}}]).state.displayFahrenheit, false);
});

void test('temperature samples only while the heater is on, at most one per 30 s, plus at transitions', () => {
  const steps: Step[] = [{at: 0, reading: {currentDeciC: 400}}];
  for (let at = 5000; at <= 65_000; at += 5000) steps.push({at, reading: {status1: HEATING, currentDeciC: 400 + at / 100}});
  steps.push({at: 70_000, reading: {currentDeciC: 1000}}, {at: 75_000, reading: {currentDeciC: 900}}, {at: 110_000, reading: {currentDeciC: 800}});
  const samples = only(play(steps).facts, 'temperature').map(fact => fact.observedAtMs - START);
  assert.deepEqual(samples, [5000, 35_000, 65_000, 70_000], 'on at 5 s, then each 30 s, and off at 70 s, then nothing while off');
});

void test('setpoint and counter facts appear only on change', () => {
  const {facts} = play([
    {at: 0, reading: {targetDeciC: 1800, heatingMinutes: 5}}, {at: 5000, reading: {targetDeciC: 1800, heatingMinutes: 5}},
    {at: 10_000, reading: {targetDeciC: 1900, heatingMinutes: 5}}, {at: 15_000, reading: {targetDeciC: 1900, heatingMinutes: 6}},
  ]);
  assert.deepEqual(only(facts, 'setpoint').map(fact => fact.targetDeciC), [1800, 1900]);
  assert.deepEqual(only(facts, 'counter').map(fact => fact.totalMinutes), [725, 726]);
});

void test('a duplicate (epoch, sequence) and a non-newer observation are dropped with no fact or time', () => {
  const first = play([{at: 0, reading: {status1: HEATING}}]);
  const repeat: VolcanoObservation = {feed: FEED, observedAtMs: START + 9000, collectorEpoch: 'epoch-a', sequence: first.state.sequence, link: 'connected', reading: reading()};
  const duplicate = admit(first.state, repeat, START + 9000);
  assert.deepEqual(duplicate, {take: false, baselineMs: first.state.baselineMs, reason: 'duplicate'});
  const late = admit(first.state, {...repeat, sequence: first.state.sequence + 1, observedAtMs: START - 1}, START + 1000);
  assert.deepEqual(late, {take: false, baselineMs: first.state.baselineMs, reason: 'stale'});
  const sameTime = admit(first.state, {...repeat, sequence: first.state.sequence + 1, observedAtMs: START}, START + 1000);
  assert.equal(sameTime.take, false);
});

void test('a stale feed lets an out-of-order stamp reset the baseline, and only the next newer snapshot is taken, with a clock discontinuity', () => {
  const {state} = play([{at: 0, reading: {status1: HEATING, heatingMinutes: 5}}, {at: 5000, reading: {status1: HEATING, heatingMinutes: 5}}]);
  const stepped: VolcanoObservation = {feed: FEED, observedAtMs: START - 3_600_000, collectorEpoch: 'epoch-a', sequence: state.sequence + 1, link: 'connected', reading: reading({status1: HEATING})};
  const fresh = admit(state, stepped, START + 5000 + 25 + 1000);
  assert.deepEqual(fresh, {take: false, baselineMs: state.baselineMs, reason: 'stale'}, 'a fresh feed keeps its baseline');
  const gone = admit(state, stepped, START + 5000 + 25 + STALE_MS);
  assert.equal(gone.take, false);
  assert.equal(gone.take === false && gone.baselineMs, stepped.observedAtMs, 'the baseline moves, and the snapshot still gives no evidence');
  const moved: Continuity = {...state, baselineMs: stepped.observedAtMs};
  const next = {...stepped, sequence: stepped.sequence + 1, observedAtMs: stepped.observedAtMs + 5000};
  assert.deepEqual(admit(moved, next, START + 60_000), {take: true});
  const {facts, state: after} = reduce(moved, next, START + 60_000);
  const discontinuity = only(facts, 'discontinuity');
  assert.deepEqual(discontinuity.map(({reason, lastReadingAtMs}) => [reason, lastReadingAtMs]), [['clock-step', START + 5000]]);
  assert.equal(only(facts, 'gap').length, 0, 'no credit crosses a stepped clock');
  assert.equal(only(facts, 'heater')[0]?.edge, 'first-observation');
  assert.equal(after.latestMs, next.observedAtMs);
});

void test('a second delayed snapshot after a moved baseline is taken, but only behind a clock-step that nothing crosses', () => {
  const {state} = play([{at: 0, reading: {status1: HEATING, heatingMinutes: 5}}]);
  const old = (seconds: number, epoch: string): VolcanoObservation => ({feed: FEED, observedAtMs: START - seconds * 1000, collectorEpoch: epoch, sequence: 1, link: 'connected', reading: reading({status1: IDLE, heatingMinutes: 9})});
  const first = admit(state, old(60, 'old-epoch'), START + STALE_MS + 25);
  assert.equal(first.take, false, 'the one that moves the baseline gives no evidence');
  const moved: Continuity = {...state, baselineMs: first.take ? null : first.baselineMs};
  assert.deepEqual(admit(moved, old(55, 'old-epoch'), START + STALE_MS + 26), {take: true});
  const {facts} = reduce(moved, old(55, 'old-epoch'), START + STALE_MS + 26);
  assert.deepEqual(only(facts, 'discontinuity').map(fact => fact.reason), ['clock-step']);
  assert.equal(only(facts, 'gap').length, 0);
});

void test('first connection mid-session records what it saw, with no earlier start', () => {
  const {facts} = play([{at: 600_000, reading: {status1: HEATING}}]);
  assert.deepEqual(only(facts, 'heater').map(({on, edge, observedAtMs}) => [on, edge, observedAtMs]), [[true, 'first-observation', START + 600_000]]);
  assert.equal(only(facts, 'gap').length, 0, 'there is nothing before the first observation to call a gap');
});

void test('a disconnect is not off, and the interval is one gap with its counter gain in whole minutes', () => {
  const {facts, state} = play([
    {at: 0, reading: {status1: HEATING, heatingMinutes: 5}}, {at: 5000, link: 'disconnected'}, {at: 10_000, link: 'unavailable'},
    {at: 125_000, reading: {status1: HEATING, heatingMinutes: 7}},
  ]);
  assert.equal(only(facts, 'heater').length, 1, 'no off and no second on');
  assert.deepEqual(only(facts, 'gap').map(({fromMs, toMs, heaterBefore, heaterAfter, creditedMinutes}) => [fromMs, toMs, heaterBefore, heaterAfter, creditedMinutes]),
    [[START, START + 125_000, 'on', 'on', 2]]);
  assert.deepEqual(only(facts, 'link').map(fact => fact.state), ['connected', 'disconnected', 'unavailable', 'connected']);
  assert.equal(state.heater, true);
});

void test('a short reconnect is still an unobserved interval, and a stream with no gap adds none', () => {
  const short = play([{at: 0, reading: {status1: HEATING}}, {at: 400, link: 'disconnected'}, {at: 1400, reading: {status1: HEATING}}]);
  assert.equal(only(short.facts, 'gap').length, 1);
  const steady = play([{at: 0, reading: {status1: HEATING}}, {at: 5000, reading: {status1: HEATING}}, {at: 15_000, reading: {status1: HEATING}}]);
  assert.equal(only(steady.facts, 'gap').length, 0);
  const missed = play([{at: 0, reading: {status1: HEATING}}, {at: 15_001, reading: {status1: HEATING}}]);
  assert.equal(only(missed.facts, 'gap').length, 1, 'a silent feed past the stale limit is a gap');
});

void test('heater edges across a gap are as first seen, never an exact time', () => {
  const off = play([{at: 0, reading: {status1: HEATING}}, {at: 60_000, reading: {status1: IDLE}}]);
  assert.deepEqual(only(off.facts, 'heater').at(-1)?.edge, 'after-gap');
  const on = play([{at: 0, reading: {status1: IDLE}}, {at: 60_000, reading: {status1: HEATING}}]);
  assert.deepEqual(only(on.facts, 'heater').at(-1)?.edge, 'after-gap');
});

void test('a counter decrease starts a discontinuity, with no negative or recovered delta across it', () => {
  const {facts} = play([{at: 0, reading: {heatingHours: 120, heatingMinutes: 5}}, {at: 60_000, reading: {heatingHours: 3, heatingMinutes: 0}}, {at: 65_000, reading: {heatingHours: 3, heatingMinutes: 0}}]);
  assert.deepEqual(only(facts, 'discontinuity').map(({reason, lastReadingAtMs}) => [reason, lastReadingAtMs]), [['counter-decrease', START]]);
  assert.deepEqual(only(facts, 'gap').map(fact => fact.creditedMinutes), [null]);
  assert.deepEqual(only(facts, 'counter').map(fact => fact.totalMinutes), [7205, 180]);
});

void test('a counter gain larger than the time that passed is a discontinuity, not usage', () => {
  const {facts} = play([{at: 0, reading: {heatingHours: 1, heatingMinutes: 0}}, {at: 120_000, reading: {heatingHours: 3, heatingMinutes: 0}}]);
  assert.deepEqual(only(facts, 'discontinuity').map(fact => fact.reason), ['counter-jump']);
  assert.deepEqual(only(facts, 'gap').map(fact => fact.creditedMinutes), [null]);
});

const hidden = {heatingHours: null, heatingMinutes: null};

void test('a gap that ends with no counter has no credit, and the counter neither moves nor loses its baseline', () => {
  const {facts, state} = play([{at: 0, reading: {heatingMinutes: 5}}, {at: 60_000, reading: hidden}]);
  assert.deepEqual(only(facts, 'gap').map(fact => fact.creditedMinutes), [null]);
  assert.equal(state.counter, 725);
  assert.equal(only(facts, 'counter').length, 1);
});

void test('a counter held back across an ordinary rollover records no discontinuity and no credit', () => {
  const {facts} = play([
    {at: 0, reading: {heatingHours: 12, heatingMinutes: 59}}, {at: 1000, reading: hidden}, {at: 2000, reading: {heatingHours: 13, heatingMinutes: 0}},
    {at: 62_000, reading: {heatingHours: 13, heatingMinutes: 1}},
  ]);
  assert.deepEqual(only(facts, 'discontinuity'), []);
  assert.deepEqual(only(facts, 'counter').map(fact => fact.totalMinutes), [779, 780, 781]);
  assert.deepEqual(only(facts, 'gap').length, 1, 'a minute of silence is still a gap');
  assert.deepEqual(only(facts, 'gap').map(fact => fact.creditedMinutes), [1], 'and the baseline is good again by then');
});

void test('a gain from before a hidden counter is never credited to a later gap', () => {
  const {facts} = play([
    {at: 0, reading: {heatingMinutes: 5}}, {at: 1000, reading: hidden},
    {at: 120_000, reading: {heatingMinutes: 7}},
  ]);
  assert.deepEqual(only(facts, 'gap').map(fact => fact.creditedMinutes), [null], 'two minutes gained, some perhaps before the gap began');
  assert.deepEqual(only(facts, 'counter').map(fact => fact.totalMinutes), [725, 727]);
});

void test('a reset confirmed after being hidden is one discontinuity, with its gap uncredited', () => {
  const {facts} = play([
    {at: 0, reading: {heatingHours: 120, heatingMinutes: 5}}, {at: 5000, link: 'disconnected'}, {at: 60_000, reading: hidden},
    {at: 65_000, reading: {heatingHours: 3, heatingMinutes: 0}},
  ]);
  assert.deepEqual(only(facts, 'gap').map(fact => fact.creditedMinutes), [null]);
  assert.deepEqual(only(facts, 'discontinuity').map(fact => fact.reason), ['counter-decrease']);
});

void test('a changed identity starts a discontinuity, and what follows starts over with no credit', () => {
  const {facts, state} = play([
    {at: 0, reading: {status1: HEATING, heatingMinutes: 5}}, {at: 5000, link: 'identity-mismatch'}, {at: 10_000, link: 'identity-mismatch'},
    {at: 300_000, reading: {status1: HEATING, heatingMinutes: 9}},
  ]);
  assert.deepEqual(only(facts, 'discontinuity').map(fact => fact.reason), ['identity-mismatch'], 'one discontinuity for the whole mismatch');
  assert.equal(only(facts, 'gap').length, 0);
  assert.deepEqual(only(facts, 'heater').map(({on, edge}) => [on, edge]), [[true, 'first-observation'], [true, 'first-observation']]);
  assert.equal(state.counter, 725 + 4);
});

void test('a new collector epoch is one marker and an unobserved interval, with no heater fact unless it changed', () => {
  const {facts} = play([
    {at: 0, epoch: 'epoch-a', reading: {status1: HEATING, heatingMinutes: 5}}, {at: 5000, epoch: 'epoch-b', reading: {status1: HEATING, heatingMinutes: 5}},
    {at: 10_000, epoch: 'epoch-b', reading: {status1: HEATING, heatingMinutes: 5}},
  ]);
  assert.equal(only(facts, 'collector-restart').length, 1);
  assert.equal(only(facts, 'heater').length, 1);
  assert.deepEqual(only(facts, 'gap').map(({fromMs, toMs, creditedMinutes}) => [fromMs, toMs, creditedMinutes]), [[START, START + 5000, 0]]);
});

void test('a skipped sequence is a missed observation even within 15 s: what it hid has an unobserved edge', () => {
  const taken = play([{at: 0, reading: {status1: HEATING, heatingMinutes: 5}}]).state;
  const later = (sequence: number, status1: number): VolcanoObservation => ({feed: FEED, observedAtMs: START + 5000, collectorEpoch: 'epoch-a', sequence, link: 'connected', reading: reading({status1, heatingMinutes: 5})});
  const next = reduce(taken, later(taken.sequence + 1, IDLE), START + 5000);
  assert.equal(only(next.facts, 'heater')[0]?.edge, 'observed', 'the next sequence saw it as it happened');
  assert.equal(only(next.facts, 'gap').length, 0);
  const skipped = reduce(taken, later(taken.sequence + 2, IDLE), START + 5000);
  assert.equal(only(skipped.facts, 'heater')[0]?.edge, 'after-gap');
  assert.deepEqual(only(skipped.facts, 'gap').map(({fromMs, toMs, heaterBefore, heaterAfter, creditedMinutes}) => [fromMs, toMs, heaterBefore, heaterAfter, creditedMinutes]), [[START, START + 5000, 'on', 'off', 0]]);
  assert.equal(skipped.state.broken, false, 'the reading closes the gap');
});

void test('going stale is one marker and leaves the heater as last seen for the gap, not off', () => {
  const taken = play([{at: 0, reading: {status1: HEATING}}]).state;
  const first = stale(taken, START + STALE_MS);
  assert.deepEqual(first.facts.map(fact => fact.kind === 'link' && fact.state), ['stale']);
  assert.equal(first.state.heater, true);
  assert.equal(stale(first.state, START + 2 * STALE_MS).facts.length, 0);
  assert.equal(stale(emptyContinuity(), START).facts.length, 0, 'a feed never seen has nothing to mark');
});

void test('a connected link with no reading is broken continuity, not a reading', () => {
  const {facts, state} = play([{at: 0, reading: {status1: HEATING}}, {at: 5000, reading: null}, {at: 8000, reading: {status1: HEATING}}]);
  assert.equal(only(facts, 'gap').length, 1);
  assert.equal(state.broken, false);
});
