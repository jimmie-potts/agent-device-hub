import assert from 'node:assert/strict';
import {test} from 'node:test';
import {errorBody, type ErrorDetail} from '@jimmie-potts/event-contracts/v2';
import type {ArtComposition} from '@jimmie-potts/event-contracts/v2/art-state';
import type {ArtDispatchSeam, ArtStageRequest, StageResult} from '../src/seams.js';
import {distinctDrawing, fakeImages} from './fixtures.js';
import {gate, hosted, until, type Hosted} from './support.js';

function dispatch() {
  const stages: ArtStageRequest[] = [];
  let report: (requestId: string, result: StageResult, error?: ErrorDetail) => void = () => {};
  const seam: ArtDispatchSeam = {
    stage: request => {stages.push(request); return Promise.resolve({status: 'accepted'});},
    ambient: () => assert.fail('preparation and browser selection have no display effect'),
    watch: callback => {report = callback; return Promise.resolve([]);},
  };
  return {seam, stages, report: (requestId: string, result: StageResult, error?: ErrorDetail) => {report(requestId, result, error);}};
}
const automatic = (art: Hosted, data: object, requestId: string) => art.operator.request('bunny.cmd.art-auto.art', {
  type: 'org.bunny.art.auto.requested', subject: 'art', dataschema: 'https://bunny.invalid/events/art-auto/2.1', data,
}, {requestId, timeoutMs: 2000});
async function generate(art: Hosted, requestId: string, targets: string[]) {
  assert.equal((await art.owner({action: 'start', purpose: 'request', origin: {kind: 'owner'}, targets}, requestId)).status, 'accepted');
  return art.finished(requestId);
}
function composition(art: Hosted, artworkId: string, target: ArtComposition['target']) {
  const found = art.state.artworks.find(item => item.artworkId === artworkId)?.compositions.find(item => item.target === target);
  assert.ok(found?.compositionId !== undefined && found.compositionId !== null);
  return found.compositionId;
}
const selection = (art: Hosted) => art.state.selection;

for (const target of ['ui', 'pixoo'] as const) void test(`two artworks may share ${target} composition bytes without hiding the older artwork`, async t => {
  const drawing = distinctDrawing();
  let shared: ReturnType<typeof drawing> | undefined;
  const transport = dispatch(), art = await hosted(t, {providers: {openai: fakeImages(request => shared ??= drawing(request))}, dispatch: transport.seam});
  const first = await generate(art, 'first-shared', [target]), second = await generate(art, 'second-shared', [target]);
  const saved = {artworkId: first.artworkId, compositionId: composition(art, first.artworkId, target)};
  assert.equal(saved.compositionId, composition(art, second.artworkId, target));
  const command = target === 'ui' ? {action: 'present', ...saved} : {action: 'prepare', ...saved, target: 'desk'};
  assert.equal((await automatic(art, command, 'shared')).status, 'accepted');
  assert.deepEqual(selection(art), target === 'ui' ? saved : null);
  assert.equal(transport.stages.length, target === 'ui' ? 0 : 3);
});

