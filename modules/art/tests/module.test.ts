// The record's case table, the catalog and the seams, on fake providers and synthetic images.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import sharp from 'sharp';
import {configureArt} from '../src/configuration.js';
import {artworkOutcome, STAGE_LIFETIME_MS} from '../src/module.js';
import {PROMPT_LIMIT} from '../src/prices.js';
import {ProviderFault, type ImageAnswer, type TextAnswer} from '../src/provider.js';
import {MAX_TEXT, MAX_IDEA, MAX_VARIATION_IDEA, contextFor, imagePrompt, variationIdea} from '../src/prompts.js';
import type {ArtAmbientRequest, ArtDispatchSeam, ArtStageRequest, StageResult} from '../src/seams.js';
import {distinctDrawing, drawing, fakeIdeas, fakeImages, gifBytes, gradientPng} from './fixtures.js';
import {gate, hosted, until} from './support.js';

const generate = (targets: string[], extra: object = {}) => ({action: 'start', purpose: 'request', origin: {kind: 'owner'}, targets, ...extra});
const reservation = 2 * 834 * 30 + PROMPT_LIMIT * 5;

function fakeDispatch(answer: 'succeeded' | 'wait' | 'refuse' = 'succeeded') {
  const stages: ArtStageRequest[] = [], ambients: ArtAmbientRequest[] = [];
  let report: (requestId: string, result: StageResult) => void = () => {};
  const seam: ArtDispatchSeam = {
    stage: request => {
      stages.push(request);
      if (answer === 'refuse') return Promise.resolve({error: {code: 'unavailable', retryable: true}});
      if (answer === 'succeeded') setImmediate(() => {report(request.requestId, 'succeeded');});
      return Promise.resolve({status: 'accepted'});
    },
    ambient: request => {ambients.push(request); return Promise.resolve({status: 'accepted'});},
    watch: result => {report = result; return Promise.resolve([]);},
  };
  return {seam, stages, ambients, report: (requestId: string, result: StageResult) => {report(requestId, result);}};
}

void test('late stages cannot select deleted or superseded ambient art', async t => {
  const dispatch = fakeDispatch('wait'), art = await hosted(t, {providers: {openai: fakeImages(distinctDrawing())}, dispatch: dispatch.seam});
  const ambient = {action: 'start', purpose: 'ambient', origin: {kind: 'schedule'}, targets: ['tidbyt']};
  await art.automatic(ambient, 'old');
  const old = await art.finished('old');
  await art.automatic(ambient, 'current');
  const current = await art.finished('current');
  dispatch.report(dispatch.stages[0]?.requestId ?? '', 'succeeded');
  await until(() => art.state.candidates.length === 1);
  assert.equal(dispatch.ambients.length, 0, 'superseded art must not become ambient');
  await art.catalog({action: 'delete', artworkId: current.artworkId}, 'delete-current');
  dispatch.report(dispatch.stages[1]?.requestId ?? '', 'succeeded');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(dispatch.ambients.length, 0, 'deleted pending art must not become ambient');
  assert.equal(art.state.artworks[0]?.artworkId, old.artworkId);
});

void test('deleted ambient art cancels renewal and cannot be restored by an already queued callback', async t => {
  const timers: {delay: number; callback: () => void; cancelled: boolean}[] = [];
  const scheduler = {after: (delay: number, callback: () => void) => {const timer = {delay, callback, cancelled: false}; timers.push(timer); return () => {timer.cancelled = true;};}};
  const dispatch = fakeDispatch(), art = await hosted(t, {providers: {openai: fakeImages(drawing())}, dispatch: dispatch.seam, scheduler});
  await art.automatic({action: 'start', purpose: 'ambient', origin: {kind: 'schedule'}, targets: ['tidbyt']}, 'ambient');
  const job = await art.finished('ambient');
  await until(() => dispatch.ambients.length === 1);
  const timer = timers.find(entry => entry.delay === STAGE_LIFETIME_MS / 2) ?? assert.fail('no renewal');
  await art.catalog({action: 'delete', artworkId: job.artworkId}, 'delete');
  assert.equal(timer.cancelled, true);
  art.clock.value += STAGE_LIFETIME_MS / 2;
  timer.callback();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(dispatch.stages.length, 1);
  assert.equal(dispatch.ambients.at(-1)?.compositionId, null);
});

void test('conflicting staging evidence withdraws a candidate', async t => {
  const dispatch = fakeDispatch('wait'), art = await hosted(t, {providers: {openai: fakeImages(drawing())}, dispatch: dispatch.seam});
  await art.owner(generate(['pixoo']), 'conflict'); await art.finished('conflict');
  const stage = dispatch.stages[0] ?? assert.fail('no stage');
  dispatch.report(stage.requestId, 'succeeded');
  await until(() => art.state.candidates.length === 1);
  dispatch.report(stage.requestId, 'uncertain');
  await until(() => art.state.candidates.length === 0);
});

