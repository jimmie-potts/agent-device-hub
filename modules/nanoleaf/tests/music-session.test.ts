// The live Music session's loop on its own store and a scripted device (#1272, design D4; #1598): the Start enters
// streaming, frames go as datagrams the light applies only while streaming, restoration rechecks for a newer choice
// around each write, a failed send ends the session without a retry, and the loop never overlaps two device requests.
// The same loop runs on the Lines (version 2) and on the NL22 Light Panels (version 1), each on its own device.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import type {CaptureFeatures} from '@jimmie-potts/event-contracts/v2/music-capture';
import {admitCommand, discovered, Refused, sceneList} from '../src/controls.js';
import {initialize} from '../src/database.js';
import {elementId, metaKey, type LayoutEntry} from '../src/devices.js';
import type {MusicRecipeV1} from '../src/music-effects.js';
import {expireQueued, held, initJournal, journalRow, type Outcome, type Transact} from '../src/journal.js';
import {restoreFreeBase} from '../src/moments.js';
import {colorStateOf, readMusicBase, restoreMusicBase, type ColorState, type MusicBase, type MusicColor} from '../src/music-base.js';
import {lastSelection, saveSelection, SELECTION_REFRESH_MS} from '../src/music-store.js';
import {HttpError} from '../src/transport.js';
import type {Indication} from '../src/line-projection.js';
import {MusicInput, type MusicClock} from '../src/music-input.js';
import {initReactivePresets, saveReactivePreset} from '../src/music-presets.js';
import {admitMusicStart, admitMusicStop, checkMusicStart, musicDeviceState, playMusic} from '../src/music-session.js';
import {transaction} from '../src/sqlite.js';
import type {LightRequest} from '../src/transport.js';
import {test} from './support.js';

const CAPTURE = {endpointId: 'music-mac', generation: '9df02246-518e-44f2-9412-a942735e63cd'};
const GENERATION = '00000000-0000-4000-8000-000000000001';
const LAYOUT: LayoutEntry = {kind: 'lines', elements: [0, 1, 2].map(index => ({id: elementId([2 * index + 1, 2 * index + 2]), number: index + 1,
  zones: [2 * index + 1, 2 * index + 2], position: [index, 0]}))};
/** A synthetic NL22 layout: four one-zone triangles in a strip, their panel IDs below 256 as the version 1 stream needs. */
const PANEL_IDS = [11, 37, 124, 211] as const;
const PANELS_LAYOUT: LayoutEntry = {kind: 'panels', elements: PANEL_IDS.map((id, index) => ({id: elementId([id]), number: index + 1, zones: [id],
  position: [Math.round(index * 86.6), 0]}))};
/** The light a session runs on: its device ID and its saved layout. */
type Target = {device: string; layout: LayoutEntry};
const LINES_TARGET: Target = {device: 'wall', layout: LAYOUT};
const PANELS_TARGET: Target = {device: 'nl22', layout: PANELS_LAYOUT};
/**
 * The selection each light reports while it streams, as each installed light showed: `*ExtControl*` on the Lines
 * (#1598), `*Dynamic*` on the NL22 (#1777), the same name the NL22 gives an unsaved dynamic effect.
 */
const streamingOf = (target: Target): string => target.layout.kind === 'panels' ? '*Dynamic*' : '*ExtControl*';
/** The documented version 1 entry answer: where to stream. Its address is never used. */
const V1_ANSWER = {streamControlIpAddr: '192.0.2.99', streamControlPort: 60221, streamControlProtocol: 'udp'};

type World = {
  db: DatabaseSync; outcomes: Outcome[]; writes: {endpoint: string; payload: unknown; atMs: number}[]; inFlight: number; maxInFlight: number;
  /** The light the session runs on. */
  target: Target;
  /** What the light answers a version 1 streaming entry with. */
  entryAnswer: unknown;
  /** Every frame datagram sent, with its port, whether the light applied it (streaming) or ignored it, and every read. */
  datagrams: {atMs: number; applied: boolean; packet: Buffer; port: number}[]; reads: {endpoint: string; atMs: number}[];
  /** The next datagram send fails, as a socket error. */
  failSend: boolean;
  /** Changes every later feature's measurements, as silence or a quiet passage would. */
  patch: Partial<CaptureFeatures>;
  now: number; selected: string; brightness: number; alert: boolean; feeding: boolean; sequence: number; input: MusicInput;
  /** Whether `/state` reports the light on: the app or the light's own switch can turn it off. */
  on: boolean;
  /** Whether the light is in external control: only its entry sets it, and any other choice clears it (#1777). */
  streaming: boolean;
  /** The plain colour `/state` reports, if one was chosen: a colour write selects `*Solid*` (#1614). */
  color: MusicColor | undefined;
  /** Answers the next `/state` read with this instead of the light's state, once. */
  stateAnswer: {value: unknown} | undefined;
  onWrite: (endpoint: string, payload: unknown) => void; lose: string | undefined; refuse: number | undefined;
  /** Runs while a read is in flight, before it is answered: what changes during the read. */
  onRead: (endpoint: string) => void;
  /** Runs as a request reaches the light, before it is served: what the light applied since its last answer. */
  onArrive: () => void;
};

