// The Codex Desktop module (Hub #926) on a simulated marker and a stand-in core: the old Hub's read rules
// (apps/hub/tests/codex-desktop.test.mjs at main 8590332f) as published observations, policy A for the marker's folder,
// and what leaves the module. The real core's reduction of the evidence is apps/runtime/tests/codex-desktop.test.ts.
import assert from 'node:assert/strict';
import type {LifecycleObservation} from '@jimmie-potts/event-contracts/v2/families';
import {
  MARKER_DEVICE, POLL_MS, READ_TIMEOUT_MS, RESEND_FIRST_MS, RESEND_MAX_MS, SimulatedMarker, createCodexDesktopModule, type MarkerRead, type MarkerTransport,
} from '../src/index.js';
import {SECTION, START_MS, World, identityOf, it} from './support.js';

it('the marker gives read evidence for the configured producer\'s top-level Desktop sessions only', async () => {
  const world = await World.open();
  try {
    await world.session('one');
    await world.session('child', {parent: {status: 'known', identity: identityOf('one')}});
    await world.session('other', {sourceId: 'other'});
    await world.session('cli', {client: 'cli'});
    await world.session('host-2', {hostId: 'host-2'});
    await world.session('claude', {provider: 'claude', client: 'code'});
    world.marker.list(['one', 'child', 'other', 'cli', 'host-2', 'claude']);
    await world.clock.advance(POLL_MS);
    assert.deepEqual(world.evidence(), ['one unread']);
    assert.equal(world.record('one')?.read, 'unread');
    assert.ok(['child', 'other', 'cli', 'host-2', 'claude'].every(name => [...world.sessions.values()].find(record => record.identity.sessionId === name)?.read === 'unknown'));
    // Nothing more while the marker and the records stay as they are.
    await world.clock.advance(10_000);
    assert.deepEqual(world.evidence(), ['one unread']);
    world.marker.list([]);
    await world.clock.advance(POLL_MS);
    assert.deepEqual(world.evidence(), ['one unread', 'one read']);
    world.marker.list(['one']);
    await world.clock.advance(POLL_MS);
    assert.deepEqual(world.evidence(), ['one unread', 'one read', 'one unread']);
    await world.clock.advance(10_000);
    assert.equal(world.evidence().length, 3);
    // Each observation is the old Hub's read event, from the module, for the session's own entity.
    const observed = world.published.filter(message => message.type === 'org.bunny.lifecycle.observed');
    for (const message of observed) {
      const data = message.data as unknown as LifecycleObservation;
      assert.equal(message.source, 'bunny/modules/codex-desktop');
      assert.equal(message.subject, world.record('one')?.id);
      assert.deepEqual({parent: data.parent, ordering: data.ordering, turn: data.turn}, {parent: {status: 'unknown'}, ordering: {status: 'unknown'}, turn: {status: 'known', id: 'turn-1'}});
    }
    assert.deepEqual(world.invalid, []);
  } finally {
    await world.close();
  }
});

it('an unlisted finished session becomes read only once the flag has had time to appear, and a running one never does', async () => {
  const world = await World.open();
  try {
    world.marker.list([]);
    await world.session('viewed');
    await world.session('interrupted', {activity: 'interrupted'});
    await world.session('running', {activity: 'active'});
    // Polls at 0, 2 and 4 s: the flag has not had five seconds yet.
    await world.clock.advance(4999);
    assert.deepEqual(world.evidence(), []);
    await world.clock.advance(1001);
    assert.deepEqual(world.evidence(), ['viewed read', 'interrupted read']);
    await world.clock.advance(600_000);
    assert.deepEqual(world.evidence(), ['viewed read', 'interrupted read']);
    assert.equal(world.record('running')?.read, 'unknown');
  } finally {
    await world.close();
  }
});

it('a missing, malformed or changed-format marker gives no evidence, and each change of it is logged once', async () => {
  const world = await World.open();
  try {
    await world.session('one');
    world.marker.list(['one']);
    await world.clock.advance(POLL_MS);
    assert.deepEqual(world.evidence(), ['one unread']);
    world.marker.unusable();
    // A second session would now read as read, and the first as read once unlisted; an unusable marker says neither.
    await world.session('two');
    await world.clock.advance(60_000);
    assert.deepEqual(world.evidence(), ['one unread']);
    world.marker.list([]);
    await world.clock.advance(POLL_MS);
    assert.deepEqual(world.evidence().sort(), ['one read', 'one unread', 'two read']);
    const changes = world.logs('operation.failed').concat(world.logs('operation.completed')).filter(entry => entry.fields['bunny.operation'] === 'lifecycle');
    assert.deepEqual(changes.map(entry => [entry.level, entry.event, entry.fields['bunny.outcome']]), [['warn', 'operation.failed', 'unavailable'], ['info', 'operation.completed', 'current']]);
  } finally {
    await world.close();
  }
});