for (const next of ['renewal', 'replacement'] as const) void test(`deleting issued ambient art clears it while ${next} is pending, including after restart`, async t => {
  const timers: {delay: number; callback: () => void}[] = [];
  const scheduler = {after: (delay: number, callback: () => void) => {timers.push({delay, callback}); return () => {};}};
  const dispatch = fakeDispatch('wait'), art = await hosted(t, {providers: {openai: fakeImages(drawing())}, dispatch: dispatch.seam, scheduler});
  const request = {action: 'start', purpose: 'ambient', origin: {kind: 'schedule'}, targets: ['tidbyt']};
  await art.automatic(request, 'visible');
  const visible = await art.finished('visible');
  dispatch.report(dispatch.stages[0]?.requestId ?? '', 'succeeded');
  await until(() => dispatch.ambients.length === 1);
  if (next === 'renewal') {
    art.clock.value += STAGE_LIFETIME_MS / 2;
    (timers.find(timer => timer.delay === STAGE_LIFETIME_MS / 2) ?? assert.fail('no renewal')).callback();
  } else {await art.automatic(request, 'replacement'); await art.finished('replacement');}
  await until(() => dispatch.stages.length === 2);
  await art.restart();
  assert.equal(dispatch.ambients.length, 1, 'restart does not replay ambient commands');
  await art.catalog({action: 'delete', artworkId: visible.artworkId}, 'delete-visible');
  await until(() => dispatch.ambients.length === 2);
  assert.equal(dispatch.ambients[1]?.compositionId, null);
  dispatch.report(dispatch.stages[1]?.requestId ?? '', 'succeeded');
  if (next === 'replacement') await until(() => dispatch.ambients.length === 3);
  else {await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(dispatch.ambients.length, 2, 'late renewal cannot restore deleted art');}
});

void test('late staging evidence never extends the admitted copy lifetime', async t => {
  const dispatch = fakeDispatch('wait'), art = await hosted(t, {providers: {openai: fakeImages(drawing())}, dispatch: dispatch.seam});
  await art.owner(generate(['pixoo']), 'late'); await art.finished('late');
  art.clock.value += STAGE_LIFETIME_MS + 1;
  dispatch.report(dispatch.stages[0]?.requestId ?? '', 'succeeded');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(art.state.candidates.length, 0);
});

void test('weather is rechecked when a queued job reaches its provider', async t => {
  const hold = gate(), now = Date.UTC(2026, 10, 5, 12);
  let calls = 0;
  const images = fakeImages(async request => {if (++calls <= 2) await hold.promise; return drawing()(request);});
  const art = await hosted(t, {providers: {openai: images}, now, weather: {start: () => Promise.resolve([]), read: () => ({words: ['rain'], staleAtMs: now + 50})}});
  for (const id of ['one', 'two', 'queued']) await art.owner(generate(['ui']), id);
  await until(() => images.requests.length === 2);
  art.clock.value += 100; hold.open();
  await art.finished('queued');
  assert.equal(images.requests[2]?.prompt.includes('rain'), false);
});

void test('a variation retains its explicit change even with a maximum-length source idea', () => {
  const idea = variationIdea('x'.repeat(MAX_IDEA), 'make the sky red');
  assert.ok(idea.length <= MAX_VARIATION_IDEA);
  assert.match(idea, /make the sky red/);
  assert.match(idea, /xxx/);
  const change = 'r'.repeat(MAX_TEXT), long = variationIdea('x'.repeat(MAX_IDEA), change);
  const prompt = imagePrompt(long, 'tidbyt', contextFor('variation', 0, null));
  assert.ok(prompt.includes(change));
  assert.ok(prompt.length <= PROMPT_LIMIT);
});

void test('an artwork outcome follows the record\'s rules', () => {
  assert.equal(artworkOutcome(['succeeded', 'succeeded']), 'succeeded');
  assert.equal(artworkOutcome(['succeeded', 'failed']), 'partial');
  assert.equal(artworkOutcome(['succeeded', 'uncertain']), 'partial');
  assert.equal(artworkOutcome(['failed', 'uncertain']), 'uncertain');
  assert.equal(artworkOutcome(['failed', 'failed']), 'failed');
  assert.equal(artworkOutcome(['rejected', 'rejected']), 'rejected');
  assert.equal(artworkOutcome(['cancelled', 'cancelled']), 'cancelled');
  assert.equal(artworkOutcome(['rejected', 'cancelled']), 'failed', 'only when every target was');
});

void test('the section sets each provider\'s editable limits, $150 and $5 by default, and refuses what it does not know', () => {
  const defaults = configureArt({});
  assert.ok(!('error' in defaults));
  assert.deepEqual(defaults.config.limits, {openai: {ceilingMicros: 150_000_000, paceMicros: 5_000_000}, anthropic: {ceilingMicros: 150_000_000, paceMicros: 5_000_000}});
  const edited = configureArt({limits: {openai: {monthlyCeilingUsd: 20.5}, anthropic: {dailyPaceUsd: 1}}, recentLimit: 10, secrets: {'openai-api-key': '/p', 'anthropic-api-key': '/q'}});
  assert.ok(!('error' in edited));
  assert.equal(edited.config.limits.openai.ceilingMicros, 20_500_000);
  assert.equal(edited.config.limits.anthropic.paceMicros, 1_000_000);
  assert.deepEqual(edited.config.keys, {openai: true, anthropic: true});
  for (const bad of [null, {location: 'x'}, {limits: {codex: {}}}, {limits: {openai: {monthlyCeilingUsd: -1}}}, {recentLimit: 0}, {secrets: {other: '/p'}}]) assert.ok('error' in configureArt(bad), JSON.stringify(bad));
});

void test('durable admission commits the row and a succeeded, observed outcome together; a duplicate is one job', async t => {
  const hold = gate(), images = fakeImages(async request => {await hold.promise; return drawing()(request);}), art = await hosted(t, {providers: {openai: images}});
  assert.equal((await art.owner(generate(['tidbyt']), 'once')).status, 'accepted');
  await until(() => art.outcomes.length === 1);
  assert.deepEqual(art.outcomes[0]?.data, {requestId: 'once', result: 'succeeded', evidence: 'observed'});
  assert.equal(art.outcomes[0]?.type, 'org.bunny.art.request.completed');
  assert.equal(art.job('once')?.status === 'finished', false, 'the outcome reports admission, not the art');
  assert.equal((await art.owner(generate(['tidbyt']), 'once')).status, 'accepted');
  const conflict = await art.owner(generate(['pixoo']), 'once');
  assert.equal(conflict.status, 'rejected');
  hold.open();
  await art.finished('once');
  assert.equal(images.requests.length, 1);
  assert.equal(art.outcomes.length, 1);
});

