import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ageText, bucketLabel, durationText, minutesText, sessionRow, shiftDay, temperature, thresholdValue, timelineRows, totalsLine, volcanoNow} from '../src/frontend/card-data.js';
import {gapsDocument, messageStatus, Refused, refusal, sessionsDocument, statusDocument, timelineDocument, totalsDocument, type TimelineFact} from '../src/frontend/documents.js';
import {validateGaps, validateSessions, validateStatus, validateTimeline, validateTotals} from '../src/families.js';
import type {Session} from '../src/sessions.js';
import type {VolcanoStatus} from '../src/status-document.js';

const NOW = Date.UTC(2026, 10, 4, 20, 30);
const status = (over: Partial<VolcanoStatus> = {}): VolcanoStatus => ({
  schema: 'volcano-status/2.0', id: 'volcano', revision: 4, configurationRevision: 1, availability: 'available', link: 'connected', observedAtMs: NOW - 5000, receivedAtMs: NOW - 5000,
  heater: 'on', pump: 'off', status1: 0x0623, currentDeciC: 1850, targetDeciC: 1850, heatingCounterMinutes: 725, displayFahrenheit: false, gapMinutes: 15, recording: 'ok', ...over,
});
const stamp = (seq: number, at: number) => ({seq, observedAtMs: at, receivedAtMs: at});
const on = (seq: number, at: number, edge: 'observed' | 'first-observation' | 'after-gap' = 'observed'): TimelineFact => ({...stamp(seq, at), kind: 'heater', on: true, status1: 0x20, edge});
const off = (seq: number, at: number, edge: 'observed' | 'first-observation' | 'after-gap' = 'observed'): TimelineFact => ({...stamp(seq, at), kind: 'heater', on: false, status1: 0, edge});
const MIN = 60_000;
const session = (over: Partial<Session> = {}): Session => ({
  startAtMs: NOW, startedBeforeObservation: false, endAtMs: NOW + 25 * MIN, endedUnobservedBy: null, lastObservedOnAtMs: NOW + 25 * MIN, open: false, observedHeatingMs: 25 * MIN, creditedMinutes: 0, pumpRuns: 1, discontinuities: 0,
  stretches: [{startAtMs: NOW, startedBeforeObservation: false, endAtMs: NOW + 25 * MIN, endedUnobservedBy: null, lastObservedOnAtMs: NOW + 25 * MIN, open: false, observedHeatingMs: 25 * MIN, creditedMinutes: 0, pumpRuns: 1, unobserved: [], omittedUnobserved: 0}], omittedStretches: 0, unobservedBetween: 0, ...over,
});

void test('a current reading shows its values, in the unit the device displays', () => {
  const data = volcanoNow({doc: status(), connected: true, live: true, error: undefined, now: NOW});
  assert.equal(data.freshness, 'current'); assert.equal(data.title, 'Heating'); assert.equal(data.heater, 'On'); assert.equal(data.pump, 'Off');
  assert.equal(data.current, '185 °C'); assert.equal(data.counter, '12 h 5 min'); assert.deepEqual(data.notices, []);
  assert.equal(temperature(1850, true), '365 °F'); assert.equal(temperature(1855, false), '185.5 °C'); assert.equal(temperature(null, true), 'Unknown');
});

void test('nothing that is not current reads as off or as a value', () => {
  for (const data of [
    volcanoNow({doc: status({availability: 'unavailable', link: 'disconnected', heater: 'unknown', pump: 'unknown', currentDeciC: null}), connected: true, live: true, error: undefined, now: NOW}),
    volcanoNow({doc: status({heater: 'off'}), connected: true, live: false, error: 'unavailable', now: NOW}),
    volcanoNow({doc: undefined, connected: false, live: false, error: undefined, now: NOW}),
    volcanoNow({doc: undefined, connected: true, live: false, error: 'forbidden', now: NOW}),
  ]) {
    assert.notEqual(data.freshness, 'current');
    assert.equal(data.heater, 'Unknown'); assert.equal(data.pump, 'Unknown'); assert.equal(data.current, 'Unknown'); assert.equal(data.counter, 'Unknown');
    assert.doesNotMatch(data.title, /off/iu);
    assert.ok(data.notices.length > 0);
  }
  assert.equal(volcanoNow({doc: status({heater: 'off'}), connected: true, live: false, error: 'unavailable', now: NOW}).title, 'Stale');
  assert.equal(volcanoNow({doc: undefined, connected: true, live: false, error: undefined, now: NOW}).title, 'Loading');
  assert.match(volcanoNow({doc: status({recording: 'refused'}), connected: true, live: true, error: undefined, now: NOW}).notices.join(' '), /not being stored/u);
});

