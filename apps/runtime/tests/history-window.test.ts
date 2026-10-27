import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {History, historyFilter, HISTORY_FILTER_SCHEMA} from '../src/core/history.js';

void test('history limits select the latest matching committed rows before decoding and retain oldest-first compatibility', context => {
  const database = new DatabaseSync(':memory:');context.after(() => database.close());
  const history = new History(database);
  const insert = database.prepare('INSERT INTO core_history (at_ms, revision, kind, source, type, subject, record) VALUES (?, 1, ?, ?, ?, ?, ?)');
  const expected: number[] = [];
  database.exec('BEGIN');
  for (let index = 1; index <= 2400; index++) {
    const matching = index % 2 === 0;
    const session = index % 6 === 0 ? {data: {session: 'session_1'}} : index % 6 === 2 ? {session: 'session_1'} : {};
    insert.run(10_000 - index, matching ? 'occurrence' : 'change', matching ? 'bunny/modules/lifx' : 'bunny/core', 'synthetic.event',
      index % 6 === 4 ? 'session_1' : 'other', JSON.stringify({...session, payload: 'x'.repeat(16_384)}));
    if (matching && 10_000 - index >= 8000 && 10_000 - index <= 9800) expected.push(index);
  }
  database.exec('COMMIT');
  const filters = {kind: 'occurrence', source: 'bunny/modules/lifx', session: 'session_1', fromAtMs: 8000, toAtMs: 9800};
  for (const limit of [1, 200, 500]) {
    const filter = historyFilter({...filters, limit});assert.ok(filter, `valid limit ${limit}`);
    const rows = history.read(filter);
    assert.deepEqual(rows.map(row => row.seq), expected.slice(-limit), 'inclusive combined filters precede the cap; latest is committed sequence');
    assert.ok(rows.every(row => row.record.payload === 'x'.repeat(16_384)));
  }
  assert.deepEqual(history.read(historyFilter(filters)).map(row => row.seq), expected, 'omitted limit retains every match');
  assert.equal(history.read().length, 2400, 'archive is intact and unlimited compatibility remains');
  assert.deepEqual(history.read(historyFilter({limit: 200})).map(row => row.seq), Array.from({length: 200}, (_, index) => 2201 + index));
});

void test('a bounded window never decodes an older unselected record', context => {
  const database = new DatabaseSync(':memory:');context.after(() => database.close());const history = new History(database);
  database.exec(`INSERT INTO core_history (at_ms, revision, kind, source, type, subject, record) VALUES
    (1, 1, 'occurrence', 'bunny/core', 'synthetic.event', 'old', 'invalid JSON'),
    (0, 1, 'occurrence', 'bunny/core', 'synthetic.event', 'new', '{"selected":true}')`);
  const filter = historyFilter({limit: 1});assert.ok(filter);
  assert.deepEqual(history.read(filter).map(row => row.record), [{selected: true}]);
});

void test('shared history limit schema and validation reject invalid inputs without changing other filters', () => {
  assert.deepEqual((HISTORY_FILTER_SCHEMA.properties as Record<string, unknown>).limit, {type: 'integer', minimum: 1, maximum: 500});
  for (const limit of [0, -1, 1.5, 501, '200', null, true, NaN, Infinity]) assert.equal(historyFilter({limit}), undefined, String(limit));
  for (const limit of [1, 200, 500]) assert.deepEqual(historyFilter({limit}), {limit});
  assert.deepEqual(historyFilter({}), {});
});
