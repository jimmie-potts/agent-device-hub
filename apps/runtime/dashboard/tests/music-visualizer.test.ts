// Music visualizer (#1619): deterministic effects over the existing derived capture features, driven by a fake feature
// stream through the real CaptureProjection. Nothing here sends a command, starts capture or touches a light.
import assert from 'node:assert/strict';
import test from 'node:test';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import type {CaptureFeatures, CaptureState} from '@jimmie-potts/event-contracts/v2/music-capture-data';
import type {Scheduler, SyncHandler, SyncOptions, SyncResult} from '@jimmie-potts/sdk/remote';
import {CaptureProjection, MusicCaptureFeed, type MusicCaptureView} from '../src/music-capture-feed.ts';
import {FeatureInterpolator, VisualizerEngine, restingReason, visualizerSignal, type Shape, type VisualizerEffect, type VisualizerSignal} from '../src/music-visualizer-model.ts';
import {bassPulse, effectById, spectrumBars, visualizerEffects} from '../src/music-visualizer-effects.ts';
import {EFFECT_CHOICE_KEY, EffectChoiceStore} from '../src/music-visualizer-preference.ts';
import {acquireMusicCapture, releaseMusicCapture} from '../src/music-capture-scope.ts';
import {homeCatalog, addHomeCard, defaultHomeArrangements, savedHomeCard} from '../src/home-catalog.ts';
import {widgetDefinition} from '../src/widgets.ts';
import {navigationDestination, parseRoute, routeHash} from '../src/routes.ts';
import type {RuntimeData} from '../src/runtime-feeds.ts';

const size = {width: 400, height: 200};
const now = (mono: number) => ({wallMs: 100_000 + mono, monotonicMs: mono});
const state = (status: Exclude<CaptureState['session']['status'], 'idle'> = 'active', generation = 'one'): CaptureState => ({
  id: 'music', revision: 1, endpointId: 'selected', availability: 'available', session: {status, generation, operationId: 'operation-one', input: 'music'},
});
/** One fake 100 ms feature window; `index` advances the source clock and sequence together. */
const frame = (index: number, levels: {rms?: number; bass?: number; mid?: number; treble?: number} = {}, generation = 'one'): Message<CaptureFeatures> => ({
  specversion: '1.0', bunnyprofile: '2.0', id: `frame-${String(index)}`, source: 'bunny/parts/music-producer', kind: 'occurrence',
  type: 'org.bunny.music-capture.features.observed', subject: 'selected', time: new Date(101010).toISOString(),
  dataschema: 'https://bunny.invalid/events/music-capture-features/2.0', datacontenttype: 'application/json', traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
  data: {generation, input: 'music', sequence: index, sampleRateHz: 48000, channels: 2, frameCount: 4800,
    startMonotonicMs: 100 * index, endMonotonicMs: 100 * index + 100, emittedMonotonicMs: 100 * index + 105,
    observedAtMs: 101000 + 100 * (index - 1), validUntilMs: 101400 + 100 * (index - 1),
    rms: levels.rms ?? 0, peak: levels.rms ?? 0, clippedFraction: 0,
    bands: {bass: levels.bass ?? 0, mid: levels.mid ?? 0, treble: levels.treble ?? 0}, onset: {strength: 0, confidence: 0}, discontinuity: false},
});
const ready = (): CaptureProjection => {const projection = new CaptureProjection(); projection.synchronize(state(), 101005, now(1000), now(1010)); return projection;};

/** A fake stream: one feature window every 100 ms of browser time, sampled at a 60 Hz display rate. */
function play(effect: VisualizerEffect, windows: readonly {rms?: number; bass?: number; mid?: number; treble?: number}[]) {
  const projection = ready(), engine = new VisualizerEngine(effect), scenes: Shape[][] = [], states: string[] = [];
  let index = 0;
  // Browser wall readings are whole milliseconds, so the display clock is sampled at whole-millisecond 60 Hz times.
  for (let tick = 0, ms = 1010; ms < 1010 + windows.length * 100; tick += 1, ms = 1010 + Math.round(tick * 1000 / 60)) {
    const due = Math.floor((ms - 1010) / 100);
    while (index <= due && index < windows.length) {projection.feature(frame(index + 1, windows[index]), now(ms)); index += 1;}
    projection.tick(now(ms));
    const result = engine.frame(visualizerSignal(projection.view, true), ms, size);
    scenes.push(result.scene); states.push(result.state);
  }
  return {scenes, states, projection, engine};
}
const repeat = <T>(value: T, count: number): T[] => Array.from({length: count}, () => value);
const bars = (scene: readonly Shape[]) => scene.filter((shape): shape is Extract<Shape, {kind: 'rect'}> => shape.kind === 'rect' && shape.role === 'bar');
const circle = (scene: readonly Shape[], role: string) => scene.find(shape => shape.role === role);

