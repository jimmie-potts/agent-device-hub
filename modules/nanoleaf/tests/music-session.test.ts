// The live Music session's loop on its own store and a scripted device (#1272, design D4; #1598): the Start enters
// streaming, frames go as datagrams the light applies only while streaming, restoration rechecks for a newer choice
// around each write, a failed send ends the session without a retry, and the loop never overlaps two device requests.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import type {CaptureFeatures} from '@jimmie-potts/event-contracts/v2/music-capture';
import {admitCommand, discovered, sceneList} from '../src/controls.js';
import {initialize} from '../src/database.js';
import {elementId, type LayoutEntry} from '../src/devices.js';
import {expireQueued, held, initJournal, journalRow, type Outcome, type Transact} from '../src/journal.js';
import {restoreFreeBase} from '../src/moments.js';
import {readMusicBase, restoreMusicBase, type MusicBase, type MusicColor} from '../src/music-base.js';
import {lastSelection, saveSelection, SELECTION_REFRESH_MS} from '../src/music-store.js';
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
  /** Every frame datagram sent, whether the light applied it (streaming) or ignored it, and every read. */
  datagrams: {atMs: number; applied: boolean; packet: Buffer}[]; reads: {endpoint: string; atMs: number}[];
  /** The next datagram send fails, as a socket error. */
  failSend: boolean;
  now: number; selected: string; brightness: number; alert: boolean; feeding: boolean; sequence: number; input: MusicInput;
  /** The plain colour `/state` reports, if one was chosen: a colour write selects `*Solid*` (#1614). */
  color: MusicColor | undefined;
  onWrite: (endpoint: string, payload: unknown) => void; lose: string | undefined; refuse: number | undefined;
  /** Runs while a read is in flight, before it is answered: what changes during the read. */
  onRead: (endpoint: string) => void;
  /** Runs as a request reaches the light, before it is served: what the light applied since its last answer. */
  onArrive: () => void;
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
  return {db, outcomes: [], writes: [], inFlight: 0, maxInFlight: 0, datagrams: [], reads: [], failSend: false, now, selected: 'Ocean', brightness: 50, alert: false, feeding: true, sequence: 0,
    input: new MusicInput(CAPTURE, clock), onWrite: () => {}, lose: undefined, refuse: undefined, onRead: () => {}, onArrive: () => {}, color: undefined};
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

const OCEAN: MusicBase = {kind: 'scene', name: 'Ocean', brightness: 50};
/**
 * Admits a Start over `base`, the `Ocean` scene at 50 % unless named, and runs it until it ends, feeding a feature every
 * 100 ms while `feeding`.
 */