void test('a future or missing stamp has no age', () => {
  assert.equal(ageText(NOW + 1, NOW), 'Age unknown'); assert.equal(ageText(null, NOW), 'Age unknown');
  assert.equal(ageText(NOW - 30_000, NOW), '30 s ago'); assert.equal(ageText(NOW - 90 * MIN, NOW), '1 h 30 min ago');
});

void test('times read as they are', () => {
  assert.equal(durationText(0), '0 min'); assert.equal(durationText(10), '<1 min'); assert.equal(durationText(25 * MIN), '25 min');
  assert.equal(minutesText(120), '2 h'); assert.equal(bucketLabel({fromMinutes: 60, toMinutes: null, count: 1, uncertain: 0}), '60+ min'); assert.equal(bucketLabel({fromMinutes: 5, toMinutes: 15, count: 1, uncertain: 0}), '5 to 15 min');
});

void test('the timeline draws a duration only between two edges it saw', () => {
  const [plain] = timelineRows([on(1, NOW), off(2, NOW + 25 * MIN)]);
  assert.equal(plain?.detail, '25 min');
  const rows = timelineRows([on(1, NOW), {...stamp(2, NOW + 20 * MIN), kind: 'gap', fromMs: NOW + 10 * MIN, toMs: NOW + 20 * MIN, heaterBefore: 'on', heaterAfter: 'on', creditedMinutes: 7}, off(3, NOW + 25 * MIN)]);
  assert.deepEqual(rows.map(row => row.kind), ['heating', 'gap']);
  assert.equal(rows[0]?.detail, 'Includes unobserved time.', 'no duration crosses the unobserved interval');
  assert.match(rows[1]?.detail ?? '', /Heater on before, on after; counter gained 7 min/u);
  const hidden = timelineRows([on(1, NOW), {...stamp(2, NOW + 20 * MIN), kind: 'gap', fromMs: NOW + 10 * MIN, toMs: NOW + 20 * MIN, heaterBefore: 'on', heaterAfter: 'off', creditedMinutes: null}, off(3, NOW + 20 * MIN, 'after-gap')]);
  assert.match(hidden[0]?.detail ?? '', /The end was not seen/u); assert.match(hidden[1]?.detail ?? '', /no credit/u);
  assert.doesNotMatch(hidden[0]?.title ?? '', / to /u);
  assert.match(timelineRows([on(1, NOW, 'first-observation')])[0]?.detail ?? '', /may have started earlier.*No end in this view/u);
  assert.match(timelineRows([off(1, NOW)])[0]?.detail ?? '', /before this view/u);
  assert.equal(timelineRows([off(1, NOW, 'after-gap')])[0]?.detail, 'Seen off after an unobserved interval.');
  const first = timelineRows([off(1, NOW, 'first-observation')])[0];
  assert.match(first?.title ?? '', /^First seen off at /u); assert.equal(first?.detail, '', 'a first reading of off claims no gap');
});

void test('a discontinuity is shown, and one that closes a stretch leaves its end unknown', () => {
  const reset = timelineRows([{...stamp(1, NOW), kind: 'discontinuity', reason: 'counter-decrease', lastReadingAtMs: NOW - MIN}]);
  assert.equal(reset[0]?.kind, 'discontinuity'); assert.equal(reset[0]?.detail, 'No counter credit is counted across this.', 'observed time does run across a counter discontinuity');
  const stepped = timelineRows([on(1, NOW), {...stamp(2, NOW + MIN), kind: 'discontinuity', reason: 'clock-step', lastReadingAtMs: NOW}, off(3, NOW + 2 * MIN)]);
  assert.equal(stepped[1]?.detail, 'No time or credit is counted across this.');
  assert.match(stepped[0]?.detail ?? '', /Its end is unknown/u); assert.doesNotMatch(stepped[0]?.title ?? '', / to /u);
});

