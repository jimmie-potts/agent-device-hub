// The fixed read projections (#615 AC5): closed documents, bounded pages, validated queries and nothing else.
import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {Ajv2020} from 'ajv/dist/2020.js';
import {checkManifest, checkConfiguration} from '@jimmie-potts/sdk';
import {gapsSchema, sessionsSchema, statusSchema, timelineSchema, totalsSchema} from '../src/families.js';
import {createVolcanoModule} from '../src/module.js';
import type {Session} from '../src/sessions.js';
import {HEATING, IDLE, Rig, reading} from './support.js';

async function rig(t: TestContext): Promise<Rig> {
  const opened = await Rig.open();
  t.after(() => opened.close());
  return opened;
}
const refused = async (world: Rig, ref: string, query: Record<string, string>, code = 'invalid-request'): Promise<void> => {
  const answer = await world.read<{error?: {code?: string}}>(ref, query);
  assert.equal(answer.error?.code, code, `${ref} ${JSON.stringify(query)}`);
};

void test('the manifest serves reads and one status tool, with no page, delete or release control', () => {
  const {manifest} = createVolcanoModule();
  assert.equal(checkManifest(manifest), undefined);
  assert.equal(manifest.pages, undefined);
  assert.equal(manifest.upload, undefined);
  assert.deepEqual(manifest.tools?.map(tool => tool.name), ['status']);
  assert.equal(JSON.stringify(manifest.tools).match(/delete|release/i), null);
});

void test('the section names one feed and nothing else', () => {
  const {manifest} = createVolcanoModule();
  const good = {id: 'volcano', label: 'Volcano', hostId: 'host-a', sourceId: 'volcano-a'};
  assert.equal(checkConfiguration(manifest, good).status, 'accepted');
  const {label: _label, ...unlabelled} = good;
  assert.equal(checkConfiguration(manifest, unlabelled).status, 'accepted');
  for (const bad of [{...good, serial: 'synthetic'}, {...good, id: 'Not An Id'}, {...good, hostId: 'has space'}, {...good, label: ''}, {id: 'volcano'}]) {
    assert.equal(checkConfiguration(manifest, bad).status, 'refused', JSON.stringify(bad));
  }
});

void test('an unknown reference is not served, and each reference takes only its own query fields', async t => {
  const world = await rig(t);
  assert.equal(await world.module.manifest.content?.('raw', {query: {}, signal: new AbortController().signal}), undefined);
  await refused(world, 'status', {device: 'other'});
  await refused(world, 'gaps', {zone: 'UTC'});
  await refused(world, 'timeline', {device: 'other'});
  await refused(world, 'timeline', {limit: '0'});
  await refused(world, 'timeline', {limit: '201'});
  await refused(world, 'timeline', {from: '10', to: '5'});
  await refused(world, 'timeline', {cursor: 'nope'});
  await refused(world, 'sessions', {limit: '26'});
  await refused(world, 'sessions', {cursor: 'nope'});
  await refused(world, 'sessions', {gapMinutes: '0'});
  await refused(world, 'sessions', {gapMinutes: '241'});
  await refused(world, 'totals', {});
  await refused(world, 'totals', {zone: 'Not/AZone'});
  await refused(world, 'totals', {zone: '../../etc'});
  await refused(world, 'totals', {zone: 'UTC', limit: '367'});
  await refused(world, 'totals', {zone: 'UTC', cursor: 'yesterday'});
});

void test('a cancelled read is refused', async t => {
  const world = await rig(t);
  const controller = new AbortController();
  controller.abort();
  const answer = await world.module.manifest.content?.('status', {query: {}, signal: controller.signal});
  assert.ok(answer !== undefined && 'error' in answer);
  assert.equal(answer.error.code, 'cancelled');
});

void test('each document fits its closed schema, which any strict consumer can compile, and has no usage-meaning or identifying field', async t => {
  const world = await rig(t);
  await world.send({reading: reading({status1: IDLE})});
  await world.after(5000, {reading: reading({status1: HEATING})});
  const ajv = new Ajv2020({strict: true});
  const documents: [string, object, Record<string, string>][] = [['status', statusSchema, {}], ['timeline', timelineSchema, {}], ['sessions', sessionsSchema, {}], ['totals', totalsSchema, {zone: 'UTC'}], ['gaps', gapsSchema, {}]];
  for (const [ref, schema, query] of documents) {
    const check = ajv.compile(schema);
    const document = await world.read<Record<string, unknown>>(ref, query);
    assert.equal(check(document), true, `${ref}: ${JSON.stringify(check.errors)}`);
    assert.equal(check({...document, extra: 1}), false, `${ref} is closed`);
    assert.equal(document.id, 'volcano');
    assert.equal(JSON.stringify(schema).match(/serial|address|firmware|consum|dose|inhal|hostId|sourceId|feed/iu), null, `${ref} has no such field`);
    assert.equal(JSON.stringify(document).includes('host-a'), false);
    assert.equal(JSON.stringify(document).includes('volcano-a'), false);
  }
});

