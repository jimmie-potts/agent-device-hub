// Integrated fixture acquisition faults, through shared SDK state and real display workers/queues.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import type {PlaybackState} from '@jimmie-potts/event-contracts/v2/families';
import {
  SIMULATED_SECTION as PLAYBACK, createPlaybackModule, controlPlayback, playbackSimulation,
  type PlaybackModuleOptions, type SpeakersState,
} from '@jimmie-potts/playback';
import {
  SIMULATED_SECTION as TIDBYT, createTidbytModule, tidbytSimulation, decodeLossless, type CloudState,
} from '@jimmie-potts/tidbyt';
import {
  SIMULATED_SECTION as PIXOO, createPixooModule, pixooSimulation, schemaOf, type DisplayRecord, type SimulatedPixooState,
} from '@jimmie-potts/pixoo';
import {registrations} from '../src/index.js';
import {
  CORE_FAMILIES, TRANSPORTS, expect as stepExpect, runScenario, dispatchOnce, recorded, noToken, logged, running,
  type Harness, type Outcome, type Seed,
} from './scenarios/framework.js';
import {startMemoryHarness, type MemoryHarness} from './scenarios/memory.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQsUn5DwAC0AG0vqck9wAAAABJRU5ErkJggg==', 'base64');
const PNG_A = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGM4ISLyHwAEiAHwkp1qPAAAAABJRU5ErkJggg==', 'base64');
type Fetch = NonNullable<NonNullable<PlaybackModuleOptions['artwork']>['fetch']>;
type FetchResult = Awaited<ReturnType<Fetch>>;
const readyBytes = (): FetchResult => ({ok: true, value: new Uint8Array(PNG)});
const seed: Seed = {
  modules: ['core', 'playback', 'tidbyt', 'pixoo'],
  follows: [CORE_FAMILIES, ['playback'], {families: ['device'], owner: 'bunny/modules/tidbyt'},
    {families: ['device', 'pixoo-display'], owner: 'bunny/modules/pixoo'}],
  config: {playback: PLAYBACK, tidbyt: TIDBYT, pixoo: {...PIXOO.config, playback: PLAYBACK.id}},
};
const record = (h: Harness): PlaybackState | undefined => h.reader.states<PlaybackState>('playback')[0]?.data;
const playbackRecords = (h: Harness): PlaybackState[] => h.published().flatMap(({message}) =>
  message.type === 'org.bunny.playback.updated' ? [message.data as PlaybackState] : []);
const shown = (h: Harness): SimulatedPixooState => h.devices().pixoo as SimulatedPixooState;
const speaker = (h: Harness): SpeakersState => h.devices().playback as SpeakersState;
const digest = (rgb: Uint8Array): string => createHash('sha256').update(rgb).digest('hex').slice(0, 16);

// Independent fixed oracle, with no production renderer, glyph, card-view or image helper.
const LETTERS = {A: '010101111101101', B: '110101110101110'};
const PLAY = '100110111110100', PAUSE = '101101101101101';
const WORDS = {
  playing: ['110101110100100', '100100100100111', LETTERS.A, '101101010010010', '111010010010111', '101111111111101', '111100101101111'],
  paused: ['110101110100100', LETTERS.A, '101101101101111', '111100111001111', '111100110100111', '110101101101110'],
};
function oracle(device: 'tidbyt' | 'pixoo', title: 'A' | 'B', artwork: boolean, status: 'playing' | 'paused' = 'playing', image: 'a' | 'b' = 'b'): Uint8Array {
  const rgb = new Uint8Array(64 * (device === 'tidbyt' ? 32 : 64) * 3);
  const mark = device === 'tidbyt' ? status === 'playing' ? [40, 200, 80] : [255, 160, 0]
    : status === 'playing' ? [70, 200, 100] : [230, 170, 60];
  const draw = (bitmap: string, x: number, y: number, color: readonly number[]): void => {
    for (let dy = 0; dy < 5; dy += 1) for (let dx = 0; dx < 3; dx += 1) {
      if (bitmap[dy * 3 + dx] === '1') rgb.set(color, ((y + dy) * 64 + x + dx) * 3);
    }
  };
  draw(status === 'playing' ? PLAY : PAUSE, 0, 1, mark);
  if (device === 'pixoo') {
    WORDS[status].forEach((bitmap, index) => { draw(bitmap, 5 + index * 4, 1, mark); });
    for (let x = 0; x < 64; x += 1) rgb.set([35, 35, 35], (9 * 64 + x) * 3);
  }
  draw(LETTERS[title], artwork ? 27 : device === 'tidbyt' ? 5 : 0, device === 'tidbyt' ? 1 : 13,
    device === 'tidbyt' ? [220, 220, 220] : [200, 200, 200]);
  if (artwork) for (let y = 0; y < 24; y += 1) for (let x = 0; x < 24; x += 1) {
    rgb.set(image === 'a' ? [200, 20, 20] : [20, 60, 100], (((device === 'tidbyt' ? 8 : 13) + y) * 64 + x) * 3);
  }
  return rgb;
}