async function run(world: World, step: (world: World) => void, base: MusicBase = OCEAN): Promise<void> {
  const {db} = world;
  const transact: Transact = action => Promise.resolve(transaction(db, () => action(message => { if (message.type === 'outcome') world.outcomes.push(message); })));
  transaction(db, () => admitMusicStart(db, 'wall', {requestId: 'start', generation: GENERATION, capture: CAPTURE, presetId: 'preset-green'}, LAYOUT,
    base, 0, world.now, world.now + 5000, () => {}));
  const request: LightRequest = async (_target, method, endpoint = '', payload = null) => {
    world.inFlight += 1;
    world.maxInFlight = Math.max(world.maxInFlight, world.inFlight);
    world.onArrive();
    await Promise.resolve();
    world.inFlight -= 1;
    if (method === 'GET') {
      world.reads.push({endpoint, atMs: world.now});
      world.onRead(endpoint);
      if (endpoint === '/effects/select') return world.selected;
      const color = world.color === undefined ? {colorMode: 'effect'} : 'ct' in world.color ? {colorMode: 'ct', ct: {value: world.color.ct}}
        : {colorMode: 'hs', hue: {value: world.color.hue}, sat: {value: world.color.sat}};
      return endpoint === '/effects' ? {select: world.selected, effectsList: ['Ocean', 'New scene']} : {on: {value: true}, brightness: {value: world.brightness}, ...color};
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
    if (endpoint === '/effects') {
      world.selected = body.select ?? (body.write?.animType === 'extControl' ? '*ExtControl*' : body.write?.animType === 'static' ? '*Static*' : '*Dynamic*');
    }
    if (body.brightness !== undefined) world.brightness = body.brightness.value;
    const colored = payload as {hue?: {value: number}; sat?: {value: number}; ct?: {value: number}};
    if (colored.ct !== undefined) world.color = {ct: colored.ct.value};
    else if (colored.hue !== undefined && colored.sat !== undefined) world.color = {hue: colored.hue.value, sat: colored.sat.value};
    if (colored.ct !== undefined || colored.hue !== undefined) world.selected = '*Solid*';
    world.onWrite(endpoint, payload);
    return {};
  };
  // A datagram reaches the light behind any request already there, and only a streaming light applies it.
  const stream = async (packet: Uint8Array): Promise<void> => {
    world.inFlight += 1;
    world.maxInFlight = Math.max(world.maxInFlight, world.inFlight);
    world.onArrive();
    await Promise.resolve();
    world.inFlight -= 1;
    if (world.failSend) {
      world.failSend = false;
      throw Object.assign(new Error('the datagram was not sent'), {code: 'EHOSTUNREACH'});
    }
    world.datagrams.push({atMs: world.now, applied: world.selected === '*ExtControl*', packet: Buffer.from(packet)});
  };
  const row = journalRow(db, 'start');
  assert.ok(row);
  let fed = world.now - 100;
  await playMusic({db, device: 'wall', row, config: {ip: 'synthetic', token: 'synthetic', line_groups: LAYOUT.elements.map(element => element.zones)},
    transact, request, stream, input: world.input, now: () => world.now, clock: () => ({wallMs: world.now, monotonicMs: world.now}),
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
/** The frames the session sent: datagrams after the Start's streaming entry. */
const frameWrites = (world: World) => world.datagrams;
const entries = (world: World) => world.writes.filter(write => (write.payload as {write?: {animType?: unknown}}).write?.animType === 'extControl');

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

test('a failed datagram send ends the session as a device failure with no retry or restoration', async () => {
  const world = open();
  try {
    await run(world, current => { if (frameWrites(current).length === 4) current.failSend = true; });
    assert.deepEqual(ended(world), {reason: 'device', restoration: 'none', code: 'unavailable'});
    assert.equal(frameWrites(world).length, 4, 'the failed frame is not retried');
    assert.equal(world.writes.filter(write => (write.payload as {select?: unknown}).select !== undefined).length, 0);
    assert.equal(transaction(world.db, () => world.db.prepare("SELECT value FROM meta WHERE key LIKE 'controller_hold_revision%'").all().length), 0,
      'a frame after the Start completed holds nothing');
  } finally {
    world.db.close();
  }
});

test('a lost answer to the streaming entry ends the Start uncertain, holds the light and sends no frame', async () => {
  const world = open();
  try {
    world.lose = '/effects';
    await run(world, () => {});
    assert.deepEqual(ended(world)?.reason, 'device');
    assert.equal(entries(world).length, 1, 'the entry is not retried');
    assert.equal(frameWrites(world).length, 0);
    assert.equal(world.outcomes.find(outcome => outcome.requestId === 'start')?.result, 'uncertain');
    assert.equal(held(world.db, 0, 'wall'), true);
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

test('a scene chosen in the app leaves streaming: later frames are ignored and the next check ends the session as manual', async () => {
  const world = open();
  try {
    let pickedAt: number | undefined;
    await run(world, current => {
      if (pickedAt === undefined && frameWrites(current).length === 3) { pickedAt = current.now; current.selected = 'New scene'; }
    });
    assert.ok(pickedAt !== undefined);
    assert.deepEqual(ended(world), {reason: 'manual', restoration: 'none'});
    assert.equal(world.selected, 'New scene', 'the app\'s scene stays');
    assert.equal(frameWrites(world).filter(frame => frame.atMs >= (pickedAt ?? 0) && frame.applied).length, 0, 'no frame paints over it');
    const endedAt = musicDeviceState(world.db, 'wall').session;
    assert.ok(endedAt?.status === 'ended' && endedAt.ended.atMs - pickedAt <= 1100, 'the once-per-second check ends it');
    assert.equal(world.writes.filter(write => (write.payload as {select?: unknown}).select !== undefined).length, 0, 'nothing is restored');
  } finally {
    world.db.close();
  }
});

test('#1598: an app scene the light serves while one of the session\'s requests is in flight still ends the session as manual', async () => {
  // The light answers one request at a time, in arrival order: an app choice that arrives while the session's check read
  // is in flight is applied after that read is answered and before the session's next datagram.
  const world = open();
  try {
    let chosen = false;
    let queued = false;
    world.onRead = endpoint => {
      if (endpoint === '/effects' && !chosen && frameWrites(world).length >= 3) { chosen = true; queued = true; }
    };
    world.onArrive = () => {
      if (!queued) return;
      queued = false;
      world.selected = 'New scene';
    };
    await run(world, () => {});
    assert.ok(chosen, 'the app chose a scene during the check read');
    assert.deepEqual(ended(world), {reason: 'manual', restoration: 'none'});
    assert.equal(world.selected, 'New scene', 'the app\'s scene stays');
  } finally {
    world.db.close();
  }
});

for (const change of ['stop', 'moment', 'alert'] as const) {
  test(`a${change === 'alert' ? 'n' : ''} ${change} admitted during the streaming entry stops the first frame`, async () => {
    const world = open();
    try {
      let raised = false;
      world.onWrite = (_endpoint, payload) => {
        if (raised || (payload as {write?: {animType?: unknown}}).write?.animType !== 'extControl') return;
        raised = true;
        if (change === 'alert') world.alert = true;
        else if (change === 'stop') transaction(world.db, () => admitMusicStop(world.db, 'wall', {kind: 'music.stop', requestId: 'stop', generation: GENERATION}, world.now, world.now + 5000));
        else world.db.prepare("INSERT INTO control_journal(id,device,kind,command,mode_revision,phase,accepted,expires) VALUES('moment','wall','moment.play','{}',0,'queued',1,99999999999)").run();
      };
      await run(world, () => {});
      assert.ok(raised);
      assert.equal(frameWrites(world).length, 0, 'no frame follows a change admitted during the entry');
      assert.deepEqual(ended(world), {reason: change === 'stop' ? 'stopped' : change === 'alert' ? 'alert' : 'manual', restoration: change === 'moment' ? 'none' : 'restored'});
    } finally {
      world.db.close();
    }
  });
}

test('a playing session streams every frame and reads the light only for the once-per-second check (#1598)', async () => {
  const world = open();
  try {
    let startedAt: number | undefined;
    await run(world, current => {
      startedAt ??= frameWrites(current).length > 0 ? current.now : undefined;
      if (current.sequence > 50) current.feeding = false;
    });
    assert.ok(startedAt !== undefined);
    assert.deepEqual(entries(world).length, 1);
    assert.equal(world.writes.filter(write => (write.payload as {write?: unknown}).write !== undefined).length, 1, 'no HTTP display frame');
    const playing = world.reads.filter(read => read.atMs >= (startedAt ?? 0));
    assert.equal(playing.filter(read => read.endpoint === '/effects/select').length, 0, 'no per-frame selection read');
    const seconds = (world.now - startedAt) / 1000;
    assert.ok(playing.length <= 2 * Math.ceil(seconds) + 2, `${playing.length} reads in ${seconds} s`);
    assert.ok(frameWrites(world).length > 30 && frameWrites(world).every(frame => frame.applied));
    // Each datagram carries the six zones' colors: a count, then ID, red, green, blue, white 0 and a 100 ms transition.
    const packet = frameWrites(world)[0]?.packet;
    assert.ok(packet);
    assert.equal(packet.readUInt16BE(0), 6);
    assert.deepEqual([0, 1, 2, 3, 4, 5].map(index => packet.readUInt16BE(2 + 8 * index)), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual([0, 1, 2, 3, 4, 5].map(index => [packet.readUInt8(7 + 8 * index), packet.readUInt16BE(8 + 8 * index)]), Array(6).fill([0, 1]));
    assert.equal(world.maxInFlight, 1, 'one device request or datagram at a time');
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

test('a light that refuses the streaming entry ends the session with the answer\'s code and sends no frame', async () => {
  const world = open();
  try {
    world.refuse = 503;
    await run(world, () => {});
    assert.deepEqual(ended(world), {reason: 'device', restoration: 'none', code: 'unavailable'});
    assert.equal(frameWrites(world).length, 0);
    assert.equal(world.outcomes.find(outcome => outcome.requestId === 'start')?.result, 'failed');
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
  writes.length = 0;
  const colour = {kind: 'color', selection: '*Solid*', color: {hue: 120, sat: 80}, brightness: 50} as const;
  for (const music of [{kind: 'scene', name: 'Ocean', brightness: 50} as const, colour]) {
    assert.equal(await restoreMusicBase(reader(false), music, '*Static*', () => false, write), false);
  }
  assert.deepEqual(writes, [], 'a light switched off by hand keeps its choice');
});

test('the expiry sweep leaves a live session\'s Stop for its loop and a second Stop is accepted', () => {
  const world = open();
  try {
    const {db} = world;
    transaction(db, () => admitMusicStart(db, 'wall', {requestId: 'start', generation: GENERATION, capture: CAPTURE, presetId: 'preset-green'}, LAYOUT,
      OCEAN, 0, world.now, world.now + 5000, () => {}));
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
  return body.write !== undefined ? 'stream' : body.select !== undefined ? `select ${body.select}` : `brightness ${body.brightness?.value}`;
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
  test(`${change} during the playing check's read ends the session before the next frame`, async () => {
    const world = open();
    try {
      let raised = false;
      let sent = 0;
      world.onRead = endpoint => {
        if (endpoint !== '/effects' || raised || frameWrites(world).length < 3) return;
        raised = true;
        sent = frameWrites(world).length;
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
      assert.equal(frameWrites(world).length, sent, 'no frame after the read');
      assert.deepEqual(sequence(world), ['stream', 'brightness 50', 'select Ocean'], 'the base is restored');
      assert.deepEqual(ended(world), {reason: change === 'alert' ? 'alert' : change === 'stop' ? 'stopped' : 'source-lost', restoration: 'restored'});
      assert.equal(world.maxInFlight, 1);
    } finally {
      world.db.close();
    }
  });
}

// #1614: a Start over any selection. A saved scene and a plain colour are put back; anything else is left on the last
// frame with restoration `none`, and no scene is guessed.
const COLOR: MusicBase = {kind: 'color', selection: '*Solid*', color: {hue: 120, sat: 80}, brightness: 50};
const WARM: MusicBase = {kind: 'color', selection: '*Solid*', color: {ct: 2700}, brightness: 50};
const stopAfter = (frames: number) => (current: World): void => {
  if (frameWrites(current).length === frames && journalRow(current.db, 'stop') === undefined && current.outcomes.every(outcome => outcome.requestId !== 'stop')) {
    transaction(current.db, () => admitMusicStop(current.db, 'wall', {kind: 'music.stop', requestId: 'stop', generation: GENERATION}, current.now, current.now + 5000));
  }
};

test('a Start over a plain colour streams, and Stop puts the colour back after its brightness', async () => {
  const world = open();
  try {
    world.selected = '*Solid*';
    world.color = {hue: 120, sat: 80};
    await run(world, stopAfter(3), COLOR);
    assert.equal(entries(world).length, 1, 'the light entered streaming');
    assert.deepEqual(ended(world), {reason: 'stopped', restoration: 'restored'});
    assert.deepEqual(world.writes.slice(-2).map(write => write.payload), [{brightness: {value: 50, duration: 0}}, {hue: {value: 120}, sat: {value: 80}}]);
    assert.deepEqual({selected: world.selected, color: world.color}, {selected: '*Solid*', color: {hue: 120, sat: 80}});
    assert.deepEqual(world.outcomes.find(outcome => outcome.requestId === 'stop'), {type: 'outcome', device: 'wall', requestId: 'stop', result: 'succeeded', evidence: 'transmitted'});
    assert.equal(world.writes.filter(write => (write.payload as {select?: unknown}).select !== undefined).length, 0, 'no scene is selected');
    assert.equal(world.maxInFlight, 1);
  } finally {
    world.db.close();
  }
});

for (const ending of ['alert', 'source-lost'] as const) {
  test(`${ending === 'alert' ? 'an alert' : 'source loss'} over a colour temperature puts it back`, async () => {
    const world = open();
    try {
      world.selected = '*Solid*';
      world.color = {ct: 2700};
      await run(world, current => {
        if (frameWrites(current).length < 3) return;
        if (ending === 'alert') current.alert = true;
        else current.feeding = false;
      }, WARM);
      assert.deepEqual(ended(world), {reason: ending, restoration: 'restored'});
      assert.deepEqual(world.writes.slice(-2).map(write => write.payload), [{brightness: {value: 50, duration: 0}}, {ct: {value: 2700}}]);
      assert.deepEqual(world.color, {ct: 2700});
    } finally {
      world.db.close();
    }
  });
}

test('a newer choice between a colour restoration\'s writes stops the colour write', async () => {
  const world = open();
  try {
    world.selected = '*Solid*';
    world.color = {hue: 120, sat: 80};
    world.onWrite = (_endpoint, payload) => {
      if ((payload as {brightness?: unknown}).brightness === undefined) return;
      transaction(world.db, () => admitCommand(world.db, 'unused', {id: 'owner', device: 'wall', command: {kind: 'brightness.set', percent: 10},
        instant: world.now / 1000, expires: world.now / 1000 + 5}, () => {}));
    };
    await run(world, current => { if (frameWrites(current).length >= 3) current.alert = true; }, COLOR);
    assert.deepEqual(ended(world), {reason: 'alert', restoration: 'skipped'});
    assert.equal(world.writes.filter(write => (write.payload as {hue?: unknown}).hue !== undefined).length, 0, 'the newer choice wins');
  } finally {
    world.db.close();
  }
});

for (const selection of ['*ExtControl*', '*Dynamic*', 'Unsaved preview'] as const) {
  for (const ending of ['stopped', 'alert', 'source-lost'] as const) {
    test(`a Start over ${selection} plays, and ${ending === 'stopped' ? 'Stop' : ending === 'alert' ? 'an alert' : 'source loss'} leaves the last frame with restoration none`, async () => {
      const world = open();
      try {
        world.selected = selection;
        const base: MusicBase = {kind: 'unnamed', selection, brightness: 50};
        await run(world, current => {
          if (ending === 'stopped') stopAfter(3)(current);
          else if (frameWrites(current).length >= 3) {
            if (ending === 'alert') current.alert = true;
            else current.feeding = false;
          }
        }, base);
        assert.equal(entries(world).length, 1, 'the light entered streaming');
        assert.ok(frameWrites(world).length >= 3 && frameWrites(world).every(frame => frame.applied));
        assert.deepEqual(ended(world), {reason: ending, restoration: 'none'});
        assert.deepEqual(sequence(world), ['stream'], 'nothing is written after the frames, and no scene is guessed');
        assert.equal(world.selected, '*ExtControl*', 'the light keeps the last frame');
        if (ending === 'stopped') {
          assert.deepEqual(world.outcomes.find(outcome => outcome.requestId === 'stop'), {type: 'outcome', device: 'wall', requestId: 'stop', result: 'succeeded', evidence: 'observed'});
        }
        assert.equal(held(world.db, 0, 'wall'), false);
      } finally {
        world.db.close();
      }
    });
  }
}

test('a selection other than the unnamed base\'s before the streaming entry is a newer manual choice', async () => {
  const world = open();
  try {
    world.selected = 'Unsaved preview';
    world.onRead = endpoint => { if (endpoint === '/effects/select') world.selected = 'Ocean'; };
    await run(world, () => {}, {kind: 'unnamed', selection: 'Unsaved preview', brightness: 50});
    assert.deepEqual(ended(world), {reason: 'manual', restoration: 'none'});
    assert.deepEqual(sequence(world), [], 'nothing is written over the newer choice');
  } finally {
    world.db.close();
  }
});

test('the base read takes a saved scene, a plain colour or an unnamed selection, and refuses a light that is off', async () => {
  const reads = (listing: unknown, state: unknown) => (endpoint: string): Promise<unknown> => Promise.resolve(endpoint === '/effects' ? listing : state);
  const on = (patch: object = {}) => ({on: {value: true}, brightness: {value: 40, max: 100, min: 0}, colorMode: 'effect', ...patch});
  const list = (select: string) => ({select, effectsList: ['Ocean']});
  assert.deepEqual(await readMusicBase(reads(list('Ocean'), on())),
    {observed: {selection: 'Ocean', saved: true, restores: 'scene'}, base: {kind: 'scene', name: 'Ocean', brightness: 40}});
  assert.deepEqual(await readMusicBase(reads(list('*Solid*'), on({colorMode: 'hs', hue: {value: 200, max: 360, min: 0}, sat: {value: 60, max: 100, min: 0}}))),
    {observed: {selection: '*Solid*', saved: false, restores: 'color'}, base: {kind: 'color', selection: '*Solid*', color: {hue: 200, sat: 60}, brightness: 40}});
  assert.deepEqual(await readMusicBase(reads(list('*Solid*'), on({colorMode: 'ct', ct: {value: 2700, max: 6500, min: 1200}}))),
    {observed: {selection: '*Solid*', saved: false, restores: 'color'}, base: {kind: 'color', selection: '*Solid*', color: {ct: 2700}, brightness: 40}});
  // A colour the light does not report readably is put back by no one.
  assert.deepEqual(await readMusicBase(reads(list('*Solid*'), on({colorMode: 'hs', hue: {value: 400}}))),
    {observed: {selection: '*Solid*', saved: false, restores: 'nothing'}, base: {kind: 'unnamed', selection: '*Solid*', brightness: 40}});
  for (const select of ['*ExtControl*', '*Dynamic*', '*Static*', 'Unsaved preview']) {
    assert.deepEqual(await readMusicBase(reads(list(select), on())),
      {observed: {selection: select, saved: false, restores: 'nothing'}, base: {kind: 'unnamed', selection: select, brightness: 40}});
  }
  assert.deepEqual(await readMusicBase(reads(list('Ocean'), on({on: {value: false}}))),
    {observed: {selection: 'Ocean', saved: true, restores: 'scene'}, refusal: 'off'});
  assert.deepEqual(await readMusicBase(reads(list('Ocean'), {on: {value: true}})),
    {observed: {selection: 'Ocean', saved: true, restores: 'scene'}, refusal: 'unreadable'});
  assert.deepEqual(await readMusicBase(reads({effectsList: []}, on())), {observed: undefined, refusal: 'unreadable'});
});

test('the playing check keeps the light\'s selection for its record with no request of its own', async () => {
  const world = open();
  try {
    let startedAt: number | undefined;
    await run(world, current => { startedAt ??= frameWrites(current).length > 0 ? current.now : undefined; });
    assert.ok(startedAt !== undefined);
    const kept = lastSelection(world.db, 'wall');
    assert.deepEqual(kept === undefined ? undefined : {selection: kept.selection, saved: kept.saved, restores: kept.restores},
      {selection: '*ExtControl*', saved: false, restores: 'nothing'});
    assert.ok(kept !== undefined && kept.readAtMs >= startedAt && kept.readAtMs <= world.now);
    const playing = world.reads.filter(read => read.atMs >= (startedAt ?? 0));
    const seconds = (world.now - startedAt) / 1000;
    assert.ok(playing.length <= 2 * Math.ceil(seconds) + 2, `${playing.length} reads in ${seconds} s`);
  } finally {
    world.db.close();
  }
});

test('an unchanged selection keeps its read time for a minute, and a changed one is kept at once', () => {
  const world = open();
  try {
    const reported: string[] = [];
    const save = (selection: string, atMs: number): void => transaction(world.db, () => saveSelection(world.db, 'wall',
      {selection, saved: false, restores: 'nothing'}, atMs, message => { reported.push(message.type); }));
    save('*ExtControl*', 1000);
    save('*ExtControl*', 2000);
    assert.equal(lastSelection(world.db, 'wall')?.readAtMs, 1000);
    save('*ExtControl*', 1000 + SELECTION_REFRESH_MS);
    assert.equal(lastSelection(world.db, 'wall')?.readAtMs, 1000 + SELECTION_REFRESH_MS);
    save('*Dynamic*', 2000 + SELECTION_REFRESH_MS);
    assert.equal(lastSelection(world.db, 'wall')?.selection, '*Dynamic*');
    assert.deepEqual(reported, ['selection', 'selection', 'selection']);
  } finally {
    world.db.close();
  }
});

// #1614 fix round 1: a colour picked in the app before the streaming entry is a newer manual choice, and the colour
// restoration's second write keeps the scene path's lost-answer, takeover and classification rules.
const writesColour = (world: World): number => world.writes.filter(write => {
  const body = write.payload as {hue?: unknown; ct?: unknown};
  return body.hue !== undefined || body.ct !== undefined;
}).length;

test('a colour picked in the app before the streaming entry is a newer manual choice: no entry and no colour write', async () => {
  const world = open();
  try {
    world.selected = '*Solid*';
    world.color = {hue: 120, sat: 80};
    // The app picks another colour while the session's entry read is in flight; the light still reports *Solid*.
    world.onRead = endpoint => { if (endpoint === '/effects/select') world.color = {hue: 10, sat: 90}; };
    await run(world, () => {}, COLOR);
    assert.deepEqual(ended(world), {reason: 'manual', restoration: 'none'});
    assert.equal(entries(world).length, 0, 'streaming does not replace the new colour');
    assert.equal(writesColour(world), 0, 'the old colour is not written back');
    assert.deepEqual(world.color, {hue: 10, sat: 90}, 'the app\'s colour stays');
  } finally {
    world.db.close();
  }
});

test('only a colour base reads the state before the streaming entry; scene and unnamed bases keep one selection read', async () => {
  for (const [base, selected, color] of [[COLOR, '*Solid*', {hue: 120, sat: 80}], [OCEAN, 'Ocean', undefined],
    [{kind: 'unnamed', selection: '*Dynamic*', brightness: 50}, '*Dynamic*', undefined]] as const) {
    const world = open();
    try {
      world.selected = selected;
      world.color = color;
      let entered: number | undefined;
      world.onWrite = (_endpoint, payload) => {
        if ((payload as {write?: {animType?: unknown}}).write?.animType === 'extControl') entered ??= world.reads.length;
      };
      await run(world, stopAfter(3), base);
      assert.deepEqual(world.reads.slice(0, entered).map(read => read.endpoint),
        base.kind === 'color' ? ['/effects/select', '/state'] : ['/effects/select'], base.kind);
    } finally {
      world.db.close();
    }
  }
});

for (const path of ['alert', 'stop'] as const) {
  test(`a lost answer on a ${path}'s colour write records an uncertain restoration without a retry`, async () => {
    const world = open();
    try {
      world.selected = '*Solid*';
      world.color = {hue: 120, sat: 80};
      let triggered = false;
      // The brightness write is answered; the colour write after it reaches the light, and its answer is lost.
      world.onWrite = (endpoint, payload) => {
        if (triggered && endpoint === '/state' && (payload as {brightness?: unknown}).brightness !== undefined) world.lose = '/state';
      };
      await run(world, current => {
        if (triggered || frameWrites(current).length !== 3) return;
        triggered = true;
        if (path === 'alert') current.alert = true;
        else transaction(current.db, () => admitMusicStop(current.db, 'wall', {kind: 'music.stop', requestId: 'stop', generation: GENERATION}, current.now, current.now + 5000));
      }, COLOR);
      assert.deepEqual(ended(world), {reason: path === 'alert' ? 'alert' : 'stopped', restoration: 'uncertain'});
      assert.equal(writesColour(world), 1, 'the lost colour write is not retried');
      assert.equal(world.writes.filter(write => write.endpoint === '/state').length, 2);
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

test('a scene chosen in the app during a colour-base session ends it as manual with no colour write', async () => {
  const world = open();
  try {
    world.selected = '*Solid*';
    world.color = {hue: 120, sat: 80};
    let picked = false;
    await run(world, current => {
      if (!picked && frameWrites(current).length === 3) { picked = true; current.selected = 'New scene'; }
    }, COLOR);
    assert.ok(picked);
    assert.deepEqual(ended(world), {reason: 'manual', restoration: 'none'});
    assert.equal(writesColour(world), 0);
    assert.equal(world.selected, 'New scene', 'the app\'s scene stays');
  } finally {
    world.db.close();
  }
});

test('a plain colour the light does not report completely is an unnamed base', async () => {
  const reads = (state: unknown) => (endpoint: string): Promise<unknown> =>
    Promise.resolve(endpoint === '/effects' ? {select: '*Solid*', effectsList: ['Ocean']} : state);
  const on = (patch: object) => ({on: {value: true}, brightness: {value: 40, max: 100, min: 0}, ...patch});
  const unnamed = {observed: {selection: '*Solid*', saved: false, restores: 'nothing'}, base: {kind: 'unnamed', selection: '*Solid*', brightness: 40}};
  for (const [why, state] of [
    ['an effect colour mode', on({colorMode: 'effect', hue: {value: 200, max: 360, min: 0}, sat: {value: 60, max: 100, min: 0}})],
    ['a temperature outside the light\'s bounds', on({colorMode: 'ct', ct: {value: 9000, max: 6500, min: 1200}})],
    ['a missing saturation', on({colorMode: 'hs', hue: {value: 200, max: 360, min: 0}})],
  ] as const) {
    assert.deepEqual(await readMusicBase(reads(state)), unnamed, why);
  }
});
