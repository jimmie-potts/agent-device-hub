// The Codex Desktop module in the runtime (Hub #926): Codex Desktop's read marker becomes read evidence that the real
// core reduces, through the module's real reader process on a synthetic marker in a temporary Codex home, and a Codex
// home that stalls leaves the core and the runtime's stop untouched. No test reads a real Codex file.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chmod, mkdir, mkdtemp, readdir, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import {DESKTOP_METADATA_SCHEMA, MARKER_DEVICE, MARKER_FILE, POLL_MS, SimulatedMarker, createCodexDesktopModule, folderReader, type MarkerTransport} from '@jimmie-potts/codex-desktop';
import {desktopFeedId, sessionEntityId, type DesktopMetadataSnapshot, type Identity, type LifecycleEvent, type SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {prepareMessage, publishOnce, type Sdk, type SyncedCopy} from '@jimmie-potts/sdk';
import {producerSource} from '../src/hook/index.js';
import {createCoreModule, type LogRecord} from '../src/index.js';
import {lifecycleOf} from './fixtures/agents.js';
import {contextOf, edgeConfig, entry, fixture, flush, health, it, manualClock, run, stateDir, waitFor} from './support.js';

const SOURCE = {hostId: 'host-sim', sourceId: 'codex-desktop'} as const;
const desktop = (sessionId: string, sourceId: string = SOURCE.sourceId): Identity => ({provider: 'codex', client: 'desktop', hostId: SOURCE.hostId, sourceId, sessionId});
const marker = (ids: readonly string[]): string => JSON.stringify({'electron-thread-read-state-v1': {version: 1, unreadByIdentity: {host: {'local:a': ids}}}});

/** A private Codex home. A stalled home's marker is a FIFO with no writer, so a blocking open waits indefinitely. */
async function codexHome(context: TestContext, {stalled = false} = {}): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'codex-home-')));
  await chmod(dir, 0o700);
  const marker = join(dir, MARKER_FILE);
  if (stalled) execFileSync('mkfifo', ['-m', '600', marker]);
  context.after(() => rm(dir, {recursive: true, force: true}));
  return dir;
}

async function privateConfig(context: TestContext, home: string): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'bunny-config-')));
  await chmod(dir, 0o700);
  context.after(() => rm(dir, {recursive: true, force: true}));
  const file = join(dir, 'runtime-config.json');
  await writeFile(file, JSON.stringify({schema: 'runtime-config/1.0', modules: {'codex-desktop': {home, ...SOURCE}}}), {mode: 0o600});
  return file;
}

/**
 * A hook's observation of a Codex Desktop session at `atMs`, published as a part on the runtime's bus would. Returns the
 * message's ID.
 */
async function observe(sdk: Sdk, identity: Identity, event: LifecycleEvent, parent?: Identity, atMs = Date.now()): Promise<string> {
  const data = {...lifecycleOf(event, atMs, {identity, turn: 'turn-1'}), ...(parent === undefined ? {} : {parent: {status: 'known' as const, identity: parent}})};
  const subject = sessionEntityId(identity);
  const message = await sdk.publish(`bunny.event.lifecycle.${subject}`, {kind: 'occurrence', type: 'org.bunny.lifecycle.observed', subject, dataschema: 'https://bunny.invalid/events/lifecycle/2.0', data});
  return message.id;
}

/** Waits until the core has decided on each message in `ids`, taken or not, as its intake records show. */
async function decided(logs: readonly LogRecord[], ids: readonly string[], what: string): Promise<void> {
  const taken = (id: string): boolean => logs.some(log => log.event_name === 'message.received' && log.attributes['bunny.module'] === 'core' && log.attributes['bunny.message.id'] === id);
  await waitFor(() => ids.every(taken), 5000, what);
}

/** How many of the codex-desktop module's messages the core has decided on. */
const fromModule = (logs: readonly LogRecord[]): number => logs.filter(log => log.event_name === 'message.received' && log.attributes['bunny.module'] === 'core' &&
  log.attributes['bunny.participant'] === 'bunny/modules/codex-desktop').length;

