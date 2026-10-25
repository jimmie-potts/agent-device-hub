import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {CompanionCard, SpeechDispatch, SpeechOutput, SpeechPlayback} from '@jimmie-potts/event-contracts/v2/companions';
import {MessageValidator} from '@jimmie-potts/event-contracts/v2';
import {registerCoreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import {InProcessBus, Outbox, type Command, type ModuleContext} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {SpeechCoordinator} from '../src/speech/coordinator.js';
import {initializeRevision} from '../src/revision.js';
const parent = {traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'};
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i += 1) {if (check()) return; await new Promise(resolve => setTimeout(resolve, 5));}
  assert.ok(check(), 'speech state arrived');
}
async function world(t: TestContext, adapt: (context: ModuleContext) => ModuleContext = context => context) {
  let now = Date.now(), allowed = true;
  const timers = new Set<{at: number; run(): void}>();
  const clock = {now: () => now}, scheduler = {after: (ms: number, run: () => void) => {
    const timer = {at: now + ms, run}; timers.add(timer); return () => {timers.delete(timer);};
  }};
  const bus = new InProcessBus({now: clock.now}), core = bus.connect('bunny/core'), browser = bus.connect('bunny/parts/dashboard'), gateway = bus.connect('bunny/runtime/gateway');
  const outputs: Command<SpeechOutput>[] = [], outcomes: SpeechPlayback[] = [];
  const reports: {result: string; evidence: string}[] = [];
  await browser.respond<SpeechOutput>('bunny.cmd.companion-speech-output.*', command => {outputs.push(command); return {status: 'accepted'};});
  await core.respond<SpeechDispatch>('bunny.cmd.companion-speech-dispatch.reachy', async command => {
    const result = await core.request('bunny.cmd.companion-speech-play.reachy', {type: 'org.bunny.companion-speech.play.requested', subject: 'reachy',
      dataschema: 'https://bunny.invalid/events/companion-speech-play/2.0', data: command.data}, {timeoutMs: 5000, requestId: command.data.requestId, parent: command});
    return result.status === 'accepted' ? {status: 'accepted'} : result.error;
  });
  await core.subscribe<{result: string; evidence: string}>('bunny.event.companion-speech-play.reachy', message => {reports.push(message.data);});
  const dir = await mkdtemp(join(tmpdir(), 'speech-coordinator-'));
  let engine: SpeechCoordinator | undefined;
  const make = () => new ModuleHarness({manifest: {name: 'companions', apiVersion: '1.3'}, start: async supplied => {
    const context = adapt(supplied), validator = new MessageValidator(); registerCoreFamilies(validator);
    initializeRevision(context.database(), 0);
    const outbox = new Outbox({sdk: context.sdk, database: context.database(), clock, validator, log: context.log, trace: context.trace});
    engine = new SpeechCoordinator(context, outbox, () => allowed); await engine.start(); await outbox.republish();
  }, stop: () => engine?.stop() ?? Promise.resolve()}, {bus, stateDir: dir, clock, scheduler});
  let host = make(); await host.start();
  t.after(async () => {await host.stop(); await Promise.all([core.close(), browser.close(), gateway.close()]); await rm(dir, {recursive: true, force: true});});
  const owner = () => engine ?? assert.fail('speech started');
  let id = 0;
  const card = (): CompanionCard => ({opportunity: {origin: {id: `event-${++id}`, source: 'bunny/core', type: 'org.bunny.attention.raised'},
    sourceKind: 'coding', context: 'live', category: 'coding-attention', cue: 'question', revision: id, generation: 1, session: 'session-test',
    identity: {provider: 'codex', client: 'cli', hostId: 'host-test', sourceId: 'source-test', sessionId: 'session-test'},
    turn: {status: 'unknown'}, attention: {id: {status: 'unknown'}, turn: {status: 'unknown'}, kind: 'question'}, noticeId: null,
    evidence: 'lifecycle-metadata', occurredAtMs: now, observedAtMs: now, validUntilMs: now + 30_000, busy: null, media: null, visitor: null, location: null},
    text: 'Synthetic coding question.', phrase: 0, presentedAtMs: now, history: false, content: 'unavailable'});
  return {owner, outputs, outcomes, reports, card, allow: (value: boolean) => {allowed = value;},
    advance: async (ms = 0) => {now += ms; for (const timer of [...timers]) if (timer.at <= now) {timers.delete(timer); timer.run();} await new Promise(resolve => setImmediate(resolve));},
    control: (action: 'enable' | 'stop' | 'mute', endpoint = 'endpoint-one') => browser.request(`bunny.cmd.companion-speech-endpoint.${endpoint}`, {
      type: 'org.bunny.companion-speech.endpoint.requested', subject: endpoint, dataschema: 'https://bunny.invalid/events/companion-speech-endpoint/2.0',
      data: {requestId: `control-${++id}`, action, ...(action === 'enable' ? {available: true} : {})}}, {timeoutMs: 5000}),
    report: async (playback: SpeechPlayback, endpoint = 'endpoint-one') => {outcomes.push(playback); await browser.publish(`bunny.event.companion-speech-playback.${endpoint}`, {
      kind: 'occurrence', type: 'org.bunny.companion-speech.playback.observed', subject: endpoint, dataschema: 'https://bunny.invalid/events/companion-speech-playback/2.0', data: playback}, {parent});},
    lost: (endpoint = 'endpoint-one') => gateway.publish(`bunny.event.companion-speech-lost.${endpoint}`, {kind: 'occurrence', type: 'org.bunny.companion-speech.endpoint-lost',
      subject: endpoint, dataschema: 'https://bunny.invalid/events/companion-speech-lost/2.0', data: {id: endpoint}}),
    restart: async () => {await host.stop(); host = make(); await host.start();}, host: () => host,
  };
}