void test('a failed save admits nothing and calls nothing', async t => {
  const images = fakeImages(drawing()), art = await hosted(t, {providers: {openai: images}});
  art.db().exec("CREATE TRIGGER refuse_jobs BEFORE INSERT ON art_jobs BEGIN SELECT RAISE(FAIL,'database or disk is full'); END");
  const answer = await art.owner(generate(['tidbyt']), 'full');
  assert.equal(answer.status, 'rejected');
  assert.equal(images.requests.length, 0);
  assert.equal(art.outcomes.length, 0);
});

void test('malformed requests are refused before a row exists', async t => {
  const images = fakeImages(drawing()), art = await hosted(t, {providers: {openai: images}});
  const bad = [generate([]), generate(['wall']), generate(['ui', 'ui']), generate(['ui'], {text: ''}), generate(['ui'], {text: 'x'.repeat(MAX_TEXT + 1)}), generate(['ui'], {location: 'somewhere'}), generate(['ui'], {purpose: 'variation', variationOf: 'art-none'}), generate(['ui'], {context: {weather: '48°F'}}), {action: 'mystery'}, {action: 'cancel', jobRequestId: 'none'}];
  let index = 0;
  for (const data of bad) assert.equal((await art.owner(data, `bad-${index++}`)).status, 'rejected', JSON.stringify(data));
  assert.equal(art.state.jobs.length, 0);
  assert.equal(images.requests.length, 0);
});

void test('no key: refused before any call, and saved art keeps playing', async t => {
  const art = await hosted(t, {providers: {}});
  await art.owner(generate(['tidbyt']), 'keyless');
  const job = await art.finished('keyless');
  assert.equal(job.outcome, 'rejected');
  assert.equal(job.targets[0]?.reason, 'no-key');
  assert.equal((await art.calls()).length, 0);
  assert.equal(art.spend('openai').available, false);
});

void test('a section without a readable key file is no key, not a failed module', async t => {
  const art = await hosted(t, {section: {secrets: {'openai-api-key': '/none'}}});
  assert.deepEqual(art.host.failures, []);
  assert.equal(art.spend('openai').available, false);
  assert.equal(art.spend('anthropic').available, false);
});

void test('a key read from its secret file reaches the provider\'s header and nothing else', async t => {
  const sent: {url: string; authorization: string | undefined}[] = [], key = 'synthetic-secret-value';
  const art = await hosted(t, {section: {secrets: {'openai-api-key': '/synthetic'}}, secrets: {'openai-api-key': `${key}\n`}, transport: async (url, init) => {
    sent.push({url, authorization: init.headers.authorization});
    return new Response(JSON.stringify({data: [{b64_json: (await gradientPng(1536, 1024)).toString('base64')}], usage: {input_tokens: 1, output_tokens: 1}}), {status: 200});
  }});
  await art.owner(generate(['ui'], {text: 'a moon bakery'}), 'req');
  assert.equal((await art.finished('req')).outcome, 'succeeded');
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.authorization, `Bearer ${key}`);
  assert.equal(JSON.stringify(art.state).includes(key), false);
  assert.equal(JSON.stringify(art.host.logs).includes(key), false);
});

void test('a provider without image output is refused by the capability check', async t => {
  const text = fakeIdeas(() => Promise.resolve<TextAnswer>({text: 'idea', usage: null}));
  const art = await hosted(t, {providers: {openai: {...text, name: 'openai'}}});
  await art.owner(generate(['tidbyt']), 'req');
  const job = await art.finished('req');
  assert.equal(job.targets[0]?.reason, 'unsupported');
  assert.equal(job.targets[0]?.code, 'unsupported-capability');
  assert.equal((await art.calls()).length, 0);
});

void test('cancelled before dispatch: cancelled, and nothing is stored', async t => {
  const hold = gate(), images = fakeImages(async request => {await hold.promise; return drawing()(request);}), art = await hosted(t, {providers: {openai: images}});
  // Two jobs run at once, so the third waits.
  await art.owner(generate(['tidbyt']), 'one');
  await art.owner(generate(['tidbyt']), 'two');
  await art.owner(generate(['tidbyt']), 'waiting');
  assert.equal((await art.owner({action: 'cancel', jobRequestId: 'waiting'}, 'cancel-it')).status, 'accepted');
  const job = await art.finished('waiting');
  assert.equal(job.outcome, 'cancelled');
  hold.open();
  await art.finished('one'); await art.finished('two');
  assert.equal(images.requests.length, 2);
  assert.equal((await art.calls()).filter(call => call.requestId === 'waiting').length, 0);
  assert.equal((await art.owner({action: 'cancel', jobRequestId: 'waiting'}, 'too-late')).status, 'rejected');
});

void test('cancelled after dispatch: uncertain, the reservation kept, late bytes discarded, and no resend; later targets are cancelled', async t => {
  const hold = gate<ImageAnswer>(), images = fakeImages(() => hold.promise), art = await hosted(t, {providers: {openai: images}});
  await art.owner(generate(['tidbyt', 'pixoo']), 'req');
  await until(() => images.requests.length === 1);
  assert.equal((await art.owner({action: 'cancel', jobRequestId: 'req'}, 'stop-it')).status, 'accepted');
  const job = await art.finished('req');
  assert.deepEqual(job.targets.map(target => target.outcome), ['uncertain', 'cancelled']);
  assert.equal(job.outcome, 'uncertain');
  assert.equal(art.spend('openai').uncertainMicros, reservation);
  hold.open({bytes: gifBytes(512, 256), usage: {inputTokens: 1, outputTokens: 1}});
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(art.state.artworks.length, 0);
  assert.equal(art.spend('openai').spentMicros, 0);
  assert.equal(images.requests.length, 1);
});