type Upload = {atMs: number; rgb: Uint8Array};
function fixtures(fetch: Fetch, pollMs?: number, failingRenderer?: 'tidbyt' | 'pixoo') {
  const uploads: Upload[] = [];
  const displays: {atMs: number; digests: string[]}[] = [];
  let detach = (): void => {};
  let pixooFailed = (): void => {};
  const pixooFailure = new Promise<void>(resolve => { pixooFailed = resolve; });
  // Worker completion is real IO, not virtual popup time. Bound the barrier in real time.
  const waitForPixooFailure = async (): Promise<void> => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([pixooFailure, new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => { reject(new Error('ready Pixoo worker did not report a fault within 5 real seconds')); }, 5000);
      })]);
    } finally { if (timeout !== undefined) clearTimeout(timeout); }
  };
  const playback: typeof playbackSimulation = {...playbackSimulation, memory: {...playbackSimulation.memory,
    build: (speakers, {now}) => createPlaybackModule({transport: speakers, monotonic: now, ...(pollMs === undefined ? {} : {pollMs}), artwork: {fetch}}),
  }};
  const tidbyt: typeof tidbytSimulation = {...tidbytSimulation, memory: {...tidbytSimulation.memory,
    build: (cloud, {now}) => createTidbytModule({renderTimeoutMs: 3_600_000,
      ...(failingRenderer === 'tidbyt' ? {renderWorker: new URL('./fixtures/tidbyt-ready-fail-worker.js', import.meta.url)} : {}), transport: (url, init) => {
      if (init.method === 'POST' && init.body !== undefined) {
        const body = JSON.parse(init.body) as {installationID?: string; image?: string};
        if (body.installationID === TIDBYT.nowPlaying.installation && typeof body.image === 'string') {
          const decoded = decodeLossless(new Uint8Array(Buffer.from(body.image, 'base64')));
          assert.ok(decoded !== undefined, 'actual uploaded WebP must decode');
          assert.equal(decoded.width, 64); assert.equal(decoded.height, 32);
          uploads.push({atMs: now(), rgb: decoded.rgb});
        }
      }
      return cloud.fetch(url, init);
    }}),
  }};
  const pixoo: typeof pixooSimulation = {...pixooSimulation, memory: {...pixooSimulation.memory,
    build: (device, {now}) => {
      detach = device.onChange(state => {
        if (state.shown !== null) displays.push({atMs: now(), digests: [...state.shown.digests]});
      });
      const module = createPixooModule({transport: device,
        ...(failingRenderer === 'pixoo' ? {renderWorker: new URL('./fixtures/pixoo-ready-fail-worker.js', import.meta.url)} : {})});
      if (failingRenderer !== 'pixoo') return module;
      return {...module, start: (context: Parameters<typeof module.start>[0]) => module.start({...context, log: {...context.log,
        warn: (event, fields, parent) => {
          context.log.warn(event, fields, parent);
          if (event === 'operation.failed' && fields?.['bunny.operation'] === 'feed' && fields?.['bunny.code'] === 'uncertain-result') pixooFailed();
        },
      }})};
    },
  }};
  return {uploads, displays, waitForPixooFailure, detach: () => { detach(); }, registrations: registrations.map(entry =>
    entry.name === 'playback' ? {...entry, simulation: playback} : entry.name === 'tidbyt' ? {...entry, simulation: tidbyt}
      : entry.name === 'pixoo' ? {...entry, simulation: pixoo} : entry)};
}
async function within(h: Harness, name: string, check: (h: Harness) => Outcome | Promise<Outcome>, ms = 5000): Promise<void> {
  const result = await runScenario({id: 'artwork-fault-step', title: name, seed, steps: [stepExpect(name, check, ms)]}, h);
  assert.equal(result.outcome, 'passed', JSON.stringify(result.steps));
}
async function monitor(h: Harness): Promise<void> {
  await dispatchOnce(h, 'operator', 'fault-monitor', {
    key: `bunny.cmd.device-mode-set.${PIXOO.config.device.id}`,
    draft: {type: 'org.bunny.device-mode.set.requested', subject: PIXOO.config.device.id, dataschema: schemaOf('device-mode-set'), data: {mode: 'monitor'}},
  }, 'req-fault-monitor');
  await within(h, 'Monitor participates before playback starts', () => {
    const display = h.reader.states<DisplayRecord>('pixoo-display', 'bunny/modules/pixoo')[0]?.data;
    return display?.mode === 'monitor' && display.participating && display.showing === 'dashboard' || 'Monitor has not started';
  });
}
function text(h: Harness, title: string, status: 'playing' | 'paused'): Outcome {
  const state = record(h);
  return state?.availability === 'available' && state.playback.status === 'known' && state.playback.player === status &&
    state.playback.title === title || 'current metadata changed or became unavailable';
}
async function privacy(h: MemoryHarness): Promise<void> {
  assert.equal(await noToken(h), true);
  const places = [h.logs(), h.published(), h.reader.heard(), await h.health(), ...h.reader.families().map(family => h.reader.states(family))];
  for (const source of PLAYBACK.sources) assert.ok(!JSON.stringify(places).includes(new URL(source.endpoint).origin));
  assert.ok([PNG, PNG_A].every(bytes => !JSON.stringify(h.logs()).includes(bytes.toString('base64'))), 'image bytes must not enter diagnostics');
  assert.deepEqual(h.problems(), []);
}