/** Waits until the core's record of `identity` satisfies `ready`, through a copy of its sessions. */
async function until(copy: SyncedCopy<SessionRecord>, identity: Identity, ready: (record: SessionRecord) => boolean, what: string, timeoutMs = 8000): Promise<SessionRecord> {
  const id = sessionEntityId(identity);
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const record = copy.states().find(message => message.data.id === id)?.data;
    if (record !== undefined && ready(record)) return record;
    if (performance.now() > deadline) assert.fail(`timed out waiting for ${what}: ${JSON.stringify(record)}`);
    await new Promise(resolve => { setTimeout(resolve, 20); });
  }
}

const readOf = (copy: SyncedCopy<SessionRecord>, identity: Identity): string | undefined =>
  copy.states().find(message => message.data.id === sessionEntityId(identity))?.data.read;

it('Codex Desktop\'s marker becomes read evidence the core takes, for the configured producer\'s top-level sessions only', async context => {
  const home = await codexHome(context);
  await writeFile(join(home, MARKER_FILE), marker([]));
  const probe = fixture('probe');
  const {logs} = await run(context, {
    modules: [createCoreModule(), createCodexDesktopModule({transport: folderReader()}), probe], configFile: await privateConfig(context, home),
  });
  const {sdk} = contextOf(probe);
  const synced = await sdk.sync<SessionRecord>(['session'], () => {}, {timeoutMs: 5000});
  assert.equal(synced.status, 'synced');
  if (synced.status !== 'synced') return;
  const {copy} = synced;
  // A turn that is still running, then one that finished, a subagent of it and another producer's session.
  await observe(sdk, desktop('one'), {kind: 'turn-started'});
  await until(copy, desktop('one'), record => record.activity === 'active', 'the running turn');
  await writeFile(join(home, MARKER_FILE), marker(['one', 'child', 'other']));
  await observe(sdk, desktop('one'), {kind: 'turn-ended'});
  await observe(sdk, desktop('child'), {kind: 'turn-ended'}, desktop('one'));
  await observe(sdk, desktop('other', 'other-desktop'), {kind: 'turn-ended'});
  const unread = await until(copy, desktop('one'), record => record.read === 'unread', 'the unread session');
  assert.deepEqual(unread.unavailable.filter(item => item.dimension === 'read'), []);
  assert.equal(readOf(copy, desktop('child')), 'unknown', 'a subagent gets no read evidence');
  assert.equal(readOf(copy, desktop('other', 'other-desktop')), 'unknown', 'another producer\'s session gets none');
  await writeFile(join(home, MARKER_FILE), marker([]));
  await until(copy, desktop('one'), record => record.read === 'read', 'the read session');
  // The core took the module's evidence, and the module only read the marker.
  const intake = logs.filter(record => record.event_name === 'message.received' && record.attributes['bunny.participant'] === 'bunny/modules/codex-desktop');
  assert.deepEqual(intake.map(record => record.attributes['bunny.outcome']), ['accepted', 'accepted']);
  assert.deepEqual(await readdir(home), [MARKER_FILE]);
  assert.equal(JSON.stringify(logs).includes(home), false, 'the Codex home reached a record');
  await copy.close();
});