void test('the effect list holds both first effects, each with a unique id, a name and a resting scene', () => {
  assert.deepEqual(visualizerEffects.map(effect => effect.id), ['spectrum-bars', 'bass-pulse']);
  assert.deepEqual(visualizerEffects.map(effect => effect.name), ['Spectrum bars', 'Bass pulse']);
  for (const effect of visualizerEffects) {
    assert.ok(effect.resting(size).length > 0, effect.id);
    assert.deepEqual(effect.resting(size), effect.resting(size), `${effect.id} rests deterministically`);
  }
  assert.equal(effectById('bass-pulse'), bassPulse);
  assert.equal(effectById('not-an-effect'), spectrumBars, 'an unknown id falls back to the first effect');
});

void test('a third effect needs no change to the engine or the first two effects', () => {
  const seen: number[] = [];
  const third: VisualizerEffect = {id: 'test-level', name: 'Test level', resting: () => [{kind: 'rect', role: 'test', x: 0, y: 0, width: 1, height: 1, fill: '#000', alpha: 1}],
    create: () => {let level = 0; return {step(levels) {level = levels.level; seen.push(level);}, scene: () => [{kind: 'rect', role: 'test', x: 0, y: 0, width: level, height: 1, fill: '#fff', alpha: 1}]};}};
  const {states} = play(third, repeat({rms: 0.5}, 5));
  assert.ok(states.includes('live')); assert.ok(seen.includes(0.5));
  assert.deepEqual(play(spectrumBars, repeat({rms: 0.5, bass: 0.5}, 5)).scenes, play(spectrumBars, repeat({rms: 0.5, bass: 0.5}, 5)).scenes);
});

for (const effect of visualizerEffects) {
  void test(`${effect.name} renders the same scenes for the same fake stream`, () => {
    const stream = [{}, {rms: 0.3, bass: 0.6}, {rms: 0.1, mid: 0.4}, {rms: 0.2, treble: 0.7}, {}, {rms: 0.5, bass: 1}];
    assert.deepEqual(play(effect, stream).scenes, play(effect, stream).scenes);
  });
  void test(`${effect.name} renders silence as live, still and distinct from resting`, () => {
    const {scenes, states} = play(effect, repeat({}, 6));
    assert.ok(states.every(value => value === 'live'));
    const last = scenes.at(-1); assert.ok(last !== undefined);
    assert.deepEqual(scenes.at(-2), last, 'silence does not invent motion');
    assert.notDeepEqual(last, effect.resting(size), 'live silence is not the resting state');
  });
  void test(`${effect.name} holds steady for a steady level`, () => {
    const {scenes} = play(effect, repeat({rms: 0.4, bass: 0.4, mid: 0.4, treble: 0.4}, 8));
    assert.deepEqual(scenes.at(-1), scenes.at(-12), 'a steady level settles to a steady scene');
  });
  void test(`${effect.name} goes to the resting state when the stream stops, goes stale or changes generation`, () => {
    const stopped = play(effect, repeat({rms: 0.4, bass: 0.4}, 3));
    const engine = stopped.engine, projection = stopped.projection;
    projection.tick(now(1600));
    let result = engine.frame(visualizerSignal(projection.view, true), 1600, size);
    assert.equal(result.state, 'resting'); assert.equal(result.reason, 'Waiting for fresh measurements.');
    assert.deepEqual(result.scene, effect.resting(size), 'no frozen motion after the stream stops');
    const stale = play(effect, repeat({rms: 0.4, bass: 0.4}, 3));
    stale.projection.state(state('stale'));
    result = stale.engine.frame(visualizerSignal(stale.projection.view, true), 1400, size);
    assert.equal(result.state, 'resting'); assert.equal(result.reason, 'Measurements are stale.');
    assert.deepEqual(result.scene, effect.resting(size));
    const replaced = play(effect, repeat({rms: 0.4, bass: 0.4}, 3));
    replaced.projection.state(state('active', 'two'));
    result = replaced.engine.frame(visualizerSignal(replaced.projection.view, true), 1400, size);
    assert.equal(result.state, 'resting', 'a new generation shows nothing until its own frame arrives');
    replaced.projection.feature(frame(4, {rms: 0.8, bass: 0.8}, 'two'), now(1400));
    result = replaced.engine.frame(visualizerSignal(replaced.projection.view, true), 1400, size);
    const fresh = new VisualizerEngine(effect).frame(visualizerSignal(replaced.projection.view, true), 1400, size);
    assert.deepEqual(result.scene, fresh.scene, 'the new generation starts fresh, with nothing carried from the old one');
  });
}