/** When each read observation went out, in seconds after the world's start. */
const sentAt = (world: World): number[] => world.published.filter(message => message.type === 'org.bunny.lifecycle.observed').map(message => (Date.parse(message.time) - START_MS) / 1000);

it('evidence the core refuses goes out again on a later poll, and once the core takes it, no more', async () => {
  const world = await World.open();
  try {
    await world.session('one');
    world.refuseNext(1);
    world.marker.list(['one']);
    await world.clock.advance(POLL_MS);
    assert.deepEqual(world.evidence(), ['one unread']);
    assert.equal(world.record('one')?.read, 'unknown', 'the core refused it');
    // It went out with the first read, at 0 s. The record has not changed, so the first poll 4 s after that sends it
    // again, and the core takes it.
    await world.clock.advance(RESEND_FIRST_MS - POLL_MS - 1);
    assert.deepEqual(world.evidence(), ['one unread']);
    await world.clock.advance(1);
    assert.deepEqual(sentAt(world), [0, 4]);
    assert.equal(world.record('one')?.read, 'unread');
    await world.clock.advance(600_000);
    assert.deepEqual(world.evidence(), ['one unread', 'one unread'], 'nothing more once the record agrees');
  } finally {
    await world.close();
  }
});

it('evidence the core never takes goes out again after a doubling wait, at most a minute apart, and at once for a new revision', async () => {
  const world = await World.open({reduce: false});
  try {
    await world.session('one');
    world.marker.list(['one']);
    await world.clock.advance(122_000);
    // Polls come every 2 s from 0 s: sent with the first read, then 4, 8, 16, 32 and 60 s later.
    assert.deepEqual(sentAt(world), [0, 4, 12, 28, 60, 120]);
    assert.equal(RESEND_MAX_MS, 60_000);
    // A new revision of the record is new evidence: it goes out at the next poll, and the wait starts again.
    await world.session('one');
    await world.clock.advance(POLL_MS + RESEND_FIRST_MS);
    assert.deepEqual(sentAt(world).slice(6), [124, 128]);
    assert.ok(world.evidence().every(entry => entry === 'one unread'));
  } finally {
    await world.close();
  }
});

it('a folder that stalls: start never waits, the marker is unavailable once, nothing comes from an older read, and it recovers', async () => {
  const world = await World.open();
  try {
    await world.session('one');
    await world.session('two');
    world.marker.list(['one']);
    await world.clock.advance(POLL_MS);
    assert.deepEqual(world.evidence(), ['one unread']);
    // The folder stalls with the marker changed: the second session finished long enough ago to read as read.
    world.marker.stall();
    world.marker.list([]);
    await world.clock.advance(POLL_MS + READ_TIMEOUT_MS);
    assert.deepEqual(world.evidence(), ['one unread']);
    const warnings = (): unknown[] => world.logs('device.unavailable').filter(entry => entry.level === 'warn');
    assert.equal(warnings().length, 1);
    assert.equal(world.logs('device.unavailable')[0]?.fields['bunny.device.id'], MARKER_DEVICE);
    // A minute of stall: still one warning, one read waiting, and nothing published from what the module read before.
    await world.clock.advance(60_000);
    assert.equal(warnings().length, 1);
    assert.equal(world.marker.state().waiting, 1, 'a stalled folder holds one read');
    assert.deepEqual(world.evidence(), ['one unread']);
    world.marker.answer();
    await world.clock.advance(POLL_MS);
    assert.deepEqual(world.logs('device.available').map(entry => entry.level), ['info']);
    assert.deepEqual(world.evidence(), ['one unread', 'one read', 'two read']);
    assert.deepEqual(world.harness.failures, [], 'the module never failed');
  } finally {
    await world.close();
  }
});

it('a module whose folder stalls from the start starts at once and reports the marker unavailable', async () => {
  const marker = new SimulatedMarker();
  marker.stall();
  const world = await World.open({transport: marker});
  try {
    await world.session('one');
    await world.clock.advance(READ_TIMEOUT_MS);
    assert.equal(world.logs('device.unavailable').length, 1);
    assert.deepEqual(world.evidence(), []);
    marker.answer();
    await world.clock.advance(POLL_MS);
    assert.deepEqual(world.evidence(), ['one read']);
  } finally {
    await world.close();
  }
});

it('a reader that fails makes the marker unavailable, is tried again with capped backoff, and never fails the module', async () => {
  const marker = new SimulatedMarker();
  const reads: number[] = [];
  let failures = 4;
  let elapsed = (): number => 0;
  const transport: MarkerTransport = {
    read: (home, stamp) => {
      reads.push(elapsed());
      if (failures > 0) {
        failures -= 1;
        return Promise.reject(new Error('the reader ended'));
      }
      return marker.read(home, stamp);
    },
    close: () => {},
  };
  const world = await World.open({transport});
  const start = world.clock.now();
  elapsed = () => world.clock.now() - start;
  try {
    await world.session('one');
    await world.clock.advance(70_000);
    // After the nth failure in a row, 2 s times 2 to the n: 4, 8, 16 and 32 s, then every 2 s once a read succeeded.
    assert.deepEqual(reads.slice(0, 7), [0, 4000, 12_000, 28_000, 60_000, 62_000, 64_000]);
    assert.deepEqual(world.logs('device.unavailable').filter(entry => entry.level === 'warn').length, 1);
    assert.equal(world.logs('device.available').length, 1);
    assert.deepEqual(world.evidence(), ['one read']);
    assert.deepEqual(world.harness.failures, []);
  } finally {
    await world.close();
  }
});