it('a Codex home that stalls leaves the core taking observations, the module running, and the runtime\'s stop at once', async context => {
  // A FIFO with no writer: the reader's blocking open waits as it would on a stalled mount.
  const home = await codexHome(context, {stalled: true});
  const stuck = folderReader(new URL('./fixtures/stuck-marker-reader.js', import.meta.url));
  // If an assertion fails, end the reader before the runtime's cleanup waits for its stop.
  context.after(() => { stuck.close(); });
  let reads = 0;
  let readOutcome: 'pending' | 'answered' | 'ended' | 'failed' = 'pending';
  const transport: MarkerTransport = {
    read: (...request) => {
      reads += 1;
      const reading = stuck.read(...request);
      void reading.then(
        () => { readOutcome = 'answered'; },
        (error: unknown) => {
          readOutcome = error instanceof Error && error.message === 'the marker reader ended' ? 'ended' : 'failed';
        },
      );
      return reading;
    },
    close: () => { stuck.close(); },
  };
  // The runtime runs on a clock the test moves, so the read's 5 s deadline passes only when the test advances it.
  const clock = manualClock();
  const probe = fixture('probe');
  const {runtime, logs} = await run(context, {
    modules: [createCoreModule(), createCodexDesktopModule({transport}), probe], configFile: await privateConfig(context, home), clock, scheduler: clock.scheduler,
  });
  const {sdk} = contextOf(probe);
  const synced = await sdk.sync<SessionRecord>(['session'], () => {}, {timeoutMs: 5000});
  if (synced.status !== 'synced') assert.fail('the core served its sessions');
  // The module's first poll, due at its start, issues the read and sets its deadline on the module's clock.
  const unavailable = (): LogRecord[] => logs.filter(record => record.event_name === 'device.unavailable' && record.attributes['bunny.module'] === 'codex-desktop');
  clock.advance(0);
  assert.equal(reads, 1, 'the first poll issued the read');
  // The fixture signals after issuing the open, and the FIFO stays without a writer through stop.
  await waitFor(async () => (await readdir(home)).includes(`${MARKER_FILE}.opening`), 5000, 'the reader to issue the blocking open');
  assert.equal(readOutcome, 'pending');
  await observe(sdk, desktop('one'), {kind: 'turn-ended'}, undefined, clock.now());
  await until(synced.copy, desktop('one'), () => true, 'the session while the reader is stuck');
  assert.equal(readOutcome, 'pending');
  // The capability specifies 5 s, independently of the deadline the module schedules.
  clock.advance(4999);
  assert.equal(unavailable().length, 0, 'the marker was unavailable before the read was overdue');
  clock.advance(1);
  assert.equal(unavailable().length, 1);
  assert.equal(unavailable()[0]?.severity_text, 'WARN');
  assert.equal(unavailable()[0]?.attributes['bunny.device.id'], MARKER_DEVICE);
  // The next poll finds the read still under way: it issues no other read and logs no other warning.
  clock.advance(POLL_MS);
  assert.deepEqual([reads, unavailable().length], [1, 1]);
  assert.deepEqual([entry((await health(runtime.url)).body, 'codex-desktop').state, entry((await health(runtime.url)).body, 'core').state], ['running', 'running']);
  assert.equal(readOf(synced.copy, desktop('one')), 'unknown', 'no evidence from a marker that was never read');
  await synced.copy.close();
  assert.equal(readOutcome, 'pending');
  // Bound the stop in real time while the host's manual clock stays still.
  const stopLimitMs = 3000;
  const started = performance.now();
  const stopping = runtime.stop().then(() => performance.now() - started);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { reject(new Error('timed out waiting for the runtime to stop')); }, Math.max(0, stopLimitMs - (performance.now() - started)));
  });
  const elapsed = await Promise.race([stopping, timedOut]).finally(() => { clearTimeout(timer); });
  assert.ok(elapsed < stopLimitMs, `the runtime stopped in ${Math.round(elapsed)} ms`);
  assert.equal(logs.some(record => record.event_name === 'runtime.module.stop-timed-out'), false);
  await waitFor(() => readOutcome !== 'pending', 2000, 'the reader to end');
  assert.equal(readOutcome, 'ended');
});