function open(target: Target = LINES_TARGET): World {
  const db = new DatabaseSync(':memory:');
  initialize(db, () => 10);
  db.exec(`INSERT OR REPLACE INTO meta VALUES('mode','free');
    CREATE TABLE nanoleaf_devices(device TEXT PRIMARY KEY,configuration_revision INTEGER); INSERT INTO nanoleaf_devices VALUES('wall',0)`);
  if (target.device !== 'wall') {
    db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run(metaKey('mode', target.device), 'free');
    db.prepare('INSERT INTO nanoleaf_devices VALUES(?,0)').run(target.device);
  }
  initJournal(db); initReactivePresets(db);
  discovered(db, ['Ocean', 'New scene'], target.device, () => {});
  transaction(db, () => saveReactivePreset(db, {presetId: 'preset-green', expectedRevision: 0, name: 'Green',
    recipe: {rendererVersion: 1, effect: 'level-glow', palette: ['#12ab34'], intensity: 0.5, sensitivity: 1, smoothingMs: 0}}, 1));
  const now = 1_793_836_800_000;
  const clock: MusicClock = {wallMs: now, monotonicMs: now};
  return {db, outcomes: [], writes: [], inFlight: 0, maxInFlight: 0, target, entryAnswer: V1_ANSWER, datagrams: [], reads: [], failSend: false, patch: {}, now, selected: 'Ocean', streaming: false, brightness: 50, on: true, alert: false, feeding: true, sequence: 0,
    input: new MusicInput(CAPTURE, clock), onWrite: () => {}, lose: undefined, refuse: undefined, onRead: () => {}, onArrive: () => {}, color: undefined, stateAnswer: undefined};
}

