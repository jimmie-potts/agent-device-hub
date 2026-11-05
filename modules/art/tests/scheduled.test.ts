import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {errorBody, type ErrorDetail} from '@jimmie-potts/event-contracts/v2';
import {STAGE_LIFETIME_MS} from '../src/module.js';
import type {ArtAmbientRequest, ArtDispatchSeam, ArtStageRequest, StageResult} from '../src/seams.js';
import {ArtStore} from '../src/store.js';
import {distinctDrawing, drawing, fakeIdeas, fakeImages} from './fixtures.js';
import {gate, hosted, until, type Hosted} from './support.js';

const automatic = (art: Hosted, data: object, requestId: string) => art.operator.request('bunny.cmd.art-auto.art', {
  type: 'org.bunny.art.auto.requested', subject: 'art', dataschema: 'https://bunny.invalid/events/art-auto/2.2', data,
}, {requestId, timeoutMs: 2000});
const outcome = (art: Hosted, id: string) => art.outcomes.filter(item => item.data.requestId === id).at(-1)?.data;
const tick = () => new Promise<void>(resolve => {setImmediate(resolve);});
function dispatch() {
  const stages: ArtStageRequest[] = [], ambients: ArtAmbientRequest[] = [];
  let report: (id: string, result: StageResult, error?: ErrorDetail) => void = () => {};
  const seam: ArtDispatchSeam = {
    stage: request => {stages.push(request); return Promise.resolve({status: 'accepted'});},
    ambient: request => {ambients.push(request); return Promise.resolve({status: 'accepted'});},
    watch: callback => {report = callback; return Promise.resolve([]);},
  };
  return {seam, stages, ambients, report: (id: string, result: StageResult, error?: ErrorDetail) => {report(id, result, error);}};
}
async function saved(art: Hosted, id: string) {
  await art.owner({action: 'start', purpose: 'request', origin: {kind: 'owner'}, targets: ['tidbyt']}, id);
  const job = await art.finished(id), artwork = art.state.artworks.find(item => item.artworkId === job.artworkId);
  return {artworkId: job.artworkId, compositionId: artwork?.compositions[0]?.compositionId ?? assert.fail('missing composition')};
}
const select = (art: Hosted, source: Awaited<ReturnType<typeof saved>>, id: string) => automatic(art,
  {action: 'ambient', ...source, target: 'shelf-display', authorization: `grant-${id}`}, id);
function renewalClock() {
  const timers: {delay: number; callback: () => void; cancelled: boolean}[] = [];
  return {timers, scheduler: {after: (delay: number, callback: () => void) => {
    const timer = {delay, callback, cancelled: false}; timers.push(timer); return () => {timer.cancelled = true;};
  }}};
}