void test('Spectrum bars follow the bass, mid and treble bands', () => {
  const low = bars(play(spectrumBars, repeat({rms: 0.5, bass: 0.9}, 4)).scenes.at(-1) ?? []);
  const high = bars(play(spectrumBars, repeat({rms: 0.5, treble: 0.9}, 4)).scenes.at(-1) ?? []);
  assert.ok(low.length >= 3 && low.length === high.length);
  const first = (list: typeof low) => list[0]?.height ?? 0, final = (list: typeof low) => list.at(-1)?.height ?? 0;
  assert.ok(first(low) > final(low), 'bass raises the left bars');
  assert.ok(final(high) > first(high), 'treble raises the right bars');
  const changed = play(spectrumBars, [...repeat({rms: 0.5, bass: 0.9}, 3), ...repeat({rms: 0.5, treble: 0.9}, 3)]).scenes.at(-1) ?? [];
  assert.ok(final(bars(changed)) > first(bars(changed)), 'a band change moves the bars');
  const caps = changed.filter(shape => shape.role === 'cap');
  assert.equal(caps.length, low.length, 'each bar keeps a falling peak cap');
});

void test('Bass pulse flares on a single beat and then decays', () => {
  const {scenes} = play(bassPulse, [{}, {}, {rms: 0.6, bass: 1}, {}, {}, {}, {}, {}]);
  const radius = scenes.map(scene => {const shape = circle(scene, 'pulse'); return shape?.kind === 'circle' ? shape.radius : 0;});
  const peak = Math.max(...radius), peakAt = radius.indexOf(peak);
  assert.ok(peak > (radius[0] ?? 0) * 1.3, 'the beat flares the pulse');
  const after = radius.slice(peakAt);
  assert.ok(after.every((value, index) => index === 0 || value <= (after[index - 1] ?? 0) + 1e-9), 'then it only decays');
  assert.ok((radius.at(-1) ?? 0) < peak * 0.8, 'and it decays well before the stream ends');
  const flash = scenes.map(scene => circle(scene, 'flash')?.alpha ?? 0);
  assert.ok(Math.max(...flash) > 0.3, 'a sharp bass rise adds a flash ring');
  assert.equal(flash.at(-1) ?? 0, 0, 'the flash has faded by the end');
});

void test('interpolation eases toward the newest window and never replays skipped ones', () => {
  const interpolator = new FeatureInterpolator();
  const live = (sequence: number, value: number, key = 'k'): VisualizerSignal => ({kind: 'live', key, sequence, levels: {level: value, bass: value, mid: value, treble: value}});
  assert.equal(interpolator.sample(live(1, 0), 0)?.level, 0);
  assert.equal(interpolator.sample(live(2, 1), 100)?.level, 0, 'a new window starts from the shown value');
  assert.equal(interpolator.sample(live(2, 1), 150)?.level, 0.5, 'halfway through the window interval');
  assert.equal(interpolator.sample(live(4, 0.2), 150)?.level, 0.5, 'window 3 was skipped; easing restarts from what is shown');
  assert.equal(interpolator.sample(live(4, 0.2), 250)?.level, 0.2, 'and lands on the newest window');
  assert.equal(interpolator.sample(live(4, 0.2), 900)?.level, 0.2, 'it holds the newest value without inventing motion');
  assert.equal(interpolator.sample({kind: 'resting', reason: 'x'}, 950), undefined);
  assert.equal(interpolator.sample(live(5, 0.9), 960)?.level, 0.9, 'after resting the next window starts fresh');
  assert.equal(interpolator.sample(live(1, 0.3, 'other'), 970)?.level, 0.3, 'a new source identity starts fresh');
});

