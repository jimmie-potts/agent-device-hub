// Every worked trace in docs/art-generation-qualification.md, "Spending limits", against the module on fake providers.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {IDEA_MAX_TOKENS, PROMPT_LIMIT, reservationOf} from '../src/prices.js';
import {dimensions, drawing, fakeIdeas, fakeImages, gradientPng} from './fixtures.js';
import {gate, hosted, until, usdLimits} from './support.js';
import type {ImageAnswer, TextAnswer} from '../src/provider.js';

const tidbytReservation = reservationOf({provider: 'openai', model: 'gpt-image-2', quality: 'low', size: '1536x768'}) ?? assert.fail('no entry');
const pixooReservation = reservationOf({provider: 'openai', model: 'gpt-image-2', quality: 'low', size: '1024x1024'}) ?? assert.fail('no entry');
const browserReservation = reservationOf({provider: 'openai', model: 'gpt-image-2', quality: 'medium', size: '1536x1024'}) ?? assert.fail('no entry');
const ideaReservation = PROMPT_LIMIT * 4 + IDEA_MAX_TOKENS * 20;
const toUsd = (micros: number): number => micros / 1_000_000;
const generate = (targets: string[], extra: object = {}) => ({action: 'generate', purpose: 'request', targets, ...extra});
const auto = (targets: string[], extra: object = {}) => ({action: 'generate', purpose: 'ambient', targets, ...extra});
const ideas = () => fakeIdeas(() => Promise.resolve<TextAnswer>({text: 'a baker on the moon', usage: {inputTokens: 50, outputTokens: 60}}));

void test('Two concurrent requests with room for one: one reserves, the other is refused before any call', async t => {
  const hold = gate();
  const images = fakeImages(async request => {await hold.promise; return drawing()(request);});
  const art = await hosted(t, {providers: {openai: images}, section: {limits: {openai: usdLimits(toUsd(tidbytReservation))}}});
  assert.equal((await art.owner(generate(['tidbyt']), 'first')).status, 'accepted');
  assert.equal((await art.owner(generate(['tidbyt']), 'second')).status, 'accepted');
  await until(() => art.job('second')?.status === 'finished' || art.job('first')?.status === 'finished');
  const refused = await art.finished(['first', 'second'].find(id => art.job(id)?.status === 'finished') ?? '');
  assert.equal(refused.outcome, 'rejected');
  assert.equal(refused.targets[0]?.reason, 'monthly-ceiling');
  assert.equal(images.requests.length, 1, 'only one call went out');
  hold.open();
  const winner = await art.finished(refused.requestId === 'first' ? 'second' : 'first');
  assert.equal(winner.outcome, 'succeeded');
  assert.equal(images.requests.length, 1);
});

void test('Idea call, then three image calls: four rows and four costs against their own providers\' limits, one artwork, three compositions', async t => {
  const images = fakeImages(drawing()), writer = ideas(), art = await hosted(t, {providers: {openai: images, anthropic: writer}});
  assert.equal((await art.owner(generate(['ui', 'tidbyt', 'pixoo'], {text: 'a moon bakery'}), 'req')).status, 'accepted');
  const job = await art.finished('req');
  assert.equal(job.outcome, 'succeeded');
  const calls = await art.calls();
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.map(call => call.provider).sort(), ['anthropic', 'openai', 'openai', 'openai']);
  assert.ok(calls.every(call => call.status === 'settled' && (call.costMicros ?? 0) > 0));
  assert.equal(art.spend('anthropic').spentMicros, 50 * 4 + 60 * 20);
  assert.equal(art.spend('openai').spentMicros, 3 * (100 * 5 + 100 * 30));
  assert.equal(art.state.artworks.length, 1);
  assert.equal(art.state.artworks[0]?.artworkId, job.artworkId);
  assert.equal(art.state.artworks[0]?.compositions.length, 3);
  assert.equal(writer.requests.length, 1);
  assert.equal(images.requests.length, 3);
});