void test('speech is off until explicit availability, reserves one endpoint and never catches up an old candidate', async t => {
  const w = await world(t), before = w.owner().mark(), card = w.card();
  w.owner().offer(card, parent, before); await w.advance(); assert.equal(w.outputs.length, 0);
  assert.equal((await w.control('enable')).status, 'accepted');
  assert.equal((await w.control('enable', 'endpoint-two')).status, 'rejected');
  w.owner().offer(card, parent, before); await w.advance(); assert.equal(w.outputs.length, 0);
  const fresh = w.card(); w.owner().offer(fresh, parent, w.owner().mark());
  await w.advance(); await until(() => w.outputs.length === 1);
  assert.equal(w.outputs[0]?.subject, 'endpoint-one');
  const operationId = w.outputs[0]?.data.operationId ?? assert.fail('operation');
  await w.report({operationId, status: 'started', started: true});
  await w.report({operationId, status: 'completed', started: true});
  await until(() => w.reports.length === 1);
  assert.deepEqual(w.reports[0], {requestId: operationId, result: 'succeeded', evidence: 'observed'});
  w.owner().offer(fresh, parent, w.owner().mark()); await w.advance(); assert.equal(w.outputs.length, 1);
});

void test('Stop discards pending work and waits for cancellation before another utterance', async t => {
  const w = await world(t); await w.control('enable');
  w.owner().offer(w.card(), parent, w.owner().mark()); await w.advance(); await until(() => w.outputs.length === 1);
  const operationId = w.outputs[0]?.data.operationId ?? assert.fail('operation');
  await w.report({operationId, status: 'started', started: true});
  w.owner().offer(w.card(), parent, w.owner().mark()); assert.equal(w.owner().inspect().pending, true);
  await w.control('stop'); await until(() => w.outputs.length === 2);
  assert.equal(w.outputs[1]?.data.action, 'stop'); assert.equal(w.owner().inspect().pending, false);
  await w.report({operationId, status: 'stopped', started: true});
  await until(() => w.owner().inspect().playback?.status === 'stopped');
  w.owner().offer(w.card(), parent, w.owner().mark()); await w.advance(); await until(() => w.outputs.length === 3);
  assert.equal(w.outputs[2]?.data.action, 'speak');
});

void test('lost completion and endpoint loss are uncertain, with no automatic replacement or restart replay', async t => {
  const w = await world(t); await w.control('enable');
  w.owner().offer(w.card(), parent, w.owner().mark()); await w.advance(); await until(() => w.outputs.length === 1);
  await w.lost(); await until(() => w.owner().inspect().availability === 'unavailable');
  assert.equal((await w.control('enable', 'endpoint-two')).status, 'rejected');
  await w.restart(); assert.equal(w.outputs.filter(command => command.data.action === 'speak').length, 1);
  assert.equal(w.owner().inspect().availability, 'unavailable');
  assert.equal((await w.control('enable')).status, 'rejected');
  assert.ok(w.reports.some(report => report.result === 'uncertain'));
});

void test('mute, expired candidates, scenario cards and policy changes suppress new output', async t => {
  const w = await world(t); await w.control('enable'); const epoch = w.owner().mark();
  await w.control('mute'); w.owner().offer(w.card(), parent, epoch); await w.advance(); assert.equal(w.outputs.length, 0);
  await w.control('enable'); const expired = w.card(); expired.opportunity.validUntilMs = 0;
  w.owner().offer(expired, parent, w.owner().mark());
  const scenario = w.card(); scenario.opportunity.context = 'scenario';
  w.owner().offer(scenario, parent, w.owner().mark()); await w.advance(); assert.equal(w.outputs.length, 0);
  w.allow(false); w.owner().offer(w.card(), parent, w.owner().mark()); await w.advance(); assert.equal(w.outputs.length, 0);
});

