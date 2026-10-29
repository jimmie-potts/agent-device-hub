// A remote Codex Desktop source (Hub #567): a host-local collector's `desktop-metadata` snapshots as the reads of one
// source, under the module's existing rules, beside a local source, on a stand-in core. The real core, the edge's source
// binding and the collector are apps/runtime/tests/codex-desktop.test.ts and codex-desktop-collector.test.ts.
import assert from 'node:assert/strict';
import {desktopFeedId, type DesktopMetadataSnapshot, type LifecycleObservation} from '@jimmie-potts/event-contracts/v2/families';
import type {Participant} from '@jimmie-potts/sdk';
import {DESKTOP_METADATA_SCHEMA, FEED_FRESH_MS, MARKER_DEVICE, POLL_MS, READ_SETTLE_MS, READ_TIMEOUT_MS, markerDeviceOf} from '../src/index.js';
import {SECTION, World, flush, it} from './support.js';

const PC = {hostId: 'pc', sourceId: 'desktop'};
const FEED = {provider: 'codex', client: 'desktop', ...PC} as const;
const FEED_ID = desktopFeedId(FEED);
/** The source a collector's ingest credential acts as at the edge: a producer part, never the module or the core. */
const COLLECTOR = 'bunny/parts/hub-00000000000000000000000000000567';
const title = (value: string) => ({value, source: 'provider' as const});

type Partial567 = Partial<Omit<DesktopMetadataSnapshot, 'feed'>> & {feed?: DesktopMetadataSnapshot['feed']};

/** One snapshot of the PC's Desktop inputs, as the collector publishes it, from `source` and on `subject`. */
async function snapshot(part: Participant, world: World, fields: Partial567 = {}, {subject = FEED_ID}: {subject?: string} = {}): Promise<void> {
  const data: DesktopMetadataSnapshot = {
    feed: FEED, observedAtMs: world.clock.now(), stamp: fields.stamp ?? `s${world.clock.now()}`,
    unread: fields.unread === undefined ? [] : fields.unread, archived: fields.archived === undefined ? [] : fields.archived, titles: fields.titles ?? [],
    ...(fields.feed === undefined ? {} : {feed: fields.feed}), ...(fields.observedAtMs === undefined ? {} : {observedAtMs: fields.observedAtMs}),
  };
  await part.publish(`bunny.event.desktop-metadata.${subject}`, {kind: 'occurrence', type: 'org.bunny.desktop-metadata.observed', subject, dataschema: DESKTOP_METADATA_SCHEMA, data});
  await flush();
}

const metadataOf = (world: World) => world.published.map(message => message.data as unknown as LifecycleObservation).filter(data => data.event?.kind === 'metadata-observed');