void test('pump runs and temperature samples: a run is a row, a sample is not', () => {
  const rows = timelineRows([{...stamp(1, NOW), kind: 'pump', on: true, status1: 0, edge: 'observed'}, {...stamp(2, NOW + 1000), kind: 'temperature', currentDeciC: 1000}, {...stamp(3, NOW + MIN), kind: 'pump', on: false, status1: 0, edge: 'observed'}]);
  assert.deepEqual(rows.map(row => row.kind), ['pump']); assert.match(rows[0]?.title ?? '', /^Pump .* to /u);
});

void test('a session says what it does not know', () => {
  assert.equal(sessionRow(session(), true).partial, false);
  const first = sessionRow(session({startedBeforeObservation: true}));
  assert.equal(first.partial, true); assert.match(first.start, /^First seen on /u);
  const hidden = sessionRow(session({endAtMs: null, endedUnobservedBy: NOW + 30 * MIN, stretches: session().stretches.map(value => ({...value, endAtMs: null, endedUnobservedBy: NOW + 30 * MIN}))}));
  assert.match(hidden.end, /^End not seen: last on .*, off by /u); assert.equal(hidden.partial, true);
  assert.match(sessionRow(session({endAtMs: null, open: true})).end, /^No end seen yet/u);
  assert.match(sessionRow(session({endAtMs: null})).end, /^End unknown/u);
  const stretches = session().stretches;
  const crossed = sessionRow(session({creditedMinutes: 7, stretches: stretches.map(value => ({...value, creditedMinutes: 7, unobserved: [{fromMs: NOW, toMs: NOW + MIN, creditedMinutes: 7}]}))}));
  assert.deepEqual(crossed.facts.find(([name]) => name === 'Counter credit'), ['Counter credit', '7 min']);
  assert.deepEqual(sessionRow(session({discontinuities: 2})).facts.at(-1), ['Discontinuities', '2']);
  assert.ok(!sessionRow(session()).facts.some(([name]) => name === 'Counter credit'), 'no credit line where nothing was unobserved');
  for (const [name] of sessionRow(session()).facts) assert.doesNotMatch(name, /dose|consum|inhal/iu);
});

void test('an unknown counter credit never reads as zero or as an exact sum', () => {
  const inside = (credits: readonly (number | null)[], omittedUnobserved = 0, creditedMinutes = 0): Session => session({creditedMinutes, stretches: session().stretches.map(value => ({...value, creditedMinutes, omittedUnobserved, unobserved: credits.map(minutes => ({fromMs: NOW, toMs: NOW + MIN, creditedMinutes: minutes}))}))});
  const credit = (value: Session): string | undefined => sessionRow(value).facts.find(([name]) => name === 'Counter credit')?.[1];
  assert.equal(credit(inside([null])), 'Unknown');
  assert.equal(credit(inside([7, null], 0, 7)), 'At least 7 min');
  assert.equal(credit(inside([7], 1, 7)), 'At least 7 min', 'an omitted interval may have had no credit');
  assert.equal(credit(inside([0])), '0 min', 'a counter that was read on both sides and did not move is a real zero');
  assert.equal(credit({...session({creditedMinutes: 9}), omittedStretches: 1}), 'At least 9 min');
});

