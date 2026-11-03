// #614's worked examples, exactly, with N = 15 minutes, and regrouping by threshold (#615 AC6). A timeline of the device
// plays through the same reducer the module uses at the collector's 5 s heartbeat; every stored fact stays unchanged.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {VolcanoLink, VolcanoObservation} from '@jimmie-potts/event-contracts/v2/families';
import {admit, emptyContinuity, reduce, type Continuity, type Fact} from '../src/facts.js';
import {dailyTotals, derive, gapDistribution, groupSessions} from '../src/sessions.js';
import {FEED, HEATING, IDLE, reading} from './support.js';

const BASE = Date.parse('2026-11-03T00:00:00.000Z');
const clock = (time: string): number => {
  const [hours = 0, minutes = 0, seconds = 0] = time.split(':').map(Number);
  return BASE + ((hours * 60 + minutes) * 60 + seconds) * 1000;
};
const MIN = 60_000;

type Span = {from: string; to: string; heater?: boolean; link?: VolcanoLink; counter?: number};

/** Plays each span at the heartbeat with a counter that runs while the heater is on, unless a span pins it. */
function play(spans: readonly Span[]): {facts: Fact[]; state: Continuity} {
  let state = emptyContinuity(), sequence = 0, counter = 7205, accumulated = 0;
  const facts: Fact[] = [];
  for (const span of spans) {
    for (let at = clock(span.from); at <= clock(span.to); at += 5000) {
      if (span.counter !== undefined) counter = span.counter;
      sequence += 1;
      const link = span.link ?? 'connected';
      const snapshot: VolcanoObservation = {feed: FEED, observedAtMs: at, collectorEpoch: 'epoch-a', sequence, link,
        reading: link !== 'connected' ? null : reading({status1: span.heater === true ? HEATING : IDLE, heatingHours: Math.floor(counter / 60), heatingMinutes: counter % 60})};
      if (span.heater === true) {
        accumulated += 5000;
        if (accumulated >= MIN) { counter += 1; accumulated -= MIN; }
      }
      const admission = admit(state, snapshot, at);
      assert.equal(admission.take, true);
      const result = reduce(state, snapshot, at + 40);
      state = result.state;
      facts.push(...result.facts);
    }
  }
  return {facts, state};
}
const structural = (facts: readonly Fact[]): Fact[] => facts.filter(fact => ['heater', 'pump', 'gap', 'discontinuity'].includes(fact.kind));
const sessionsOf = ({facts, state}: {facts: Fact[]; state: Continuity}, gap = 15) => groupSessions(derive(structural(facts), state.lastReadingAtMs), gap);

void test('manual use: HEAT at 20:00, off at 20:25, is one session with one stretch', () => {
  const sessions = sessionsOf(play([{from: '19:59:55', to: '19:59:55'}, {from: '20:00', to: '20:24:55', heater: true}, {from: '20:25', to: '20:26'}]));
  assert.equal(sessions.length, 1);
  const [session] = sessions;
  assert.equal(session?.startAtMs, clock('20:00'));
  assert.equal(session?.endAtMs, clock('20:25'));
  assert.equal(session?.startedBeforeObservation, false);
  assert.equal(session?.open, false);
  assert.equal(session?.stretches.length, 1);
  assert.equal(session?.observedHeatingMs, 25 * MIN);
});

const autoOff: Span[] = [
  {from: '19:59:55', to: '19:59:55'}, {from: '20:00', to: '20:29:55', heater: true}, {from: '20:30', to: '20:37:55'}, {from: '20:38', to: '20:49:55', heater: true},
  {from: '20:50', to: '21:29:55'}, {from: '21:30', to: '21:40', heater: true}, {from: '21:40:05', to: '21:41'},
];

void test('auto-off then restart: an 8 minute gap is one session of two stretches, and a 40 minute gap starts a new one', () => {
  const sessions = sessionsOf(play(autoOff));
  assert.deepEqual(sessions.map(session => [session.startAtMs, session.endAtMs, session.stretches.length]), [
    [clock('20:00'), clock('20:50'), 2],
    [clock('21:30'), clock('21:40:05'), 1],
  ]);
  assert.equal(sessions[0]?.observedHeatingMs, (30 + 12) * MIN);
});