void test('the signal uses applied response values when the projection has them, otherwise the measured features', () => {
  const projection = ready(); projection.feature(frame(1, {rms: 0.25, bass: 3, mid: 0.5, treble: 0}), now(1020));
  const signal = visualizerSignal(projection.view, true);
  assert.equal(signal.kind, 'live');
  assert.deepEqual(signal.kind === 'live' ? signal.levels : undefined, {level: 0.25, bass: 1, mid: 0.5, treble: 0}, 'features are clamped to 0..1');
  const view: MusicCaptureView = {...projection.view, response: {level: 0.1, bass: 0.2, mid: 0.3, treble: 0.4, gateOpen: true, alpha: 1}};
  const response = visualizerSignal(view, true);
  assert.deepEqual(response.kind === 'live' ? response.levels : undefined, {level: 0.1, bass: 0.2, mid: 0.3, treble: 0.4});
  assert.deepEqual(visualizerSignal(projection.view, false), {kind: 'resting', reason: 'Measurement status is unavailable.'});
});

void test('each resting reason says why measurement is not shown', () => {
  const base: MusicCaptureView = {synced: true, state: state(), features: undefined, clockQualified: true, rechecking: false};
  const idle: CaptureState = {id: 'music', revision: 1, endpointId: 'selected', availability: 'available', session: {status: 'idle'}};
  const cases: [MusicCaptureView, boolean, string][] = [
    [base, false, 'Measurement status is unavailable.'],
    [{...base, synced: false}, true, 'Measurement status is unavailable.'],
    [{...base, state: undefined}, true, 'Measurement status is unavailable.'],
    [{...base, state: {...idle, availability: 'off', endpointId: null}}, true, 'Music producer is off.'],
    [{...base, state: {...idle, availability: 'unavailable'}}, true, 'Music input is unavailable.'],
    [{...base, state: idle}, true, 'Measurement is not running.'],
    [{...base, state: state('starting')}, true, 'Measurement is starting.'],
    [{...base, state: state('stale')}, true, 'Measurements are stale.'],
    [{...base, state: state('stopping')}, true, 'Measurement is stopping.'],
    [{...base, state: state('uncertain')}, true, 'Measurement state is uncertain.'],
    [{...base, state: state('unavailable')}, true, 'Measurement is unavailable.'],
    [base, true, 'Waiting for fresh measurements.'],
    [{...base, clockQualified: false}, true, 'Measurement timing is unavailable.'],
    [{...base, clockQualified: false, rechecking: true}, true, 'Checking measurement timing again.'],
  ];
  for (const [view, live, reason] of cases) assert.equal(restingReason(view, live), reason, reason);
});

void test('the effect choice is a per-viewer browser preference that survives a reload and works without storage', () => {
  const saved = new Map<string, string>();
  const storage = {getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => {saved.set(key, value);}};
  const first = new EffectChoiceStore(() => storage);
  assert.equal(first.getSnapshot(), 'spectrum-bars');
  let notified = 0; const unsubscribe = first.subscribe(() => {notified += 1;});
  first.choose('bass-pulse'); assert.equal(first.getSnapshot(), 'bass-pulse'); assert.equal(notified, 1);
  assert.equal(saved.get(EFFECT_CHOICE_KEY), 'bass-pulse');
  unsubscribe(); first.choose('spectrum-bars'); assert.equal(notified, 1);
  first.choose('bass-pulse');
  assert.equal(new EffectChoiceStore(() => storage).getSnapshot(), 'bass-pulse', 'a reloaded page reads the saved choice');
  first.choose('no-such-effect'); assert.equal(first.getSnapshot(), 'bass-pulse', 'an unknown choice is ignored');
  saved.set(EFFECT_CHOICE_KEY, 'retired-effect');
  assert.equal(new EffectChoiceStore(() => storage).getSnapshot(), 'spectrum-bars', 'a retired saved choice falls back');
  const broken = {getItem: (): string | null => {throw new Error('blocked');}, setItem: (): void => {throw new Error('blocked');}};
  const without = new EffectChoiceStore(() => broken);
  assert.equal(without.getSnapshot(), 'spectrum-bars');
  without.choose('bass-pulse'); assert.equal(without.getSnapshot(), 'bass-pulse', 'the choice still works for this page');
  const missing = new EffectChoiceStore(() => {throw new Error('no storage');});
  missing.choose('bass-pulse'); assert.equal(missing.getSnapshot(), 'bass-pulse');
  without.storageChanged(EFFECT_CHOICE_KEY, 'spectrum-bars'); assert.equal(without.getSnapshot(), 'spectrum-bars', 'another tab\'s choice is followed');
  without.storageChanged('other-key', 'bass-pulse'); assert.equal(without.getSnapshot(), 'spectrum-bars');
});