void test('only one pending candidate survives, and current coding attention preempts a lower-priority utterance after confirmed stop', async t => {
  const w = await world(t); await w.control('enable');
  const notice = w.card(); notice.opportunity.category = 'coding-notice'; notice.opportunity.cue = 'turn-ended';
  notice.opportunity.attention = null; notice.opportunity.noticeId = 'notice-test';
  w.owner().offer(notice, parent, w.owner().mark()); await w.advance(); await until(() => w.outputs.length === 1);
  const operationId = w.outputs[0]?.data.operationId ?? assert.fail('operation');
  await w.report({operationId, status: 'started', started: true});
  for (let i = 0; i < 3; i += 1) w.owner().offer(w.card(), parent, w.owner().mark());
  await until(() => w.outputs.length === 2); assert.equal(w.outputs[1]?.data.action, 'stop');
  assert.equal(w.owner().inspect().pending, true);
  await w.advance(); assert.equal(w.outputs.length, 2, 'no replacement before cancellation evidence');
  await w.report({operationId, status: 'stopped', started: true});
  await until(() => w.owner().inspect().playback?.status === 'stopped');
  await w.advance(); await until(() => w.outputs.length === 3);
  const next = w.outputs[2]?.data; assert.ok(next?.action === 'speak');
  assert.equal(next.card.opportunity.category, 'coding-attention');
  assert.equal(w.owner().inspect().pending, false);
});

void test('foreign receipts are ignored and completion without a start remains uncertain', async t => {
  const w = await world(t); await w.control('enable');
  w.owner().offer(w.card(), parent, w.owner().mark()); await w.advance(); await until(() => w.outputs.length === 1);
  const operationId = w.outputs[0]?.data.operationId ?? assert.fail('operation');
  await w.report({operationId, status: 'started', started: true}, 'endpoint-two');
  await new Promise(resolve => setImmediate(resolve)); assert.equal(w.owner().inspect().playback?.status, 'dispatching');
  await w.report({operationId, status: 'completed', started: true});
  await until(() => w.owner().inspect().playback?.status === 'uncertain');
  assert.equal(w.owner().inspect().availability, 'unavailable');
  assert.equal((await w.control('enable', 'endpoint-two')).status, 'rejected');
});

void test('the receipt deadline leaves playback uncertain and later definitive cancellation requires fresh enablement', async t => {
  const w = await world(t); await w.control('enable');
  w.owner().offer(w.card(), parent, w.owner().mark()); await w.advance(); await until(() => w.outputs.length === 1);
  const operationId = w.outputs[0]?.data.operationId ?? assert.fail('operation');
  await w.report({operationId, status: 'started', started: true});
  await until(() => w.owner().inspect().playback?.status === 'started');
  await w.advance(25_000); await until(() => w.reports.length === 1);
  assert.equal(w.owner().inspect().availability, 'unavailable');
  await w.report({operationId, status: 'stopped', started: true});
  await until(() => w.owner().inspect().playback?.status === 'stopped');
  assert.equal(w.owner().mark(), undefined);
  assert.equal((await w.control('enable')).status, 'accepted');
  assert.equal(w.outputs.length, 1, 'late evidence and enablement do not replay');
});

void test('policy is checked again after internal dispatch waits and before the browser receives anything', async t => {
  let release: () => void = () => {};
  const held = new Promise<void>(resolve => {release = resolve;});
  let waiting = false;
  const w = await world(t, context => ({...context, sdk: {...context.sdk, request: async (key, draft, options) => {
    if (key === 'bunny.cmd.companion-speech-dispatch.reachy') {waiting = true; await held;}
    return context.sdk.request(key, draft, options);
  }}}));
  t.after(release); await w.control('enable');
  w.owner().offer(w.card(), parent, w.owner().mark()); await w.advance(); await until(() => waiting);
  w.allow(false); release(); await until(() => w.owner().inspect().playback?.status === 'not-started');
  assert.equal(w.outputs.length, 0);
});

