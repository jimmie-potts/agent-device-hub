// Hub #950: what a run's supervisor takes from its runtime's stderr as the journal. A line that is a JSON object with an
// event name is a record, kept with the runtime that wrote it; any other line with something in it is counted, so the
// follow query can say that the journal held lines that were not records.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Journal} from '../journal.js';

void test('a JSON object with an event name is kept with its generation, and every other line with content is counted', () => {
  const journal = new Journal();
  journal.take(1, JSON.stringify({event_name: 'runtime.started', attributes: {}}));
  journal.take(2, JSON.stringify({event_name: 'runtime.ready'}));
  for (const line of ['usage: main.js --port <0-65535>', '{"truncated":', '{}', '[]', 'null', '42', '"text"', JSON.stringify({event_name: 7}), '    at Object.<anonymous> (file.js:1:1)']) {
    journal.take(2, line);
  }
  assert.deepEqual(journal.entries.map(entry => [entry.generation, (entry.record as {event_name: string}).event_name]), [[1, 'runtime.started'], [2, 'runtime.ready']]);
  assert.equal(journal.skipped, 9);
});

void test('a blank line is not counted: it holds nothing that could have been a record', () => {
  const journal = new Journal();
  for (const line of ['', '   ', '\t']) journal.take(1, line);
  assert.deepEqual([journal.entries.length, journal.skipped], [0, 0]);
});

void test('the count of skipped lines saturates at the largest safe integer', () => {
  const journal = new Journal();
  journal.skipped = Number.MAX_SAFE_INTEGER;
  journal.take(1, 'not a record');
  assert.equal(journal.skipped, Number.MAX_SAFE_INTEGER);
});

void test('the line that was taken is returned, and a line that was not is not', () => {
  const journal = new Journal();
  assert.equal(journal.take(1, JSON.stringify({event_name: 'runtime.ready'}))?.event_name, 'runtime.ready');
  assert.equal(journal.take(1, 'plain text'), undefined);
});