it('Desktop metadata guards scoped root and ancestor admission, unarchive and expiry without inventing activity', async context => {
  const clock = manualClock();
  const metadata = fixture('codex-desktop'), hook = fixture('hook');
  const {logs} = await run(context, {modules: [createCoreModule(), metadata, hook], clock, scheduler: clock.scheduler});
  const trusted = contextOf(metadata).sdk, untrusted = contextOf(hook).sdk;
  const result = await untrusted.sync<SessionRecord>(['session'], () => {}, {timeoutMs: 5000});
  if (result.status !== 'synced') assert.fail('the core served its sessions');
  const copy = result.copy;
  context.after(async () => { await copy.close(); });
  const send = async (sdk: Sdk, identity: Identity, event: LifecycleEvent, options: {title?: string; parent?: Identity; label?: string; hostSessionId?: string} = {}) => {
    const subject = sessionEntityId(identity);
    const data = {...lifecycleOf(event, clock.now(), {identity, turn: event.kind === 'metadata-observed' ? null : 'turn', ...(options.parent === undefined ? {} : {parent: {status: 'known', identity: options.parent}}), ...(options.title === undefined ? {} : {title: {value: options.title, source: 'provider'}}), ...(options.hostSessionId === undefined ? {} : {hostSessionId: options.hostSessionId})}), ...(options.label === undefined ? {} : {label: {value: options.label, origin: 'user' as const}})};
    await sdk.publish(`bunny.event.lifecycle.${subject}`, {kind: 'occurrence', type: 'org.bunny.lifecycle.observed', subject, dataschema: 'https://bunny.invalid/events/lifecycle/2.0', data});
    for (let n = 0; n < 8; n += 1) await flush();
  };
  const record = (identity: Identity) => copy.states().find(message => message.subject === sessionEntityId(identity))?.data;
  const closed = desktop('closed');
  await send(trusted, closed, {kind: 'metadata-observed', archived: true});
  await send(untrusted, closed, {kind: 'turn-started'});
  await send(untrusted, desktop('child'), {kind: 'turn-started'}, {parent: closed});
  assert.equal(record(closed), undefined);assert.equal(record(desktop('child')), undefined);
  await send(untrusted, desktop('closed', 'other'), {kind: 'turn-started'});
  assert.ok(record(desktop('closed', 'other')));
  await send(trusted, closed, {kind: 'metadata-observed', archived: false});
  await send(untrusted, closed, {kind: 'turn-ended'}, {label: 'Owner label', hostSessionId: 'host-session'});
  const before = structuredClone(record(closed));assert.ok(before);
  clock.advance(1000);
  await send(trusted, closed, {kind: 'metadata-observed'}, {title: 'Desktop title'});
  const after = record(closed);assert.ok(after);
  assert.deepEqual(after.title, {value: 'Desktop title', source: 'provider'});assert.equal(after.label?.value, 'Owner label');
  for (const field of ['activity', 'turn', 'read', 'ordering', 'notices', 'lastEvidenceAtMs', 'observedAtMs', 'restartUncertain', 'hostSessionId'] as const) assert.deepEqual(after[field], before[field], field);
  await send(untrusted, closed, {kind: 'metadata-observed'}, {title: 'Forged title'});
  await send(untrusted, desktop('forged'), {kind: 'metadata-observed', archived: true});
  await send(untrusted, desktop('forged'), {kind: 'turn-started'});
  assert.equal(record(closed)?.title?.value, 'Desktop title');assert.ok(record(desktop('forged')));
  await send(trusted, desktop('absent-title'), {kind: 'metadata-observed'}, {title: 'No session'});
  assert.equal(record(desktop('absent-title')), undefined);
  const expires = desktop('expires');
  await send(trusted, expires, {kind: 'metadata-observed', archived: true});
  clock.advance(7000);
  await send(untrusted, expires, {kind: 'turn-started'});assert.ok(record(expires));
  const refusals = logs.filter(log => log.event_name === 'message.received' && log.attributes['bunny.code'] === 'forbidden');
  assert.equal(refusals.length, 2);
  assert.equal(refusals.every(log => log.severity_text === 'WARN'), true);
});