void test('a session is incomplete when anything inside it was not seen, including between its stretches', () => {
  assert.equal(sessionRow(session()).note, '');
  const [one] = session().stretches;
  assert.ok(one !== undefined);
  const between = sessionRow(session({unobservedBetween: 1, stretches: [one, one]}));
  assert.equal(between.partial, true); assert.match(between.note, /Incomplete evidence/u);
  assert.deepEqual(between.facts.find(([name]) => name === 'Unobserved intervals'), ['Unobserved intervals', '1']);
  assert.ok(!between.facts.some(([name]) => name === 'Counter credit'), 'an interval between stretches has no credit on the session');
  assert.equal(sessionRow(session({stretches: [one, {...one, startedBeforeObservation: true}]})).partial, true, 'a later stretch first seen on');
  assert.equal(sessionRow(session({stretches: [{...one, endAtMs: null, endedUnobservedBy: NOW + MIN}, one]})).partial, true, 'an earlier stretch with no seen end');
  assert.deepEqual(sessionRow({...session(), omittedStretches: 2}).facts.find(([name]) => name === 'Unobserved intervals'), ['Unobserved intervals', 'At least 0']);
  const open = session({endAtMs: null, open: true, stretches: [{...one, endAtMs: null, open: true}]});
  const running = sessionRow(open, true);
  assert.match(running.end, /^No end seen yet/u);
  assert.equal(running.partial, false, 'a session being watched has no end yet, and nothing missing');
  assert.equal(running.note, '');
  assert.match(sessionRow(open, false).note, /Incomplete evidence/u, 'with the feed lost, it may be running unseen');
  assert.equal(sessionRow(session({discontinuities: 1})).note, '', 'a counter discontinuity has its own line, and says nothing about unobserved time');
  assert.equal(sessionRow(session({endAtMs: null, stretches: [{...one, endAtMs: null}]}), true).partial, true, 'a stretch closed with no end time');
});

void test('a span over days shows its dates, so it cannot read as minutes', () => {
  const [row] = timelineRows([{...stamp(1, NOW + 2 * 1440 * MIN), kind: 'gap', fromMs: NOW, toMs: NOW + 2 * 1440 * MIN + 5 * MIN, heaterBefore: 'off', heaterAfter: 'off', creditedMinutes: null}]);
  assert.match(row?.title ?? '', /Nov/u);
  assert.match(sessionRow(session({endAtMs: NOW + 1440 * MIN})).end, /Nov/u);
  assert.doesNotMatch(sessionRow(session({endAtMs: new Date(new Date(NOW).setHours(23, 0, 0, 0)).getTime(), startAtMs: new Date(new Date(NOW).setHours(22, 0, 0, 0)).getTime()})).end, /Nov/u);
});

void test('a pump or heater range over an unobserved interval says so', () => {
  const gap: TimelineFact = {...stamp(2, NOW + 2 * MIN), kind: 'gap', fromMs: NOW + MIN, toMs: NOW + 2 * MIN, heaterBefore: 'on', heaterAfter: 'on', creditedMinutes: 1};
  const rows = timelineRows([on(1, NOW), {...stamp(3, NOW + 10), kind: 'pump', on: true, status1: 0, edge: 'observed'}, gap, {...stamp(4, NOW + 3 * MIN), kind: 'pump', on: false, status1: 0, edge: 'observed'}, off(5, NOW + 4 * MIN)]);
  assert.equal(rows.find(row => row.kind === 'heating')?.detail, 'Includes unobserved time.');
  assert.equal(rows.find(row => row.kind === 'pump')?.detail, 'Includes unobserved time.');
});

void test('every synthetic document the card checks is one the module\'s own schema accepts', () => {
  const ids = {id: 'volcano', revision: 1};
  const facts: TimelineFact[] = [on(1, NOW, 'first-observation'), off(2, NOW + MIN), {...stamp(3, NOW), kind: 'pump', on: true, status1: 0, edge: 'observed'}, {...stamp(4, NOW), kind: 'setpoint', targetDeciC: 1850}, {...stamp(5, NOW), kind: 'temperature', currentDeciC: 1850},
    {...stamp(6, NOW), kind: 'counter', hours: 1, minutes: 2, totalMinutes: 62}, {...stamp(7, NOW), kind: 'link', state: 'stale'}, {...stamp(8, NOW), kind: 'collector-restart'},
    {...stamp(9, NOW), kind: 'gap', fromMs: NOW, toMs: NOW + 1, heaterBefore: 'unknown', heaterAfter: 'on', creditedMinutes: null}, {...stamp(10, NOW), kind: 'discontinuity', reason: 'clock-step', lastReadingAtMs: null}];
  const timeline = {schema: 'volcano-timeline/2.0', ...ids, facts, next: null};
  const sessions = {schema: 'volcano-sessions/2.0', ...ids, gapMinutes: 15, preview: true, sessions: [session({unobservedBetween: 2})], next: '15:3'};
  const totals = {schema: 'volcano-totals/2.0', ...ids, zone: 'UTC', gapMinutes: 15, days: [{date: '2026-11-04', observedHeatingMs: 1, creditedMinutes: 0, stretches: 1, sessions: 1, pumpRuns: 0}], next: null};
  const gaps = {schema: 'volcano-gaps/2.0', ...ids, gapMinutes: 15, buckets: [{fromMinutes: 0, toMinutes: null, count: 1, uncertain: 0}]};
  assert.equal(validateStatus(status()), true); assert.equal(validateTimeline(timeline), true); assert.equal(validateSessions(sessions), true); assert.equal(validateTotals(totals), true); assert.equal(validateGaps(gaps), true);
  assert.equal(statusDocument(status()).id, 'volcano'); assert.equal(timelineDocument(timeline, 'volcano').facts.length, facts.length); assert.equal(sessionsDocument(sessions, 'volcano', 15).next, '15:3');
  assert.equal(totalsDocument(totals, 'volcano').days.length, 1); assert.equal(gapsDocument(gaps, 'volcano').buckets.length, 1);
  assert.throws(() => sessionsDocument({...sessions, sessions: [{...session(), unobservedBetween: undefined}]}, 'volcano'), Refused);
});

