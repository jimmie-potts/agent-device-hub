import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activity, normalizeStatus, normalizeSummary, normalizeRecord, normalizeConsumables } from '../src/normalize.js';
const begin = 1700000000;
const known = (value: unknown) => ({ kind: 'known', value });
void test('unqualified extra_time retains its raw value without claiming seconds', () => {
    const r = normalizeRecord({ begin, extra_time: 42 }, begin);
    assert.deepEqual(r.extraTimeRaw, known(42));
    assert.deepEqual(r.extraTimeSeconds, { kind: 'unknown', reason: 'unqualified' });
});
void test('explicit objects, wrappers and positional layouts preserve units and independent record identity', () => {
    const raw = { state: 5, battery: 82, clean_time: 123, clean_area: 12345678 };
    assert.deepEqual(normalizeStatus([raw]), normalizeStatus(raw));
    assert.deepEqual(normalizeStatus(raw).cleanAreaMm2, known(12345678));
    assert.deepEqual(normalizeSummary([400, 500, 600, [begin]]).recordIds, known([begin]));
    const record = { begin, end: begin + 900, duration: 600, area: 12000000, cleaned_area: 13000000, task_id: '007' };
    const r = normalizeRecord([record], begin);
    assert.deepEqual(r.recordId, known(begin));
    assert.deepEqual(r.durationSeconds, known(600));
    assert.deepEqual(r.cleanedAreaMm2, known(13000000));
    assert.deepEqual(r.taskId, known('007'));
    assert.equal(normalizeRecord({ ...record, begin: begin + 1 }, begin).recordId.kind, 'unknown');
    const slots = [begin, begin + 900, 600, 12000000, 0, 1, 2, 3, 999];
    assert.deepEqual(normalizeRecord([slots], begin).finishReasonCode, known(999));
    assert.equal(normalizeRecord([42, ...slots], begin).recordId.kind, 'unknown');
    for (const bad of [slots.slice(0, 8), [...slots, 0, 1], [[slots]], []])
        assert.equal(normalizeRecord(bad, begin).layout.kind, 'unknown');
});
void test('missingness, invalid values, raw codes and exact activity flags do not invent measurements or completion', () => {
    assert.deepEqual(normalizeStatus({}).batteryPercent, { kind: 'unknown', reason: 'absent' });
    for (const battery of [null, '0', false, NaN, Infinity, -1, 101, 0.5])
        assert.deepEqual(normalizeStatus({ battery }).batteryPercent, { kind: 'unknown', reason: 'invalid' });
    for (const value of ['12', NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
        assert.equal(normalizeStatus({ clean_time: value, clean_area: value }).cleanTimeSeconds.kind, 'unknown');
    assert.deepEqual(normalizeStatus({ error_code: -1, state: 777 }).errorCode, known(-1));
    assert.equal(activity(normalizeStatus({ state: 777 })), 'unknown');
    for (const state of [5, 11, 17, 18])
        assert.equal(activity(normalizeStatus({ state })), 'cleaning');
    for (const state of [6, 15])
        assert.equal(activity(normalizeStatus({ state })), 'returning');
    assert.equal(activity(normalizeStatus({ state: 8, clean_time: 720, clean_area: 21000000 })), 'other');
    assert.equal(activity(normalizeStatus({ state: 8, in_cleaning: 2 })), 'unknown');
    assert.equal(activity(normalizeStatus({ state: 5, in_returning: 1 })), 'unknown');
    assert.equal(Object.hasOwn(normalizeStatus({ state: 8 }), 'completed'), false);
    assert.equal(normalizeRecord({ begin, end: begin - 1 }, begin).endSeconds.kind, 'unknown');
});
void test('summary subsets retain every valid ID and distinguish absent, invalid and empty', () => {
    const r = normalizeSummary({ records: [begin, 'bad', begin, begin + 1, null, 0] });
    assert.deepEqual(r.recordIds, known([begin, begin + 1]));
    assert.equal(r.invalidRecordIdCount, 3);
    assert.deepEqual(normalizeSummary({ records: [] }).recordIds, known([]));
    assert.deepEqual(normalizeSummary({}).recordIds, { kind: 'unknown', reason: 'absent' });
    assert.equal(normalizeSummary({ records: [null, -1] }).recordIds.kind, 'unknown');
    for (const v of [[100, 200, [begin]], [100, 200, 3, [begin], 4]])
        assert.equal(normalizeSummary(v).layout.kind, 'unknown');
});
void test('dock bits retain full input and unqualified labels; consumables keep measured seconds/cycles', () => {
    const dss = (0x80000000 | (1 << 8) | (2 << 6) | (3 << 4) | (2 << 2) | 1) >>> 0, dock = normalizeStatus({ dss }).dock;
    assert.deepEqual(dock.rawDss, known(dss));
    assert.deepEqual(dock.dustBag.sourceLabel, known('ok'));
    assert.equal(dock.dustBag.qualification, 'unqualified');
    assert.equal(normalizeStatus({}).dock.dustBag.raw.kind, 'unknown');
    const c = normalizeConsumables({ main_brush_work_time: 3601, strainer_work_times: 7 }).items;
    assert.deepEqual(c.find(x => x.sourceKey === 'strainer_work_times'), { sourceKey: 'strainer_work_times', unit: 'cycles', used: known(7) });
    assert.deepEqual(c.find(x => x.sourceKey === 'main_brush_work_time')?.used, known(3601));
    assert.equal(c.find(x => x.sourceKey === 'filter_work_time')?.used.kind, 'unknown');
});
void test('no heuristics, getters, original mutation or arbitrary personal fields in projections', () => {
    let calls = 0;
    const getter = Object.defineProperty({}, 'battery', { enumerable: true, get: () => { calls++; return 100; } });
    assert.equal(normalizeStatus(getter).layout.kind, 'unknown');
    assert.equal(calls, 0);
    const raw = { state: 5, household_note: 'synthetic-private-note', account_extra: { synthetic: true } }, before = structuredClone(raw);
    assert.equal(JSON.stringify(normalizeStatus(raw)).includes('synthetic-private-note'), false);
    assert.deepEqual(raw, before);
    for (const v of [[], [1], [{}, {}], 'ok', 0, false, new Date(0), [[{}]]])
        assert.equal(normalizeStatus(v).layout.kind, 'unknown');
});
