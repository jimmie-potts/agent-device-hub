import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ageText, bucketLabel, durationText, minutesText, sessionRow, shiftDay, temperature, thresholdValue, timelineRows, totalsLine, volcanoNow} from '../src/frontend/card-data.js';
import {gapsDocument, messageStatus, Refused, refusal, sessionsDocument, statusDocument, timelineDocument, type TimelineFact} from '../src/frontend/documents.js';
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
  stretches: [{startAtMs: NOW, startedBeforeObservation: false, endAtMs: NOW + 25 * MIN, endedUnobservedBy: null, lastObservedOnAtMs: NOW + 25 * MIN, open: false, observedHeatingMs: 25 * MIN, creditedMinutes: 0, pumpRuns: 1, unobserved: [], omittedUnobserved: 0}], omittedStretches: 0, ...over,
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
  assert.equal(rows[0]?.detail, '', 'no duration crosses the unobserved interval');
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
  assert.equal(reset[0]?.kind, 'discontinuity'); assert.match(reset[0]?.detail ?? '', /No time or credit/u);
  const stepped = timelineRows([on(1, NOW), {...stamp(2, NOW + MIN), kind: 'discontinuity', reason: 'clock-step', lastReadingAtMs: NOW}, off(3, NOW + 2 * MIN)]);
  assert.match(stepped[0]?.detail ?? '', /Its end is unknown/u); assert.doesNotMatch(stepped[0]?.title ?? '', / to /u);
});

void test('pump runs and temperature samples: a run is a row, a sample is not', () => {
  const rows = timelineRows([{...stamp(1, NOW), kind: 'pump', on: true, status1: 0, edge: 'observed'}, {...stamp(2, NOW + 1000), kind: 'temperature', currentDeciC: 1000}, {...stamp(3, NOW + MIN), kind: 'pump', on: false, status1: 0, edge: 'observed'}]);
  assert.deepEqual(rows.map(row => row.kind), ['pump']); assert.match(rows[0]?.title ?? '', /^Pump .* to /u);
});

void test('a session says what it does not know', () => {
  assert.equal(sessionRow(session()).partial, false);
  const first = sessionRow(session({startedBeforeObservation: true}));
  assert.equal(first.partial, true); assert.match(first.start, /^First seen on /u);
  const hidden = sessionRow(session({endAtMs: null, endedUnobservedBy: NOW + 30 * MIN}));
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