void test('saved-art preparation remains pending until its exact stage completes and duplicates never stage again', async t => {
  const transport = dispatch(), images = fakeImages(distinctDrawing()), art = await hosted(t, {providers: {openai: images}, dispatch: transport.seam});
  const job = await generate(art, 'source', ['pixoo']);
  await until(() => transport.stages.length === 1);
  const data = {action: 'prepare', artworkId: job.artworkId, compositionId: composition(art, job.artworkId, 'pixoo'), target: 'desk-display'};
  const send = transport.seam.stage.bind(transport.seam);
  transport.seam.stage = (request, parent) => {
    const saved = art.db().prepare('SELECT stage_request_id FROM art_preparations WHERE request_id=?').get('prepare-one');
    assert.deepEqual(saved && {...saved}, {stage_request_id: request.requestId}, 'the parent-child link commits before sending');
    return send(request, parent);
  };
  assert.equal((await automatic(art, data, 'prepare-one')).status, 'accepted');
  await until(() => transport.stages.length === 2);
  assert.equal(art.outcomes.some(item => item.data.requestId === 'prepare-one'), false, 'admission does not complete preparation');
  const stage = transport.stages[1] ?? assert.fail('no preparation stage');
  assert.deepEqual(stage, {...stage, expectedTargetId: 'desk-display'});
  transport.report(stage.requestId, 'succeeded');
  await until(() => art.outcomes.some(item => item.data.requestId === 'prepare-one'));
  assert.deepEqual(art.outcomes.find(item => item.data.requestId === 'prepare-one')?.data,
    {requestId: 'prepare-one', result: 'succeeded', evidence: 'observed'});
  assert.equal((await automatic(art, data, 'prepare-one')).status, 'accepted');
  const conflict = await automatic(art, {...data, target: 'another-display'}, 'prepare-one');
  assert.equal(conflict.status === 'rejected' && conflict.error.error.code, 'duplicate-conflict');
  assert.equal(transport.stages.length, 2);
  assert.equal(images.requests.length, 1, 'saved preparation makes no provider call');
});

void test('browser selection commits an existing composition and keeps it through pruning and restart', async t => {
  const transport = dispatch(), images = fakeImages(distinctDrawing()), art = await hosted(t, {providers: {openai: images}, dispatch: transport.seam, section: {recentLimit: 1}});
  const old = await generate(art, 'old', ['ui']), selected = {artworkId: old.artworkId, compositionId: composition(art, old.artworkId, 'ui')};
  assert.equal((await automatic(art, {action: 'present', ...selected}, 'select-old')).status, 'accepted');
  assert.deepEqual(selection(art), selected);
  assert.deepEqual(art.outcomes.find(item => item.data.requestId === 'select-old')?.data,
    {requestId: 'select-old', result: 'succeeded', evidence: 'observed'});
  await generate(art, 'newer', ['ui']);
  await generate(art, 'newest', ['ui']);
  await art.restart();
  assert.deepEqual(selection(art), selected);
  const detail = await art.readJson<{artworkId: string; createdAtMs: number}>(`artwork.${old.artworkId}`);
  assert.equal(detail.artworkId, old.artworkId);
  assert.equal(detail.createdAtMs, old.createdAtMs);
  assert.equal(images.requests.length, 3);
  assert.equal(transport.stages.length, 0);
  assert.equal((await art.catalog({action: 'delete', artworkId: old.artworkId}, 'delete-old')).status, 'accepted');
  assert.equal(selection(art), null);
  assert.equal(art.state.artworks.some(item => item.artworkId === old.artworkId), false);
});

void test('preparation checks exact saved composition and browser selection refuses display art without changing its choice', async t => {
  const transport = dispatch(), art = await hosted(t, {providers: {openai: fakeImages(distinctDrawing())}, dispatch: transport.seam});
  const first = await generate(art, 'mixed', ['ui', 'pixoo']), second = await generate(art, 'other', ['ui']);
  const browser = {artworkId: first.artworkId, compositionId: composition(art, first.artworkId, 'ui')};
  const display = {artworkId: first.artworkId, compositionId: composition(art, first.artworkId, 'pixoo')};
  assert.equal((await automatic(art, {action: 'present', ...browser}, 'selected')).status, 'accepted');
  for (const [id, data, code] of [
    ['mismatch', {action: 'prepare', ...display, artworkId: second.artworkId, target: 'desk'}, 'not-found'],
    ['browser-prepare', {action: 'prepare', ...browser, target: 'desk'}, 'invalid-state'],
    ['display-present', {action: 'present', ...display}, 'invalid-state'],
    ['missing', {action: 'present', artworkId: 'missing', compositionId: browser.compositionId}, 'not-found'],
  ] as const) {
    const answer = await automatic(art, data, id);
    assert.equal(answer.status === 'rejected' && answer.error.error.code, code);
  }
  assert.deepEqual(selection(art), browser);
  assert.equal(transport.stages.length, 1);
  await art.catalog({action: 'delete', artworkId: second.artworkId}, 'delete-other');
  const deleted = await automatic(art, {action: 'present', artworkId: second.artworkId, compositionId: browser.compositionId}, 'deleted');
  assert.equal(deleted.status === 'rejected' && deleted.error.error.code, 'not-found');
  assert.deepEqual(selection(art), browser);
});

