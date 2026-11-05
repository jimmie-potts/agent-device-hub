// The Volcano path through a real runtime (#615 AC1, AC3, AC5): a real collector loop with a fake radio publishes over the
// SDK edge under its source-bound credential, the module records it, and the authenticated reads and tracked threshold
// command go through the gateway. Synthetic identifiers and usage only.
import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import type {TestContext} from 'node:test';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import {VOLCANO_OBSERVATION_SCHEMA, volcanoFeedId, volcanoObservationKey, type VolcanoFeed, type VolcanoObservation, type VolcanoReading} from '@jimmie-potts/event-contracts/v2/families';
import {prepareMessage, publishOnce, type Reply} from '@jimmie-potts/sdk';
import {createVolcanoModule, volcanoSchemas, type VolcanoStatus} from '@jimmie-potts/volcano';
import {VOLCANO_REGISTERS, VOLCANO_SERIAL, runCollector, type ReadUuid, type SubscribeUuid, type VolcanoTransport} from '../src/collector/volcano.js';
import {kept} from '../src/core/history.js';
import {checkProducerIdentity, checkVolcanoFeedIdentity} from '../src/gateway/producer-admission.js';
import {observation as lifecycle, turnEnded} from './fixtures/agents.js';
import {producerCredentialId, producerSource} from '../src/hook/index.js';
import {createCoreModule} from '../src/index.js';
import {edgeConfig, fixture, it, run, waitFor} from './support.js';

const feedOf = (hostId: string): VolcanoFeed => ({provider: 'storz-bickel', client: 'volcano', hostId, sourceId: 'volcano-sim'});
const collectorConfiguration = (feed: VolcanoFeed) => ({...feed, feed: 'volcano-observation'});
const FEED = feedOf('mac-sim');
const SECTION = {id: 'volcano', label: 'Volcano', hostId: FEED.hostId, sourceId: FEED.sourceId};
const REFUSAL = 'the producer credential does not own this Volcano feed';
const token = (): string => randomBytes(32).toString('base64url');

const reading = (fields: Partial<VolcanoReading> = {}): VolcanoReading => ({status1: 0x0603, status2: 0x0200, currentDeciC: 400, targetDeciC: 1850, heatingHours: 12, heatingMinutes: 5, ...fields});
function observation(sender: string, feed: VolcanoFeed, sequence: number, fields: Partial<VolcanoObservation> = {}): {key: string; message: Message} {
  const data: VolcanoObservation = {feed, observedAtMs: Date.now(), collectorEpoch: 'epoch-a', sequence, link: 'connected', reading: reading(), ...fields};
  return {key: volcanoObservationKey(feed), message: prepareMessage(sender, {kind: 'occurrence', type: 'org.bunny.volcano-observation.observed', subject: volcanoFeedId(feed), dataschema: VOLCANO_OBSERVATION_SCHEMA, data})};
}

async function world(context: TestContext) {
  const collector = {id: producerCredentialId(collectorConfiguration(FEED)), source: producerSource(collectorConfiguration(FEED)), token: token()};
  const hook = {id: producerCredentialId(FEED), source: producerSource(FEED), token: token()};
  const reader = {id: 'reader', source: 'bunny/parts/reader', token: token()};
  const operator = {id: 'operator', source: 'bunny/parts/operator', token: token()};
  const files = await edgeConfig(context, [{...collector, scopes: ['ingest']}, {...hook, scopes: ['ingest']}, {...reader, scopes: ['read']}, {...operator, scopes: ['read', 'control']}], {modules: {volcano: SECTION}});
  const {runtime, logs} = await run(context, {modules: [createCoreModule(), createVolcanoModule()], configFile: files.config, edge: {schemas: volcanoSchemas}});
  const read = (path: string, credential?: {token: string}): Promise<Response> => fetch(runtime.url + path, credential === undefined ? {} : {headers: {authorization: `Bearer ${credential.token}`}});
  return {collector, hook, reader, operator, runtime, logs, read};
}

