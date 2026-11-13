import assert from 'node:assert/strict';
import type {DatabaseSync} from 'node:sqlite';
import {validateRecord} from '@jimmie-potts/bunny-observability';
import {SCHEMA_BASE, type Message} from '@jimmie-potts/event-contracts/v2';
import {bookkeeping} from '@jimmie-potts/event-contracts/v2/bookkeeping';
import type {LogFields} from '@jimmie-potts/sdk';
import {LogWriter} from '../src/log.js';
import {MODULE_SCOPE, type LogRecord} from '../src/record.js';
import {World} from './fixtures/store-world.js';
import {it, manualClock} from './support.js';

const EVENT = 'history.entity.noisy';
const SOURCE = 'bunny/modules/wemo';
const HOUR = 3_600_000;
const AT = Date.parse('2026-10-06T12:00:00.000Z');
const ID = 'fixture-plug';
const PIXOO = 'bunny/modules/pixoo';
const HISTORY_DEVICES = [{owner: SOURCE, id: ID}, {owner: SOURCE, id: 'other-plug'}, {owner: PIXOO, id: ID}];

function state(revision: number, {id = ID, source = SOURCE, family = 'device', power = revision % 2 === 0} = {}): Message {
  return {
    specversion: '1.0', bunnyprofile: '2.0', kind: 'state', id: `fixture-${id}-${family}-${revision}`, source,
    type: `org.bunny.${family}.updated`, subject: id, time: new Date(AT).toISOString(), datacontenttype: 'application/json',
    dataschema: `${SCHEMA_BASE}${family}/2.4`, traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
    data: {id, revision, power, label: 'Synthetic private label', endpoint: 'https://fixture.invalid/private'},
  };
}

function take(world: World, ...messages: readonly Message[]): Promise<void> {
  return world.store.transaction(tx => {
    for (const message of messages) tx.record(message);
  });
}

async function writes(world: World, first: number, last: number, options?: Parameters<typeof state>[1]): Promise<void> {
  await take(world, ...Array.from({length: last - first + 1}, (_, index) => state(first + index, options)));
}

function diagnostics(clock: ReturnType<typeof manualClock>, secret?: string) {
  const warnings: LogRecord[] = [];
  const writer = new LogWriter(record => {
    if (record.event_name === EVENT) warnings.push(record);
  }, 'info', clock);
  if (secret !== undefined) writer.redact(secret);
  return {log: writer.logger(MODULE_SCOPE, {'bunny.module': 'core'}), warnings};
}

function alarmOf(id = ID, source = SOURCE, family = 'device', hour = AT): LogFields {
  return {'bunny.module': 'core', 'bunny.provenance': 'source', 'bunny.participant': source,
    'bunny.history.family': family, 'bunny.history.entity_id': id, 'bunny.history.row_count': 121,
    'bunny.history.row_threshold': 120, 'bunny.history.hour_start_at_ms': hour};
}

it('history alarms at 121 committed change rows per entity and leaves rows and their fact order identical', async context => {
  const clock = manualClock(AT), {log, warnings} = diagnostics(clock);
  const world = await World.open(context, {clock, watch: {log, historyDevices: HISTORY_DEVICES}});
  const silent = await World.open(context, {clock});
  await writes(world, 1, 120);
  await writes(silent, 1, 120);
  assert.equal(warnings.length, 0, '120 rows is within the threshold');
  for (const target of [world, silent]) {
    // Duplicate, stale, and a new revision confirming the last state add no rows.
    await take(target, state(120), state(119), state(121, {power: true}));
    await writes(target, 123, 124);
  }
  assert.deepEqual(warnings.map(record => record.attributes), [alarmOf()]);
  const [warning] = warnings;
  assert.ok(warning !== undefined && validateRecord(warning).ok);
  assert.equal(warning.severity_text, 'WARN');
  const facts = (target: World) => target.store.history.after(target.store.history.origin, 0)
    .map(({origin, ...row}) => row);
  assert.deepEqual(facts(world), facts(silent));
  assert.equal(facts(world).length, 122);
});