void test('changing the threshold regroups the same facts and rewrites none', () => {
  const played = play(autoOff);
  const before = JSON.stringify(played.facts);
  assert.equal(sessionsOf(played, 8).length, 3, 'a gap of exactly the threshold separates: the rule is less than');
  assert.equal(sessionsOf(played, 9).length, 2);
  assert.equal(sessionsOf(played, 15).length, 2);
  assert.equal(sessionsOf(played, 40).length, 2);
  assert.equal(sessionsOf(played, 41).length, 1);
  assert.equal(JSON.stringify(played.facts), before);
});

void test('first connection mid-session: started before observation, by the time first seen, with no earlier start', () => {
  const sessions = sessionsOf(play([{from: '20:10', to: '20:29:55', heater: true}, {from: '20:30', to: '20:31'}]));
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.startAtMs, clock('20:10'));
  assert.equal(sessions[0]?.startedBeforeObservation, true);
  assert.equal(sessions[0]?.stretches[0]?.startedBeforeObservation, true);
  assert.equal(sessions[0]?.observedHeatingMs, 20 * MIN);
});

const missed: Span[] = [
  {from: '19:59:55', to: '19:59:55'}, {from: '20:00', to: '20:10', heater: true}, {from: '20:10:05', to: '20:19:55', link: 'disconnected'},
  {from: '20:20', to: '20:29:55', heater: true, counter: 7220}, {from: '20:30', to: '20:31'},
];

void test('missed interval: heater on at both edges, shown unobserved, credited whole minutes, and no boundary inside it', () => {
  const sessions = sessionsOf(play(missed));
  assert.equal(sessions.length, 1, 'a gap of ten minutes with a threshold of one still makes no boundary');
  const [session] = sessions;
  assert.equal(session?.stretches.length, 1);
  assert.deepEqual(session?.stretches[0]?.unobserved, [{fromMs: clock('20:10'), toMs: clock('20:20'), creditedMinutes: session?.creditedMinutes}]);
  assert.equal(session?.creditedMinutes, 5, 'the gain from the last reading before the gap to the first after it');
  assert.equal(session?.observedHeatingMs, 20 * MIN, 'observed time excludes the gap, and the credit stays separate');
  assert.equal(session?.endAtMs, clock('20:30'));
  assert.equal(sessionsOf(play(missed), 1).length, 1);
});

void test('a long gap with the heater on at both edges makes no boundary whatever the threshold', () => {
  const sessions = sessionsOf(play([{from: '20:00', to: '20:05', heater: true}, {from: '20:05:05', to: '23:00', link: 'unavailable'}, {from: '23:00:05', to: '23:05', heater: true}]), 1);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.open, true);
  assert.equal(sessions[0]?.creditedMinutes, 0);
});

void test('counter decrease: a discontinuity, with no negative or recovered delta crossing it', () => {
  const played = play([
    {from: '20:00', to: '20:05', heater: true, counter: 7205},
    {from: '20:05:05', to: '20:09:55', link: 'disconnected'},
    {from: '20:10', to: '20:15', heater: true, counter: 180},
    {from: '20:15:05', to: '20:16'},
  ]);
  const sessions = sessionsOf(played);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.creditedMinutes, 0, 'no credit crosses it');
  assert.equal(sessions[0]?.discontinuities, 1);
  assert.deepEqual(sessions[0]?.stretches[0]?.unobserved, [{fromMs: clock('20:05'), toMs: clock('20:10'), creditedMinutes: null}]);
  assert.ok(played.facts.every(fact => fact.kind !== 'gap' || fact.creditedMinutes === null));
});