it('only the derived collector credential of the feed publishes its observations: anyone else is forbidden before the bus', async context => {
  const {collector, hook, reader, runtime, read} = await world(context);
  const send = (credential: {source: string; token: string}, sent: {key: string; message: Message}) =>
    publishOnce({url: runtime.url, source: credential.source, token: credential.token, timeoutMs: 2000}, sent.key, sent.message);
  const refusedAs = async (credential: {source: string; token: string}, sent: {key: string; message: Message}, detail?: string): Promise<void> => {
    const result = await send(credential, sent);
    assert.equal(result.status, 'rejected');
    if (result.status !== 'rejected') return;
    assert.equal(result.error.error.code, 'forbidden');
    if (detail !== undefined) assert.equal(result.error.error.detail, detail);
  };
  await refusedAs(collector, observation(collector.source, feedOf('other-host'), 1), REFUSAL);
  await refusedAs(hook, observation(hook.source, FEED, 1), REFUSAL);
  await refusedAs(reader, observation(reader.source, FEED, 1));
  const heardNothing = await read('/modules/volcano/content/timeline', reader);
  assert.deepEqual(((await heardNothing.json()) as {facts: unknown[]}).facts, [], 'no refused message reaches the module');
  // A snapshot on another family's key, and another family on this one, are refused too.
  const own = observation(collector.source, FEED, 2);
  await refusedAs(collector, {key: `bunny.event.desktop-metadata.${volcanoFeedId(FEED)}`, message: own.message});
  assert.deepEqual(await send(collector, own), {status: 'published'});
  await waitFor(async () => (await (await read('/modules/volcano/content/status', reader)).json() as VolcanoStatus).availability === 'available', 5000, 'the module took it');
});

it('what a Volcano collector credential can publish: its feed only, and a lifecycle observation on the loopback entry alone', async context => {
  const {collector, runtime} = await world(context);
  const send = (key: string, message: Message) => publishOnce({url: runtime.url, source: collector.source, token: collector.token, timeoutMs: 2000}, key, message);
  const {key, draft} = lifecycle(turnEnded, Date.now());
  const message = prepareMessage(collector.source, draft);
  // The loopback entry keeps released local producers working, so this binding is not checked there.
  assert.deepEqual(await send(key, message), {status: 'published'});
  assert.equal(checkProducerIdentity(message)?.error.code, 'forbidden', 'the private entry refuses the same message');
  assert.equal(checkVolcanoFeedIdentity(message), undefined, 'this check is about Volcano observations only');
  const other = await send(`bunny.event.moment-ended.wall`, prepareMessage(collector.source, {kind: 'occurrence', type: 'org.bunny.moment.ended', subject: 'wall',
    dataschema: 'https://bunny.invalid/events/moment-ended/2.0', data: {requestId: 'req-moment-1', momentId: 'moment-1', ending: 'preempted', endedAtMs: Date.now()}}));
  assert.equal(other.status === 'rejected' && other.error.error.code, 'forbidden', 'and any other family stays refused');
});

it('the raw observation is no history row, and the status reads only with a read grant, on this route only', async context => {
  assert.equal(kept({kind: 'occurrence', type: 'org.bunny.volcano-observation.observed'}), false);
  assert.equal(kept({kind: 'state', type: 'org.bunny.volcano-status.updated'}), false);
  assert.equal(kept({kind: 'state', type: 'org.bunny.device.updated'}), true, 'availability stays in history');
  const {collector, reader, operator, runtime, read, logs} = await world(context);
  assert.deepEqual(await publishOnce({url: runtime.url, source: collector.source, token: collector.token, timeoutMs: 2000}, ...(({key, message}) => [key, message] as const)(observation(collector.source, FEED, 1, {reading: reading({status1: 0x0623})}))), {status: 'published'});
  await waitFor(async () => (await (await read('/modules/volcano/content/status', reader)).json() as VolcanoStatus).heater === 'on', 5000, 'the heater reads on');

  assert.equal((await read('/modules/volcano/content/status')).status, 401, 'no credential');
  assert.equal((await read('/modules/volcano/content/status', {token: token()})).status, 401, 'an unknown credential');
  assert.equal((await read('/modules/volcano/content/status', collector)).status, 403, 'a collector has no read grant');
  assert.equal((await read('/modules/volcano/content/status?device=other', reader)).status, 400, 'there is no other device to ask for');
  assert.equal((await read('/modules/volcano/content/raw', reader)).status, 404);
  const history = await (await read('/api/v2/history', operator)).json() as {rows: {type?: string}[]};
  assert.equal(JSON.stringify(history).includes('volcano-observation'), false);
  const text = JSON.stringify(logs.filter(record => record.attributes['bunny.routing.key'] === undefined));
  for (const value of ['mac-sim', 'volcano-sim']) assert.equal(text.includes(value), false, `${value} reached a record`);
});