void test('a preparation refusal retains the child error while another display can prepare independently', async t => {
  const transport = dispatch(), art = await hosted(t, {providers: {openai: fakeImages(distinctDrawing())}, dispatch: transport.seam});
  const job = await generate(art, 'both', ['pixoo', 'tidbyt']);
  await until(() => transport.stages.length === 2);
  const pixoo = {action: 'prepare', artworkId: job.artworkId, compositionId: composition(art, job.artworkId, 'pixoo'), target: 'desk'};
  const tidbyt = {...pixoo, compositionId: composition(art, job.artworkId, 'tidbyt'), target: 'shelf'};
  await automatic(art, pixoo, 'pixoo-prepare');
  await automatic(art, tidbyt, 'tidbyt-prepare');
  const error = errorBody('unsupported-capability', {detail: 'synthetic target has no art capability'}).error;
  transport.report(transport.stages[2]?.requestId ?? assert.fail(), 'failed', error);
  transport.report(transport.stages[3]?.requestId ?? assert.fail(), 'succeeded');
  await until(() => art.outcomes.some(item => item.data.requestId === 'tidbyt-prepare'));
  assert.deepEqual(art.outcomes.find(item => item.data.requestId === 'pixoo-prepare')?.data,
    {requestId: 'pixoo-prepare', result: 'failed', evidence: 'none', error});
  assert.deepEqual(art.outcomes.find(item => item.data.requestId === 'tidbyt-prepare')?.data,
    {requestId: 'tidbyt-prepare', result: 'succeeded', evidence: 'observed'});
  assert.equal(selection(art), null);
  assert.equal(transport.stages.length, 4);
});

void test('restart marks a pending preparation uncertain without replay and late evidence never presents or stages again', async t => {
  const transport = dispatch(), art = await hosted(t, {providers: {openai: fakeImages(distinctDrawing())}, dispatch: transport.seam});
  const job = await generate(art, 'source', ['pixoo']);
  await until(() => transport.stages.length === 1);
  const data = {action: 'prepare', artworkId: job.artworkId, compositionId: composition(art, job.artworkId, 'pixoo'), target: 'desk'};
  const held = gate<Awaited<ReturnType<ArtDispatchSeam['stage']>>>(), send = transport.seam.stage.bind(transport.seam);
  transport.seam.stage = (request, parent) => {void send(request, parent); return held.promise;};
  await automatic(art, data, 'pending');
  const stageId = transport.stages[1]?.requestId ?? assert.fail();
  await art.restart();
  const uncertain = art.outcomes.find(item => item.data.requestId === 'pending')?.data;
  assert.equal(uncertain?.result, 'uncertain');
  assert.equal(uncertain?.evidence, 'none');
  assert.equal(uncertain.error?.code, 'uncertain-result');
  held.open(errorBody('uncertain-result'));
  assert.equal((await automatic(art, data, 'pending')).status, 'accepted');
  transport.report(stageId, 'succeeded');
  await until(() => art.outcomes.some(item => item.data.requestId === 'pending' && item.data.result === 'succeeded'));
  assert.equal(transport.stages.length, 2);
  assert.equal(selection(art), null);
  assert.equal(art.state.candidates.some(item => item.compositionId === data.compositionId), true);
  assert.deepEqual(art.host.failures, []);
});