it('history counts gaps and span-closing changes, with independent writer, family, entity and hour buckets', async context => {
  const clock = manualClock(AT), {log, warnings} = diagnostics(clock);
  const world = await World.open(context, {clock, watch: {log, historyDevices: HISTORY_DEVICES, history: {bookkeeping, polling: {[SOURCE]: {device: 5000}}}}});
  await writes(world, 1, 119);
  await writes(world, 1, 120, {id: 'other-plug'});
  await writes(world, 1, 120, {source: PIXOO});
  await writes(world, 1, 120, {source: PIXOO, family: 'pixoo-display'});
  assert.equal(warnings.length, 0);
  clock.advance(120_001);
  await take(world, state(120, {power: false})); // a gap after the last unchanged state
  await take(world, state(121)); // a confirmation in the new span
  const {data: _data, ...envelope} = state(122);
  await take(world, {...envelope, id: 'fixture-removal', kind: 'removal', type: 'org.bunny.device.removed',
    dataschema: `${SCHEMA_BASE}removal/2.0`, data: {entity: {id: ID, family: 'device'}, revision: 122, reason: 'deleted'}});
  assert.deepEqual(warnings.map(record => record.attributes), [alarmOf()]);
  assert.deepEqual(world.store.history.read({source: SOURCE, limit: 3}).map(row => [row.kind, row.record.gapMs, row.record.closedBy]),
    [['change', 120_001, undefined], ['change', undefined, 'removal'], ['removal', undefined, undefined]]);
  await writes(world, 121, 121, {id: 'other-plug'});
  await writes(world, 121, 121, {source: PIXOO});
  await writes(world, 121, 121, {source: PIXOO, family: 'pixoo-display'});
  clock.advance(HOUR - 120_001);
  await writes(world, 123, 243);
  assert.deepEqual(warnings.map(record => record.attributes), [
    alarmOf(), alarmOf('other-plug'), alarmOf(ID, PIXOO), alarmOf(ID, PIXOO, 'pixoo-display'), alarmOf(ID, SOURCE, 'device', AT + HOUR),
  ]);
});

it('history keeps a revisited retained hour, resets an older clock window, and starts empty after restart', async context => {
  const clock = manualClock(AT), {log, warnings} = diagnostics(clock);
  const world = await World.open(context, {clock, watch: {log, historyDevices: HISTORY_DEVICES}});
  await writes(world, 1, 121);
  clock.advance(HOUR);
  await writes(world, 122, 122);
  clock.advance(-1);
  await writes(world, 123, 243);
  assert.deepEqual(warnings.map(record => record.attributes), [alarmOf()], 'the prior hour remains suppressed');
  clock.advance(10 * HOUR + 1);
  await writes(world, 244, 244);
  clock.advance(-11 * HOUR);
  await writes(world, 245, 364);
  assert.equal(warnings.length, 1, 'a discarded hour starts fresh when the clock returns');
  await writes(world, 365, 365);
  assert.deepEqual(warnings.map(record => record.attributes), [alarmOf(), alarmOf()]);
  await world.crashAndRestart();
  await writes(world, 366, 485);
  assert.equal(warnings.length, 2);
  await writes(world, 486, 486);
  assert.deepEqual(warnings.map(record => record.attributes), [alarmOf(), alarmOf(), alarmOf()]);
});

it('history counts no rolled-back changes, and a throwing alarm logger cannot alter a committed change', async context => {
  let rejectCommit = false;
  const wrap = (database: DatabaseSync): DatabaseSync => {
    const exec = database.exec.bind(database);
    database.exec = sql => {
      if (rejectCommit && sql === 'COMMIT') throw new Error('synthetic commit refusal');
      exec(sql);
    };
    return database;
  };
  const clock = manualClock(AT), {log, warnings} = diagnostics(clock);
  const world = await World.open(context, {clock, wrap, watch: {historyDevices: HISTORY_DEVICES, log: {...log, warn: (event, fields, trace) => {
    log.warn(event, fields, trace);
    if (event === EVENT) throw new Error('synthetic diagnostic failure');
  }}}});
  await writes(world, 1, 120);
  rejectCommit = true;
  await assert.rejects(writes(world, 121, 121), /synthetic commit refusal/);
  rejectCommit = false;
  assert.equal(warnings.length, 0);
  assert.equal(world.store.history.read().length, 120);
  await writes(world, 121, 122);
  await writes(world, 1, 121, {id: 'other-plug'});
  assert.deepEqual(warnings.map(record => record.attributes), [alarmOf(), alarmOf('other-plug')]);
  assert.deepEqual(world.store.history.after(world.store.history.origin, 0).map(row => row.originSeq),
    Array.from({length: 243}, (_, index) => index + 1));
});