const feature = (world: World): CaptureFeatures => {
  world.sequence += 1;
  const n = world.sequence;
  return {generation: CAPTURE.generation, input: 'music', sequence: n, sampleRateHz: 48000, channels: 2, frameCount: 4800,
    startMonotonicMs: 900000 + n * 100, endMonotonicMs: 900100 + n * 100, emittedMonotonicMs: 900102 + n * 100,
    observedAtMs: world.now, validUntilMs: world.now + 400, rms: 0.5, peak: 1, clippedFraction: 0,
    bands: {bass: 0.4, mid: 0.2, treble: 0.1}, onset: {strength: 0, confidence: 0}, discontinuity: false, ...world.patch} as CaptureFeatures;
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
async function run(world: World, step: (world: World) => void, base: MusicBase = OCEAN, presetId = 'preset-green'): Promise<void> {
  const {db, target} = world;
  const transact: Transact = action => Promise.resolve(transaction(db, () => action(message => { if (message.type === 'outcome') world.outcomes.push(message); })));
  transaction(db, () => admitMusicStart(db, target.device, {requestId: 'start', generation: GENERATION, capture: CAPTURE, presetId}, target.layout,
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
      const scripted = endpoint === '/state' ? world.stateAnswer : undefined;
      world.stateAnswer = undefined;
      if (scripted !== undefined) return scripted.value;
      const color = world.color === undefined ? {colorMode: 'effect'} : 'ct' in world.color ? {colorMode: 'ct', ct: {value: world.color.ct}}
        : {colorMode: 'hs', hue: {value: world.color.hue}, sat: {value: world.color.sat}};
      return endpoint === '/effects' ? {select: world.selected, effectsList: ['Ocean', 'New scene']} : {on: {value: world.on}, brightness: {value: world.brightness}, ...color};
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
    const body = payload as {select?: string; write?: {animType: string; extControlVersion?: string}; brightness?: {value: number}};
    if (endpoint === '/effects') {
      world.streaming = body.write?.animType === 'extControl';
      world.selected = body.select ?? (world.streaming ? streamingOf(world.target) : body.write?.animType === 'static' ? '*Static*' : '*Dynamic*');
    }
    if (body.brightness !== undefined) world.brightness = body.brightness.value;
    const colored = payload as {hue?: {value: number}; sat?: {value: number}; ct?: {value: number}};
    if (colored.ct !== undefined) world.color = {ct: colored.ct.value};
    else if (colored.hue !== undefined && colored.sat !== undefined) world.color = {hue: colored.hue.value, sat: colored.sat.value};
    if (colored.ct !== undefined || colored.hue !== undefined) {
      world.selected = '*Solid*';
      world.streaming = false;
    }
    world.onWrite(endpoint, payload);
    // A version 1 light answers its streaming entry with where to stream (Nanoleaf OpenAPI 5.7).
    return body.write?.extControlVersion === 'v1' ? world.entryAnswer : {};
  };
  // A datagram reaches the light behind any request already there, and only a streaming light applies it.
  const stream = async (packet: Uint8Array, port: number): Promise<void> => {
    world.inFlight += 1;
    world.maxInFlight = Math.max(world.maxInFlight, world.inFlight);
    world.onArrive();
    await Promise.resolve();
    world.inFlight -= 1;
    if (world.failSend) {
      world.failSend = false;
      throw Object.assign(new Error('the datagram was not sent'), {code: 'EHOSTUNREACH'});
    }
    // A choice in the app leaves streaming: a test that changes the selection, or clears `streaming`, stops the frames.
    world.datagrams.push({atMs: world.now, applied: world.streaming && world.selected === streamingOf(world.target), packet: Buffer.from(packet), port});
  };
  const row = journalRow(db, 'start');
  assert.ok(row);
  let fed = world.now - 100;
  await playMusic({db, device: target.device, row, config: {ip: 'synthetic', token: 'synthetic', line_groups: target.layout.elements.map(element => element.zones)},
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
  const session = musicDeviceState(world.db, world.target.device).session;
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
    assert.ok(frameWrites(world).every(frame => frame.port === 60222), 'the Lines stream on their fixed port');
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

// #1614 fix round 2: the colour base's entry read of `/state` failing or answering something that is not the captured colour.
test('a colour base whose entry state read fails ends the session as a device failure with no entry write', async () => {
  const world = open();
  try {
    world.selected = '*Solid*';
    world.color = {hue: 120, sat: 80};
    world.onRead = endpoint => { if (endpoint === '/state' && entries(world).length === 0) throw new Error('the read was not answered'); };
    await run(world, () => {}, COLOR);
    assert.deepEqual(ended(world), {reason: 'device', restoration: 'none', code: 'unavailable'});
    assert.deepEqual(world.reads.map(read => read.endpoint), ['/effects/select', '/state']);
    assert.equal(entries(world).length, 0, 'no streaming entry');
    assert.equal(world.writes.length, 0, 'nothing is written');
  } finally {
    world.db.close();
  }
});

for (const [why, answer] of [['an effect colour mode', {colorMode: 'effect'}], ['a partial colour', {colorMode: 'hs', hue: {value: 120}}],
  ['a malformed answer', 'not a state'], ['no answer body', null]] as const) {
  test(`a colour base whose entry state read gives ${why} ends the session as manual with no write`, async () => {
    const world = open();
    try {
      world.selected = '*Solid*';
      world.color = {hue: 120, sat: 80};
      world.stateAnswer = {value: answer};
      await run(world, () => {}, COLOR);
      assert.deepEqual(ended(world), {reason: 'manual', restoration: 'none'});
      assert.equal(entries(world).length, 0, 'no streaming entry');
      assert.equal(world.writes.length, 0, 'no colour or other write');
    } finally {
      world.db.close();
    }
  });
}

// #1272: live sessions on the original NL22 Light Panels through their own external-control protocol, version 1. The
// session machinery, its endings and its guards are the Lines'; only the entry, the port and the datagram differ.
/** A version 1 datagram's panels, after checking its one-byte count and each panel's frame count of 1, white 0 and 100 ms transition. */
function panelsOf(packet: Buffer): [number, [number, number, number]][] {
  const count = packet.readUInt8(0);
  assert.equal(packet.length, 1 + 7 * count, 'one count byte and seven bytes per panel');
  return Array.from({length: count}, (_, index): [number, [number, number, number]] => {
    const at = 1 + 7 * index;
    assert.deepEqual([packet.readUInt8(at + 1), packet.readUInt8(at + 5), packet.readUInt8(at + 6)], [1, 0, 1], 'one frame, white 0, 100 ms');
    return [packet.readUInt8(at), [packet.readUInt8(at + 2), packet.readUInt8(at + 3), packet.readUInt8(at + 4)]];
  });
}
/** A version 2 datagram's zones, after checking its two-byte count, white 0 and 100 ms transition. */
function zonesOf(packet: Buffer): [number, [number, number, number]][] {
  const count = packet.readUInt16BE(0);
  assert.equal(packet.length, 2 + 8 * count);
  return Array.from({length: count}, (_, index): [number, [number, number, number]] => {
    const at = 2 + 8 * index;
    assert.deepEqual([packet.readUInt8(at + 5), packet.readUInt16BE(at + 6)], [0, 1]);
    return [packet.readUInt16BE(at), [packet.readUInt8(at + 2), packet.readUInt8(at + 3), packet.readUInt8(at + 4)]];
  });
}
const ENTER_V1 = {write: {command: 'display', animType: 'extControl', extControlVersion: 'v1'}};
const stopNl22After = (frames: number) => (current: World): void => {
  if (frameWrites(current).length === frames && journalRow(current.db, 'stop') === undefined && current.outcomes.every(outcome => outcome.requestId !== 'stop')) {
    transaction(current.db, () => admitMusicStop(current.db, 'nl22', {kind: 'music.stop', requestId: 'stop', generation: GENERATION}, current.now, current.now + 5000));
  }
};

test('an NL22 Start enters version 1, streams one-byte panel datagrams to the port its answer names, and Stop restores its scene', async () => {
  const world = open(PANELS_TARGET);
  try {
    await run(world, stopNl22After(5));
    assert.deepEqual(entries(world).map(write => write.payload), [ENTER_V1], 'one version 1 entry, without logical panels');
    assert.deepEqual(world.outcomes.find(outcome => outcome.requestId === 'start'), {type: 'outcome', device: 'nl22', requestId: 'start', result: 'succeeded', evidence: 'transmitted'});
    const frames = frameWrites(world);
    assert.equal(frames.length, 5, 'no frame after the Stop');
    assert.ok(frames.every(frame => frame.applied && frame.port === 60221), 'every frame goes to the port the answer named');
    for (const frame of frames) assert.deepEqual(panelsOf(frame.packet).map(([id]) => id), [...PANEL_IDS], 'the saved layout\'s panel IDs, in order');
    for (let index = 1; index < frames.length; index += 1) assert.ok((frames[index]?.atMs ?? 0) - (frames[index - 1]?.atMs ?? 0) >= 100, 'no faster than 10 Hz');
    assert.deepEqual(ended(world), {reason: 'stopped', restoration: 'restored'});
    assert.deepEqual(world.writes.slice(-2).map(write => write.payload), [{brightness: {value: 50, duration: 0}}, {select: 'Ocean'}]);
    assert.deepEqual(world.outcomes.find(outcome => outcome.requestId === 'stop'), {type: 'outcome', device: 'nl22', requestId: 'stop', result: 'succeeded', evidence: 'transmitted'});
    assert.equal(musicDeviceState(world.db, 'wall').session, null, 'the Lines\' record is untouched');
    assert.equal(world.maxInFlight, 1, 'one device request or datagram at a time');
  } finally {
    world.db.close();
  }
});

for (const [why, answer] of [['no body', null], ['no port', {streamControlIpAddr: '192.0.2.99', streamControlProtocol: 'udp'}],
  ['a port out of range', {...V1_ANSWER, streamControlPort: 70000}], ['a well-known port', {...V1_ANSWER, streamControlPort: 53}],
  ['another protocol', {...V1_ANSWER, streamControlProtocol: 'tcp'}]] as const) {
  test(`an NL22 entry answer with ${why} fails the Start as transmitted, sends no frame and holds nothing`, async () => {
    const world = open(PANELS_TARGET);
    try {
      world.entryAnswer = answer;
      await run(world, () => {});
      assert.deepEqual(ended(world), {reason: 'device', restoration: 'none', code: 'unsupported-capability'});
      const start = world.outcomes.find(outcome => outcome.requestId === 'start');
      assert.deepEqual({result: start?.result, evidence: start?.evidence, code: start?.error?.code}, {result: 'failed', evidence: 'transmitted', code: 'unsupported-capability'});
      assert.equal(frameWrites(world).length, 0, 'nowhere to stream, so no frame');
      assert.deepEqual(sequence(world), ['stream'], 'no write after the entry');
      assert.equal(held(world.db, 0, 'nl22'), false, 'an answered entry holds nothing');
    } finally {
      world.db.close();
    }
  });
}

test('a lost answer to the NL22 entry ends the Start uncertain, holds the Panels only and sends no frame', async () => {
  const world = open(PANELS_TARGET);
  try {
    world.lose = '/effects';
    await run(world, () => {});
    assert.equal(ended(world)?.reason, 'device');
    assert.equal(entries(world).length, 1, 'the entry is not retried');
    assert.equal(frameWrites(world).length, 0);
    assert.equal(world.outcomes.find(outcome => outcome.requestId === 'start')?.result, 'uncertain');
    assert.equal(held(world.db, 0, 'nl22'), true);
    assert.equal(held(world.db, 0, 'wall'), false, 'the Lines are not held');
  } finally {
    world.db.close();
  }
});

test('a scene chosen in the app on the NL22 ends the session as manual: nothing paints over it and nothing is restored', async () => {
  const world = open(PANELS_TARGET);
  try {
    let pickedAt: number | undefined;
    await run(world, current => {
      if (pickedAt === undefined && frameWrites(current).length === 3) { pickedAt = current.now; current.selected = 'New scene'; }
    });
    assert.ok(pickedAt !== undefined);
    assert.deepEqual(ended(world), {reason: 'manual', restoration: 'none'});
    assert.equal(world.selected, 'New scene');
    assert.equal(frameWrites(world).filter(frame => frame.atMs >= (pickedAt ?? 0) && frame.applied).length, 0);
    assert.deepEqual(sequence(world), ['stream'], 'no restoration write over the newer choice');
  } finally {
    world.db.close();
  }
});

for (const choice of ['none', 'brightness'] as const) {
  for (const ending of ['alert', 'source-lost'] as const) {
    test(`${ending === 'alert' ? 'an alert' : 'source loss'} on the NL22 restores its scene ${choice === 'none' ? 'after its brightness' : 'unless a newer brightness choice lands between the writes'}`, async () => {
      const world = open(PANELS_TARGET);
      try {
        world.onWrite = endpoint => {
          if (endpoint !== '/state' || choice === 'none') return;
          // A brightness command for the Panels, journaled as their admission would (the registry is not part of this store).
          world.db.prepare("INSERT INTO control_journal(id,device,kind,command,mode_revision,phase,accepted,expires) VALUES('owner','nl22','brightness.set',?,0,'queued',1,99999999999)")
            .run(JSON.stringify({kind: 'brightness.set', percent: 10}));
        };
        await run(world, current => {
          if (frameWrites(current).length < 3) return;
          if (ending === 'alert') current.alert = true;
          else current.feeding = false;
        });
        assert.deepEqual(ended(world), {reason: ending, restoration: choice === 'none' ? 'restored' : 'skipped'});
        assert.deepEqual(sequence(world), choice === 'none' ? ['stream', 'brightness 50', 'select Ocean'] : ['stream', 'brightness 50']);
      } finally {
        world.db.close();
      }
    });
  }
}

test('an NL22 session over a selection nothing can select again leaves the last frame with restoration none', async () => {
  const world = open(PANELS_TARGET);
  try {
    world.selected = '*Dynamic*';
    await run(world, stopNl22After(3), {kind: 'unnamed', selection: '*Dynamic*', brightness: 50});
    assert.deepEqual(ended(world), {reason: 'stopped', restoration: 'none'});
    assert.deepEqual(sequence(world), ['stream']);
    assert.ok(frameWrites(world).length === 3 && frameWrites(world).every(frame => frame.applied));
    assert.equal(world.selected, '*Dynamic*', 'the NL22 keeps the last frame, still reporting *Dynamic*');
  } finally {
    world.db.close();
  }
});

test('a failed NL22 datagram send ends the session as a device failure with no retry or restoration', async () => {
  const world = open(PANELS_TARGET);
  try {
    await run(world, current => { if (frameWrites(current).length === 2) current.failSend = true; });
    assert.deepEqual(ended(world), {reason: 'device', restoration: 'none', code: 'unavailable'});
    assert.equal(frameWrites(world).length, 2);
    assert.deepEqual(sequence(world), ['stream']);
  } finally {
    world.db.close();
  }
});

test('an NL22 that refuses the version 1 entry ends the session with the answer\'s code: no frame, no retry and no hold', async () => {
  const world = open(PANELS_TARGET);
  try {
    world.refuse = 400;
    await run(world, () => {});
    assert.deepEqual(ended(world), {reason: 'device', restoration: 'none', code: 'invalid-request'});
    const start = world.outcomes.find(outcome => outcome.requestId === 'start');
    assert.deepEqual({result: start?.result, evidence: start?.evidence, code: start?.error?.code}, {result: 'failed', evidence: 'transmitted', code: 'invalid-request'});
    assert.equal(world.writes.length, 0, 'the refused entry is not retried and nothing else is written');
    assert.equal(frameWrites(world).length, 0);
    assert.equal(held(world.db, 0, 'nl22'), false);
  } finally {
    world.db.close();
  }
});

for (const change of ['brightness', 'power off', 'colour', 'static selection'] as const) {
  test(`a ${change} made in the app during an NL22 session ends it as manual at the next check, with no datagram after and no restoration`, async () => {
    const world = open(PANELS_TARGET);
    try {
      let changedAt: number | undefined;
      await run(world, current => {
        if (changedAt !== undefined || frameWrites(current).length !== 3) return;
        changedAt = current.now;
        if (change === 'brightness') current.brightness = 20;
        else if (change === 'power off') current.on = false;
        else {
          // A colour or an unsaved static selection leaves streaming, and the selection shows it (#1777).
          current.streaming = false;
          current.selected = change === 'colour' ? '*Solid*' : '*Static*';
          if (change === 'colour') current.color = {hue: 10, sat: 90};
        }
      });
      assert.ok(changedAt !== undefined);
      const session = musicDeviceState(world.db, 'nl22').session;
      assert.ok(session?.status === 'ended');
      assert.deepEqual({reason: session.ended.reason, restoration: session.ended.restoration}, {reason: 'manual', restoration: 'none'});
      assert.ok(session.ended.atMs - changedAt <= 1100, 'the once-per-second check ends it');
      assert.equal(frameWrites(world).filter(frame => frame.atMs > session.ended.atMs).length, 0, 'no datagram after the ending');
      if (change === 'colour' || change === 'static selection') {
        assert.equal(frameWrites(world).filter(frame => frame.atMs > (changedAt ?? 0) && frame.applied).length, 0, 'no frame paints over it');
        assert.equal(world.selected, change === 'colour' ? '*Solid*' : '*Static*', 'the app\'s choice stays');
      }
      assert.deepEqual(sequence(world), ['stream'], 'no restoration write over the newer choice');
      assert.deepEqual({brightness: world.brightness, on: world.on}, {brightness: change === 'brightness' ? 20 : 50, on: change !== 'power off'});
    } finally {
      world.db.close();
    }
  });
}

test('silence keeps an NL22 session playing with dark frames, and stale input ends it as source loss', async () => {
  const world = open(PANELS_TARGET);
  try {
    world.patch = {rms: 0, peak: 0, bands: {bass: 0, mid: 0, treble: 0}};
    await run(world, current => { if (frameWrites(current).length >= 6) current.feeding = false; });
    const frames = frameWrites(world);
    assert.ok(frames.length >= 6 && frames.every(frame => frame.applied));
    assert.ok(frames.every(frame => panelsOf(frame.packet).every(([, color]) => color.every(value => value === 0))), 'silence renders dark, not stopped');
    assert.deepEqual(ended(world), {reason: 'source-lost', restoration: 'restored'});
  } finally {
    world.db.close();
  }
});

test('a layout the NL22\'s version 1 stream cannot address is refused before any device request; the Lines\' version 2 addresses it', () => {
  const world = open(PANELS_TARGET);
  try {
    const start = {requestId: 'start', generation: GENERATION, capture: CAPTURE, presetId: 'preset-green'};
    const wide: LayoutEntry = {kind: 'panels', elements: [11, 300].map((id, index) => ({id: elementId([id]), number: index + 1, zones: [id], position: [index * 86.6, 0]}))};
    const many: LayoutEntry = {kind: 'panels', elements: Array.from({length: 256}, (_, index) => ({id: elementId([index]), number: index + 1, zones: [index], position: [index, 0]}))};
    for (const layout of [wide, many]) {
      assert.throws(() => checkMusicStart(world.db, 'nl22', start, layout, world.now, world.now + 5000),
        (error: unknown) => error instanceof Refused && error.code === 'unsupported-capability');
    }
    assert.equal(checkMusicStart(world.db, 'nl22', start, PANELS_LAYOUT, world.now, world.now + 5000).layout.kind, 'panels');
    const lines: LayoutEntry = {kind: 'lines', elements: [{id: elementId([299, 300]), number: 1, zones: [299, 300], position: [0, 0]}]};
    assert.deepEqual(checkMusicStart(world.db, 'wall', start, lines, world.now, world.now + 5000).layout.elements.map(element => element.zones), [[299, 300]],
      'the Lines address two-byte zone IDs');
    assert.equal(world.writes.length + world.reads.length + world.datagrams.length, 0, 'no device request');
  } finally {
    world.db.close();
  }
});

// The five effect families from saved reactive presets, admitted and streamed on both lights (AC1). Each family's frames
// carry the saved layout's zones; uniform families light every element alike and spatial families vary across them.
const FAMILIES: readonly {recipe: MusicRecipeV1; uniform: boolean}[] = [
  {recipe: {rendererVersion: 1, effect: 'level-glow', palette: ['#12ab34'], intensity: 0.5, sensitivity: 1, smoothingMs: 0}, uniform: true},
  {recipe: {rendererVersion: 1, effect: 'bass-pulse', palette: ['#ff2200'], intensity: 1, sensitivity: 1, smoothingMs: 0, halfLifeMs: 200}, uniform: true},
  {recipe: {rendererVersion: 1, effect: 'spectrum', palette: ['#ff0000', '#00ff00', '#0000ff'], intensity: 1, sensitivity: 1, smoothingMs: 0, direction: 'right'}, uniform: false},
  {recipe: {rendererVersion: 1, effect: 'traveling-wave', palette: ['#3355ff'], intensity: 1, sensitivity: 1, smoothingMs: 0, direction: 'right', periodMs: 2000}, uniform: false},
  {recipe: {rendererVersion: 1, effect: 'ambient', palette: ['#ff8800', '#0088ff'], intensity: 1, sensitivity: 1, smoothingMs: 1500}, uniform: true},
];
for (const target of [LINES_TARGET, PANELS_TARGET]) {
  for (const {recipe, uniform} of FAMILIES) {
    test(`a saved ${recipe.effect} preset plays live on the ${target.layout.kind === 'lines' ? 'Lines' : 'NL22'} over every zone of its layout`, async () => {
      const world = open(target);
      try {
        const presetId = `preset-${recipe.effect}`;
        transaction(world.db, () => saveReactivePreset(world.db, {presetId, expectedRevision: 1, name: recipe.effect, recipe}, 2));
        await run(world, current => { if (frameWrites(current).length >= 6) current.feeding = false; }, OCEAN, presetId);
        const frames = frameWrites(world);
        assert.equal(entries(world).length, 1);
        assert.ok(frames.length >= 6 && frames.every(frame => frame.applied), `${frames.length} frames`);
        const decoded = frames.map(frame => target.layout.kind === 'panels' ? panelsOf(frame.packet) : zonesOf(frame.packet));
        const ids = target.layout.elements.flatMap(element => element.zones);
        for (const zones of decoded) assert.deepEqual(zones.map(([id]) => id), ids);
        // Each element's zones share its colour: a Line's two zones, a triangle's one.
        const colours = decoded.map(zones => target.layout.elements.map(element => {
          const shades = new Set(element.zones.map(id => JSON.stringify(zones.find(([zone]) => zone === id)?.[1])));
          assert.equal(shades.size, 1);
          return [...shades][0];
        }));
        assert.ok(colours.some(frame => frame.some(colour => colour !== JSON.stringify([0, 0, 0]))), 'the music lights the zones');
        assert.equal(colours.every(frame => new Set(frame).size === 1), uniform, uniform ? 'every element alike' : 'elements differ across the layout');
        assert.deepEqual(ended(world), {reason: 'source-lost', restoration: 'restored'});
      } finally {
        world.db.close();
      }
    });
  }
}

// #1777: the installed NL22 reports `*Dynamic*` while it streams version 1, not `*ExtControl*` as the Lines do. A Panels
// session keeps playing on that selection; a scene, colour or static selection picked in the app still ends it
// `manual`. An unsaved dynamic effect picked in the app reads exactly as streaming does, so it is not seen.
test('an NL22 session keeps playing past several once-a-second checks while the Panels report *Dynamic*', async () => {
  const world = open(PANELS_TARGET);
  try {
    let startedAt: number | undefined;
    await run(world, current => {
      startedAt ??= frameWrites(current).length > 0 ? current.now : undefined;
      stopNl22After(45)(current);
    });
    assert.ok(startedAt !== undefined);
    assert.deepEqual(ended(world), {reason: 'stopped', restoration: 'restored'});
    const frames = frameWrites(world);
    assert.equal(frames.length, 45, 'every frame until the Stop, none after');
    assert.ok(frames.every(frame => frame.applied && frame.port === 60221), 'the Panels apply every frame');
    const checks = world.reads.filter(read => read.endpoint === '/effects' && read.atMs >= (startedAt ?? 0) && read.atMs < (frames.at(-1)?.atMs ?? 0));
    assert.ok(checks.length >= 3, `${checks.length} once-a-second checks passed`);
    const kept = lastSelection(world.db, 'nl22');
    assert.deepEqual(kept === undefined ? undefined : {selection: kept.selection, saved: kept.saved, restores: kept.restores},
      {selection: '*Dynamic*', saved: false, restores: 'nothing'}, 'the record keeps what the Panels report while streaming');
    assert.deepEqual(world.writes.slice(-2).map(write => write.payload), [{brightness: {value: 50, duration: 0}}, {select: 'Ocean'}]);
    assert.equal(world.selected, 'Ocean');
    assert.equal(world.maxInFlight, 1);
  } finally {
    world.db.close();
  }
});

for (const base of [OCEAN, COLOR]) {
  for (const ending of ['stopped', 'alert', 'source-lost'] as const) {
    test(`${ending === 'stopped' ? 'Stop' : ending === 'alert' ? 'an alert' : 'source loss'} after several checks puts an NL22 ${base.kind === 'scene' ? 'scene' : 'colour'} base back over *Dynamic*`, async () => {
      const world = open(PANELS_TARGET);
      try {
        if (base.kind === 'color') {
          world.selected = '*Solid*';
          world.color = {hue: 120, sat: 80};
        }
        await run(world, current => {
          if (ending === 'stopped') stopNl22After(25)(current);
          else if (frameWrites(current).length >= 25) {
            if (ending === 'alert') current.alert = true;
            else current.feeding = false;
          }
        }, base);
        assert.deepEqual(ended(world), {reason: ending, restoration: 'restored'});
        assert.ok(frameWrites(world).length >= 25 && frameWrites(world).every(frame => frame.applied));
        assert.deepEqual(world.writes.slice(-2).map(write => write.payload),
          [{brightness: {value: 50, duration: 0}}, base.kind === 'scene' ? {select: 'Ocean'} : {hue: {value: 120}, sat: {value: 80}}]);
        assert.equal(world.selected, base.kind === 'scene' ? 'Ocean' : '*Solid*');
        if (ending === 'stopped') {
          assert.deepEqual(world.outcomes.find(outcome => outcome.requestId === 'stop'),
            {type: 'outcome', device: 'nl22', requestId: 'stop', result: 'succeeded', evidence: 'transmitted'});
        }
      } finally {
        world.db.close();
      }
    });
  }
}

test('a scene picked in the app during an NL22 colour-base session ends it as manual with no colour write', async () => {
  const world = open(PANELS_TARGET);
  try {
    world.selected = '*Solid*';
    world.color = {hue: 120, sat: 80};
    let pickedAt: number | undefined;
    await run(world, current => {
      if (pickedAt === undefined && frameWrites(current).length === 12) {
        pickedAt = current.now;
        current.streaming = false;
        current.selected = 'New scene';
      }
    }, COLOR);
    assert.ok(pickedAt !== undefined);
    assert.deepEqual(ended(world), {reason: 'manual', restoration: 'none'});
    assert.deepEqual(sequence(world), ['stream'], 'nothing is written over the app\'s scene');
    assert.equal(world.selected, 'New scene');
    assert.equal(frameWrites(world).filter(frame => frame.atMs >= (pickedAt ?? 0) && frame.applied).length, 0);
  } finally {
    world.db.close();
  }
});

test('#1777 limit: an unsaved dynamic effect picked in the app during an NL22 session is not seen, and Stop puts the base back over it', async () => {
  // The Panels report `*Dynamic*` both while they stream and for an unsaved dynamic effect, and no documented read tells
  // them apart. The session plays on: its datagrams reach a light that left streaming and are ignored, and the Stop's
  // guarded restoration finds `*Dynamic*`, an unchanged brightness and the power on, so it writes the base.
  const world = open(PANELS_TARGET);
  try {
    let pickedAt: number | undefined;
    await run(world, current => {
      if (pickedAt === undefined && frameWrites(current).length === 12) {
        pickedAt = current.now;
        current.streaming = false;
        current.selected = '*Dynamic*';
      }
      stopNl22After(30)(current);
    });
    assert.ok(pickedAt !== undefined);
    assert.deepEqual(ended(world), {reason: 'stopped', restoration: 'restored'}, 'the pick is not recognised as a manual change');
    const after = frameWrites(world).filter(frame => frame.atMs >= (pickedAt ?? 0));
    assert.ok(after.length >= 10 && after.every(frame => !frame.applied), 'frames go on, and a light that left streaming ignores them');
    assert.deepEqual(sequence(world), ['stream', 'brightness 50', 'select Ocean'], 'the Stop restores the base over the app\'s effect');
  } finally {
    world.db.close();
  }
});

test('on the Lines, *Dynamic* is still a manual change: an effect picked in the app ends the session with no write (#1777)', async () => {
  const world = open();
  try {
    let pickedAt: number | undefined;
    await run(world, current => {
      if (pickedAt === undefined && frameWrites(current).length === 12) {
        pickedAt = current.now;
        current.streaming = false;
        current.selected = '*Dynamic*';
      }
    });
    assert.ok(pickedAt !== undefined);
    assert.deepEqual(ended(world), {reason: 'manual', restoration: 'none'});
    const session = musicDeviceState(world.db, 'wall').session;
    assert.ok(session?.status === 'ended' && session.ended.atMs - pickedAt <= 1100, 'the once-per-second check ends it');
    assert.deepEqual(sequence(world), ['stream'], 'nothing is written over the app\'s effect');
    assert.equal(world.selected, '*Dynamic*');
  } finally {
    world.db.close();
  }
});

test('the NL22 restoration guard writes only while the Panels report *Dynamic*, an unchanged brightness and the power on', async () => {
  const on = {on: {value: true}, brightness: {value: 50}};
  const cases: readonly [string, string, object, boolean][] = [
    ['streaming', '*Dynamic*', on, true],
    ['the Lines\' streaming selection', '*ExtControl*', on, false],
    ['a scene', 'Ocean', on, false],
    ['a colour', '*Solid*', on, false],
    ['a static selection', '*Static*', on, false],
    ['a changed brightness', '*Dynamic*', {on: {value: true}, brightness: {value: 30}}, false],
    ['the power off', '*Dynamic*', {on: {value: false}, brightness: {value: 50}}, false],
  ];
  const bases: readonly Exclude<MusicBase, {kind: 'unnamed'}>[] = [{kind: 'scene', name: 'Ocean', brightness: 50},
    {kind: 'color', selection: '*Solid*', color: {hue: 120, sat: 80}, brightness: 50}];
  for (const [why, select, state, restores] of cases) {
    for (const base of bases) {
      const writes: string[] = [];
      const read = (endpoint: string): Promise<unknown> => Promise.resolve(endpoint === '/effects' ? {select, effectsList: ['Ocean']} : state);
      const done = await restoreMusicBase(read, base, '*Dynamic*', () => false, endpoint => { writes.push(endpoint); return Promise.resolve({}); });
      assert.equal(done, restores, `${why}, ${base.kind}`);
      assert.equal(writes.length, restores ? 2 : 0, `${why}, ${base.kind}`);
    }
  }
});

test('a Start over the stream an earlier NL22 session left reads it as an unnamed *Dynamic* base with nothing to restore', async () => {
  const read = (endpoint: string): Promise<unknown> => Promise.resolve(endpoint === '/effects'
    ? {select: '*Dynamic*', effectsList: ['Ocean']} : {on: {value: true}, brightness: {value: 50}, colorMode: 'effect'});
  assert.deepEqual(await readMusicBase(read),
    {observed: {selection: '*Dynamic*', saved: false, restores: 'nothing'}, base: {kind: 'unnamed', selection: '*Dynamic*', brightness: 50}});
  const world = open(PANELS_TARGET);
  try {
    world.selected = '*Dynamic*';
    await run(world, current => { if (frameWrites(current).length >= 15) current.alert = true; }, {kind: 'unnamed', selection: '*Dynamic*', brightness: 50});
    assert.deepEqual(ended(world), {reason: 'alert', restoration: 'none'});
    assert.ok(frameWrites(world).length >= 15 && frameWrites(world).every(frame => frame.applied), 'the session plays past its checks on the leftover selection');
    assert.deepEqual(sequence(world), ['stream'], 'no scene is guessed and nothing is written after the frames');
  } finally {
    world.db.close();
  }
});

// #1777 limit on the shared ending paths: anything that leaves the NL22 reporting `*Dynamic*` with brightness and power
// unchanged is not seen, and every guarded restoration puts a scene or colour base back over it.
for (const [base, ending] of [[COLOR, 'stopped'], [OCEAN, 'alert'], [OCEAN, 'source-lost']] as const) {
  test(`#1777 limit: an unseen *Dynamic* choice on the NL22 over a ${base.kind === 'color' ? 'colour' : 'scene'} base is restored over by ${ending === 'stopped' ? 'Stop' : ending === 'alert' ? 'an alert' : 'source loss'}`, async () => {
    const world = open(PANELS_TARGET);
    try {
      if (base.kind === 'color') {
        world.selected = '*Solid*';
        world.color = {hue: 120, sat: 80};
      }
      let pickedAt: number | undefined;
      await run(world, current => {
        if (pickedAt === undefined && frameWrites(current).length === 12) {
          pickedAt = current.now;
          current.streaming = false;
          current.selected = '*Dynamic*';
        }
        if (ending === 'stopped') stopNl22After(30)(current);
        else if (frameWrites(current).length >= 30) {
          if (ending === 'alert') current.alert = true;
          else current.feeding = false;
        }
      }, base);
      assert.ok(pickedAt !== undefined);
      assert.deepEqual(ended(world), {reason: ending, restoration: 'restored'}, 'the choice is not recognised as a manual change');
      assert.ok(frameWrites(world).filter(frame => frame.atMs >= (pickedAt ?? 0)).every(frame => !frame.applied));
      assert.deepEqual(world.writes.slice(-2).map(write => write.payload),
        [{brightness: {value: 50, duration: 0}}, base.kind === 'scene' ? {select: 'Ocean'} : {hue: {value: 120}, sat: {value: 80}}],
        'the guarded restoration writes the base over the unseen choice');
    } finally {
      world.db.close();
    }
  });
}

// #1777 diagnostic: what the playing check's own `/state` read showed of the light's colour is kept with the selection
// for the record. It never decides an ending: whether it tells the NL22's stream from an app choice is unknown.
test('#1777 diagnostic: the light\'s colour state from a /state read is kept with what it reports, bounded and in its own mode', () => {
  assert.deepEqual(colorStateOf({colorMode: 'hs', hue: {value: 10, max: 360, min: 0}, sat: {value: 20}, ct: {value: 4000}}),
    {colorMode: 'hs', hue: 10, sat: 20, ct: 4000});
  assert.deepEqual(colorStateOf({colorMode: 'effect'}), {colorMode: 'effect'});
  assert.deepEqual(colorStateOf({hue: {value: 10}}), {colorMode: null, hue: 10}, 'no colour mode reads as null');
  assert.deepEqual(colorStateOf({colorMode: 'not a mode!', hue: {value: 400}, sat: {value: 20.5}, ct: {value: -1}}), {colorMode: null},
    'an unexpected mode is null, and values out of range or not whole are left out');
  assert.deepEqual(colorStateOf('not a state'), {colorMode: null});
});

test('#1777 diagnostic: a kept selection carries the colour state read with it, a changed one is kept at once, and a read without one keeps none', () => {
  const world = open();
  try {
    const reported: string[] = [];
    const save = (color: ColorState | undefined, atMs: number): void => transaction(world.db, () => saveSelection(world.db, 'wall',
      {selection: '*Dynamic*', saved: false, restores: 'nothing'}, atMs, message => { reported.push(message.type); }, color));
    save({colorMode: 'effect', hue: 0, sat: 0, ct: 4000}, 1000);
    assert.deepEqual(lastSelection(world.db, 'wall')?.color, {colorMode: 'effect', hue: 0, sat: 0, ct: 4000});
    save({colorMode: 'effect', hue: 0, sat: 0, ct: 4000}, 2000);
    assert.equal(lastSelection(world.db, 'wall')?.readAtMs, 1000, 'an unchanged read keeps its time for a minute');
    save({colorMode: 'hs', hue: 10, sat: 20}, 3000);
    assert.deepEqual(lastSelection(world.db, 'wall')?.color, {colorMode: 'hs', hue: 10, sat: 20});
    save({colorMode: null}, 3500);
    assert.deepEqual(lastSelection(world.db, 'wall')?.color, {colorMode: null});
    save(undefined, 4000);
    assert.equal(lastSelection(world.db, 'wall')?.color, undefined, 'a selection read with no /state read keeps no colour state');
    assert.equal(lastSelection(world.db, 'wall')?.readAtMs, 4000);
    assert.deepEqual(reported, ['selection', 'selection', 'selection', 'selection']);
  } finally {
    world.db.close();
  }
});

test('#1777 diagnostic: an NL22 session keeps its playing check\'s colour state with no request of its own, and the colour state decides nothing', async () => {
  const runs: unknown[] = [];
  for (const variant of ['effect', 'hs'] as const) {
    const world = open(PANELS_TARGET);
    try {
      await run(world, current => {
        // The Panels keep streaming and reporting `*Dynamic*`; only what `/state` says of their colour differs.
        if (variant === 'hs' && frameWrites(current).length === 3) current.color = {hue: 10, sat: 20};
        stopNl22After(30)(current);
      });
      assert.deepEqual(lastSelection(world.db, 'nl22')?.color, variant === 'hs' ? {colorMode: 'hs', hue: 10, sat: 20} : {colorMode: 'effect'});
      runs.push({ended: ended(world), writes: sequence(world), frames: frameWrites(world).map(frame => [frame.atMs, frame.applied]),
        reads: world.reads.map(read => [read.endpoint, read.atMs])});
    } finally {
      world.db.close();
    }
  }
  assert.deepEqual(runs[1], runs[0], 'the same ending, writes, frames and reads, at the same times');
  assert.deepEqual((runs[0] as {ended: unknown}).ended, {reason: 'stopped', restoration: 'restored'});
});