void test('preparation admission storage failure rolls back the link, stage and receipt before dispatch', async t => {
  const transport = dispatch(), art = await hosted(t, {providers: {openai: fakeImages(distinctDrawing())}, dispatch: transport.seam});
  const job = await generate(art, 'source', ['pixoo']);
  await until(() => transport.stages.length === 1);
  const data = {action: 'prepare', artworkId: job.artworkId, compositionId: composition(art, job.artworkId, 'pixoo'), target: 'desk'};
  art.db().exec("CREATE TRIGGER refuse_preparation BEFORE INSERT ON art_preparations BEGIN SELECT RAISE(FAIL,'synthetic storage failure'); END");
  const answer = await automatic(art, data, 'rollback');
  assert.equal(answer.status === 'rejected' && answer.error.error.code, 'internal');
  assert.equal(transport.stages.length, 1);
  assert.equal(art.db().prepare('SELECT 1 FROM art_receipts WHERE request_id=?').get('rollback'), undefined);
  assert.equal(art.db().prepare('SELECT COUNT(*) AS total FROM art_stages').get()?.total, 1);
  assert.equal(art.outcomes.some(item => item.data.requestId === 'rollback'), false);
  art.db().exec('DROP TRIGGER refuse_preparation');
  assert.equal((await automatic(art, data, 'rollback')).status, 'accepted');
  assert.equal(transport.stages.length, 2);
});

void test('failed browser selection leaves the previous selection and can be retried after storage recovers', async t => {
  const art = await hosted(t, {providers: {openai: fakeImages(distinctDrawing())}, dispatch: dispatch().seam});
  const first = await generate(art, 'first', ['ui']), second = await generate(art, 'second', ['ui']);
  const old = {artworkId: first.artworkId, compositionId: composition(art, first.artworkId, 'ui')};
  const next = {artworkId: second.artworkId, compositionId: composition(art, second.artworkId, 'ui')};
  await automatic(art, {action: 'present', ...old}, 'old');
  art.db().exec("CREATE TRIGGER refuse_selection BEFORE UPDATE ON art_browser_selection BEGIN SELECT RAISE(FAIL,'synthetic storage failure'); END");
  const answer = await automatic(art, {action: 'present', ...next}, 'next');
  assert.equal(answer.status === 'rejected' && answer.error.error.code, 'internal');
  assert.deepEqual(selection(art), old);
  assert.equal(art.outcomes.some(item => item.data.requestId === 'next'), false);
  assert.equal(art.db().prepare('SELECT 1 FROM art_receipts WHERE request_id=?').get('next'), undefined);
  art.db().exec('DROP TRIGGER refuse_selection');
  await art.restart();
  assert.deepEqual(selection(art), old);
  assert.equal((await automatic(art, {action: 'present', ...next}, 'next')).status, 'accepted');
  assert.deepEqual(selection(art), next);
});

void test('pending preparation capacity is bounded and a terminal preparation releases a slot', async t => {
  const transport = dispatch(), art = await hosted(t, {providers: {openai: fakeImages(distinctDrawing())}, dispatch: transport.seam});
  const job = await generate(art, 'source', ['pixoo']);
  await until(() => transport.stages.length === 1);
  const data = {action: 'prepare', artworkId: job.artworkId, compositionId: composition(art, job.artworkId, 'pixoo'), target: 'desk'};
  for (let i = 0; i < 8; i++) assert.equal((await automatic(art, data, `pending-${i}`)).status, 'accepted');
  const full = await automatic(art, data, 'extra');
  assert.equal(full.status === 'rejected' && full.error.error.code, 'capacity');
  assert.equal(transport.stages.length, 9);
  transport.report(transport.stages[1]?.requestId ?? assert.fail(), 'failed');
  await until(() => art.outcomes.some(item => item.data.requestId === 'pending-0'));
  assert.equal((await automatic(art, data, 'extra')).status, 'accepted');
  assert.equal(transport.stages.length, 10);
});