it('Desktop metadata from the real reader keeps archives closed and titles independent of a missing marker', async context => {
  const home = await codexHome(context);
  await mkdir(join(home, 'archived_sessions'));
  const file = join(home, 'archived_sessions', 'rollout-2026-10-08T01-00-00-closed.jsonl');
  await writeFile(file, 'PRIVATE_TRANSCRIPT_CANARY');
  await writeFile(join(home, 'session_index.jsonl'), JSON.stringify({id: 'one', thread_name: 'Desktop title'}));
  const probe = fixture('probe');
  const {logs} = await run(context, {modules: [createCoreModule(), createCodexDesktopModule({transport: folderReader()}), probe], configFile: await privateConfig(context, home)});
  const sdk = contextOf(probe).sdk;
  const result = await sdk.sync<SessionRecord>(['session'], () => {}, {timeoutMs: 5000});
  if (result.status !== 'synced') assert.fail('the core served its sessions');
  const copy = result.copy;context.after(async () => { await copy.close(); });
  await observe(sdk, desktop('one'), {kind: 'turn-ended'});
  await until(copy, desktop('one'), record => record.title?.value === 'Desktop title', 'the independent title');
  // The module's admission evidence for the archived conversation, as the probe hears it.
  const unarchived: string[] = [];
  await sdk.subscribe<{event: {archived?: boolean}}>(`bunny.event.lifecycle.${sessionEntityId(desktop('closed'))}`, message => {
    if (message.source === 'bunny/modules/codex-desktop' && message.data.event.archived === false) unarchived.push(message.id);
  });
  const hooks = [await observe(sdk, desktop('closed'), {kind: 'turn-started'}), await observe(sdk, desktop('closed-child'), {kind: 'turn-started'}, desktop('closed'))];
  await decided(logs, hooks, 'the core\'s decision on both hooks');
  assert.equal(copy.states().some(message => ['closed', 'closed-child'].includes(message.data.identity.sessionId)), false);
  await rm(file);
  const limit = performance.now() + 6000;
  while (!logs.some(log => log.event_name === 'message.received' && log.attributes['bunny.participant'] === 'bunny/modules/codex-desktop' && log.attributes['bunny.outcome'] === 'accepted') && performance.now() < limit) await flush();
  // The next completed poll reports the missing positive. The core takes the bus's lifecycle messages one at a time in
  // the order they come, so it takes that report before the fresh hook, which then admits the conversation.
  await waitFor(() => unarchived.length > 0, 8000, 'the poll that reports the archive gone');
  await observe(sdk, desktop('closed'), {kind: 'turn-started'});
  await until(copy, desktop('closed'), () => true, 'fresh unarchived work');
  assert.equal(JSON.stringify(logs).includes(home), false);
});


it('Desktop metadata title commits preserve real core restart uncertainty and host session identity', async context => {
  const directory = await stateDir(context), clock = manualClock();
  const hook = fixture('hook');
  const first = await run(context, {modules: [createCoreModule(), hook], stateDir: directory, clock, scheduler: clock.scheduler});
  const identity = desktop('restart'), subject = sessionEntityId(identity);
  const original = {...lifecycleOf({kind: 'turn-ended'}, clock.now(), {identity, hostSessionId: 'host-session'}), label: {value: 'Owner label', origin: 'user' as const}};
  await contextOf(hook).sdk.publish(`bunny.event.lifecycle.${subject}`, {kind: 'occurrence', type: 'org.bunny.lifecycle.observed', subject, dataschema: 'https://bunny.invalid/events/lifecycle/2.0', data: original});
  for (let n = 0; n < 8; n += 1) await flush();
  await first.runtime.stop();
  clock.advance(1000);
  const metadata = fixture('codex-desktop');
  await run(context, {modules: [createCoreModule(), metadata], stateDir: directory, clock, scheduler: clock.scheduler});
  const sdk = contextOf(metadata).sdk, synced = await sdk.sync<SessionRecord>(['session'], () => {}, {timeoutMs: 5000});
  if (synced.status !== 'synced') assert.fail('the restarted core served its sessions');
  context.after(async () => { await synced.copy.close(); });
  const before = synced.copy.states()[0]?.data;assert.ok(before);assert.equal(before.restartUncertain, true);
  await sdk.publish(`bunny.event.lifecycle.${subject}`, {kind: 'occurrence', type: 'org.bunny.lifecycle.observed', subject, dataschema: 'https://bunny.invalid/events/lifecycle/2.0', data: lifecycleOf({kind: 'metadata-observed'}, clock.now(), {identity, turn: null, title: {value: 'Desktop title', source: 'provider'}})});
  const after = await until(synced.copy, identity, record => record.title?.value === 'Desktop title', 'the persisted metadata');
  for (const field of ['activity', 'turn', 'read', 'ordering', 'notices', 'lastEvidenceAtMs', 'observedAtMs', 'restartUncertain', 'hostSessionId'] as const) assert.deepEqual(after[field], before[field], field);
  assert.equal(after.label?.value, 'Owner label');
});