void test('the timeline pages by range and cursor without repeating or skipping a fact', async t => {
  const world = await rig(t);
  const startedAt = world.clock.now();
  await world.send({reading: reading({status1: IDLE})});
  for (let beat = 1; beat <= 12; beat += 1) await world.after(5000, {reading: reading({status1: beat % 2 === 0 ? IDLE : HEATING})});
  const all = await world.facts();
  const seen: unknown[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    const answer: {facts: {seq: number}[]; next: string | null} = await world.read('timeline', {limit: '3', ...(cursor === undefined ? {} : {cursor})});
    assert.ok(answer.facts.length <= 3);
    seen.push(...answer.facts);
    if (answer.next === null) break;
    cursor = answer.next;
  }
  assert.deepEqual(seen, all);
  const ranged = await world.read<{facts: {observedAtMs: number}[]}>('timeline', {from: String(startedAt + 10_000), to: String(startedAt + 20_000)});
  assert.ok(ranged.facts.length > 0);
  assert.ok(ranged.facts.every(fact => fact.observedAtMs >= startedAt + 10_000 && fact.observedAtMs <= startedAt + 20_000));
});

void test('sessions page newest first by cursor, and the last page ends', async t => {
  const world = await rig(t);
  await world.send({reading: reading({status1: IDLE})});
  const starts: number[] = [];
  for (let use = 0; use < 4; use += 1) {
    await world.after(16 * 60_000, {reading: reading({status1: HEATING})});
    starts.push(world.clock.now());
    await world.after(5000, {reading: reading({status1: IDLE})});
  }
  const first = await world.read<{sessions: Session[]; next: string | null}>('sessions', {limit: '3'});
  assert.deepEqual(first.sessions.map(session => session.startAtMs), [...starts].reverse().slice(0, 3));
  assert.notEqual(first.next, null);
  const second = await world.read<{sessions: Session[]; next: string | null}>('sessions', {limit: '3', cursor: first.next ?? ''});
  assert.deepEqual(second.sessions.map(session => session.startAtMs), [starts[0]]);
  assert.equal(second.next, null);
});

void test('a long history stays inside the page and byte caps', async t => {
  const world = await rig(t);
  await world.send({reading: reading({status1: IDLE})});
  const database = world.host.moduleDatabase();
  assert.ok(database !== undefined);
  const insert = database.prepare('INSERT INTO volcano_facts(kind, observed_at_ms, received_at_ms, data) VALUES(?, ?, ?, ?)');
  let at = world.clock.now();
  // Thousands of short stretches a minute apart make one enormous session, with stored facts the derivation has to bound.
  database.exec('BEGIN');
  for (let index = 0; index < 4000; index += 1) {
    at += 1000;
    insert.run('heater', at, at, JSON.stringify({kind: 'heater', on: true, status1: HEATING, edge: 'observed'}));
    at += 1000;
    insert.run('gap', at, at, JSON.stringify({kind: 'gap', fromMs: at - 500, toMs: at, heaterBefore: 'on', heaterAfter: 'on', creditedMinutes: 0}));
    at += 1000;
    insert.run('heater', at, at, JSON.stringify({kind: 'heater', on: false, status1: IDLE, edge: 'observed'}));
  }
  database.exec('COMMIT');
  for (const gapMinutes of ['1', '240']) {
    const answer = await world.module.manifest.content?.('sessions', {query: {gapMinutes}, signal: new AbortController().signal});
    assert.ok(answer !== undefined && 'bytes' in answer, JSON.stringify(answer));
    assert.ok(answer.bytes.length <= 256 * 1024);
    const {sessions} = JSON.parse(Buffer.from(answer.bytes).toString('utf8')) as {sessions: Session[]};
    assert.ok(sessions.length <= 25);
    assert.ok(sessions.every(session => session.stretches.length <= 32));
    if (gapMinutes === '240') assert.equal(sessions[0]?.omittedStretches, 4000 - 32);
  }
  const timeline = await world.module.manifest.content?.('timeline', {query: {}, signal: new AbortController().signal});
  assert.ok(timeline !== undefined && 'bytes' in timeline);
  assert.ok(timeline.bytes.length <= 256 * 1024);
});

void test('the status tool returns the status document, and refuses once the module has stopped', async t => {
  const world = await rig(t);
  await world.send({reading: reading({status1: HEATING})});
  const tool = world.module.manifest.tools?.[0];
  assert.ok(tool !== undefined);
  assert.deepEqual(await tool.read({}), await world.status());
  await world.stopModule();
  const answer = await tool.read({}) as {error?: {code?: string}};
  assert.equal(answer.error?.code, 'unavailable');
});