void test('a lost stage reply cannot erase a tracked success observed while admission was waiting', async t => {
  const transport = dispatch(), art = await hosted(t, {providers: {openai: fakeImages(distinctDrawing())}, dispatch: transport.seam});
  const job = await generate(art, 'source', ['pixoo']);
  await until(() => transport.stages.length === 1);
  const data = {action: 'prepare', artworkId: job.artworkId, compositionId: composition(art, job.artworkId, 'pixoo'), target: 'desk'};
  const held = gate<Awaited<ReturnType<ArtDispatchSeam['stage']>>>(), send = transport.seam.stage.bind(transport.seam);
  transport.seam.stage = (request, parent) => {void send(request, parent); return held.promise;};
  await automatic(art, data, 'prepared');
  const stageId = transport.stages[1]?.requestId ?? assert.fail();
  transport.report(stageId, 'succeeded');
  await until(() => art.outcomes.some(item => item.data.requestId === 'prepared'));
  held.open(errorBody('uncertain-result'));
  await new Promise<void>(resolve => {setImmediate(resolve);});
  assert.deepEqual(art.outcomes.filter(item => item.data.requestId === 'prepared').map(item => item.data.result), ['succeeded']);
  assert.equal(art.state.candidates.some(item => item.compositionId === data.compositionId), true);
  assert.equal(transport.stages.length, 2);
});

void test('a completion outbox failure rolls back preparation status so repeated evidence can complete it', async t => {
  const transport = dispatch(), art = await hosted(t, {providers: {openai: fakeImages(distinctDrawing())}, dispatch: transport.seam});
  const job = await generate(art, 'source', ['pixoo']);
  await until(() => transport.stages.length === 1);
  const data = {action: 'prepare', artworkId: job.artworkId, compositionId: composition(art, job.artworkId, 'pixoo'), target: 'desk'};
  await automatic(art, data, 'prepared');
  const stageId = transport.stages[1]?.requestId ?? assert.fail();
  art.db().exec("CREATE TRIGGER refuse_completion BEFORE INSERT ON bunny_outbox WHEN NEW.routing_key='bunny.event.art-auto.art' BEGIN SELECT RAISE(FAIL,'synthetic storage failure'); END");
  transport.report(stageId, 'succeeded');
  await new Promise<void>(resolve => {setImmediate(resolve);});
  assert.equal(art.outcomes.some(item => item.data.requestId === 'prepared'), false);
  assert.equal(art.db().prepare('SELECT status FROM art_preparations WHERE request_id=?').get('prepared')?.status, 'pending');
  assert.equal(art.db().prepare('SELECT status FROM art_stages WHERE request_id=?').get(stageId)?.status, 'pending');
  art.db().exec('DROP TRIGGER refuse_completion');
  transport.report(stageId, 'succeeded');
  await until(() => art.outcomes.some(item => item.data.requestId === 'prepared'));
  assert.equal(transport.stages.length, 2);
});

void test('first-seen child conflict commits both outcomes atomically and later partial callbacks cannot erase it', async t => {
  const transport = dispatch(), art = await hosted(t, {providers: {openai: fakeImages(distinctDrawing())}, dispatch: transport.seam});
  const job = await generate(art, 'source', ['pixoo']);
  await until(() => transport.stages.length === 1);
  const data = {action: 'prepare', artworkId: job.artworkId, compositionId: composition(art, job.artworkId, 'pixoo'), target: 'desk'};
  await automatic(art, data, 'conflicting');
  const stageId = transport.stages[1]?.requestId ?? assert.fail();
  art.db().exec("CREATE TRIGGER refuse_second_outcome BEFORE INSERT ON bunny_outbox WHEN NEW.routing_key='bunny.event.art-auto.art' AND json_extract(NEW.message,'$.data.result')='succeeded' BEGIN SELECT RAISE(FAIL,'synthetic storage failure'); END");
  transport.report(stageId, 'conflict');
  await new Promise<void>(resolve => {setImmediate(resolve);});
  assert.equal(art.outcomes.some(item => item.data.requestId === 'conflicting'), false, 'the first outcome cannot escape a failed transaction');
  assert.equal(art.db().prepare('SELECT status FROM art_preparations WHERE request_id=?').get('conflicting')?.status, 'pending');
  art.db().exec('DROP TRIGGER refuse_second_outcome');
  transport.report(stageId, 'conflict');
  await until(() => art.outcomes.filter(item => item.data.requestId === 'conflicting').length === 2);
  assert.deepEqual(art.outcomes.filter(item => item.data.requestId === 'conflicting').map(item => [item.data.result, item.data.evidence]),
    [['failed', 'none'], ['succeeded', 'observed']]);
  const current = () => art.db().prepare('SELECT status FROM art_preparations WHERE request_id=?').get('conflicting')?.status;
  assert.equal(current(), 'conflict');
  for (const result of ['succeeded', 'failed', 'uncertain', 'conflict'] as const) transport.report(stageId, result);
  await new Promise<void>(resolve => {setImmediate(resolve);});
  assert.equal(art.outcomes.filter(item => item.data.requestId === 'conflicting').length, 2);
  await art.restart();
  assert.equal(current(), 'conflict');
  const outcomes = art.outcomes.length;
  transport.report(stageId, 'succeeded');
  await automatic(art, data, 'conflicting');
  assert.equal(current(), 'conflict');
  assert.equal(art.outcomes.length, outcomes);
  assert.equal(art.state.candidates.some(item => item.compositionId === data.compositionId), false);
  assert.equal(transport.stages.length, 2);
});

