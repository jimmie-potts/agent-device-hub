// The live Music session's loop on its own store and a scripted device (#1272, design D4): restoration rechecks for a
// newer choice around each write, a lost frame answer ends the session without a retry, and the loop never overlaps two
// device requests.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import type {CaptureFeatures} from '@jimmie-potts/event-contracts/v2/music-capture';
import {admitCommand, discovered, sceneList} from '../src/controls.js';
import {initialize} from '../src/database.js';
import {elementId, type LayoutEntry} from '../src/devices.js';
import {expireQueued, held, initJournal, journalRow, type Outcome, type Transact} from '../src/journal.js';
import {restoreFreeBase} from '../src/moments.js';
import {HttpError} from '../src/transport.js';
import type {Indication} from '../src/line-projection.js';
import {MusicInput, type MusicClock} from '../src/music-input.js';
import {initReactivePresets, saveReactivePreset} from '../src/music-presets.js';
import {admitMusicStart, admitMusicStop, musicDeviceState, playMusic} from '../src/music-session.js';
import {transaction} from '../src/sqlite.js';
import type {LightRequest} from '../src/transport.js';
import {test} from './support.js';

const CAPTURE = {endpointId: 'music-mac', generation: '9df02246-518e-44f2-9412-a942735e63cd'};
const GENERATION = '00000000-0000-4000-8000-000000000001';
const LAYOUT: LayoutEntry = {kind: 'lines', elements: [0, 1, 2].map(index => ({id: elementId([2 * index + 1, 2 * index + 2]), number: index + 1,
  zones: [2 * index + 1, 2 * index + 2], position: [index, 0]}))};

type World = {
  db: DatabaseSync; outcomes: Outcome[]; writes: {endpoint: string; payload: unknown; atMs: number}[]; inFlight: number; maxInFlight: number;
  now: number; selected: string; brightness: number; alert: boolean; feeding: boolean; sequence: number; input: MusicInput;
  onWrite: (endpoint: string, payload: unknown) => void; lose: string | undefined; refuse: number | undefined;
  /** Runs while a read is in flight, before it is answered: what changes during the read. */
  onRead: (endpoint: string) => void;
};

function open(): World {
  const db = new DatabaseSync(':memory:');
  initialize(db, () => 10);
  db.exec(`INSERT OR REPLACE INTO meta VALUES('mode','free');
    CREATE TABLE nanoleaf_devices(device TEXT PRIMARY KEY,configuration_revision INTEGER); INSERT INTO nanoleaf_devices VALUES('wall',0)`);
  initJournal(db); initReactivePresets(db);
  discovered(db, ['Ocean', 'New scene'], 'wall', () => {});
  transaction(db, () => saveReactivePreset(db, {presetId: 'preset-green', expectedRevision: 0, name: 'Green',
    recipe: {rendererVersion: 1, effect: 'level-glow', palette: ['#12ab34'], intensity: 0.5, sensitivity: 1, smoothingMs: 0}}, 1));
  const now = 1_793_836_800_000;
  const clock: MusicClock = {wallMs: now, monotonicMs: now};
  return {db, outcomes: [], writes: [], inFlight: 0, maxInFlight: 0, now, selected: 'Ocean', brightness: 50, alert: false, feeding: true, sequence: 0,
    input: new MusicInput(CAPTURE, clock), onWrite: () => {}, lose: undefined, refuse: undefined, onRead: () => {}};
}