it('core history holds no usage: temperature changes add no row, and only availability moves the device record', async context => {
  const {collector, reader, operator, runtime, read} = await world(context);
  let sequence = 0;
  const say = async (fields: Partial<VolcanoObservation>): Promise<void> => {
    sequence += 1;
    const {key, message} = observation(collector.source, FEED, sequence, fields);
    assert.deepEqual(await publishOnce({url: runtime.url, source: collector.source, token: collector.token, timeoutMs: 2000}, key, message), {status: 'published'});
  };
  const status = async (): Promise<VolcanoStatus> => await (await read('/modules/volcano/content/status', reader)).json() as VolcanoStatus;
  const rows = async (): Promise<{source?: string; record: {family?: string; changed?: Record<string, unknown>}}[]> => {
    // The core's intake commits in groups of about 50 ms.
    await new Promise(resolve => { setTimeout(resolve, 200); });
    const body = await (await read('/api/v2/history?kind=change', operator)).json() as {rows: {source?: string; record: {family?: string; changed?: Record<string, unknown>}}[]};
    return body.rows.filter(row => row.source === 'bunny/modules/volcano');
  };
  await say({reading: reading({status1: 0x0623, currentDeciC: 500})});
  await waitFor(async () => (await status()).currentDeciC === 500, 5000, 'the first reading');
  const before = await rows();
  for (const currentDeciC of [600, 700, 800, 900]) {
    await say({reading: reading({status1: 0x0623, currentDeciC, heatingMinutes: 6})});
    await waitFor(async () => (await status()).currentDeciC === currentDeciC, 5000, 'the next reading');
  }
  await say({reading: reading({status1: 0x3623, currentDeciC: 900, heatingMinutes: 6})});
  await waitFor(async () => (await status()).pump === 'on', 5000, 'a pump run');
  const after = await rows();
  assert.equal(after.length, before.length, 'the row count does not grow with temperature, heater, pump or counter');
  const text = JSON.stringify(after);
  for (const field of ['currentDeciC', 'targetDeciC', 'status1', 'heatingCounterMinutes', 'heater', 'pump', 'volcano-status']) assert.equal(text.includes(field), false, `${field} reached core history`);
  assert.ok(after.every(row => row.record.family === 'device'));
  assert.ok(after.some(row => row.record.changed?.availability === 'available'), 'availability stays visible');
  await say({link: 'disconnected', reading: null});
  await waitFor(async () => (await status()).availability === 'unavailable', 5000, 'the disconnect');
  assert.ok((await rows()).some(row => row.record.changed?.availability === 'unavailable'), 'and so does losing it');
});

it('a threshold goes through the dispatcher as a tracked action, and a reader or collector cannot send it', async context => {
  const {collector, reader, operator, runtime, read} = await world(context);
  const post = (credential: {token: string}, body: unknown): Promise<Response> => fetch(`${runtime.url}/api/v2/commands/volcano-session-gap`, {method: 'POST', headers: {authorization: `Bearer ${credential.token}`, 'content-type': 'application/json'}, body: JSON.stringify(body)});
  assert.equal((await post(reader, {target: 'volcano', data: {gapMinutes: 30}})).status, 403);
  assert.equal((await post(collector, {target: 'volcano', data: {gapMinutes: 30}})).status, 403);
  assert.equal((await read('/modules/volcano/content/status', reader)).status, 200);
  const accepted = await post(operator, {target: 'volcano', requestId: 'gap-30', data: {gapMinutes: 30, expectedConfigurationRevision: 0}});
  assert.equal(accepted.status, 200, await accepted.clone().text());
  assert.deepEqual(await accepted.json(), {schema: 'command-reply/2.0', status: 'accepted', requestId: 'gap-30'});
  await waitFor(async () => (await (await read('/modules/volcano/content/status', reader)).json() as VolcanoStatus).gapMinutes === 30, 5000, 'the threshold');
  const outcomes = async (requestId: string): Promise<{result?: string; evidence?: string}[]> => {
    const {rows} = await (await read('/api/v2/history?kind=outcome', operator)).json() as {rows: {requestId?: string; record: {data: {result?: string; evidence?: string}}}[]};
    return rows.filter(row => row.requestId === requestId).map(row => row.record.data);
  };
  await waitFor(async () => (await outcomes('gap-30')).some(row => row.result === 'succeeded' && row.evidence === 'observed'), 5000, 'the tracked outcome in history');
  const invalid = await post(operator, {target: 'volcano', requestId: 'gap-999', data: {gapMinutes: 999}});
  assert.equal(invalid.status, 200, 'out of range is an accepted command whose outcome fails');
  await waitFor(async () => (await outcomes('gap-999')).some(row => row.result === 'failed'), 5000, 'the failed outcome');
  assert.equal((await post(operator, {target: 'volcano', data: {gapMinutes: 1.5}})).status, 400, 'a malformed one fails the family\'s schema');
  assert.equal(((await (await read('/modules/volcano/content/status', reader)).json()) as VolcanoStatus).gapMinutes, 30);
});