void test('an automatic job can be cancelled by the owner', async t => {
  const hold = gate<ImageAnswer>(), images = fakeImages(() => hold.promise), art = await hosted(t, {providers: {openai: images}});
  await art.automatic({action: 'start', purpose: 'ambient', origin: {kind: 'schedule'}, targets: ['tidbyt']}, 'auto');
  await until(() => images.requests.length === 1);
  assert.equal((await art.owner({action: 'cancel', jobRequestId: 'auto'}, 'stop-auto')).status, 'accepted');
  assert.equal((await art.finished('auto')).outcome, 'uncertain');
  hold.open({bytes: Buffer.alloc(0), usage: null});
});

void test('on a still, 4xx answers fail without a resend: moderation, unverified organization and rate limit', async t => {
  for (const [code, reason] of [['invalid-request', 'moderation'], ['forbidden', 'provider-refused'], ['capacity', 'provider-refused']] as const) {
    const images = fakeImages(() => Promise.reject(new ProviderFault(code, reason)));
    const art = await hosted(t, {providers: {openai: images}});
    await art.owner(generate(['ui']), 'req');
    const job = await art.finished('req');
    assert.equal(job.outcome, 'failed');
    assert.deepEqual([job.targets[0]?.code, job.targets[0]?.reason], [code, reason]);
    assert.equal(images.requests.length, 1);
    assert.equal(art.spend('openai').spentMicros, 0);
    assert.equal(art.spend('openai').reservedMicros, 0);
    assert.equal(art.state.artworks.length, 0);
  }
  const reported = fakeImages(() => Promise.reject(new ProviderFault('capacity', 'provider-refused', {usage: {inputTokens: 10, outputTokens: 0}})));
  const art = await hosted(t, {providers: {openai: reported}});
  await art.owner(generate(['ui']), 'req');
  await art.finished('req');
  assert.equal(art.spend('openai').spentMicros, 50, 'reported usage counts');
});

void test('invalid still output fails before storage: reported usage settles, otherwise the reservation is kept', async t => {
  const answers: ImageAnswer[] = [{bytes: Buffer.from('corrupt'), usage: {inputTokens: 1, outputTokens: 1}}, {bytes: Buffer.from('corrupt'), usage: null}];
  const images = fakeImages(() => Promise.resolve(answers.shift() ?? assert.fail('resent'))), art = await hosted(t, {providers: {openai: images}});
  await art.owner(generate(['ui']), 'with-usage');
  const first = await art.finished('with-usage');
  assert.deepEqual([first.outcome, first.targets[0]?.reason], ['failed', 'invalid-output']);
  assert.equal(art.spend('openai').spentMicros, 35);
  await art.owner(generate(['ui']), 'without');
  assert.equal((await art.finished('without')).outcome, 'failed');
  assert.equal(art.spend('openai').uncertainMicros, 2 * 1372 * 30 + PROMPT_LIMIT * 5);
  assert.equal(art.state.artworks.length, 0);
  assert.equal(art.db().prepare('SELECT COUNT(*) AS blobs FROM art_blobs').get()?.blobs, 0, 'no bytes were kept');
});

void test('a moderated GIF fails with nothing stored, and a lost one stays uncertain with nothing stored', async t => {
  for (const [fault, outcome] of [[new ProviderFault('invalid-request', 'moderation'), 'failed'], [new ProviderFault('uncertain-result', 'lost-response', {uncertain: true, keep: true}), 'uncertain']] as const) {
    const images = fakeImages(() => Promise.reject(fault)), art = await hosted(t, {providers: {openai: images}});
    await art.owner(generate(['pixoo']), 'req');
    assert.equal((await art.finished('req')).outcome, outcome);
    assert.equal(images.requests.length, 1);
    assert.equal(art.state.artworks.length, 0);
  }
});

void test('one of three targets fails: partial, the others are stored, each call on its own terms', async t => {
  const images = fakeImages(request => request.size === '512x512' ? Promise.reject(new ProviderFault('invalid-request', 'moderation')) : drawing()(request));
  const art = await hosted(t, {providers: {openai: images}});
  await art.owner(generate(['ui', 'pixoo', 'tidbyt']), 'req');
  const job = await art.finished('req');
  assert.equal(job.outcome, 'partial');
  assert.deepEqual(art.state.artworks[0]?.compositions.map(entry => entry.target).sort(), ['tidbyt', 'ui']);
  const result = await art.readJson<{outcome: string; calls: unknown[]; compositions: {target: string; compositionId: string | null; outcome: string}[]}>(`artwork.${job.artworkId}`);
  assert.equal(result.outcome, 'partial');
  assert.equal(result.calls.length, 3);
  assert.equal(result.compositions.find(entry => entry.target === 'pixoo')?.compositionId, null);
});