void test('the visualizer is a placeable Audio card that reads only the capture records and sends no command', () => {
  const runtime: RuntimeData = {modules: [], copies: [], control: true, catalogFailed: false};
  const widget = widgetDefinition('music-visualizer');
  assert.ok(widget !== undefined); assert.equal(widget.commands, false);
  assert.deepEqual(widget.source, {kind: 'core', families: ['music-capture-state']});
  const catalog = homeCatalog(runtime, true), card = catalog.find(value => value.id === 'music-visualizer');
  assert.ok(card !== undefined); assert.equal(card.name, 'Music visualizer'); assert.equal(card.category, 'Audio');
  assert.equal(card.reason, undefined, 'it can be added while measurement is not running; the card shows why it rests');
  assert.equal(card.defaultSelected, false);
  const defaults = defaultHomeArrangements(catalog);
  assert(!defaults.desktop.some(value => value.widget === 'music-visualizer'));
  const next = addHomeCard(defaults, 'desktop', card);
  assert.equal(next.desktop.at(-1)?.widget, 'music-visualizer'); assert.equal(next.phone.at(-1)?.widget, 'music-visualizer');
  assert.deepEqual(savedHomeCard('music-visualizer', catalog), card);
});

void test('surfaces on one page share one capture scope, so the page makes one clock-qualified sync', async () => {
  const opened: {refreshed: number; closed: number}[] = [];
  const connection = {openMusicCapture: () => {
    const record = {refreshed: 0, closed: 0}; opened.push(record);
    return {closed: false, busy: false, getSnapshot: () => ({synced: true, rechecking: false}),
      refresh: () => {record.refreshed += 1; return Promise.resolve(true);}, close: () => {record.closed += 1; return Promise.resolve();}};
  }};
  const first = acquireMusicCapture(connection), second = acquireMusicCapture(connection);
  assert.ok(first !== undefined); assert.equal(first, second);
  assert.deepEqual(opened, [{refreshed: 1, closed: 0}], 'one scope and one sync for both surfaces');
  releaseMusicCapture(connection, first); assert.deepEqual(opened, [{refreshed: 1, closed: 0}], 'still in use');
  releaseMusicCapture(connection, first); await new Promise(resolve => {setTimeout(resolve, 0);});
  assert.deepEqual(opened, [{refreshed: 1, closed: 1}], 'the last user closes it once the page has settled');
  const reopened = acquireMusicCapture(connection); assert.notEqual(reopened, first); assert.equal(opened.length, 2, 'a later user opens a fresh scope');
  const refused = {openMusicCapture: () => {throw new Error('unavailable');}};
  assert.equal(acquireMusicCapture(refused), undefined);
});

/** A controllable fake scope: its sync stays pending until `finish`, and the connection may close it itself. */
function fakeScopes() {
  const scopes: {closed: boolean; busy: boolean; synced: boolean; rechecking: boolean; refreshed: number; closes: number; finish: () => void}[] = [];
  const connection = {openMusicCapture: () => {
    let finish = (): void => {};
    const scope = {closed: false, busy: false, synced: false, rechecking: false, refreshed: 0, closes: 0, finish: () => {finish();},
      getSnapshot: () => ({synced: scope.synced, rechecking: scope.rechecking}),
      refresh: () => {scope.refreshed += 1; return new Promise<boolean>(resolve => {finish = () => {scope.synced = true; resolve(true);};});},
      close: () => {scope.closes += 1; scope.closed = true; return Promise.resolve();}};
    scopes.push(scope); return scope;
  }};
  return {connection, scopes};
}