it('a remote source\'s snapshots give read, archive and title evidence under the module\'s rules, and an unchanged snapshot gives nothing new', async () => {
  const world = await World.open({section: {sources: [PC]}});
  const collector = world.bus.connect(COLLECTOR);
  try {
    await world.session('one', PC);
    // A running session never settles to read, so only the marker's listing moves it.
    await world.session('two', {...PC, activity: 'active'});
    await world.session('one');
    // Nothing is read until the first snapshot: no local home, no reader.
    await world.clock.advance(POLL_MS);
    assert.deepEqual(world.evidence(), []);
    await snapshot(collector, world, {unread: ['one'], archived: ['closed'], titles: [{id: 'two', title: title('PC title')}]});
    await world.clock.advance(POLL_MS);
    assert.deepEqual(world.evidence().filter(line => !line.endsWith('metadata-observed')), ['one unread']);
    assert.equal(world.record('one', PC)?.read, 'unread');
    // The same thread ID on the module's own host is another session, untouched by the PC's marker.
    assert.equal(world.record('one')?.read, 'unknown');
    const archived = metadataOf(world).filter(data => data.identity.sessionId === 'closed');
    assert.ok(archived.length > 0 && archived.every(data => data.identity.hostId === PC.hostId && data.event.kind === 'metadata-observed' && data.event.archived === true));
    assert.deepEqual(metadataOf(world).filter(data => data.title !== undefined).map(data => [data.identity.sessionId, data.identity.hostId, data.title?.value]), [['two', 'pc', 'PC title']]);
    // Heartbeats with the same stamp change nothing; the archive positive is refreshed on each poll as it is locally.
    const before = world.evidence().filter(line => !line.endsWith('metadata-observed')).length;
    await snapshot(collector, world, {stamp: `s${world.clock.now() - POLL_MS}`, unread: ['one'], archived: ['closed']});
    await world.clock.advance(POLL_MS * 2);
    assert.equal(world.evidence().filter(line => !line.endsWith('metadata-observed')).length, before);
    // Desktop clears the flag: the next snapshot reads it as read.
    await snapshot(collector, world, {unread: [], archived: ['closed']});
    await world.clock.advance(POLL_MS);
    assert.deepEqual(world.evidence().filter(line => !line.endsWith('metadata-observed')), ['one unread', 'one read']);
    for (const message of world.published.filter(message => message.source === 'bunny/modules/codex-desktop')) {
      assert.deepEqual([message.type, (message.data as unknown as LifecycleObservation).identity.client], ['org.bunny.lifecycle.observed', 'desktop']);
    }
    // Evidence drawn from a snapshot continues that snapshot's trace, so one read can be followed from the collector.
    const traceOf = (traceparent: string): string => traceparent.split('-')[1] ?? '';
    const snapshots = world.published.filter(message => message.source === COLLECTOR).map(message => traceOf(message.traceparent));
    const observations = world.published.filter(message => message.source === 'bunny/modules/codex-desktop').map(message => traceOf(message.traceparent));
    assert.ok(observations.length > 0 && observations.every(trace => snapshots.includes(trace)), 'an observation started a trace of its own');
    // Each snapshot taken is one DEBUG intake record with the contract's `accepted` outcome, in the snapshot's trace.
    const taken = world.logs('message.received').filter(entry => entry.fields['bunny.outcome'] === 'accepted');
    assert.equal(taken.length, snapshots.length);
    assert.ok(taken.every(entry => entry.level === 'debug' && entry.fields['bunny.operation'] === 'feed' && entry.trace !== undefined && snapshots.includes(traceOf(entry.trace.traceparent))));
    assert.deepEqual(world.invalid, []);
  } finally {
    await collector.close();
    await world.close();
  }
});

it('a feed whose snapshots stop makes the marker unavailable once and clears archive positives, and the next snapshot is its recovery', async () => {
  const world = await World.open({section: {sources: [PC]}});
  const collector = world.bus.connect(COLLECTOR);
  try {
    await world.session('one', PC);
    await snapshot(collector, world, {unread: ['one'], archived: ['closed']});
    await world.clock.advance(POLL_MS);
    assert.equal(world.record('one', PC)?.read, 'unread');
    // Snapshots stop: once the last one is stale, a read waits, and the deadline makes the marker unavailable.
    await world.clock.advance(FEED_FRESH_MS + READ_TIMEOUT_MS + POLL_MS);
    const unavailable = world.logs('device.unavailable');
    assert.equal(unavailable.filter(entry => entry.level === 'warn').length, 1);
    assert.equal(unavailable[0]?.fields['bunny.device.id'], MARKER_DEVICE);
    const closed = metadataOf(world).filter(data => data.identity.sessionId === 'closed').at(-1);
    assert.equal(closed?.event.kind === 'metadata-observed' && closed.event.archived, false);
    // No stale input changes read state meanwhile.
    assert.equal(world.record('one', PC)?.read, 'unread');
    await world.clock.advance(60_000);
    assert.equal(world.logs('device.available').length, 0);
    // The next snapshot answers the waiting read at once.
    await snapshot(collector, world, {unread: [], archived: ['closed']});
    await world.clock.advance(0);
    assert.equal(world.logs('device.available').length, 1);
    await world.clock.advance(POLL_MS);
    assert.equal(world.record('one', PC)?.read, 'read');
    assert.deepEqual(world.invalid, []);
  } finally {
    await collector.close();
    await world.close();
  }
});