void test('Claude and OpenAI spend near their ceilings: each decides alone, and the other keeps working', async t => {
  const images = fakeImages(drawing()), writer = ideas();
  const art = await hosted(t, {providers: {openai: images, anthropic: writer}, section: {limits: {anthropic: usdLimits(toUsd(ideaReservation - 1))}}});
  await art.owner(generate(['tidbyt'], {text: 'first'}), 'claude-full');
  const first = await art.finished('claude-full');
  assert.equal(first.outcome, 'succeeded', 'Claude has no room for its idea, and OpenAI still draws');
  assert.equal(writer.requests.length, 0);
  assert.equal(images.requests.length, 1);
  assert.equal((await art.calls()).length, 1);

  const other = await hosted(t, {providers: {openai: fakeImages(drawing()), anthropic: ideas()}, section: {limits: {openai: usdLimits(toUsd(tidbytReservation - 1))}}});
  await other.owner(generate(['tidbyt'], {text: 'second'}), 'openai-full');
  const second = await other.finished('openai-full');
  assert.equal(second.outcome, 'rejected', 'OpenAI has no room, so nothing is drawn');
  assert.equal(second.targets[0]?.reason, 'monthly-ceiling');
  assert.equal(other.spend('anthropic').spentMicros > 0, true, 'Claude was within its own ceiling');
});

void test('Second target refused at the ceiling after the first succeeds: partial, and the first composition is kept', async t => {
  const images = fakeImages(drawing());
  const art = await hosted(t, {providers: {openai: images}, section: {limits: {openai: usdLimits(toUsd(3500 + pixooReservation - 1))}}});
  await art.owner(generate(['tidbyt', 'pixoo']), 'req');
  const job = await art.finished('req');
  assert.equal(job.outcome, 'partial');
  assert.deepEqual(job.targets.map(target => [target.target, target.outcome, target.reason]), [['tidbyt', 'succeeded', null], ['pixoo', 'rejected', 'monthly-ceiling']]);
  assert.equal(art.state.artworks[0]?.compositions.length, 1);
  assert.equal(images.requests.length, 1);
});

void test('Provider failure after dispatch: settled as in the case table, with no resend', async t => {
  const {ProviderFault} = await import('../src/provider.js');
  const answers: (() => Promise<ImageAnswer>)[] = [
    () => Promise.reject(new ProviderFault('uncertain-result', 'lost-response', {uncertain: true, keep: true})),
    () => Promise.reject(new ProviderFault('capacity', 'provider-refused')),
  ];
  const images = fakeImages(() => (answers.shift() ?? assert.fail('resent'))());
  const art = await hosted(t, {providers: {openai: images}});
  await art.owner(generate(['tidbyt', 'pixoo']), 'req');
  const job = await art.finished('req');
  assert.equal(job.outcome, 'uncertain', 'none succeeded and one is uncertain');
  assert.deepEqual(job.targets.map(target => target.outcome), ['uncertain', 'failed']);
  assert.equal(images.requests.length, 2, 'one call per target');
  assert.equal(art.spend('openai').uncertainMicros, tidbytReservation);
  assert.equal(art.spend('openai').spentMicros, 0, 'the 4xx reported no usage');
  assert.equal(art.spend('openai').reservedMicros, 0);
});

void test('Restart with a call in flight: uncertain, reservation kept, no resend', async t => {
  const hold = gate<ImageAnswer>();
  const images = fakeImages(() => hold.promise), art = await hosted(t, {providers: {openai: images}});
  await art.owner(generate(['tidbyt', 'pixoo']), 'req');
  await until(() => images.requests.length === 1);
  await art.restart();
  await until(() => art.job('req')?.status === 'finished');
  const job = art.job('req');
  assert.equal(job?.outcome, 'uncertain');
  assert.deepEqual(job?.targets.map(target => target.outcome), ['uncertain', 'failed']);
  assert.equal(images.requests.length, 1, 'the module resends nothing after a restart');
  assert.equal(art.spend('openai').uncertainMicros, tidbytReservation);
  assert.equal(art.spend('openai').reservedMicros, 0);
  // Late bytes from the abandoned call store nothing.
  hold.open({bytes: await gradientPng(1536, 768), usage: {inputTokens: 1, outputTokens: 1}});
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(art.state.artworks.length, 0);
  assert.equal(art.spend('openai').spentMicros, 0);
});