void test('a daily total keeps observed time and credit apart', () => {
  assert.equal(totalsLine({date: '2026-11-04', observedHeatingMs: 25 * MIN, creditedMinutes: 7, stretches: 2, sessions: 1, pumpRuns: 2}), '25 min observed · 7 min credited · 1 session · 2 pump runs');
  assert.doesNotMatch(totalsLine({date: '2026-11-04', observedHeatingMs: 0, creditedMinutes: 0, stretches: 0, sessions: 0, pumpRuns: 0}), /credited/u);
});

void test('the threshold takes a whole number of minutes in the module\'s range', () => {
  assert.equal(thresholdValue('15'), 15); assert.equal(thresholdValue(' 240 '), 240); assert.equal(thresholdValue('1'), 1);
  for (const text of ['', '0', '241', '1.5', '-1', '1e2', '007', 'abc']) assert.equal(thresholdValue(text), undefined, text);
});

void test('a day shift lands on local midnight across a daylight change', () => {
  const start = new Date(2026, 2, 7).getTime();
  assert.equal(new Date(shiftDay(start, 1)).getDate(), 8); assert.equal(new Date(shiftDay(start, 2)).getHours(), 0); assert.equal(shiftDay(start + 5 * MIN, 0), start);
});

void test('documents are closed, and a foreign or malformed one is refused', () => {
  assert.equal(statusDocument(status()).id, 'volcano');
  assert.throws(() => statusDocument({...status(), serial: 'x'}), Refused);
  assert.throws(() => statusDocument(status(), 'other'), Refused);
  assert.throws(() => timelineDocument({schema: 'volcano-timeline/2.0', id: 'volcano', revision: 1, facts: [{...stamp(1, NOW), kind: 'dose'}], next: null}, 'volcano'), Refused);
  assert.equal(timelineDocument({schema: 'volcano-timeline/2.0', id: 'volcano', revision: 1, facts: [on(1, NOW)], next: null}, 'volcano').facts.length, 1);
  assert.equal(sessionsDocument({schema: 'volcano-sessions/2.0', id: 'volcano', revision: 1, gapMinutes: 15, preview: false, sessions: [session()], next: null}, 'volcano').sessions.length, 1);
  assert.throws(() => sessionsDocument({schema: 'volcano-sessions/2.0', id: 'volcano', revision: 1, gapMinutes: 15, preview: false, sessions: [], next: null}, 'volcano', 30), Refused);
  assert.throws(() => gapsDocument({schema: 'volcano-gaps/2.0', id: 'volcano', revision: 1, gapMinutes: 300, buckets: []}, 'volcano'), Refused);
  const message = {source: 'bunny/modules/volcano', kind: 'state', type: 'org.bunny.volcano-status.updated', dataschema: 'https://bunny.invalid/events/volcano-status/2.0', subject: 'volcano', data: status()} as unknown as Parameters<typeof messageStatus>[0];
  assert.equal(messageStatus(message).id, 'volcano');
  assert.throws(() => messageStatus({...message, source: 'bunny/modules/other'}), Refused);
  assert.equal(refusal({body: {error: {code: 'forbidden'}}}), 'forbidden'); assert.equal(refusal(new Error('x')), 'unavailable');
});