it('Desktop archive batches above the SDK queue limit retain trailing admission and continued title/read evidence', async context => {
  const home = await codexHome(context), marker = new SimulatedMarker();
  const archived = Array.from({length: 1100}, (_, index) => `closed-${index}`);
  marker.archive(archived);marker.title('one', 'First title');marker.list(['one']);
  const probe = fixture('probe');
  const {logs} = await run(context, {logLevel: 'debug', modules: [createCoreModule(), createCodexDesktopModule({transport: marker}), probe], configFile: await privateConfig(context, home)});
  const sdk = contextOf(probe).sdk, result = await sdk.sync<SessionRecord>(['session'], () => {}, {timeoutMs: 5000});
  if (result.status !== 'synced') assert.fail('the core served its sessions');
  const copy = result.copy;context.after(async () => { await copy.close(); });
  await observe(sdk, desktop('one'), {kind: 'turn-ended'});
  await until(copy, desktop('one'), () => true, 'the existing root');
  // Two completed scans use the production bus's default 1,024-slot queue.
  const deadline = performance.now() + 6000;
  const publications = () => logs.filter(log => log.event_name === 'lifecycle.observed' && log.attributes['bunny.module'] === 'codex-desktop').length;
  while (publications() < 2200 && performance.now() < deadline) await flush();
  assert.ok(marker.state().reads >= 2);
  assert.ok(publications() >= 2200, 'both supported archive batches finished publication');
  for (let n = 0; n < 20; n += 1) await flush();
  for (const id of [archived[0], archived.at(-1)]) {
    if (id === undefined) assert.fail('the archive batch has a first and trailing ID');
    await observe(sdk, desktop(id), {kind: 'turn-started'});
    for (let n = 0; n < 8; n += 1) await flush();
    assert.equal(copy.states().some(message => message.data.identity.sessionId === id), false, `${id} remains archived`);
  }
  await until(copy, desktop('one'), record => record.title?.value === 'First title' && record.read === 'unread', 'independent title and unread evidence after the archive batch');
  marker.title('one', 'Next title');marker.list([]);
  await until(copy, desktop('one'), record => record.title?.value === 'Next title' && record.read === 'read', 'continued title and read evidence across another archive batch');
});