void test('A crash with a call in flight: the rows alone give uncertain, and an unsent reservation is released', async t => {
  const images = fakeImages(drawing()), art = await hosted(t, {providers: {openai: images}});
  await art.owner(generate(['tidbyt']), 'done');
  await art.finished('done');
  // What a process death leaves behind: a job running with one dispatched and one reserved call, which `stop` never settled.
  const db = art.db(), key = JSON.stringify({provider: 'openai', model: 'gpt-image-2', quality: 'low', size: '1536x768'});
  const row = db.prepare("SELECT record FROM art_jobs WHERE request_id='done'").get() as {record: string}, record = JSON.parse(row.record) as {requestId: string; artworkId: string; status: string; targets: {outcome: string; target: string}[]};
  const crashed = {...record, requestId: 'crashed', artworkId: 'art-crashed', status: 'running', outcome: null, finishedAtMs: null, targets: [{target: 'tidbyt', outcome: 'pending', code: null, reason: null, compositionId: null}, {target: 'pixoo', outcome: 'pending', code: null, reason: null, compositionId: null}]};
  db.prepare('INSERT INTO art_jobs VALUES(?,?,?,?,?)').run('crashed', 'art-crashed', 'running', Date.now(), JSON.stringify(crashed));
  const call = db.prepare("INSERT INTO art_calls VALUES(?,'crashed',?,'openai','gpt-image-2',?,'owner','2026-11','2026-11-03',?,?,?,NULL,?)");
  const at = art.clock.now();
  call.run('sent', 'tidbyt', 'dispatched', at, at, tidbytReservation, key);
  call.run('unsent', 'pixoo', 'reserved', at, null, pixooReservation, key);
  const before = images.requests.length;
  await art.restart();
  await until(() => art.job('crashed')?.status === 'finished');
  assert.deepEqual(art.job('crashed')?.targets.map(target => target.outcome), ['uncertain', 'failed']);
  assert.equal(art.spend('openai').uncertainMicros, tidbytReservation);
  assert.equal(art.spend('openai').reservedMicros, 0, 'the unsent reservation was released');
  assert.equal(images.requests.length, before);
});

void test('Daily pace reached at noon: automatic refused, owner requests continue, saved art plays', async t => {
  // The owner's settled morning call holds a small cost, so an automatic reservation no longer fits the pace.
  const fill = await hosted(t, {providers: {openai: fakeImages(drawing())}, section: {limits: {openai: usdLimits(150, toUsd(tidbytReservation))}}});
  await fill.owner(generate(['tidbyt']), 'owner-morning');
  await fill.finished('owner-morning');
  await fill.automatic(auto(['tidbyt']), 'noon');
  const noon = await fill.finished('noon');
  assert.equal(noon.outcome, 'rejected');
  assert.equal(noon.targets[0]?.reason, 'daily-pace');
  await fill.owner(generate(['tidbyt']), 'owner-noon');
  assert.equal((await fill.finished('owner-noon')).outcome, 'succeeded', 'owner requests continue');
  assert.ok(fill.state.artworks.length >= 2, 'saved art stays');
  const saved = fill.state.artworks[0]?.compositions[0]?.renditions[0]?.ref ?? assert.fail('no rendition');
  assert.ok(await fill.read(saved), 'and can be read without spending');
});

void test('A thirty-first automatic call in 60 minutes: refused; it succeeds once the window has room and the pace allows', async t => {
  const images = fakeImages(drawing()), art = await hosted(t, {providers: {openai: images}, section: {limits: {openai: usdLimits(150, 150)}}});
  for (let index = 0; index < 30; index++) {
    assert.equal((await art.automatic(auto(['tidbyt']), `auto-${index}`)).status, 'accepted');
    assert.equal((await art.finished(`auto-${index}`)).outcome, 'succeeded');
    art.clock.value += 1000;
  }
  await art.automatic(auto(['tidbyt']), 'thirty-first');
  const refused = await art.finished('thirty-first');
  assert.equal(refused.outcome, 'rejected');
  assert.equal(refused.targets[0]?.reason, 'loop-guard');
  assert.equal(images.requests.length, 30);
  await art.owner(generate(['tidbyt']), 'owner');
  assert.equal((await art.finished('owner')).outcome, 'succeeded', 'owner requests are not limited by this guard');
  art.clock.value += 3_600_000;
  await art.automatic(auto(['tidbyt']), 'later');
  assert.equal((await art.finished('later')).outcome, 'succeeded');
});