it('snapshots for another feed, with a mismatched subject or from a source that is not a remote part are refused once and change nothing', async () => {
  const world = await World.open({section: {sources: [PC]}});
  const collector = world.bus.connect(COLLECTOR);
  const core = world.bus.connect('bunny/core');
  try {
    await world.session('one', PC);
    const mac = {provider: 'codex', client: 'desktop', hostId: 'mac', sourceId: 'desktop'} as const;
    // An unconfigured feed, twice from the same sender: logged once.
    await snapshot(collector, world, {feed: mac, unread: ['one']}, {subject: desktopFeedId(mac)});
    await snapshot(collector, world, {feed: mac, unread: ['one']}, {subject: desktopFeedId(mac)});
    // The configured feed's snapshot on another feed's key.
    await snapshot(collector, world, {unread: ['one']}, {subject: desktopFeedId(mac)});
    // A snapshot from the core's own source.
    await snapshot(core, world, {unread: ['one']});
    await world.clock.advance(POLL_MS * 2);
    assert.deepEqual(world.evidence(), []);
    assert.equal(world.record('one', PC)?.read, 'unknown');
    // One record per sender and key: the configured feed on the other key shares the first case's record.
    const refused = world.logs('message.received').filter(entry => entry.fields['bunny.outcome'] === 'rejected');
    // A snapshot nobody configured is a domain refusal (INFO); one a correct sender never makes is WARN (ADR 0012 levels).
    assert.deepEqual(refused.map(entry => [entry.level, entry.fields['bunny.code']]).sort(), [['info', 'not-found'], ['warn', 'forbidden']]);
    assert.equal(world.logs('device.available').length, 0);
    // The configured feed on its own key still works afterwards.
    await snapshot(collector, world, {unread: ['one']});
    await world.clock.advance(POLL_MS);
    assert.equal(world.record('one', PC)?.read, 'unread');
  } finally {
    await core.close();
    await collector.close();
    await world.close();
  }
});

it('a local and a remote source run side by side, each with its own marker device, and the same thread ID on each host stays independent', async () => {
  const world = await World.open({section: {sources: [SECTION, PC]}});
  const collector = world.bus.connect(COLLECTOR);
  try {
    await world.session('shared');
    await world.session('shared', PC);
    world.marker.list(['shared']);
    await snapshot(collector, world, {unread: []});
    await world.clock.advance(POLL_MS);
    assert.equal(world.record('shared')?.read, 'unread');
    assert.equal(world.record('shared', PC)?.read, 'unknown');
    // The remote session settles to read only from a snapshot received 5 s after its last evidence.
    await world.clock.advance(READ_SETTLE_MS + POLL_MS);
    assert.equal(world.record('shared', PC)?.read, 'unknown');
    await snapshot(collector, world, {unread: []});
    await world.clock.advance(POLL_MS);
    assert.equal(world.record('shared')?.read, 'unread');
    assert.equal(world.record('shared', PC)?.read, 'read');
    // The local folder stalls while the remote feed goes on: only the local marker is unavailable, under its own name.
    world.marker.stall();
    await snapshot(collector, world, {unread: []});
    await world.clock.advance(POLL_MS + READ_TIMEOUT_MS);
    await snapshot(collector, world, {unread: ['shared']});
    await world.clock.advance(POLL_MS);
    assert.equal(world.record('shared', PC)?.read, 'unread');
    const unavailable = world.logs('device.unavailable').filter(entry => entry.level === 'warn');
    assert.deepEqual(unavailable.map(entry => entry.fields['bunny.device.id']), [markerDeviceOf(SECTION, false)]);
    assert.equal(markerDeviceOf(PC, false), 'marker:pc:desktop');
    const long = markerDeviceOf({hostId: 'h'.repeat(128), sourceId: 's'.repeat(128)}, false);
    assert.match(long, /^marker:[0-9a-f]{32}$/);
    assert.equal(long, markerDeviceOf({hostId: 'h'.repeat(128), sourceId: 's'.repeat(128)}, false));
    assert.notEqual(long, markerDeviceOf({hostId: 'h'.repeat(128), sourceId: 't'.repeat(128)}, false));
    // Each observation names its own source's identity.
    const hosts = new Set(world.published.filter(message => message.source === 'bunny/modules/codex-desktop').map(message => (message.data as unknown as LifecycleObservation).identity.hostId));
    assert.deepEqual([...hosts].sort(), ['host', 'pc']);
    assert.deepEqual(world.invalid, []);
  } finally {
    world.marker.answer();
    await collector.close();
    await world.close();
  }
});