it('a remote source\'s snapshots, published through the edge by the collector\'s own credential, become evidence the core takes, and a forged feed is refused (Hub #567)', async context => {
  const pc = {hostId: 'pc-sim', sourceId: 'codex-desktop'};
  const feed = {provider: 'codex', client: 'desktop', ...pc} as const;
  const feedId = desktopFeedId(feed);
  const collector = producerSource({...feed, feed: 'desktop-metadata'});
  const hook = producerSource({...feed, hook: 'Stop'});
  const token = 'tok_SYNTHETIC567_collector_abcdefghijklmnopqrstuvwxyz0123456789';
  const hookToken = 'tok_SYNTHETIC567_hook_abcdefghijklmnopqrstuvwxyz0123456789abc';
  const {config} = await edgeConfig(context, [{source: collector, token, scopes: ['ingest']}, {source: hook, token: hookToken, scopes: ['ingest']}],
    {modules: {'codex-desktop': {sources: [{...pc}]}}});
  // The runtime runs on a clock the test moves, so the module polls its feed only when the test advances a poll.
  const clock = manualClock();
  const probe = fixture('probe');
  const {runtime, logs} = await run(context, {
    logLevel: 'debug', modules: [createCoreModule(), createCodexDesktopModule({transport: new SimulatedMarker()}), probe], configFile: config, edge: {schemas: {}},
    clock, scheduler: clock.scheduler,
  });
  const {sdk} = contextOf(probe);
  const synced = await sdk.sync<SessionRecord>(['session'], () => {}, {timeoutMs: 5000});
  if (synced.status !== 'synced') assert.fail('the core served its sessions');
  const {copy} = synced;
  const identity = (sessionId: string): Identity => ({...feed, sessionId});
  await observe(sdk, identity('one'), {kind: 'turn-ended'}, undefined, clock.now());
  await observe(sdk, identity('two'), {kind: 'turn-ended'}, undefined, clock.now());
  await until(copy, identity('two'), () => true, 'the sessions');
  /** Publishes a snapshot through the edge; once the edge takes it, waits until the module has taken it from the bus. */
  const publish = async (source: string, bearer: string, data: DesktopMetadataSnapshot, subject = feedId) => {
    const message = prepareMessage(source, {kind: 'occurrence', type: 'org.bunny.desktop-metadata.observed', subject, dataschema: DESKTOP_METADATA_SCHEMA, data});
    const result = await publishOnce({url: runtime.url, source, token: bearer, timeoutMs: 4000}, `bunny.event.desktop-metadata.${subject}`, message);
    if (result.status === 'published') {
      await waitFor(() => logs.some(log => log.event_name === 'message.received' && log.attributes['bunny.module'] === 'codex-desktop' && log.attributes['bunny.message.id'] === message.id),
        5000, 'the module\'s receipt of the snapshot');
    }
    return result;
  };
  const snapshot = (fields: Partial<DesktopMetadataSnapshot>): DesktopMetadataSnapshot => ({feed, observedAtMs: clock.now(), stamp: `s${clock.now()}`, unread: [], archived: [], titles: [], ...fields});
  // The collector's first snapshot: one listed as unread, a title for the other, and an archived conversation. The
  // module's first poll, due at its start, reads it.
  assert.deepEqual(await publish(collector, token, snapshot({unread: ['one'], archived: ['closed'], titles: [{id: 'two', title: {value: 'PC title', source: 'provider'}}]})), {status: 'published'});
  clock.advance(0);
  await until(copy, identity('one'), record => record.read === 'unread', 'the unread session');
  await until(copy, identity('two'), record => record.title?.value === 'PC title', 'the titled session');
  // A late hook for the archived conversation is refused admission while the positive evidence is fresh.
  await decided(logs, [await observe(sdk, identity('closed'), {kind: 'turn-ended'}, undefined, clock.now())], 'the core\'s decision on the late hook');
  assert.equal(readOf(copy, identity('closed')), undefined, 'the archived conversation was admitted');
  // Desktop clears the flag: the next snapshot, a poll later, reads the session as read at the poll after it.
  clock.advance(POLL_MS);
  assert.deepEqual(await publish(collector, token, snapshot({unread: [], archived: ['closed']})), {status: 'published'});
  clock.advance(POLL_MS);
  await until(copy, identity('one'), record => record.read === 'read', 'the read session');
  // A hook's credential cannot speak for the feed, and the collector's cannot speak for another feed: neither changes a record.
  const before = [readOf(copy, identity('one')), readOf(copy, identity('two'))];
  const forged = await publish(hook, hookToken, snapshot({unread: ['one', 'two']}));
  assert.equal(forged.status === 'rejected' ? forged.error.error.code : forged.status, 'forbidden');
  const mac = {provider: 'codex', client: 'desktop', hostId: 'mac-sim', sourceId: 'codex-desktop'} as const;
  const other = await publish(collector, token, {...snapshot({unread: ['one', 'two']}), feed: mac}, desktopFeedId(mac));
  assert.equal(other.status === 'rejected' ? other.error.error.code : other.status, 'forbidden');
  // A poll's worth of time and more passes: the module polls its feed once, the core decides on what that poll sent,
  // and any evidence the same poll drew then reaches the copy.
  const sent = fromModule(logs);
  clock.advance(2500);
  await waitFor(() => fromModule(logs) > sent, 5000, 'the core\'s decision on the next poll\'s messages');
  for (let n = 0; n < 8; n += 1) await flush();
  assert.deepEqual([readOf(copy, identity('one')), readOf(copy, identity('two'))], before, 'a refused snapshot changed read state');
  // The module published as itself, and nothing carried a token.
  const intake = logs.filter(record => record.event_name === 'message.received' && record.attributes['bunny.participant'] === 'bunny/modules/codex-desktop');
  assert.ok(intake.length >= 2);
  assert.equal(JSON.stringify(logs).includes('SYNTHETIC567'), false, 'a token reached a record');
  await copy.close();
});