void test('a retained conflicting preparation still owns its request ID after its admission receipt expires', async t => {
  const transport = dispatch(), art = await hosted(t, {providers: {openai: fakeImages(distinctDrawing())}, dispatch: transport.seam});
  const job = await generate(art, 'source', ['pixoo']);
  await until(() => transport.stages.length === 1);
  const data = {action: 'prepare', artworkId: job.artworkId, compositionId: composition(art, job.artworkId, 'pixoo'), target: 'desk'};
  await automatic(art, data, 'retained');
  transport.report(transport.stages[1]?.requestId ?? assert.fail(), 'conflict');
  await until(() => art.outcomes.filter(item => item.data.requestId === 'retained').length === 2);
  art.clock.value += 31 * 24 * 3_600_000;
  await art.restart();
  assert.equal(art.db().prepare('SELECT 1 FROM art_receipts WHERE request_id=?').get('retained'), undefined);
  const before = art.db().prepare('SELECT * FROM art_preparations WHERE request_id=?').get('retained');
  const answer = await automatic(art, data, 'retained');
  assert.equal(answer.status === 'rejected' && answer.error.error.code, 'duplicate-conflict');
  assert.deepEqual(art.db().prepare('SELECT * FROM art_preparations WHERE request_id=?').get('retained'), before);
  assert.equal(transport.stages.length, 2);
});

void test('terminal preparation retention is bounded while its receipt still prevents staging a trimmed duplicate', async t => {
  const transport = dispatch(), art = await hosted(t, {providers: {openai: fakeImages(distinctDrawing())}, dispatch: transport.seam});
  const job = await generate(art, 'source', ['pixoo']);
  await until(() => transport.stages.length === 1);
  const data = {action: 'prepare', artworkId: job.artworkId, compositionId: composition(art, job.artworkId, 'pixoo'), target: 'desk'};
  await automatic(art, data, 'oldest');
  transport.report(transport.stages[1]?.requestId ?? assert.fail(), 'succeeded');
  await until(() => art.outcomes.some(item => item.data.requestId === 'oldest'));
  const old = art.db().prepare('SELECT record FROM art_preparations WHERE request_id=?').get('oldest');
  assert.equal(typeof old?.record, 'string');
  const insert = art.db().prepare("INSERT INTO art_preparations VALUES(?,?,'succeeded',json_set(?,'$.requestId',?,'$.stageRequestId',?))");
  for (let i = 0; i < 1000; i++) insert.run(`synthetic-${i}`, `stage-synthetic-${i}`, old?.record ?? '', `synthetic-${i}`, `stage-synthetic-${i}`);
  await automatic(art, data, 'newest');
  transport.report(transport.stages[2]?.requestId ?? assert.fail(), 'succeeded');
  await until(() => art.outcomes.some(item => item.data.requestId === 'newest'));
  assert.equal(art.db().prepare('SELECT COUNT(*) AS total FROM art_preparations').get()?.total, 1000);
  assert.equal(art.db().prepare('SELECT 1 FROM art_preparations WHERE request_id=?').get('oldest'), undefined);
  await art.restart();
  assert.equal((await automatic(art, data, 'oldest')).status, 'accepted');
  assert.equal(transport.stages.length, 3);
});