it('a snapshot not newer than the feed\'s last is ignored, so a delayed publication neither reorders evidence nor renews freshness, and the settle rule counts from the snapshot\'s receipt', async () => {
  const world = await World.open({section: {sources: [PC]}});
  const collector = world.bus.connect(COLLECTOR);
  try {
    await world.session('one', PC);
    const fresh = world.clock.now();
    await snapshot(collector, world, {observedAtMs: fresh, unread: ['one']});
    await world.clock.advance(POLL_MS);
    assert.equal(world.record('one', PC)?.read, 'unread');
    await snapshot(collector, world, {observedAtMs: fresh + 2000, unread: []});
    await world.clock.advance(POLL_MS);
    assert.equal(world.record('one', PC)?.read, 'read');
    // A snapshot observed before the last one arrives late: nothing moves, and it is noted at DEBUG only.
    await snapshot(collector, world, {observedAtMs: fresh + 1000, unread: ['one']});
    await snapshot(collector, world, {observedAtMs: fresh + 2000, unread: ['one']});
    await world.clock.advance(POLL_MS * 2);
    assert.equal(world.record('one', PC)?.read, 'read');
    const stale = world.logs('message.received').filter(entry => entry.fields['bunny.outcome'] === 'stale');
    assert.equal(stale.length, 2);
    assert.ok(stale.every(entry => entry.level === 'debug'));
    // Nor does a late snapshot renew freshness: with no newer one, the marker is unavailable on schedule.
    await world.clock.advance(FEED_FRESH_MS + READ_TIMEOUT_MS);
    assert.equal(world.logs('device.unavailable').filter(entry => entry.level === 'warn').length, 1);
    // A snapshot stamped far ahead, as after a clock step on the collector's host, holds the feed for one freshness window only.
    await snapshot(collector, world, {observedAtMs: fresh + 10 * 365 * 86_400_000, unread: []});
    await world.clock.advance(0);
    await snapshot(collector, world, {observedAtMs: fresh + 20_000, unread: ['one']});
    await world.clock.advance(POLL_MS);
    assert.equal(world.record('one', PC)?.read, 'read', 'a snapshot behind a future-stamped one was taken while the feed was fresh');
    await world.clock.advance(FEED_FRESH_MS);
    await snapshot(collector, world, {observedAtMs: fresh + 21_000, unread: ['one']});
    await world.clock.advance(POLL_MS);
    assert.equal(world.record('one', PC)?.read, 'unread', 'the feed did not recover after its freshness window');
    await snapshot(collector, world, {observedAtMs: fresh + 22_000, unread: []});
    await world.clock.advance(POLL_MS);
    assert.equal(world.record('one', PC)?.read, 'read');
    // A session that ended 1 s before the snapshot was received does not settle to read from it, however late the module reads it.
    await snapshot(collector, world, {observedAtMs: fresh + 30_000, unread: []});
    await world.clock.advance(0);
    await world.session('two', {...PC, lastEvidenceAtMs: world.clock.now() - 1000});
    await world.clock.advance(READ_SETTLE_MS + POLL_MS);
    assert.equal(world.record('two', PC)?.read, 'unknown', 'settled from a snapshot older than the session');
    await snapshot(collector, world, {observedAtMs: fresh + 40_000, unread: []});
    await world.clock.advance(POLL_MS);
    assert.equal(world.record('two', PC)?.read, 'read');
    assert.deepEqual(world.invalid, []);
  } finally {
    await collector.close();
    await world.close();
  }
});