for (const transport of TRANSPORTS) {
  void test(`deferred Sony acquisition A cannot publish or display after B association over ${transport}`, {timeout: 60_000}, async () => {
    let releaseA = (_result: FetchResult): void => {};
    let signalA: AbortSignal | undefined;
    let attempts = 0;
    const deferredA = new Promise<FetchResult>(resolve => { releaseA = resolve; });
    // Use the existing poll option so B can arrive while A remains inside its unchanged 2 s fetch deadline.
    const fixture = fixtures((_candidate, _endpoint, signal) => {
      attempts += 1;
      if (attempts === 1) { signalA = signal; return deferredA; }
      return Promise.resolve(readyBytes());
    }, 200);
    const h = await startMemoryHarness(seed, transport, {registrations: fixture.registrations});
    try {
      await monitor(h);
      h.simulate({device: 'playback', speaker: 'sony', action: 'play', title: 'A'});
      await within(h, 'Sony reports A before artwork selection', () => text(h, 'A', 'playing'));
      h.simulate({device: 'playback', speaker: 'sony', action: 'artwork'});
      await within(h, 'fixture acquisition A started and is held', () => attempts === 1 || 'A has not started');
      const generationA = record(h)?.artwork?.generation;
      assert.ok(generationA !== undefined);
      h.simulate({device: 'playback', speaker: 'sony', action: 'play', title: 'B'});
      await within(h, 'metadata reaches B while acquisition A remains held', () => text(h, 'B', 'playing'), 1500);
      const handoffAt = h.now();
      assert.notEqual(record(h)?.artwork?.generation, generationA);
      assert.equal(signalA?.aborted, false, 'handoff must precede the fetch deadline so this checks association invalidation');
      releaseA({ok: true, value: new Uint8Array(PNG_A)});
      await within(h, 'newest acquisition B becomes ready', () => {
        const state = record(h);
        return text(h, 'B', 'playing') === true && state?.artwork?.status === 'ready' && state.artwork.generation !== generationA || 'B is not ready';
      }, 8000);
      await within(h, 'Pixoo really displays B artwork during its existing popup', () =>
        shown(h).shown?.digests[0] === digest(oracle('pixoo', 'B', true)) || 'Pixoo has not shown B');
      await within(h, 'Tidbyt really uploads B artwork behind its existing gate', () =>
        fixture.uploads.some(upload => Buffer.from(upload.rgb).equals(Buffer.from(oracle('tidbyt', 'B', true)))) || 'Tidbyt has not uploaded B', 18_000);
      assert.equal(attempts, 2, 'one obsolete acquisition and one newest acquisition');
      assert.ok(playbackRecords(h).every(state => state.artwork?.status !== 'ready' ||
        state.artwork.generation !== generationA && state.playback.status === 'known' && state.playback.title === 'B'), 'no obsolete A-ready publication');
      assert.ok(!fixture.uploads.filter(upload => upload.atMs >= handoffAt).some(upload =>
        (['A', 'B'] as const).some(title => Buffer.from(upload.rgb).equals(Buffer.from(oracle('tidbyt', title, true, 'playing', 'a'))))), 'no obsolete A artwork POST');
      assert.ok(!fixture.displays.filter(display => display.atMs >= handoffAt).some(display =>
        (['A', 'B'] as const).some(title => display.digests.includes(digest(oracle('pixoo', title, true, 'playing', 'a'))))), 'no obsolete A artwork displayed');
      await dispatchOnce(h, 'operator', 'fault-b-pause', controlPlayback(PLAYBACK.id, 'pause'), 'req-fault-b-pause');
      await within(h, 'pause still succeeds with transmitted evidence', current => recorded(current, 'req-fault-b-pause', 'succeeded', 'transmitted'));
      assert.deepEqual(speaker(h).sony.commands, ['pause']); assert.equal(speaker(h).sonos.commands.length, 0);
      assert.equal(attempts, 2);
      await privacy(h);
    } finally {
      releaseA({ok: true, value: new Uint8Array(PNG_A)});
      try { await h.close(); } finally { fixture.detach(); }
    }
  });

  for (const code of ['unsupported', 'unavailable'] as const) {
    void test(`acquisition ${code} retains real text displays and usable pause/next over ${transport}`, {timeout: 60_000}, async () => {
      let attempts = 0;
      const fixture = fixtures(() => { attempts += 1; return Promise.resolve({ok: false, code, transient: code === 'unavailable'}); });
      const h = await startMemoryHarness(seed, transport, {registrations: fixture.registrations});
      try {
        await monitor(h);
        h.simulate({device: 'playback', speaker: 'sony', action: 'play', title: 'A'});
        await within(h, 'Sony reports playing A', () => text(h, 'A', 'playing'));
        h.simulate({device: 'playback', speaker: 'sony', action: 'artwork'});
        await within(h, 'fixture refusal reached acquisition', () => attempts >= 1 || 'no acquisition');
        await within(h, 'Pixoo shows complete text fallback through the real worker', () =>
          shown(h).shown?.digests[0] === digest(oracle('pixoo', 'A', false)) || 'Pixoo text fallback is wrong');
        await within(h, 'Tidbyt uploaded complete text fallback through the real worker', () =>
          fixture.uploads.some(upload => Buffer.from(upload.rgb).equals(Buffer.from(oracle('tidbyt', 'A', false)))) || 'Tidbyt text fallback is wrong', 18_000);
        await within(h, 'bounded acquisition attempts finish', () => attempts === (code === 'unsupported' ? 1 : 3) || 'retry sequence unfinished', 8000);
        assert.equal(attempts, code === 'unsupported' ? 1 : 3);
        assert.equal(record(h)?.artwork?.status, 'missing');
        assert.equal(text(h, 'A', 'playing'), true);
        await dispatchOnce(h, 'operator', 'fault-pause', controlPlayback(PLAYBACK.id, 'pause'), 'req-fault-pause');
        await within(h, 'pause succeeded independently of acquisition', current => recorded(current, 'req-fault-pause', 'succeeded', 'transmitted'));
        await within(h, 'paused metadata and next remain available', () => {
          const state = record(h);
          return text(h, 'A', 'paused') === true && state?.playback.status === 'known' && state.playback.controls.includes('next') || 'pause lost metadata or next';
        });
        await dispatchOnce(h, 'operator', 'fault-next', controlPlayback(PLAYBACK.id, 'next'), 'req-fault-next');
        await within(h, 'next succeeded with existing transmitted evidence', current => recorded(current, 'req-fault-next', 'succeeded', 'transmitted'));
        assert.deepEqual(speaker(h).sony.commands, ['pause', 'next']); assert.equal(speaker(h).sonos.commands.length, 0);
        await within(h, 'Tidbyt eventually shows current paused text', () =>
          fixture.uploads.some(upload => Buffer.from(upload.rgb).equals(Buffer.from(oracle('tidbyt', 'A', false, 'paused')))) || 'Tidbyt paused fallback is wrong', 18_000);
        assert.equal(attempts, code === 'unsupported' ? 1 : 3, 'controls and polls never restart exhausted acquisition');
        assert.equal(playbackRecords(h).filter(state => state.artwork?.status === 'ready').length, 0);
        assert.ok(!fixture.uploads.some(upload => Buffer.from(upload.rgb).equals(Buffer.from(oracle('tidbyt', 'A', true)))));
        assert.ok(!fixture.displays.some(display => display.digests.includes(digest(oracle('pixoo', 'A', true)))));
        await privacy(h);
      } finally {
        try { await h.close(); } finally { fixture.detach(); }
      }
    });
  }
}