it('the module\'s stop never waits on a read that does not answer, and ends its reader', async () => {
  const marker = new SimulatedMarker();
  marker.stall();
  let closed = 0;
  const transport: MarkerTransport = {read: (home, stamp): Promise<MarkerRead> => marker.read(home, stamp), close: () => { closed += 1; }};
  const world = await World.open({transport});
  try {
    await world.clock.advance(1);
    assert.equal(marker.state().waiting, 1);
    const started = performance.now();
    await world.harness.stop();
    assert.ok(performance.now() - started < 1000, 'the stop returned at once');
    assert.equal(closed, 1);
    assert.deepEqual(world.harness.failures, []);
    assert.equal(world.harness.pendingTimers(), 0);
  } finally {
    await world.close();
  }
});

it('the module publishes only read observations of Codex Desktop sessions, sends no command, and nothing carries the Codex home', async () => {
  const home = '/mnt/c/Users/owner-sim/.codex';
  const world = await World.open({section: {...SECTION, home}});
  try {
    await world.session('one');
    await world.session('two');
    world.marker.list(['one']);
    await world.clock.advance(10_000);
    world.marker.unusable();
    await world.clock.advance(POLL_MS);
    world.marker.stall();
    await world.clock.advance(READ_TIMEOUT_MS + POLL_MS);
    const own = world.published.filter(message => message.source === 'bunny/modules/codex-desktop');
    assert.ok(own.length > 0);
    for (const message of own) {
      const data = message.data as unknown as LifecycleObservation;
      assert.deepEqual([message.type, message.kind, data.event.kind, data.identity.client], ['org.bunny.lifecycle.observed', 'occurrence', 'read-observed', 'desktop']);
    }
    assert.deepEqual(world.harness.sent, [{call: 'sync', families: ['session']}]);
    const module = createCodexDesktopModule({transport: new SimulatedMarker()});
    const shown = module.manifest.settings?.show({home, hostId: SECTION.hostId, sourceId: SECTION.sourceId});
    assert.deepEqual(shown, {hostId: 'host', sourceId: 'desktop'});
    const evidence = JSON.stringify({published: world.published, logs: world.hosted.map(harness => harness.logs), shown});
    for (const part of ['owner-sim', '.codex', '/mnt/c']) assert.equal(evidence.includes(part), false, 'the Codex home left the module');
  } finally {
    world.marker.answer();
    await world.close();
  }
});

it('Desktop metadata publishes positives and independent titles, then clears unavailable archive evidence', async () => {
  let archived: readonly string[] | null = ['closed'];
  let stalled = false;
  const world = await World.open({transport: {read: async () => stalled ? new Promise<MarkerRead>(() => {}) : {status: 'read', stamp: '', unread: null, archived, titles: [{id: 'one', title: {value: 'Desktop title', source: 'provider'}}]}, close: () => {}}});
  try {
    await world.session('one');await world.session('one-child', {parent: {status: 'known', identity: identityOf('one')}});
    await world.session('one', {sourceId: 'other'});
    await world.clock.advance(0);
    const metadata = () => world.published.map(message => message.data as unknown as LifecycleObservation).filter(data => data.event?.kind === 'metadata-observed');
    assert.equal(metadata().some(data => data.identity.sessionId === 'closed' && data.event.kind === 'metadata-observed' && data.event.archived === true), true);
    assert.deepEqual(metadata().filter(data => data.title !== undefined).map(data => [data.identity.sessionId, data.identity.sourceId, data.title?.value]), [['one', SECTION.sourceId, 'Desktop title']]);
    archived = null;await world.clock.advance(POLL_MS);
    assert.equal(metadata().at(-1)?.event.kind, 'metadata-observed');
    assert.equal(metadata().some(data => data.identity.sessionId === 'closed' && data.event.kind === 'metadata-observed' && data.event.archived === false), true);
    archived = ['closed'];await world.clock.advance(POLL_MS);
    stalled = true;await world.clock.advance(POLL_MS + READ_TIMEOUT_MS);
    const closed = metadata().filter(data => data.identity.sessionId === 'closed').at(-1);
    assert.equal(closed?.event.kind === 'metadata-observed' && closed.event.archived, false);
    assert.deepEqual(world.invalid, []);
  } finally { await world.close(); }
});