void test('a scope the connection already closed is never handed out', async () => {
  const {connection, scopes} = fakeScopes();
  const held = acquireMusicCapture(connection); assert.ok(held !== undefined);
  held.closed = true; // The connection closes its music scopes itself when the feed or the core drops.
  const next = acquireMusicCapture(connection);
  assert.ok(next !== undefined); assert.notEqual(next, held, 'a later surface gets a fresh scope');
  assert.equal(scopes.length, 2); assert.equal(next.refreshed, 1);
  releaseMusicCapture(connection, held); assert.equal(next.closes, 0, 'releasing the dead scope leaves the fresh one open');
  releaseMusicCapture(connection, next); await new Promise(resolve => {setTimeout(resolve, 0);}); assert.equal(next.closes, 1);
});

void test('in-page navigation hands the synced scope to the next surface without a new sync', async () => {
  const {connection, scopes} = fakeScopes();
  const panel = acquireMusicCapture(connection); assert.ok(panel !== undefined);
  panel.finish(); await Promise.resolve(); await Promise.resolve();
  releaseMusicCapture(connection, panel); // Audio unmounts its panel and card as the full view mounts in the same commit.
  const full = acquireMusicCapture(connection);
  assert.equal(full, panel); assert.equal(panel.refreshed, 1); assert.equal(panel.closes, 0);
  await new Promise(resolve => {setTimeout(resolve, 0);});
  assert.equal(panel.closes, 0, 'the scope is still in use'); assert.equal(scopes.length, 1);
});

void test('a later surface resyncs an unsynced shared view, but never beside a sync in flight', async () => {
  const {connection, scopes} = fakeScopes();
  const first = acquireMusicCapture(connection); assert.ok(first !== undefined); assert.equal(first.refreshed, 1);
  acquireMusicCapture(connection); assert.equal(first.refreshed, 1, 'no second sync while the first is in flight');
  first.finish(); await Promise.resolve(); await Promise.resolve();
  acquireMusicCapture(connection); assert.equal(first.refreshed, 1, 'a synced view needs no refresh');
  first.synced = false; // Invalidated, for example by a dropped stream.
  acquireMusicCapture(connection); assert.equal(first.refreshed, 2, 'a later surface refreshes an unsynced view');
  assert.equal(scopes.length, 1);
});

void test('a later surface never refreshes beside the feed\'s own clock recheck', async () => {
  const {connection} = fakeScopes();
  const first = acquireMusicCapture(connection); assert.ok(first !== undefined);
  first.finish(); await Promise.resolve(); await Promise.resolve();
  first.synced = false; first.rechecking = true; first.busy = true; // A recheck is pending or reading (#1629).
  acquireMusicCapture(connection); assert.equal(first.refreshed, 1, 'the recheck owns the next sync');
});

/** A real MusicCaptureFeed over a fake participant whose syncs take the given round trips, on a hand-run scheduler. */
function sharedFeed(rounds: readonly (number | 'refused')[]) {
  let mono = 1000, syncs = 0;
  const pending = new Set<{at: number; delay: number; callback: () => void}>();
  const scheduler: Scheduler = {after: (delay, callback) => {const entry = {at: mono + delay, delay, callback}; pending.add(entry); return () => {pending.delete(entry);};}};
  const stateMessage = (): Message<CaptureState> => ({...frame(1), kind: 'state', type: 'org.bunny.music-capture.updated', source: 'bunny/core',
    subject: 'music', dataschema: 'https://bunny.invalid/events/music-capture-state/2.0', data: state()});
  const participant = {
    subscribe: () => Promise.resolve({close: () => Promise.resolve()}),
    sync: async (_families: readonly string[], handler: SyncHandler<CaptureState>, _options: SyncOptions): Promise<SyncResult<CaptureState>> => {
      const round = rounds[syncs] ?? 10; syncs += 1; const id = `sync-${String(syncs)}`, source = stateMessage();
      const reply: Extract<SyncResult<CaptureState>, {status: 'synced'}> = {status: 'synced', copy: {states: () => [source], get: () => source, close: () => Promise.resolve()},
        message: {...source, id, kind: 'sync-completed', time: new Date(101005).toISOString(), data: {requestId: id, revision: 1, members: []}}};
      if (round === 'refused') {mono += 10; return {status: 'rejected', requestId: id, error: {error: {code: 'unavailable', retryable: true, requestId: id}}};}
      mono += round;
      await handler({type: 'updated', entity: {family: 'music-capture-state', id: 'music'}, message: source});
      await handler({type: 'synced', message: reply.message}); return reply;
    },
  };
  let opened = 0;
  const connection = {openMusicCapture: () => {opened += 1;
    return new MusicCaptureFeed({participant: participant as unknown as ConstructorParameters<typeof MusicCaptureFeed>[0]['participant'], now: () => now(mono), scheduler});}};
  const flush = async (): Promise<void> => {await new Promise(resolve => {setImmediate(resolve);});};
  return {connection, flush, syncs: () => syncs, opened: () => opened, delays: () => [...pending].map(entry => entry.delay),
    async fire(): Promise<void> {const next = [...pending].sort((a, b) => a.at - b.at)[0]; assert.ok(next !== undefined); pending.delete(next); mono = next.at; next.callback(); await flush();}};
}