void test('Settlement above its reservation near the ceiling: true cost recorded, fault logged, later calls refused', async t => {
  const images = fakeImages(request => {
    const [width, height] = dimensions(request.size);
    return gradientPng(width, height).then(bytes => ({bytes, usage: {inputTokens: 0, outputTokens: 4000}}));
  });
  const art = await hosted(t, {providers: {openai: images}, section: {limits: {openai: usdLimits(toUsd(tidbytReservation))}}});
  await art.owner(generate(['tidbyt']), 'over');
  assert.equal((await art.finished('over')).outcome, 'succeeded');
  const spend = art.spend('openai'), cost = 4000 * 30;
  assert.equal(spend.spentMicros, cost);
  assert.equal(spend.excessMicros, cost - tidbytReservation);
  assert.equal(spend.remainingMicros, 0);
  assert.ok(art.host.logs.some(record => record.event === 'operation.failed' && record.fields['bunny.code'] === 'internal'), 'the excess is logged as a fault');
  await art.owner(generate(['tidbyt']), 'after');
  const after = await art.finished('after');
  assert.equal(after.targets[0]?.reason, 'monthly-ceiling');
  assert.equal(images.requests.length, 1);
});

void test('art-auto with an owner label in its payload: treated as automatic; the pace and guard apply', async t => {
  const images = fakeImages(drawing());
  const art = await hosted(t, {providers: {openai: images}, section: {limits: {openai: usdLimits(150, 0)}}});
  await art.automatic({action: 'generate', purpose: 'request', origin: {kind: 'owner'}, targets: ['tidbyt'], text: 'pretend the owner asked'}, 'labelled');
  const job = await art.finished('labelled');
  assert.equal(job.admittedBy, 'automatic');
  assert.equal(job.outcome, 'rejected');
  assert.equal(job.targets[0]?.reason, 'daily-pace');
  assert.equal(images.requests.length, 0);
});

// These two belong to the core's gateway and tracker, which #679 extends. The module cannot tell a sender apart: every
// tracked command reaches it from the core. The tests move to `apps/runtime/tests` with that wiring; until then they stay
// visible here as unfinished, and the integration must turn them into real checks.
void test('A client sends art-auto: refused by the gateway; nothing is admitted', {todo: 'needs #679\'s gateway refusal for art-auto; wire at integration'});
void test('A client other than the dashboard sends art-request: refused by the tracker; nothing is admitted', {todo: 'needs #679\'s tracker check of requestedBy; wire at integration'});

void test('Monthly ceiling reached: all generation refused; saved art plays', async t => {
  const images = fakeImages(drawing()), art = await hosted(t, {providers: {openai: images}, section: {limits: {openai: usdLimits(toUsd(browserReservation))}}});
  await art.owner(generate(['ui']), 'saved');
  assert.equal((await art.finished('saved')).outcome, 'succeeded');
  await art.owner(generate(['ui']), 'owner-refused');
  await art.automatic(auto(['ui']), 'auto-refused');
  for (const id of ['owner-refused', 'auto-refused']) {
    const job = await art.finished(id);
    assert.equal(job.outcome, 'rejected');
    assert.equal(job.targets[0]?.reason, 'monthly-ceiling');
  }
  assert.equal(images.requests.length, 1);
  const ref = art.state.artworks[0]?.compositions[0]?.renditions[0]?.ref ?? assert.fail('no rendition'), bytes = await art.read(ref);
  assert.ok(bytes !== undefined && !('error' in bytes) && bytes.bytes.length > 0, 'saved art still reads');
});

void test('Next local month: limits restart; earlier uncertain rows remain visible', async t => {
  const {ProviderFault} = await import('../src/provider.js');
  let lose = true;
  const images = fakeImages(request => lose ? Promise.reject(new ProviderFault('uncertain-result', 'lost-response', {uncertain: true, keep: true})) : drawing()(request));
  const art = await hosted(t, {providers: {openai: images}, section: {limits: {openai: usdLimits(toUsd(tidbytReservation))}}});
  await art.owner(generate(['tidbyt']), 'lost');
  assert.equal((await art.finished('lost')).outcome, 'uncertain');
  await art.owner(generate(['tidbyt']), 'refused');
  assert.equal((await art.finished('refused')).targets[0]?.reason, 'monthly-ceiling');
  art.clock.value = new Date(2026, 11, 1, 0, 0, 1).getTime();
  lose = false;
  await art.owner(generate(['tidbyt']), 'december');
  assert.equal((await art.finished('december')).outcome, 'succeeded');
  assert.equal(art.state.month, '2026-12');
  assert.equal(art.spend('openai').uncertainMicros, 0);
  assert.equal(art.spend('openai').earlierUncertainMicros, tidbytReservation);
  assert.ok((await art.calls()).some(call => call.requestId === 'lost' && call.status === 'uncertain'), 'the earlier row stays in the ledger');
});