it('history leaves unapproved IDs and subject fallbacks in history without putting them in diagnostics', async context => {
  const clock = manualClock(AT), {log, warnings} = diagnostics(clock);
  const world = await World.open(context, {clock, watch: {log, historyDevices: HISTORY_DEVICES}});
  await writes(world, 1, 121, {id: 'unconfigured-slug'});
  await writes(world, 1, 121, {source: 'bunny/modules/unapproved'});
  await writes(world, 1, 121, {family: 'pixoo-display'});
  const fallback = (revision: number, power = revision % 2 === 0): Message => {
    const message = state(revision, {power});
    return {...message, data: {revision, power}};
  };
  await take(world, ...Array.from({length: 121}, (_, index) => fallback(index + 1)));
  assert.equal(warnings.length, 0);
  assert.equal(world.store.history.read().length, 484);

  // The diagnostic is one row short. A state without its own ID becomes the
  // latest row under the same key, then a confirmation opens a closing span.
  clock.advance(HOUR);
  await writes(world, 122, 241);
  await take(world, fallback(242), fallback(243, true));
  const {data: _data, ...envelope} = state(244);
  await take(world, {...envelope, id: 'fixture-fallback-removal', kind: 'removal', type: 'org.bunny.device.removed',
    dataschema: `${SCHEMA_BASE}removal/2.0`, data: {entity: {id: ID, family: 'device'}, revision: 244, reason: 'deleted'}});
  assert.deepEqual(world.store.history.read({limit: 2}).map(row => [row.kind, row.record.closedBy]),
    [['change', 'removal'], ['removal', undefined]]);
  assert.equal(warnings.length, 0);
  await writes(world, 245, 245);
  assert.deepEqual(warnings.map(record => record.attributes), [alarmOf(ID, SOURCE, 'device', AT + HOUR)]);
});

it('occurrences remain in history outside the alarm count', async context => {
  const clock = manualClock(AT), {log, warnings} = diagnostics(clock);
  const world = await World.open(context, {clock, watch: {log, historyDevices: HISTORY_DEVICES}});
  await take(world, ...Array.from({length: 121}, (_, index): Message => ({
    ...state(index + 1), id: `fixture-feature-${index}`, kind: 'occurrence', type: 'org.bunny.music-capture.features.observed',
    dataschema: `${SCHEMA_BASE}music-capture-features/2.1`, data: {id: ID},
  })));
  assert.equal(world.store.history.read({kind: 'occurrence'}).length, 121);
  assert.deepEqual(warnings, []);
});

it('a refused publication keeps its committed change and its history warning', async context => {
  const clock = manualClock(AT), {log, warnings} = diagnostics(clock);
  const world = await World.open(context, {clock, watch: {log}});
  for (let revision = 1; revision <= 120; revision++) {
    await world.store.transaction(tx => {
      const next = tx.revision();
      tx.add('bunny.state.mode.hub', {
        kind: 'state', type: 'org.bunny.mode.updated', subject: 'hub', dataschema: `${SCHEMA_BASE}mode/2.0`,
        data: {id: 'hub', revision: next, mode: revision % 2 === 0 ? 'free' : 'work', selectedAtMs: clock.now(), overrides: []},
      });
    });
  }
  await world.store.republish();
  world.publishing = () => { throw new Error('synthetic publication failure'); };
  await world.store.transaction(tx => {
    tx.add('bunny.state.mode.hub', {
      kind: 'state', type: 'org.bunny.mode.updated', subject: 'hub', dataschema: `${SCHEMA_BASE}mode/2.0`,
      data: {id: 'hub', revision: tx.revision(), mode: 'work', selectedAtMs: clock.now(), overrides: []},
    });
  });
  assert.deepEqual(warnings.map(record => record.attributes), [alarmOf('hub', 'bunny/core', 'mode')]);
  assert.equal(world.store.history.read().length, 121);
  world.publishing = undefined;
  assert.equal(await world.store.republish(), 1);
  assert.equal(warnings.length, 1);
});

it('the canonical log writer drops an alarm containing a registered secret', async context => {
  const id = 'fixture-secret';
  const clock = manualClock(AT), {log, warnings} = diagnostics(clock, id);
  const world = await World.open(context, {clock, watch: {log, historyDevices: [...HISTORY_DEVICES, {owner: SOURCE, id}]}});
  await writes(world, 1, 121, {id});
  assert.equal(world.store.history.read().length, 121);
  assert.equal(warnings.length, 0);
  await writes(world, 1, 121);
  assert.deepEqual(warnings.map(record => record.attributes), [alarmOf()]);
});