void test('the shared scope runs one clock recheck for all surfaces, and a visualizer-only page recovers without a reload', async () => {
  const shared = sharedFeed([200, 10]);
  const fullView = acquireMusicCapture(shared.connection), homeCard = acquireMusicCapture(shared.connection);
  assert.ok(fullView !== undefined); assert.equal(fullView, homeCard);
  await shared.flush();
  assert.equal(shared.syncs(), 1, 'one sync for both surfaces');
  assert.equal(fullView.getSnapshot().clockQualified, false); assert.deepEqual(shared.delays(), [250], 'one recheck for the shared scope, not one per surface');
  assert.equal(restingReason(fullView.getSnapshot(), true), 'Checking measurement timing again.');
  assert.equal(acquireMusicCapture(shared.connection), fullView); await shared.flush();
  assert.equal(shared.syncs(), 1, 'a surface mounting meanwhile starts no sync beside the recheck'); assert.deepEqual(shared.delays(), [250]);
  await shared.fire();
  assert.equal(shared.syncs(), 2); assert.equal(fullView.getSnapshot().clockQualified, true);
  assert.equal(restingReason(fullView.getSnapshot(), true), 'Waiting for fresh measurements.', 'the page recovers on its own, with no reload');
  await fullView.close();
});

void test('a later surface resyncs when a failed recheck left the view unsynced with nothing scheduled', async () => {
  const shared = sharedFeed([200, 'refused', 10]);
  const audio = acquireMusicCapture(shared.connection); assert.ok(audio !== undefined);
  await shared.flush(); assert.deepEqual(shared.delays(), [250], 'a recheck is pending');
  audio.invalidate(); // The shown copy is invalidated, for example by a stream overflow, while the recheck waits.
  await shared.fire(); // The recheck's read is refused.
  assert.equal(audio.getSnapshot().synced, false); assert.equal(shared.syncs(), 2);
  assert.deepEqual(shared.delays(), [], 'no recheck is scheduled any more');
  const fullView = acquireMusicCapture(shared.connection); assert.equal(fullView, audio); await shared.flush();
  assert.equal(shared.syncs(), 3, 'the later surface resyncs');
  assert.equal(audio.getSnapshot().synced, true); assert.equal(audio.getSnapshot().clockQualified, true);
  assert.equal(restingReason(audio.getSnapshot(), true), 'Waiting for fresh measurements.', 'and the page goes live without Refresh or a reload');
  await audio.close();
});

void test('closing the shared scope leaves no clock recheck behind', async () => {
  const shared = sharedFeed([200]);
  const scope = acquireMusicCapture(shared.connection); assert.ok(scope !== undefined);
  await shared.flush(); assert.deepEqual(shared.delays(), [250]);
  releaseMusicCapture(shared.connection, scope); assert.deepEqual(shared.delays(), [250], 'the scope stays open until the page settles');
  await new Promise(resolve => {setTimeout(resolve, 0);});
  assert.equal(scope.closed, true); assert.deepEqual(shared.delays(), [], 'the pending recheck is cancelled with the scope');
  assert.notEqual(acquireMusicCapture(shared.connection), scope); assert.equal(shared.opened(), 2);
});

void test('the full view has its own address under Audio', () => {
  assert.deepEqual(parseRoute('#/audio/visualizer'), {kind: 'visualizer'});
  assert.equal(routeHash({kind: 'visualizer'}), '#/audio/visualizer');
  assert.equal(navigationDestination({kind: 'visualizer'}), 'devices');
  assert.deepEqual(parseRoute('#/audio'), {kind: 'audio'});
});