void test('an end hidden in a gap has no end time, only its bounds', () => {
  const sessions = sessionsOf(play([
    {from: '19:59:55', to: '19:59:55'}, {from: '20:00', to: '20:10', heater: true}, {from: '20:10:05', to: '20:19:55', link: 'disconnected'}, {from: '20:20', to: '20:21'},
  ]));
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.endAtMs, null);
  assert.equal(sessions[0]?.endedUnobservedBy, clock('20:20'));
  assert.equal(sessions[0]?.lastObservedOnAtMs, clock('20:10'));
  assert.equal(sessions[0]?.observedHeatingMs, 10 * MIN);
});

void test('a stretch that began in a gap is as first seen, and an open one stays open with no end', () => {
  const sessions = sessionsOf(play([{from: '20:00', to: '20:05'}, {from: '20:05:05', to: '21:00', link: 'disconnected'}, {from: '21:00:05', to: '21:10', heater: true}]));
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.startedBeforeObservation, true);
  assert.equal(sessions[0]?.startAtMs, clock('21:00:05'));
  assert.equal(sessions[0]?.open, true);
  assert.equal(sessions[0]?.endAtMs, null);
  assert.equal(sessions[0]?.observedHeatingMs, clock('21:10') - clock('21:00:05'));
});

void test('a changed identity closes what was open with no end time, and the next stretch starts as first seen', () => {
  const sessions = sessionsOf(play([
    {from: '20:00', to: '20:05', heater: true}, {from: '20:05:05', to: '20:06', link: 'identity-mismatch'}, {from: '20:06:05', to: '20:10', heater: true},
  ]), 30);
  assert.equal(sessions.length, 1);
  const [first, second] = sessions[0]?.stretches ?? [];
  assert.equal(first?.open, false);
  assert.equal(first?.endAtMs, null);
  assert.equal(first?.lastObservedOnAtMs, clock('20:05'));
  assert.equal(second?.startedBeforeObservation, true);
  assert.equal(second?.open, true);
});

void test('gap distribution counts each separation once and marks those with an edge not seen as it happened', () => {
  const derived = derive(structural(play(autoOff).facts), null);
  const buckets = gapDistribution(derived);
  assert.deepEqual(buckets.filter(bucket => bucket.count > 0), [{fromMinutes: 5, toMinutes: 10, count: 1, uncertain: 0}, {fromMinutes: 30, toMinutes: 60, count: 1, uncertain: 0}]);
  const hidden = derive(structural(play([{from: '20:00', to: '20:05', heater: true}, {from: '20:05:05', to: '20:06', link: 'disconnected'}, {from: '20:06:05', to: '20:07'}, {from: '20:07:05', to: '20:08', heater: true}]).facts), null);
  assert.deepEqual(gapDistribution(hidden).filter(bucket => bucket.count > 0).map(({count, uncertain}) => [count, uncertain]), [[1, 1]]);
});

void test('daily totals split observed time at local midnight in the requested zone, and credits land where they were found', () => {
  const played = play([
    {from: '23:50', to: '23:59:55', heater: true}, {from: '24:00', to: '24:05', heater: true}, {from: '24:05:05', to: '24:06'},
  ]);
  const derived = derive(structural(played.facts), played.state.lastReadingAtMs);
  const sessions = groupSessions(derived, 15);
  const utc = dailyTotals(derived, sessions, 'UTC');
  assert.deepEqual(utc.map(({date, observedHeatingMs, sessions: count, stretches}) => [date, observedHeatingMs, count, stretches]), [
    ['2026-11-04', clock('24:05:05') - clock('24:00'), 0, 0],
    ['2026-11-03', 10 * MIN, 1, 1],
  ]);
  const tokyo = dailyTotals(derived, sessions, 'Asia/Tokyo');
  assert.deepEqual(tokyo.map(({date}) => date), ['2026-11-04'], 'all of it is the next local day there');
  const credited = play(missed);
  const creditedDerived = derive(structural(credited.facts), credited.state.lastReadingAtMs);
  assert.equal(dailyTotals(creditedDerived, groupSessions(creditedDerived, 15), 'UTC')[0]?.creditedMinutes, 5);
});