// A render failure keeps the frame already shown; it does not establish that a fresh fallback frame was sent.
for (const transport of TRANSPORTS) for (const failingRenderer of ['tidbyt', 'pixoo'] as const) {
  void test(`${failingRenderer} ready-artwork worker failure retains text and controls over ${transport}`, {timeout: 60_000}, async () => {
    let acquisitions = 0;
    const fixture = fixtures(() => { acquisitions += 1; return Promise.resolve(readyBytes()); }, undefined, failingRenderer);
    const h = await startMemoryHarness(seed, transport, {registrations: fixture.registrations});
    const tile = () => (h.devices().tidbyt as CloudState).installations[TIDBYT.nowPlaying.installation];
    const failures = () => logged(h, failingRenderer, 'operation.failed').filter(({record: entry}) =>
      entry.attributes['bunny.operation'] === (failingRenderer === 'tidbyt' ? 'playback' : 'feed'));
    try {
      // Warm the cloud gate while Pixoo remains passive. No fixture image has been selected.
      h.simulate({device: 'playback', speaker: 'sony', action: 'play', title: 'A'});
      await within(h, 'Sony reports current A metadata before renderer fault selection', () => text(h, 'A', 'playing'));
      await within(h, 'real Tidbyt text worker uploaded the baseline before artwork selection', () =>
        fixture.uploads.some(upload => Buffer.from(upload.rgb).equals(Buffer.from(oracle('tidbyt', 'A', false)))) || 'no baseline Tidbyt text', 18_000);
      h.simulate({device: 'playback', speaker: 'sony', action: 'pause'});
      await within(h, 'metadata pauses before Monitor starts', () => text(h, 'A', 'paused'));
      await monitor(h);
      h.simulate({device: 'playback', speaker: 'sony', action: 'play', title: 'A'});
      await within(h, 'fresh playing transition opens Monitor popup', () => text(h, 'A', 'playing'));
      await within(h, 'real Pixoo text worker shows the baseline before artwork selection', () =>
        shown(h).shown?.digests[0] === digest(oracle('pixoo', 'A', false)) || 'no baseline Pixoo text');
      assert.equal(acquisitions, 0);
      assert.equal(record(h)?.artwork?.status, 'missing');
      assert.ok(tile() !== undefined);
      const baselinePicture = [...(tile()?.picture ?? [])];
      const baselinePushes = tile()?.pushes;
      const baselinePixooUploads = shown(h).uploads;
      const baselinePixooDigest = shown(h).shown?.digests[0];
      assert.ok(fixture.uploads.length > 0);
      assert.ok(Buffer.from(fixture.uploads[fixture.uploads.length - 1]?.rgb ?? []).equals(Buffer.from(oracle('tidbyt', 'A', false))),
        'Tidbyt still shows the current playing text before artwork selection');
      assert.equal(failures().length, 0, 'normal text/dashboard delegation did not fail');
      h.simulate({device: 'playback', speaker: 'sony', action: 'artwork'});
      await within(h, 'real producer independently completes its ready artwork', () =>
        record(h)?.artwork?.status === 'ready' && text(h, 'A', 'playing') === true || 'producer artwork is not ready', 8000);
      if (failingRenderer === 'pixoo') {
        const beforeFault = h.now();
        await fixture.waitForPixooFailure();
        assert.equal(h.now(), beforeFault, 'waiting for the real worker does not spend the virtual popup');
        await within(h, 'ready Pixoo render failure is diagnosed within the existing popup', () => failures().length === 1 || 'no Pixoo render failure', 2000);
        assert.equal(shown(h).shown?.digests[0], baselinePixooDigest, 'failed Pixoo retains its already shown current text');
        assert.equal(shown(h).uploads, baselinePixooUploads, 'no new text/image upload is claimed for the failed renderer');
        await within(h, 'unaffected Tidbyt real worker uploads the ready image', () =>
          fixture.uploads.some(upload => Buffer.from(upload.rgb).equals(Buffer.from(oracle('tidbyt', 'A', true)))) || 'unaffected Tidbyt has no image', 18_000);
      } else {
        await within(h, 'unaffected Pixoo real worker displays ready artwork during the existing popup', () =>
          shown(h).shown?.digests[0] === digest(oracle('pixoo', 'A', true)) || 'unaffected Pixoo has no image', 2000);
        await within(h, 'ready Tidbyt render failure is diagnosed behind the existing tile gate', () => failures().length === 1 || 'no Tidbyt render failure', 18_000);
        assert.deepEqual(tile()?.picture, baselinePicture, 'failed Tidbyt retains its already shown current text');
        assert.equal(tile()?.pushes, baselinePushes, 'no new text/image POST is claimed for the failed renderer');
        assert.ok(!fixture.uploads.some(upload => Buffer.from(upload.rgb).equals(Buffer.from(oracle('tidbyt', 'A', true)))));
      }
      assert.deepEqual(failures().map(({record: entry}) => entry.attributes['bunny.code']), ['uncertain-result']);
      assert.equal(await running(h, ['core', 'playback', 'tidbyt', 'pixoo']), true);
      await dispatchOnce(h, 'operator', 'render-fault-pause', controlPlayback(PLAYBACK.id, 'pause'), 'req-render-fault-pause');
      await within(h, 'pause remains succeeded/transmitted despite one renderer fault', current =>
        recorded(current, 'req-render-fault-pause', 'succeeded', 'transmitted'));
      await within(h, 'paused metadata still offers next after renderer fault', () => {
        const state = record(h);
        return text(h, 'A', 'paused') === true && state?.playback.status === 'known' && state.playback.controls.includes('next') || 'pause lost current metadata/controls';
      });
      assert.deepEqual(speaker(h).sony.commands, ['pause']);
      assert.equal(speaker(h).sonos.commands.length, 0);
      assert.equal(acquisitions, 1, 'consumer failure and controls do not cause producer reacquisition');
      assert.equal(failures().length, 1, 'one fixed-code diagnostic for the current run of renderer failures');
      assert.equal(await running(h, ['core', 'playback', 'tidbyt', 'pixoo']), true);
      assert.ok(!JSON.stringify(h.logs()).includes('synthetic-ready-artwork-render-failure'), 'raw fixture error is not logged');
      await privacy(h);
    } finally {
      try { await h.close(); } finally { fixture.detach(); }
    }
  });
}