void test('outbox recovery republishes the original outcome identity without repeating audio', async t => {
  let fail = true; const ids: string[] = [];
  const w = await world(t, context => ({...context, sdk: {...context.sdk, publishMessage: (key, message) => {
    if (message.kind === 'outcome') {ids.push(message.id); if (fail) return Promise.reject(new Error('synthetic publication failure'));}
    return context.sdk.publishMessage(key, message);
  }}}));
  await w.control('enable'); w.owner().offer(w.card(), parent, w.owner().mark()); await w.advance(); await until(() => w.outputs.length === 1);
  const operationId = w.outputs[0]?.data.operationId ?? assert.fail('operation');
  await w.report({operationId, status: 'started', started: true}); await w.report({operationId, status: 'completed', started: true});
  await until(() => w.owner().inspect().playback?.status === 'completed');
  assert.equal(w.reports.length, 0); fail = false; await w.restart(); await until(() => w.reports.length >= 1);
  assert.equal(new Set(ids).size, 1); assert.equal(w.outputs.length, 1); assert.equal(w.owner().inspect().availability, 'off');
});

void test('full disk refuses responsibility before browser output and never publishes raw storage errors', async t => {
  const w = await world(t); await w.control('enable');
  const db = w.host().moduleDatabase(); assert.ok(db);
  db.exec('CREATE TABLE full_fixture(value BLOB); CREATE TRIGGER full_speech BEFORE INSERT ON companion_speech BEGIN INSERT INTO full_fixture VALUES(zeroblob(65536)); END;');
  const pages = Number(db.prepare('PRAGMA page_count').get()?.page_count); db.exec(`PRAGMA max_page_count=${String(pages + 2)}`);
  w.owner().offer(w.card(), parent, w.owner().mark()); await w.advance();
  await until(() => w.owner().inspect().playback?.status === 'not-started');
  assert.equal(w.outputs.length, 0); assert.equal(db.prepare('SELECT count(*) AS count FROM companion_speech').get()?.count, 0);
  assert.equal(JSON.stringify(w.host().logs).includes('SQLITE'), false);
  db.exec('PRAGMA max_page_count=1073741823; DROP TRIGGER full_speech');
});

void test('Stop without a terminal receipt becomes uncertain within five seconds and never starts the pending card', async t => {
  const w = await world(t); await w.control('enable');
  w.owner().offer(w.card(), parent, w.owner().mark()); await w.advance(); await until(() => w.outputs.length === 1);
  await w.control('stop'); await until(() => w.outputs.length === 2);
  await w.advance(5000); await until(() => w.owner().inspect().playback?.status === 'uncertain');
  assert.equal(w.owner().inspect().availability, 'unavailable');
  assert.equal(w.outputs.filter(command => command.data.action === 'speak').length, 1);
});

void test('startup settles durable unfinished responsibility as uncertain without recovering a candidate or endpoint', async t => {
  const w = await world(t), db = w.host().moduleDatabase(); assert.ok(db);
  db.prepare('INSERT INTO companion_speech(operation_id,candidate_id,endpoint_id,traceparent,started) VALUES(?,?,?,?,?)')
    .run('crash-operation', 'crash-candidate', 'lost-endpoint', parent.traceparent, 1);
  await w.restart(); await until(() => w.reports.length >= 1);
  assert.equal(w.outputs.length, 0); assert.equal(w.owner().inspect().endpointId, null);
  assert.equal(w.owner().inspect().availability, 'unavailable');
  assert.deepEqual(w.owner().inspect().playback, {operationId: 'crash-operation', status: 'uncertain', started: true});
  assert.equal((await w.control('enable')).status, 'rejected');
});

void test('a storage failure after output leaves responsibility unresolved until restart and cannot admit replacement', async t => {
  const w = await world(t); await w.control('enable');
  w.owner().offer(w.card(), parent, w.owner().mark()); await w.advance(); await until(() => w.outputs.length === 1);
  const operationId = w.outputs[0]?.data.operationId ?? assert.fail('operation'), db = w.host().moduleDatabase(); assert.ok(db);
  await w.report({operationId, status: 'started', started: true}); await until(() => w.owner().inspect().playback?.status === 'started');
  db.exec('CREATE TABLE full_fixture(value BLOB); CREATE TRIGGER full_speech BEFORE UPDATE OF playback ON companion_speech BEGIN INSERT INTO full_fixture VALUES(zeroblob(65536)); END;');
  const pages = Number(db.prepare('PRAGMA page_count').get()?.page_count); db.exec(`PRAGMA max_page_count=${String(pages + 2)}`);
  await w.report({operationId, status: 'completed', started: true}); await until(() => w.owner().inspect().playback?.status === 'uncertain');
  assert.equal(w.reports.length, 0); assert.equal((await w.control('enable', 'endpoint-two')).status, 'rejected');
  assert.equal(db.prepare('SELECT playback FROM companion_speech WHERE operation_id=?').get(operationId)?.playback, 'pending');
  db.exec('PRAGMA max_page_count=1073741823; DROP TRIGGER full_speech');
  await w.restart(); await until(() => w.reports.length >= 1);
  assert.equal(w.outputs.length, 1); assert.equal(w.reports[0]?.result, 'uncertain');
});