const feature = (world: World): CaptureFeatures => {
  world.sequence += 1;
  const n = world.sequence;
  return {generation: CAPTURE.generation, input: 'music', sequence: n, sampleRateHz: 48000, channels: 2, frameCount: 4800,
    startMonotonicMs: 900000 + n * 100, endMonotonicMs: 900100 + n * 100, emittedMonotonicMs: 900102 + n * 100,
    observedAtMs: world.now, validUntilMs: world.now + 400, rms: 0.5, peak: 1, clippedFraction: 0,
    bands: {bass: 0.4, mid: 0.2, treble: 0.1}, onset: {strength: 0, confidence: 0}, discontinuity: false};
};
const deliver = (world: World): void => {
  world.input.accept({specversion: '1.0', bunnyprofile: '2.0', id: `frame-${world.sequence + 1}`, source: 'bunny/parts/music-producer',
    type: 'org.bunny.music-capture.features.observed', subject: CAPTURE.endpointId, time: '2026-11-05T00:00:00.000Z', kind: 'occurrence',
    datacontenttype: 'application/json', dataschema: 'https://bunny.invalid/events/music-capture-features/2.0',
    traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01', data: feature(world)}, {wallMs: world.now, monotonicMs: world.now});
};

/** Admits a Start over the `Ocean` base at 50 % and runs it until it ends, feeding a feature every 100 ms while `feeding`. */
async function run(world: World, step: (world: World) => void): Promise<void> {
  const {db} = world;
  const transact: Transact = action => Promise.resolve(transaction(db, () => action(message => { if (message.type === 'outcome') world.outcomes.push(message); })));
  transaction(db, () => admitMusicStart(db, 'wall', {requestId: 'start', generation: GENERATION, capture: CAPTURE, presetId: 'preset-green'}, LAYOUT,
    {name: 'Ocean', brightness: 50}, 0, world.now, world.now + 5000, () => {}));
  const request: LightRequest = async (_target, method, endpoint = '', payload = null) => {
    world.inFlight += 1;
    world.maxInFlight = Math.max(world.maxInFlight, world.inFlight);
    await Promise.resolve();
    world.inFlight -= 1;
    if (method === 'GET') {
      world.onRead(endpoint);
      if (endpoint === '/effects/select') return world.selected;
      return endpoint === '/effects' ? {select: world.selected, effectsList: ['Ocean', 'New scene']} : {on: {value: true}, brightness: {value: world.brightness}};
    }
    if (world.refuse !== undefined) {
      const status = world.refuse;
      world.refuse = undefined;
      throw new HttpError(status);
    }
    world.writes.push({endpoint, payload, atMs: world.now});
    if (world.lose === endpoint) {
      world.lose = undefined;
      throw new Error('the answer was lost');
    }
    const body = payload as {select?: string; write?: {animType: string}; brightness?: {value: number}};
    if (endpoint === '/effects') world.selected = body.select ?? (body.write?.animType === 'static' ? '*Static*' : '*Dynamic*');
    if (body.brightness !== undefined) world.brightness = body.brightness.value;
    world.onWrite(endpoint, payload);
    return {};
  };
  const row = journalRow(db, 'start');
  assert.ok(row);
  let fed = world.now - 100;
  await playMusic({db, device: 'wall', row, config: {ip: 'synthetic', token: 'synthetic', line_groups: LAYOUT.elements.map(element => element.zones)},
    transact, request, input: world.input, now: () => world.now, clock: () => ({wallMs: world.now, monotonicMs: world.now}),
    sleep: seconds => {
      world.now += seconds * 1000;
      // A bound on every run: after 200 features the source goes quiet, so a session that should have ended ends anyway.
      if (world.sequence > 200) world.feeding = false;
      if (world.feeding && world.now - fed >= 100) { fed = world.now; deliver(world); }
      step(world);
      return Promise.resolve();
    },
    current: (): Indication[] => (world.alert ? [['blocked', 1]] : [null]), taken: () => {}, stopping: () => false});
}

const ended = (world: World) => {
  const session = musicDeviceState(world.db, 'wall').session;
  return session?.status === 'ended' ? {reason: session.ended.reason, restoration: session.ended.restoration,
    ...(session.ended.code === undefined ? {} : {code: session.ended.code})} : undefined;
};
const frameWrites = (world: World) => world.writes.filter(write => (write.payload as {write?: unknown}).write !== undefined);

for (const choice of ['none', 'scene', 'brightness', 'mode'] as const) {
  test(`an alert restores the base unless a newer ${choice} choice lands between the restoration's writes`, async () => {
    const world = open();
    try {
      const newer = sceneList(world.db, 'wall').find(scene => scene.name === 'New scene');
      assert.ok(newer);
      world.onWrite = endpoint => {
        if (endpoint !== '/state') return;
        const command = choice === 'scene' ? {kind: 'scene.activate', sceneId: newer.id} : choice === 'brightness' ? {kind: 'brightness.set', percent: 10}
          : choice === 'mode' ? {kind: 'mode.set', mode: 'work'} : undefined;
        if (command !== undefined) transaction(world.db, () => admitCommand(world.db, 'unused', {id: 'owner', device: 'wall', command, instant: world.now / 1000,
          expires: world.now / 1000 + 5}, () => {}));
      };
      await run(world, current => { if (frameWrites(current).length >= 3) current.alert = true; });
      assert.deepEqual(world.outcomes.find(outcome => outcome.requestId === 'start'), {type: 'outcome', device: 'wall', requestId: 'start', result: 'succeeded', evidence: 'transmitted'});
      assert.deepEqual(ended(world), {reason: 'alert', restoration: choice === 'none' ? 'restored' : 'skipped'});
      const restored = world.writes.filter(write => (write.payload as {select?: unknown}).select === 'Ocean');
      assert.equal(restored.length, choice === 'none' ? 1 : 0, 'a newer choice prevents the rest of the restoration');
      if (choice === 'scene' || choice === 'brightness') assert.ok(journalRow(world.db, 'owner'), 'the newer choice still waits for the worker');
      assert.equal(world.maxInFlight, 1, 'one device request at a time');
    } finally {
      world.db.close();
    }
  });
}

test('Stop restores the base and completes after its restoration', async () => {
  const world = open();
  try {
    await run(world, current => {
      if (frameWrites(current).length === 3 && journalRow(current.db, 'stop') === undefined && current.outcomes.every(outcome => outcome.requestId !== 'stop')) {
        transaction(current.db, () => admitMusicStop(current.db, 'wall', {kind: 'music.stop', requestId: 'stop', generation: GENERATION}, current.now, current.now + 5000));
      }
    });
    assert.deepEqual(ended(world), {reason: 'stopped', restoration: 'restored'});
    assert.deepEqual(world.outcomes.find(outcome => outcome.requestId === 'stop'), {type: 'outcome', device: 'wall', requestId: 'stop', result: 'succeeded', evidence: 'transmitted'});
    assert.deepEqual(world.writes.slice(-2).map(write => write.payload), [{brightness: {value: 50, duration: 0}}, {select: 'Ocean'}]);
    assert.equal(frameWrites(world).length, 3, 'no frame after the stop');
  } finally {
    world.db.close();
  }
});

test('a lost frame answer ends the session as a device failure with no retry or restoration', async () => {
  const world = open();
  try {
    await run(world, current => { if (frameWrites(current).length === 4) current.lose = '/effects'; });
    assert.deepEqual(ended(world), {reason: 'device', restoration: 'none', code: 'uncertain-result'});
    assert.equal(frameWrites(world).length, 5, 'the lost write is not retried');
    assert.equal(world.writes.filter(write => (write.payload as {select?: unknown}).select !== undefined).length, 0);
    assert.equal(transaction(world.db, () => world.db.prepare("SELECT value FROM meta WHERE key LIKE 'controller_hold_revision%'").all().length), 0,
      'a paint after the Start completed holds nothing');
  } finally {
    world.db.close();
  }
});

test('frames are paced to the newest sample, at least 100 ms apart, with no catch-up', async () => {
  const world = open();
  try {
    let extra = 0;
    await run(world, current => {
      // Four more features arrive between each feed: a 50 Hz burst whose newest sample alone renders.
      for (let index = 0; index < 4 && current.feeding; index += 1) { deliver(current); extra += 1; }
      if (current.sequence > 60) current.feeding = false;
    });
    const frames = frameWrites(world);
    assert.ok(extra > 0);
    assert.ok(frames.length > 3 && frames.length < world.sequence / 4, `${frames.length} frames for ${world.sequence} features`);
    for (let index = 1; index < frames.length; index += 1) assert.ok((frames[index]?.atMs ?? 0) - (frames[index - 1]?.atMs ?? 0) >= 100);
    assert.deepEqual(ended(world), {reason: 'source-lost', restoration: 'restored'});
  } finally {
    world.db.close();
  }
});

test('a scene chosen between two frames is read before the next frame, which is never written', async () => {
  const world = open();
  try {
    let chosen = false;
    await run(world, current => {
      if (!chosen && frameWrites(current).length === 3) { chosen = true; current.selected = 'New scene'; }
    });
    assert.deepEqual(ended(world), {reason: 'manual', restoration: 'none'});
    assert.equal(frameWrites(world).length, 3, 'no frame paints over the app\'s scene');
    assert.equal(world.selected, 'New scene');
  } finally {
    world.db.close();
  }
});

test('a newer moment ends the session as manual with no frame after it', async () => {
  const world = open();
  try {
    let frames = 0;
    await run(world, current => {
      if (frames === 0 && frameWrites(current).length === 3) {
        frames = 3;
        current.db.prepare("INSERT INTO control_journal(id,device,kind,command,mode_revision,phase,accepted,expires) VALUES('moment','wall','moment.play','{}',0,'queued',1,99999999999)").run();
      }
    });
    assert.deepEqual(ended(world), {reason: 'manual', restoration: 'none'});
    assert.equal(frameWrites(world).length, 3);
  } finally {
    world.db.close();
  }
});

test('a device that refuses a frame ends the session with the answer\'s code', async () => {
  const world = open();
  try {
    await run(world, current => { if (frameWrites(current).length === 2) current.refuse = 503; });
    assert.deepEqual(ended(world), {reason: 'device', restoration: 'none', code: 'unavailable'});
    assert.equal(frameWrites(world).length, 2);
  } finally {
    world.db.close();
  }
});

for (const path of ['alert', 'stop'] as const) {
  test(`a lost answer on a ${path} restoration write records an uncertain restoration without a retry`, async () => {
    const world = open();
    try {
      let triggered = false;
      await run(world, current => {
        if (triggered || frameWrites(current).length !== 3) return;
        triggered = true;
        current.lose = '/state';
        if (path === 'alert') current.alert = true;
        else transaction(current.db, () => admitMusicStop(current.db, 'wall', {kind: 'music.stop', requestId: 'stop', generation: GENERATION}, current.now, current.now + 5000));
      });
      assert.deepEqual(ended(world), {reason: path === 'alert' ? 'alert' : 'stopped', restoration: 'uncertain'});
      assert.equal(world.writes.filter(write => write.endpoint === '/state').length, 1, 'the lost write is not retried');
      assert.equal(world.writes.filter(write => (write.payload as {select?: unknown}).select !== undefined).length, 0);
      if (path === 'stop') {
        assert.equal(world.outcomes.find(outcome => outcome.requestId === 'stop')?.result, 'uncertain');
        assert.equal(held(world.db, 0, 'wall'), true, 'the Stop\'s own lost write holds the light');
      } else {
        assert.equal(held(world.db, 0, 'wall'), false, 'a commandless restoration holds nothing');
      }
    } finally {
      world.db.close();
    }
  });
}

test('restoration skips a light that was powered off, for moments and Music alike', async () => {
  const writes: string[] = [];
  const base = {name: 'Ocean', brightness: 50};
  const reader = (on: boolean) => (endpoint: string): Promise<unknown> => Promise.resolve(endpoint === '/effects'
    ? {select: '*Static*', effectsList: ['Ocean']} : {on: {value: on}, brightness: {value: 50}});
  const write = (endpoint: string): Promise<unknown> => { writes.push(endpoint); return Promise.resolve({}); };
  assert.equal(await restoreFreeBase(reader(false), base, '*Static*', () => false, write), false);
  assert.deepEqual(writes, []);
  assert.equal(await restoreFreeBase(reader(true), base, '*Static*', () => false, write), true);
  assert.deepEqual(writes, ['/state', '/effects']);
});

test('the expiry sweep leaves a live session\'s Stop for its loop and a second Stop is accepted', () => {
  const world = open();
  try {
    const {db} = world;
    transaction(db, () => admitMusicStart(db, 'wall', {requestId: 'start', generation: GENERATION, capture: CAPTURE, presetId: 'preset-green'}, LAYOUT,
      {name: 'Ocean', brightness: 50}, 0, world.now, world.now + 5000, () => {}));
    transaction(db, () => admitMusicStop(db, 'wall', {kind: 'music.stop', requestId: 'stop-a', generation: GENERATION}, world.now, world.now + 300));
    transaction(db, () => admitMusicStop(db, 'wall', {kind: 'music.stop', requestId: 'stop-b', generation: GENERATION}, world.now, world.now + 300));
    const outcomes: Outcome[] = [];
    transaction(db, () => { expireQueued(db, 'wall', world.now / 1000 + 1, message => { if (message.type === 'outcome') outcomes.push(message); }); });
    assert.ok(journalRow(db, 'stop-a') && journalRow(db, 'stop-b'), 'both Stops wait for the loop');
    assert.deepEqual(outcomes, [], 'nothing expires a Stop the live session\'s loop has yet to take');
  } finally {
    world.db.close();
  }
});

/** Each device write as `endpoint` and what it set: a frame, a brightness or a scene. */
const sequence = (world: World): string[] => world.writes.map(write => {
  const body = write.payload as {write?: unknown; select?: string; brightness?: {value: number}};
  return body.write !== undefined ? 'frame' : body.select !== undefined ? `select ${body.select}` : `brightness ${body.brightness?.value}`;
});

for (const change of ['alert', 'stop'] as const) {
  test(`a${change === 'alert' ? 'n' : ''} ${change} during the first frame's base read ends the session with no write`, async () => {
    const world = open();
    try {
      let raised = false;
      world.onRead = endpoint => {
        if (endpoint !== '/effects/select' || raised) return;
        raised = true;
        if (change === 'alert') world.alert = true;
        else transaction(world.db, () => admitMusicStop(world.db, 'wall', {kind: 'music.stop', requestId: 'stop', generation: GENERATION}, world.now, world.now + 5000));
      };
      await run(world, () => {});
      assert.ok(raised);
      assert.deepEqual(sequence(world), [], 'nothing was shown, so nothing is written or restored');
      assert.deepEqual(ended(world), {reason: change === 'alert' ? 'alert' : 'stopped', restoration: 'none'});
      const start = world.outcomes.find(outcome => outcome.requestId === 'start');
      assert.equal(start?.result, 'failed');
      assert.equal(start?.error?.code, change === 'alert' ? 'invalid-state' : 'cancelled');
      if (change === 'stop') assert.deepEqual(world.outcomes.find(outcome => outcome.requestId === 'stop')?.evidence, 'observed');
    } finally {
      world.db.close();
    }
  });
}

for (const change of ['alert', 'stop', 'source-loss'] as const) {
  test(`${change} during a later frame's selection read ends the session before that frame`, async () => {
    const world = open();
    try {
      let raised = false;
      world.onRead = endpoint => {
        if (endpoint !== '/effects/select' || raised || frameWrites(world).length !== 3) return;
        raised = true;
        if (change === 'alert') world.alert = true;
        else if (change === 'stop') transaction(world.db, () => admitMusicStop(world.db, 'wall', {kind: 'music.stop', requestId: 'stop', generation: GENERATION}, world.now, world.now + 5000));
        else {
          // The read outlasts the input's validity, as a slow light's can.
          world.feeding = false;
          world.now += 500;
        }
      };
      await run(world, () => {});
      assert.ok(raised);
      assert.deepEqual(sequence(world), ['frame', 'frame', 'frame', 'brightness 50', 'select Ocean'], 'no frame after the read; the base is restored');
      assert.deepEqual(ended(world), {reason: change === 'alert' ? 'alert' : change === 'stop' ? 'stopped' : 'source-lost', restoration: 'restored'});
      assert.equal(world.maxInFlight, 1);
    } finally {
      world.db.close();
    }
  });
}