void test('renditions: a composition is the SHA-256 of its defining bytes, each display has one GIF rendition, and the browser gets a medium still', async t => {
  const drawn = new Map<string, Uint8Array>();
  const images = fakeImages(async request => {const answer = await drawing()(request); drawn.set(request.size, answer.bytes); return answer;}), art = await hosted(t, {providers: {openai: images}});
  await art.owner(generate(['tidbyt', 'pixoo', 'ui']), 'req');
  await art.finished('req');
  assert.deepEqual(images.requests.map(request => [request.model, request.size, request.quality, request.gif?.frameCount, request.gif?.frameDurationMs]), [
    ['gpt-image-2', '1536x1024', 'medium', undefined, undefined], ['gpt-image-2.6-flare', '512x256', 'low', 8, 200], ['gpt-image-2.6-flare', '512x512', 'low', 8, 200]]);
  const artwork = art.state.artworks[0] ?? assert.fail('no artwork');
  assert.equal(artwork.provenance.generatedBy, 'openai');
  assert.equal(artwork.provenance.factual, false);
  assert.ok(artwork.palette.every(colour => /^#[0-9A-F]{6}$/.test(colour)) && artwork.palette.length > 0);
  const defining = {ui: drawn.get('1536x1024'), tidbyt: drawn.get('512x256'), pixoo: drawn.get('512x512')};
  for (const composition of artwork.compositions) {
    assert.equal(composition.compositionId, createHash('sha256').update(defining[composition.target] ?? assert.fail('not drawn')).digest('hex'));
    const first = composition.renditions[0] ?? assert.fail('no rendition'), bytes = await art.read(first.ref);
    assert.ok(bytes !== undefined && !('error' in bytes));
    assert.equal(createHash('sha256').update(bytes.bytes).digest('hex'), first.renditionId);
    if (composition.target === 'ui') {
      assert.deepEqual([bytes.type, composition.motion, composition.renditions.length, first.width, first.height], ['image/webp', 'still', 2, 1536, 1024]);
    } else {
      const info = await sharp(bytes.bytes, {animated: true}).metadata(), height = composition.target === 'tidbyt' ? 32 : 64;
      assert.deepEqual([bytes.type, composition.motion, composition.renditions.length, first.frames, first.durationMs, first.width, first.height, info.pages, info.pageHeight], ['image/gif', 'gif', 1, 8, 1600, 64, height, 8, height]);
    }
  }
  assert.deepEqual(art.state.gifs, {accepted: 2, rejected: 0});
});

void test('a wrong GIF still counts as spent, sends nothing more and falls back to local motion', async t => {
  const answers: Uint8Array[] = [gifBytes(512, 256, {frames: 4}), gifBytes(512, 512, {delayMs: 50}), Buffer.from('not a gif')];
  const images = fakeImages(() => Promise.resolve({bytes: answers.shift() ?? assert.fail('resent'), usage: {inputTokens: 1, outputTokens: 1}})), art = await hosted(t, {providers: {openai: images}});
  for (const [id, target] of [['frames', 'tidbyt'], ['timing', 'pixoo'], ['corrupt', 'tidbyt']] as const) {
    await art.owner(generate([target]), id);
    const job = await art.finished(id);
    assert.deepEqual([job.outcome, job.targets[0]?.outcome, job.targets[0]?.reason], ['succeeded', 'succeeded', 'invalid-output'], id);
  }
  assert.equal(images.requests.length, 3);
  assert.equal(art.spend('openai').spentMicros, 3 * 35);
  assert.deepEqual(art.state.gifs, {accepted: 0, rejected: 3});
  const composition = art.state.artworks[0]?.compositions[0] ?? assert.fail('none'), rendered = composition.renditions[0] ?? assert.fail('none');
  assert.deepEqual([composition.motion, rendered.format, rendered.frames], ['local', 'gif', 8]);
  assert.equal(composition.compositionId, rendered.renditionId, 'a locally animated result is its own bytes');
  assert.equal(art.state.artworks[0]?.provenance.generatedBy, 'local');
});

void test('a wrong GIF without usage keeps its reservation, and still falls back', async t => {
  const images = fakeImages(() => Promise.resolve({bytes: Buffer.from('not a gif'), usage: null})), art = await hosted(t, {providers: {openai: images}});
  await art.owner(generate(['tidbyt']), 'req');
  assert.equal((await art.finished('req')).outcome, 'succeeded');
  assert.equal(art.spend('openai').uncertainMicros, reservation);
  assert.equal(art.spend('openai').spentMicros, 0);
});

void test('a preview-access refusal falls back to local motion with no resend, and the browser still lends its look', async t => {
  const images = fakeImages(request => request.gif === undefined ? drawing()(request) : Promise.reject(new ProviderFault('forbidden', 'preview-refused')));
  const art = await hosted(t, {providers: {openai: images}});
  await art.owner(generate(['pixoo', 'ui']), 'req');
  const job = await art.finished('req');
  assert.equal(job.outcome, 'succeeded');
  assert.deepEqual(job.targets.map(target => [target.target, target.reason]), [['ui', null], ['pixoo', 'preview-refused']]);
  assert.equal(images.requests.length, 2);
  const composition = art.state.artworks[0]?.compositions.find(entry => entry.target === 'pixoo') ?? assert.fail('none');
  assert.equal(composition.motion, 'local');
  assert.equal(art.state.artworks[0]?.provenance.generatedBy, 'openai', 'the still was drawn');
  assert.deepEqual(art.state.gifs, {accepted: 0, rejected: 0}, 'no GIF came back to reject');
  const alone = await hosted(t, {providers: {openai: fakeImages(() => Promise.reject(new ProviderFault('not-found', 'preview-refused')))}});
  await alone.owner(generate(['tidbyt']), 'req');
  assert.equal((await alone.finished('req')).outcome, 'succeeded', 'procedural art stands in without a still');
});

void test('prompts hold only the owner\'s text, imagination, time, season and condition words, within the limit, and Claude writes no idea when told nothing else', async t => {
  const images = fakeImages(drawing()), writer = fakeIdeas(() => Promise.resolve<TextAnswer>({text: 'a baker on the moon', usage: {inputTokens: 1, outputTokens: 1}}));
  const weather = {start: () => Promise.resolve([]), read: () => ({words: ['chance of rain', 'Springfield, USA has commas', '48°F', 'evening'], staleAtMs: Date.now() + 1e12})};
  const art = await hosted(t, {providers: {openai: images, anthropic: writer}, weather, now: new Date(2026, 9, 3, 19).getTime()});
  await art.owner(generate(['tidbyt'], {text: 'y'.repeat(MAX_TEXT), origin: {kind: 'owner', reference: 'ref-1'}}), 'req');
  await art.finished('req');
  const prompt = images.requests[0]?.prompt ?? assert.fail('no prompt'), idea = writer.requests[0]?.prompt ?? assert.fail('no idea prompt');
  assert.ok(prompt.length <= PROMPT_LIMIT);
  assert.ok(idea.length + (writer.requests[0]?.system.length ?? 0) <= PROMPT_LIMIT);
  assert.equal(JSON.stringify(art.state).includes('rain'), false, 'weather stays out of the state');
  for (const text of [prompt, idea]) {
    assert.match(text, /evening in autumn/);
    assert.match(text, /mood: chance of rain\./);
    assert.equal(text.includes('Springfield') || text.includes('48'), false, 'only condition words pass');
    assert.equal(text.includes('ref-1'), false);
  }
  assert.match(prompt, /a baker on the moon/);
  assert.match(prompt, /No text/);
});

void test('stale or missing weather makes no claim', async t => {
  for (const read of [() => null, () => ({words: ['heavy snow'], staleAtMs: 1})]) {
    const images = fakeImages(drawing()), art = await hosted(t, {providers: {openai: images}, weather: {start: () => Promise.resolve([]), read}});
    await art.owner(generate(['tidbyt']), 'req');
    await art.finished('req');
    const prompt = images.requests[0]?.prompt ?? '';
    assert.equal(/weather|snow/i.test(prompt), false, prompt);
  }
});

void test('a failed idea call is its own row and the art goes on with plain words', async t => {
  const images = fakeImages(drawing()), writer = fakeIdeas(() => Promise.reject(new ProviderFault('uncertain-result', 'lost-response', {uncertain: true, keep: true})));
  const art = await hosted(t, {providers: {openai: images, anthropic: writer}});
  await art.owner(generate(['tidbyt'], {text: 'a moon bakery'}), 'req');
  assert.equal((await art.finished('req')).outcome, 'succeeded');
  assert.match(images.requests[0]?.prompt ?? '', /a moon bakery/);
  assert.equal(art.spend('anthropic').uncertainMicros > 0, true);
  assert.equal(writer.requests.length, 1);
});

void test('a variation names its source, builds on its idea and sends no input image', async t => {
  const images = fakeImages(drawing()), art = await hosted(t, {providers: {openai: images}});
  await art.owner(generate(['tidbyt'], {text: 'a moon bakery'}), 'source');
  const source = await art.finished('source');
  await art.owner(generate(['tidbyt'], {purpose: 'variation', variationOf: source.artworkId, text: 'at dawn'}), 'variant');
  await art.finished('variant');
  const prompt = images.requests[1]?.prompt ?? '';
  assert.match(prompt, /variation/);
  assert.match(prompt, /a moon bakery/);
  assert.match(prompt, /at dawn/);
  assert.equal(art.state.artworks.find(entry => entry.variationOf === source.artworkId)?.provenance.generatedBy, 'openai');
  assert.deepEqual(Object.keys(images.requests[1] ?? {}).sort(), ['gif', 'model', 'prompt', 'quality', 'size'], 'no input image');
});

void test('nothing is offered until the core reports staging succeeded; then a device reference is staged by its composition ID', async t => {
  const dispatch = fakeDispatch('wait'), art = await hosted(t, {providers: {openai: fakeImages(drawing())}, dispatch: dispatch.seam});
  await art.owner(generate(['ui', 'tidbyt']), 'req');
  await art.finished('req');
  await until(() => dispatch.stages.length === 1);
  assert.deepEqual(art.state.candidates, []);
  const stage = dispatch.stages[0] ?? assert.fail('no stage');
  const artwork = art.state.artworks[0] ?? assert.fail('no artwork'), composition = artwork.compositions.find(entry => entry.target === 'tidbyt') ?? assert.fail('no composition');
  assert.equal(stage.compositionId, composition.compositionId);
  assert.deepEqual([stage.target, stage.format, stage.width, stage.height, stage.frames, stage.durationMs, stage.lifetimeMs], ['tidbyt', 'gif', 64, 32, 8, 1600, STAGE_LIFETIME_MS]);
  assert.equal(stage.sha256, createHash('sha256').update(stage.bytes).digest('hex'));
  assert.ok(stage.bytes.length <= 160 * 1024);
  dispatch.report(stage.requestId, 'succeeded');
  await until(() => art.state.candidates.length === 1);
  assert.deepEqual(art.state.candidates[0], {artworkId: artwork.artworkId, target: 'tidbyt', compositionId: stage.compositionId, favorite: false, stagedUntilMs: art.clock.now() + STAGE_LIFETIME_MS});
});

void test('a refused or uncertain stage offers nothing and is never resent', async t => {
  const refused = fakeDispatch('refuse'), art = await hosted(t, {providers: {openai: fakeImages(drawing())}, dispatch: refused.seam});
  await art.owner(generate(['pixoo']), 'req');
  await art.finished('req');
  await until(() => refused.stages.length === 1);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(art.state.candidates, []);
  assert.equal(refused.stages.length, 1);
  const lost = fakeDispatch('wait'), other = await hosted(t, {providers: {openai: fakeImages(drawing())}, dispatch: lost.seam});
  await other.owner(generate(['pixoo']), 'req');
  await other.finished('req');
  await until(() => lost.stages.length === 1);
  lost.report(lost.stages[0]?.requestId ?? '', 'uncertain');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(other.state.candidates, []);
  assert.equal(lost.stages.length, 1);
});

void test('a finished ambient job sets the tile once its copy is staged; deleting it clears the tile', async t => {
  const dispatch = fakeDispatch(), art = await hosted(t, {providers: {openai: fakeImages(drawing())}, dispatch: dispatch.seam});
  await art.automatic({action: 'start', purpose: 'ambient', origin: {kind: 'schedule'}, targets: ['tidbyt']}, 'ambient');
  const job = await art.finished('ambient');
  await until(() => dispatch.ambients.length === 1);
  const composition = art.state.artworks[0]?.compositions[0]?.compositionId;
  assert.deepEqual([dispatch.ambients[0]?.target, dispatch.ambients[0]?.compositionId], ['tidbyt', composition]);
  assert.equal((await art.catalog({action: 'delete', artworkId: job.artworkId}, 'drop')).status, 'accepted');
  await until(() => dispatch.ambients.length === 2);
  assert.equal(dispatch.ambients[1]?.compositionId, null);
});

void test('reusing a favorite stages saved bytes for free, and it stays offered first', async t => {
  const dispatch = fakeDispatch('wait'), images = fakeImages(distinctDrawing()), art = await hosted(t, {providers: {openai: images}, dispatch: dispatch.seam});
  await art.owner(generate(['pixoo']), 'old');
  const old = await art.finished('old');
  await art.owner(generate(['pixoo']), 'new');
  await art.finished('new');
  await until(() => dispatch.stages.length === 2);
  const spent = art.spend('openai').spentMicros;
  assert.equal((await art.catalog({action: 'favorite', artworkId: old.artworkId, favorite: true}, 'keep')).status, 'accepted');
  assert.equal((await art.catalog({action: 'reuse', artworkId: old.artworkId, target: 'pixoo'}, 'again')).status, 'accepted');
  await until(() => dispatch.stages.length === 3);
  assert.equal(images.requests.length, 2, 'no generation');
  assert.equal(art.spend('openai').spentMicros, spent);
  for (const stage of dispatch.stages.slice(1)) dispatch.report(stage.requestId, 'succeeded');
  await until(() => art.state.candidates.length >= 1);
  assert.equal(art.state.candidates[0]?.artworkId, old.artworkId);
  assert.equal(art.state.candidates[0]?.favorite, true);
  assert.equal((await art.catalog({action: 'reuse', artworkId: old.artworkId, target: 'tidbyt'}, 'none')).status, 'rejected', 'it has no Tidbyt composition');
});

void test('explicit feedback shapes selection, and silence does not', async t => {
  const dispatch = fakeDispatch(), art = await hosted(t, {providers: {openai: fakeImages(distinctDrawing())}, dispatch: dispatch.seam});
  for (const id of ['liked', 'less', 'dismissed', 'silent']) {await art.owner(generate(['pixoo']), id); await art.finished(id);}
  await until(() => art.state.candidates.length === 4);
  const artworkOf = async (id: string) => (await art.finished(id)).artworkId;
  const [liked, less, dismissed, silent] = await Promise.all(['liked', 'less', 'dismissed', 'silent'].map(artworkOf));
  assert.equal((await art.catalog({action: 'feedback', artworkId: liked, signal: 'more'}, 'more-1')).status, 'accepted');
  assert.equal((await art.catalog({action: 'feedback', artworkId: less, signal: 'less'}, 'less-1')).status, 'accepted');
  assert.equal((await art.catalog({action: 'feedback', artworkId: dismissed, signal: 'dismiss'}, 'dismiss-1')).status, 'accepted');
  assert.equal((await art.catalog({action: 'feedback', artworkId: dismissed, signal: 'angry'}, 'bad-signal')).status, 'rejected');
  assert.deepEqual(art.state.candidates.map(candidate => candidate.artworkId), [liked, silent], 'more comes first, less and dismiss leave, and silence stays');
  assert.equal(art.state.artworks.find(entry => entry.artworkId === silent)?.feedback, null, 'silence writes nothing');
  assert.equal(art.db().prepare('SELECT COUNT(*) AS rows FROM art_feedback').get()?.rows, 3);
});

void test('recent retention prunes only unsaved, unreferenced art, past the limit, and favorites survive a restart', async t => {
  const images = fakeImages(distinctDrawing());
  const dispatch = fakeDispatch('wait'), art = await hosted(t, {providers: {openai: images}, dispatch: dispatch.seam, section: {recentLimit: 1}});
  const make = async (id: string) => {await art.owner(generate(['pixoo']), id); const job = await art.finished(id); art.clock.value += 1000; return job;};
  const saved = await make('saved');
  await art.catalog({action: 'favorite', artworkId: saved.artworkId, favorite: true}, 'keep');
  // Referenced by a device's staged copy until it expires.
  const staged = await make('staged');
  await until(() => dispatch.stages.length === 2);
  dispatch.report(dispatch.stages[1]?.requestId ?? '', 'succeeded');
  await until(() => art.state.candidates.length === 1);
  const old = await make('old');
  dispatch.report(dispatch.stages[2]?.requestId ?? '', 'failed');
  await make('newer');
  dispatch.report(dispatch.stages[3]?.requestId ?? '', 'failed');
  await make('newest');
  const ids = () => art.state.artworks.map(artwork => artwork.artworkId);
  assert.ok(ids().includes(saved.artworkId), 'the favorite stays');
  assert.ok(ids().includes(staged.artworkId), 'the staged copy\'s art stays');
  assert.equal(ids().includes(old.artworkId), false, 'the unreferenced old art goes');
  const original = art.db().prepare('SELECT COUNT(*) AS blobs FROM art_blobs').get()?.blobs;
  assert.ok(typeof original === 'number' && original >= 6);
  // Once the staged copy has expired, its art is pruned like any other.
  art.clock.value += STAGE_LIFETIME_MS + 1;
  await make('expired-now');
  assert.equal(ids().includes(staged.artworkId), false);
  assert.equal(art.state.candidates.length, 0);
  await art.restart();
  await until(() => art.state.artworks.some(artwork => artwork.artworkId === saved.artworkId));
  const favorite = art.state.artworks.find(artwork => artwork.artworkId === saved.artworkId);
  assert.equal(favorite?.favorite, true);
  const ref = favorite?.compositions[0]?.renditions[0]?.ref ?? assert.fail('no rendition'), bytes = await art.read(ref);
  assert.ok(bytes !== undefined && !('error' in bytes), 'its bytes survive');
});

void test('deletion leaves selection at once, reports the device\'s retained copy, and removes the bytes when nothing refers to them', async t => {
  const dispatch = fakeDispatch(), art = await hosted(t, {providers: {openai: fakeImages(drawing())}, dispatch: dispatch.seam});
  await art.owner(generate(['pixoo']), 'held');
  const held = await art.finished('held');
  await until(() => art.state.candidates.length === 1);
  const ref = art.state.artworks[0]?.compositions[0]?.renditions[0]?.ref ?? assert.fail('no rendition');
  assert.equal((await art.catalog({action: 'delete', artworkId: held.artworkId}, 'drop')).status, 'accepted');
  assert.deepEqual(art.state.candidates, []);
  assert.equal(art.state.artworks.length, 0);
  assert.deepEqual(art.state.retention.retained.map(entry => [entry.artworkId, entry.target]), [[held.artworkId, 'pixoo']], 'the retained copy is reported');
  assert.equal(await art.read(`artwork.${held.artworkId}`), undefined);
  assert.equal((await art.catalog({action: 'favorite', artworkId: held.artworkId, favorite: true}, 'too-late')).status, 'rejected');
  assert.equal((await art.owner(generate(['pixoo'], {purpose: 'variation', variationOf: held.artworkId}), 'no-variant')).status, 'rejected');
  assert.ok(await art.read(ref), 'the bytes stay while the device may hold its copy');
  art.clock.value += STAGE_LIFETIME_MS + 1;
  await art.owner(generate(['tidbyt']), 'tick');
  await art.finished('tick');
  assert.equal(await art.read(ref), undefined, 'and go after it expires');
  assert.deepEqual(art.state.retention.retained, []);
  // The ledger is not the catalog: deletion leaves its calls in place.
  assert.equal((await art.calls()).length, 2);
});

void test('an unreferenced artwork is deleted outright, even a favorite', async t => {
  const art = await hosted(t, {providers: {openai: fakeImages(drawing())}});
  await art.owner(generate(['pixoo']), 'req');
  const job = await art.finished('req');
  await art.catalog({action: 'favorite', artworkId: job.artworkId, favorite: true}, 'keep');
  const ref = art.state.artworks[0]?.compositions[0]?.renditions[0]?.ref ?? assert.fail('no rendition');
  assert.equal((await art.catalog({action: 'delete', artworkId: job.artworkId}, 'drop')).status, 'accepted');
  assert.equal(await art.read(ref), undefined);
  assert.equal(art.db().prepare('SELECT COUNT(*) AS blobs FROM art_blobs').get()?.blobs, 0);
});

void test('content references page the catalog and the ledger, and refuse what they do not know', async t => {
  const art = await hosted(t, {providers: {openai: fakeImages(drawing())}});
  for (const id of ['a', 'b', 'c']) {await art.owner(generate(['tidbyt'], {text: `private text ${id}`}), id); await art.finished(id);}
  const first = await art.readJson<{artworks: {artworkId: string}[]; nextAfter: number | null}>('catalog', {limit: '2'});
  assert.equal(first.artworks.length, 2);
  assert.ok(first.nextAfter !== null);
  const second = await art.readJson<{artworks: {artworkId: string}[]; nextAfter: number | null}>('catalog', {limit: '2', after: String(first.nextAfter)});
  assert.equal(second.artworks.length, 1);
  assert.equal(second.nextAfter, null);
  const ledger = await art.readJson<{calls: unknown[]; nextAfter: number | null}>('ledger', {limit: '2'});
  assert.equal(ledger.calls.length, 2);
  const rest = await art.readJson<{calls: unknown[]}>('ledger', {after: String(ledger.nextAfter)});
  assert.equal(rest.calls.length, 1);
  for (const query of [{limit: '0'}, {limit: '101'}, {after: '-1'}, {other: '1'}]) {
    const answer = await art.read('catalog', query);
    assert.ok(answer !== undefined && 'error' in answer, JSON.stringify(query));
  }
  assert.equal(await art.read('rendition.unknown'), undefined);
  assert.equal(await art.read('artwork.unknown'), undefined);
  assert.equal(await art.read('anything'), undefined);
  assert.equal(JSON.stringify(art.state).includes('private text'), false, 'no prompt text in state');
  assert.equal(JSON.stringify(art.host.logs).includes('private text'), false, 'no prompt text in logs');
});

void test('the provider call has its registered span; logs and spans stay within the diagnostic contract', async t => {
  const {checkModuleRecord} = await import('@jimmie-potts/sdk/testing');
  const {ProviderFault: Fault} = await import('../src/provider.js');
  let first = true;
  const images = fakeImages(request => {if (first) {first = false; return Promise.reject(new Fault('capacity', 'provider-refused'));} return drawing()(request);});
  const art = await hosted(t, {providers: {openai: images}});
  await art.owner(generate(['tidbyt', 'pixoo']), 'req');
  await art.finished('req');
  const spans = art.spans.spans.filter(span => span.name === 'bunny.art.call');
  assert.equal(spans.length, 2);
  assert.deepEqual(spans.map(span => span.status), ['error', 'unset']);
  assert.ok(spans.every(span => span.kind === 'client' && span.attributes['bunny.operation'] === 'media' && span.attributes['bunny.request.id'] === 'req'));
  assert.deepEqual(art.host.logs.flatMap(record => {const problem = checkModuleRecord('art', record); return problem === undefined ? [] : [problem];}), []);
  assert.ok(art.host.logs.some(record => record.event === 'operation.failed' && record.fields['bunny.code'] === 'capacity'));
});