void test('additive target storage opens a prior seven-column stage store without changing old selection or bytes', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE art_stages(request_id TEXT PRIMARY KEY,artwork_id TEXT NOT NULL,composition_id TEXT NOT NULL,target TEXT NOT NULL,status TEXT NOT NULL,expires_at_ms INTEGER,ambient INTEGER NOT NULL) STRICT;
      INSERT INTO art_stages VALUES('old-stage','old-art','old-composition','tidbyt','succeeded',123456789,1);
      CREATE TABLE art_ambient(id INTEGER PRIMARY KEY CHECK(id=1),request_id TEXT NOT NULL) STRICT;
      INSERT INTO art_ambient VALUES(1,'old-stage');`);
    const before = db.prepare('SELECT * FROM art_stages').get(), store = new ArtStore(db);
    assert.deepEqual(db.prepare('SELECT * FROM art_stages').get(), before);
    const old = store.ambient() ?? assert.fail();
    assert.equal(old.requestId, 'old-stage');
    assert.equal(old.targetId, undefined, 'legacy targeting is not fabricated');
    store.saveStage({...old, requestId: 'new-stage', targetId: 'exact-shelf'});
    const reopened = new ArtStore(db);
    assert.equal(reopened.stage('new-stage')?.targetId, 'exact-shelf');
    assert.deepEqual(reopened.ambient(), old);
  } finally {db.close();}
});

void test('a lost ambient admission reply cannot erase an already tracked child success', async t => {
  const transport = dispatch(), art = await hosted(t, {providers: {openai: fakeImages(distinctDrawing())}, dispatch: transport.seam});
  const source = await saved(art, 'source'), held = gate<Awaited<ReturnType<ArtDispatchSeam['ambient']>>>();
  transport.seam.ambient = request => {transport.ambients.push(request); return held.promise;};
  await select(art, source, 'selection');
  transport.report(transport.stages[1]?.requestId ?? assert.fail(), 'succeeded');
  await until(() => transport.ambients.length === 1);
  transport.report(transport.ambients[0]?.requestId ?? assert.fail(), 'succeeded');
  await until(() => outcome(art, 'selection')?.result === 'succeeded');
  held.open(errorBody('uncertain-result'));
  await tick(); await tick();
  assert.deepEqual(art.outcomes.filter(item => item.data.requestId === 'selection').map(item => item.data.result), ['succeeded']);
  assert.equal(transport.ambients.length, 1);
});

void test('a lost stage admission reply cannot withdraw already completed staging while ambient completion is pending', async t => {
  const transport = dispatch(), art = await hosted(t, {providers: {openai: fakeImages(distinctDrawing())}, dispatch: transport.seam});
  const source = await saved(art, 'source'), held = gate<Awaited<ReturnType<ArtDispatchSeam['stage']>>>();
  transport.seam.stage = request => {transport.stages.push(request); return held.promise;};
  await select(art, source, 'selection');
  transport.report(transport.stages[1]?.requestId ?? assert.fail(), 'succeeded');
  await until(() => transport.ambients.length === 1);
  held.open(errorBody('uncertain-result'));
  await tick(); await tick();
  assert.equal(transport.ambients.length, 1, 'lost stage admission cannot issue a clear after tracked staging success');
  assert.equal(outcome(art, 'selection'), undefined);
  assert.equal(art.state.candidates.some(item => item.compositionId === source.compositionId), true);
});

void test('stop drops a staged selection still queued behind another ambient admission', async t => {
  const transport = dispatch(), clock = renewalClock(), art = await hosted(t, {providers: {openai: fakeImages(distinctDrawing())}, dispatch: transport.seam, scheduler: clock.scheduler});
  const a = await saved(art, 'source-a'), b = await saved(art, 'source-b'), held = gate<Awaited<ReturnType<ArtDispatchSeam['ambient']>>>();
  transport.seam.ambient = request => {transport.ambients.push(request); return held.promise;};
  await select(art, a, 'a');
  transport.report(transport.stages[2]?.requestId ?? assert.fail(), 'succeeded');
  await until(() => transport.ambients.length === 1);
  await select(art, b, 'b');
  transport.report(transport.stages[3]?.requestId ?? assert.fail(), 'succeeded');
  await tick(); await tick();
  assert.equal(transport.ambients.length, 1);
  await art.restart();
  held.open({status: 'accepted'});
  await tick(); await tick();
  assert.equal(transport.ambients.length, 1, 'B never sends after stop or restart');
  assert.equal(outcome(art, 'b')?.result, 'uncertain');
  const timer = [...clock.timers].reverse().find(item => !item.cancelled && item.delay === STAGE_LIFETIME_MS / 2) ?? assert.fail();
  art.clock.value += timer.delay; timer.callback();
  await until(() => transport.stages.length === 5);
  assert.equal(transport.stages[4]?.compositionId, a.compositionId, 'only issued A can maintain its copy');
});

void test('automatic omit reads no weather and excludes caller weather from every paid prompt', async t => {
  let reads = 0;
  const images = fakeImages(drawing()), ideas = fakeIdeas(() => Promise.resolve({text: 'A quiet geometric garden', usage: {inputTokens: 1, outputTokens: 1}}));
  const art = await hosted(t, {providers: {openai: images, anthropic: ideas}, weather: {
    start: () => Promise.resolve([]), read: () => {reads++; return {words: ['rain'], staleAtMs: Number.MAX_SAFE_INTEGER};},
  }});
  assert.equal((await automatic(art, {action: 'start', purpose: 'appearance', origin: {kind: 'schedule'}, targets: ['ui', 'tidbyt'],
    weatherUse: 'omit', context: {weather: 'rain'}}, 'omit')).status, 'accepted');
  await art.finished('omit');
  assert.equal(reads, 0);
  assert.equal(ideas.requests.length, 1);
  assert.equal(images.requests.length, 2);
  for (const request of [...ideas.requests, ...images.requests]) assert.doesNotMatch(request.prompt, /\brain\b|Weather condition:/i);
});

void test('two later failed ambient children cannot restore one another, including after restart', async t => {
  const transport = dispatch(), clock = renewalClock(), art = await hosted(t, {providers: {openai: fakeImages(distinctDrawing())}, dispatch: transport.seam, scheduler: clock.scheduler});
  const a = await saved(art, 'source-a'), b = await saved(art, 'source-b'), c = await saved(art, 'source-c');
  for (const [source, id] of [[a, 'a'], [b, 'b'], [c, 'c']] as const) {
    await select(art, source, id);
    transport.report(transport.stages.at(-1)?.requestId ?? assert.fail(), 'succeeded');
    await until(() => transport.ambients.length === (id === 'a' ? 1 : id === 'b' ? 2 : 3));
    if (id === 'a') {transport.report(transport.ambients[0]?.requestId ?? assert.fail(), 'succeeded'); await until(() => outcome(art, 'a')?.result === 'succeeded');}
  }
  transport.report(transport.ambients[1]?.requestId ?? assert.fail(), 'failed', errorBody('forbidden').error);
  await until(() => outcome(art, 'b')?.result === 'failed');
  new ArtStore(art.db()).trim(0, 0);
  assert.equal(art.db().prepare('SELECT 1 FROM art_preparations WHERE request_id=?').get('b'), undefined, 'retention may remove a completed predecessor');
  await art.restart();
  transport.report(transport.ambients[2]?.requestId ?? assert.fail(), 'failed', errorBody('unavailable').error);
  await until(() => outcome(art, 'c')?.result === 'failed');
  const timer = [...clock.timers].reverse().find(item => !item.cancelled && item.delay === STAGE_LIFETIME_MS / 2) ?? assert.fail();
  art.clock.value += timer.delay; timer.callback();
  await until(() => transport.stages.length === 7);
  assert.equal(transport.stages[6]?.compositionId, a.compositionId);
  assert.equal(transport.stages[6]?.expectedTargetId, 'shelf-display');
});

void test('staging refusal completes the ambient parent without issuing a selection', async t => {
  const transport = dispatch(), art = await hosted(t, {providers: {openai: fakeImages(distinctDrawing())}, dispatch: transport.seam});
  const source = await saved(art, 'source');
  await select(art, source, 'selection');
  const error = errorBody('unsupported-capability').error;
  transport.report(transport.stages[1]?.requestId ?? assert.fail(), 'failed', error);
  await until(() => outcome(art, 'selection') !== undefined);
  assert.deepEqual(outcome(art, 'selection'), {requestId: 'selection', result: 'failed', evidence: 'none', error});
  transport.report(transport.stages[1]?.requestId ?? assert.fail(), 'succeeded');
  await tick(); await tick();
  assert.equal(transport.ambients.length, 0);
});

void test('deleting an issued scheduled artwork clears its exact target even while a replacement is staging', async t => {
  const transport = dispatch(), art = await hosted(t, {providers: {openai: fakeImages(distinctDrawing())}, dispatch: transport.seam});
  const a = await saved(art, 'source-a'), b = await saved(art, 'source-b');
  await select(art, a, 'a');
  transport.report(transport.stages[2]?.requestId ?? assert.fail(), 'succeeded');
  await until(() => transport.ambients.length === 1);
  transport.report(transport.ambients[0]?.requestId ?? assert.fail(), 'succeeded');
  await until(() => outcome(art, 'a')?.result === 'succeeded');
  await select(art, b, 'b');
  await art.catalog({action: 'delete', artworkId: a.artworkId}, 'delete-a');
  await until(() => transport.ambients.length === 2);
  assert.deepEqual(transport.ambients[1], {...transport.ambients[1], compositionId: null, expectedTargetId: 'shelf-display'});
  assert.equal('authorization' in (transport.ambients[1] ?? {}), false);
});

void test('deleting A while issued B is pending still clears A if B later fails', async t => {
  const transport = dispatch(), art = await hosted(t, {providers: {openai: fakeImages(distinctDrawing())}, dispatch: transport.seam});
  const a = await saved(art, 'source-a'), b = await saved(art, 'source-b');
  await select(art, a, 'a');
  transport.report(transport.stages[2]?.requestId ?? assert.fail(), 'succeeded');
  await until(() => transport.ambients.length === 1);
  transport.report(transport.ambients[0]?.requestId ?? assert.fail(), 'succeeded');
  await until(() => outcome(art, 'a')?.result === 'succeeded');
  await select(art, b, 'b');
  transport.report(transport.stages[3]?.requestId ?? assert.fail(), 'succeeded');
  await until(() => transport.ambients.length === 2);
  await art.catalog({action: 'delete', artworkId: a.artworkId}, 'delete-a');
  assert.equal(transport.ambients.length, 2, 'deleting A cannot clear the newer pending B');
  transport.report(transport.ambients[1]?.requestId ?? assert.fail(), 'failed');
  await until(() => outcome(art, 'b')?.result === 'failed');
  await tick(); await tick();
  assert.equal(transport.ambients.length, 3, 'the failed replacement cannot hide the earlier explicit deletion');
  assert.deepEqual(transport.ambients[2], {...transport.ambients[2], compositionId: null, expectedTargetId: 'shelf-display'});
  assert.equal(art.db().prepare('SELECT 1 FROM art_ambient').get(), undefined, 'deleted A is not renewable');
});

void test('ambient admission storage failure has no child or grant effect and permits a later original request', async t => {
  const transport = dispatch(), art = await hosted(t, {providers: {openai: fakeImages(distinctDrawing())}, dispatch: transport.seam});
  const source = await saved(art, 'source');
  art.db().exec("CREATE TRIGGER refuse_ambient BEFORE INSERT ON art_preparations BEGIN SELECT RAISE(FAIL,'synthetic refusal'); END");
  const answer = await select(art, source, 'rollback');
  assert.equal(answer.status === 'rejected' && answer.error.error.code, 'internal');
  assert.equal(transport.stages.length, 1);
  assert.equal(transport.ambients.length, 0);
  assert.equal(art.db().prepare('SELECT 1 FROM art_receipts WHERE request_id=?').get('rollback'), undefined);
  art.db().exec('DROP TRIGGER refuse_ambient');
  assert.equal((await select(art, source, 'rollback')).status, 'accepted');
  assert.equal(transport.stages.length, 2);
});

void test('automatic current reads fresh condition words again before each paid call', async t => {
  let words = ['rain'], staleAtMs = Number.MAX_SAFE_INTEGER;
  const ideas = fakeIdeas(() => {words = ['snow']; return Promise.resolve({text: 'A quiet geometric garden', usage: {inputTokens: 1, outputTokens: 1}});});
  const images = fakeImages(async request => {staleAtMs = 0; return drawing()(request);});
  const art = await hosted(t, {providers: {openai: images, anthropic: ideas}, weather: {
    start: () => Promise.resolve([]), read: () => ({words, staleAtMs}),
  }});
  await automatic(art, {action: 'start', purpose: 'appearance', origin: {kind: 'schedule'}, targets: ['ui', 'tidbyt'],
    weatherUse: 'current', context: {weather: 'fog'}}, 'current');
  await art.finished('current');
  assert.match(ideas.requests[0]?.prompt ?? '', /rain/);
  assert.match(images.requests[0]?.prompt ?? '', /snow/);
  assert.doesNotMatch(images.requests[1]?.prompt ?? '', /rain|snow|fog/);
  for (const request of [...ideas.requests, ...images.requests]) assert.doesNotMatch(request.prompt, /fog/);
});

void test('saved ambient waits for staging and tracked selection, reuses bytes and never replays its grant', async t => {
  const transport = dispatch(), images = fakeImages(distinctDrawing()), art = await hosted(t, {providers: {openai: images}, dispatch: transport.seam});
  const source = await saved(art, 'source');
  assert.equal((await select(art, source, 'ambient')).status, 'accepted');
  assert.equal(transport.stages.length, 2, 'ambient stages saved pixels');
  assert.equal(outcome(art, 'ambient'), undefined, 'admission does not complete selection');
  assert.equal(transport.ambients.length, 0);
  const stage = transport.stages[1] ?? assert.fail();
  assert.equal(stage.expectedTargetId, 'shelf-display');
  transport.report(stage.requestId, 'succeeded');
  await until(() => transport.ambients.length === 1);
  assert.equal(outcome(art, 'ambient'), undefined, 'child admission is not completion');
  const child = transport.ambients[0] ?? assert.fail();
  assert.deepEqual(child, {...child, compositionId: source.compositionId, expectedTargetId: 'shelf-display', authorization: 'grant-ambient'});
  transport.report(child.requestId, 'succeeded');
  await until(() => outcome(art, 'ambient')?.result === 'succeeded');
  await art.restart();
  await select(art, source, 'ambient');
  assert.equal(transport.stages.length, 2);
  assert.equal(transport.ambients.length, 1);
  assert.equal(images.requests.length, 1);
  assert.equal(art.db().prepare("SELECT 1 FROM art_preparations WHERE record LIKE '%grant-ambient%'").get(), undefined, 'the authority itself is not persisted');
});

for (const fate of ['pending-restart', 'refused', 'uncertain'] as const) void test(`ambient ${fate} preserves the correct exact renewable intent after restart`, async t => {
  const transport = dispatch(), clock = renewalClock(), images = fakeImages(distinctDrawing());
  const art = await hosted(t, {providers: {openai: images}, dispatch: transport.seam, scheduler: clock.scheduler});
  const a = await saved(art, 'source-a'), b = await saved(art, 'source-b');
  await select(art, a, 'a');
  assert.equal(transport.stages.length, 3);
  transport.report(transport.stages[2]?.requestId ?? assert.fail(), 'succeeded');
  await until(() => transport.ambients.length === 1);
  transport.report(transport.ambients[0]?.requestId ?? assert.fail(), 'succeeded');
  await until(() => outcome(art, 'a')?.result === 'succeeded');
  await select(art, b, 'b');
  const stageB = transport.stages[3] ?? assert.fail();
  if (fate !== 'pending-restart') {
    if (fate === 'refused') transport.seam.ambient = request => {transport.ambients.push(request); return Promise.resolve(errorBody('forbidden'));};
    transport.report(stageB.requestId, 'succeeded');
    await until(() => transport.ambients.length === 2);
    if (fate === 'uncertain') transport.report(transport.ambients[1]?.requestId ?? assert.fail(), 'uncertain');
    await until(() => outcome(art, 'b')?.result === (fate === 'refused' ? 'failed' : 'uncertain'));
  }
  await art.restart();
  const count = transport.ambients.length;
  transport.report(stageB.requestId, 'succeeded');
  await tick(); await tick();
  assert.equal(transport.ambients.length, count, 'late staging cannot replay initial authority');
  const timer = [...clock.timers].reverse().find(item => !item.cancelled && item.delay === STAGE_LIFETIME_MS / 2) ?? assert.fail('no renewal');
  art.clock.value += timer.delay; timer.callback();
  await until(() => transport.stages.length === 5);
  const renewal = transport.stages[4] ?? assert.fail();
  assert.equal(renewal.compositionId, (fate === 'uncertain' ? b : a).compositionId);
  assert.equal(renewal.expectedTargetId, 'shelf-display');
  transport.seam.ambient = request => {transport.ambients.push(request); return Promise.resolve({status: 'accepted'});};
  transport.report(renewal.requestId, 'succeeded');
  await until(() => transport.ambients.length === count + 1);
  assert.equal('authorization' in (transport.ambients.at(-1) ?? {}), false, 'maintenance does not reuse the initial grant');
  assert.equal(images.requests.length, 2);
});