it('a threshold whose reply is lost ends uncertain through the dispatcher, and is never sent again', async context => {
  const operator = {id: 'operator', source: 'bunny/parts/operator', token: token()};
  const files = await edgeConfig(context, [{...operator, scopes: ['read', 'control']}]);
  let received = 0;
  let release: () => void = () => {};
  const held = new Promise<Reply>(resolve => { release = () => { resolve({status: 'accepted'}); }; });
  const silent = fixture('volcano', async ({sdk}) => { await sdk.respond('bunny.cmd.volcano-session-gap.volcano', () => { received += 1; return held; }); });
  context.after(() => { release(); });
  const {runtime} = await run(context, {modules: [createCoreModule(), silent], configFile: files.config, edge: {schemas: volcanoSchemas}});
  const reply = await fetch(`${runtime.url}/api/v2/commands/volcano-session-gap`, {method: 'POST', headers: {authorization: `Bearer ${operator.token}`, 'content-type': 'application/json'}, body: JSON.stringify({target: 'volcano', requestId: 'gap-lost', data: {gapMinutes: 30}})});
  assert.equal(((await reply.json()) as {error?: {code?: string}}).error?.code, 'uncertain-result');
  const family = await (await fetch(`${runtime.url}/api/v2/families/operation`, {headers: {authorization: `Bearer ${operator.token}`}})).json() as {records: {requestId: string; status: string; result?: string}[]};
  const operation = family.records.find(record => record.requestId === 'gap-lost');
  assert.deepEqual([operation?.status, operation?.result], ['uncertain', 'uncertain']);
  assert.equal(received, 1);
});

it('a real collector loop on a fake radio reaches the authenticated reads with no command sent', async context => {
  const {collector, reader, runtime, read, logs} = await world(context);
  const registers: Record<string, number> = {status1: 0x0603, status2: 0x0200, current: 400, target: 1850, hours: 12, minutes: 5};
  const listeners = new Map<string, (bytes: Uint8Array) => void>();
  const operations: string[] = [];
  const le = (value: number): Uint8Array => Uint8Array.of(value & 0xff, value >> 8);
  const nameOf = (uuid: string): string => Object.entries(VOLCANO_REGISTERS).find(([, value]) => value === uuid)?.[0] ?? '';
  const transport: VolcanoTransport = {
    scan: () => { operations.push('scan'); return Promise.resolve(true); },
    connect: () => { operations.push('connect'); return Promise.resolve(); },
    read: (uuid: ReadUuid) => { operations.push('read'); return Promise.resolve(uuid === VOLCANO_SERIAL ? Buffer.from('SYNTHETIC') : le(registers[nameOf(uuid)] ?? 0)); },
    subscribe: (uuid: SubscribeUuid, listener) => { operations.push('subscribe'); listeners.set(uuid, listener); return Promise.resolve(); },
    disconnect: () => { operations.push('disconnect'); return Promise.resolve(); },
  };
  const controller = new AbortController();
  const noop = (): void => {};
  const running = runCollector({
    producer: '/synthetic/producer.json', advertisedName: 'SYNTHETIC', serialSha256: createHash('sha256').update('SYNTHETIC').digest('hex'), feed: FEED,
    publisher: {edge: runtime.url, token: collector.token, configuration: collectorConfiguration(FEED), source: collector.source},
  }, {log: {debug: noop, info: noop, warn: noop, error: noop}, signal: controller.signal, transport, timing: {minPublishMs: 5, heartbeatMs: 50, pollMs: 20}});
  context.after(async () => { controller.abort(); await running; });
  const status = async (): Promise<VolcanoStatus> => await (await read('/modules/volcano/content/status', reader)).json() as VolcanoStatus;
  await waitFor(async () => (await status()).heater === 'off', 5000, 'the first reading');
  registers.status1 = 0x0623;
  listeners.get(VOLCANO_REGISTERS.status1)?.(le(0x0623));
  await waitFor(async () => (await status()).heater === 'on', 5000, 'the button press as a notification');
  registers.status1 = 0x0603;
  await waitFor(async () => (await status()).heater === 'off', 5000, 'the button press only the poll saw');
  const {sessions} = await (await read('/modules/volcano/content/sessions', reader)).json() as {sessions: {stretches: unknown[]; open: boolean}[]};
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.open, false);
  assert.deepEqual([...new Set(operations)].sort(), ['connect', 'read', 'scan', 'subscribe']);
  assert.equal(JSON.stringify(logs).includes('SYNTHETIC'), false);
});
