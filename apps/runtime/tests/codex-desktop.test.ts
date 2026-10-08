// The Codex Desktop module in the runtime (Hub #926): Codex Desktop's read marker becomes read evidence that the real
// core reduces, through the module's real reader process on a synthetic marker in a temporary Codex home, and a Codex
// home that stalls leaves the core and the runtime's stop untouched. No test reads a real Codex file.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {constants} from 'node:fs';
import {chmod, mkdir, mkdtemp, open, readdir, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import {MARKER_FILE, createCodexDesktopModule, folderReader} from '@jimmie-potts/codex-desktop';
import {sessionEntityId, type Identity, type LifecycleEvent, type SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {Sdk, SyncedCopy} from '@jimmie-potts/sdk';
import {createCoreModule, type LogRecord} from '../src/index.js';
import {lifecycleOf} from './fixtures/agents.js';
import {contextOf, entry, fixture, flush, health, it, manualClock, run, stateDir} from './support.js';

const SOURCE = {hostId: 'host-sim', sourceId: 'codex-desktop'} as const;
const desktop = (sessionId: string, sourceId: string = SOURCE.sourceId): Identity => ({provider: 'codex', client: 'desktop', hostId: SOURCE.hostId, sourceId, sessionId});
const marker = (ids: readonly string[]): string => JSON.stringify({'electron-thread-read-state-v1': {version: 1, unreadByIdentity: {host: {'local:a': ids}}}});

/**
 * A Codex home in a new private folder. A stalled one's marker is a FIFO with no writer, whose blocking open does not
 * return, as on a stalled mount; at the test's end a writer's open releases any read still waiting on it.
 */
async function codexHome(context: TestContext, {stalled = false} = {}): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'codex-home-')));
  await chmod(dir, 0o700);
  const marker = join(dir, MARKER_FILE);
  if (stalled) execFileSync('mkfifo', ['-m', '600', marker]);
  context.after(async () => {
    if (stalled) {
      try {
        const writer = await open(marker, constants.O_WRONLY | constants.O_NONBLOCK);
        await writer.close();
      } catch {
        // No read waits on it.
      }
    }
    await rm(dir, {recursive: true, force: true});
  });
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

/** A hook's observation of a Codex Desktop session, published as a part on the runtime's bus would. */
async function observe(sdk: Sdk, identity: Identity, event: LifecycleEvent, parent?: Identity): Promise<void> {
  const data = {...lifecycleOf(event, Date.now(), {identity, turn: 'turn-1'}), ...(parent === undefined ? {} : {parent: {status: 'known' as const, identity: parent}})};
  const subject = sessionEntityId(identity);
  await sdk.publish(`bunny.event.lifecycle.${subject}`, {kind: 'occurrence', type: 'org.bunny.lifecycle.observed', subject, dataschema: 'https://bunny.invalid/events/lifecycle/2.0', data});
}

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
  // A FIFO with no writer: the stuck reader's open of it never returns, as on a stalled mount.
  const home = await codexHome(context, {stalled: true});
  const probe = fixture('probe');
  const {runtime, logs} = await run(context, {
    modules: [createCoreModule(), createCodexDesktopModule({transport: folderReader(new URL('./fixtures/stuck-marker-reader.js', import.meta.url))}), probe],
    configFile: await privateConfig(context, home),
  });
  const {sdk} = contextOf(probe);
  const synced = await sdk.sync<SessionRecord>(['session'], () => {}, {timeoutMs: 5000});
  if (synced.status !== 'synced') assert.fail('the core served its sessions');
  await observe(sdk, desktop('one'), {kind: 'turn-ended'});
  await until(synced.copy, desktop('one'), () => true, 'the session');
  // The read is overdue after 5 s: the marker is unavailable, once, and the module still runs.
  const unavailable = (): LogRecord[] => logs.filter(record => record.event_name === 'device.unavailable' && record.attributes['bunny.module'] === 'codex-desktop');
  const deadline = performance.now() + 9000;
  while (unavailable().length === 0 && performance.now() < deadline) await new Promise(resolve => { setTimeout(resolve, 50); });
  assert.equal(unavailable().length, 1);
  assert.equal(unavailable()[0]?.severity_text, 'WARN');
  assert.deepEqual([entry((await health(runtime.url)).body, 'codex-desktop').state, entry((await health(runtime.url)).body, 'core').state], ['running', 'running']);
  assert.equal(readOf(synced.copy, desktop('one')), 'unknown', 'no evidence from a marker that was never read');
  await synced.copy.close();
  const started = performance.now();
  await runtime.stop();
  assert.ok(performance.now() - started < 3000, `the runtime stopped in ${Math.round(performance.now() - started)} ms`);
  assert.equal(logs.some(record => record.event_name === 'runtime.module.stop-timed-out'), false);
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
  assert.ok(logs.some(log => log.event_name === 'message.received' && log.attributes['bunny.code'] === 'forbidden'));
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
  await observe(sdk, desktop('closed'), {kind: 'turn-started'});
  await observe(sdk, desktop('closed-child'), {kind: 'turn-started'}, desktop('closed'));
  await new Promise(resolve => { setTimeout(resolve, 100); });
  assert.equal(copy.states().some(message => ['closed', 'closed-child'].includes(message.data.identity.sessionId)), false);
  await rm(file);
  const limit = performance.now() + 6000;
  while (!logs.some(log => log.event_name === 'message.received' && log.attributes['bunny.participant'] === 'bunny/modules/codex-desktop' && log.attributes['bunny.outcome'] === 'accepted') && performance.now() < limit) await flush();
  // The next completed poll reports the missing positive; a fresh hook then admits the conversation.
  await new Promise(resolve => { setTimeout(resolve, 2200); });
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
