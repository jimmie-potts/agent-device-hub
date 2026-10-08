// The Codex Desktop module in the runtime (Hub #926): Codex Desktop's read marker becomes read evidence that the real
// core reduces, through the module's real reader process on a synthetic marker in a temporary Codex home, and a Codex
// home that stalls leaves the core and the runtime's stop untouched. No test reads a real Codex file.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {constants} from 'node:fs';
import {chmod, mkdtemp, open, readdir, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import {MARKER_FILE, createCodexDesktopModule, folderReader} from '@jimmie-potts/codex-desktop';
import {sessionEntityId, type Identity, type LifecycleEvent, type SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {Sdk, SyncedCopy} from '@jimmie-potts/sdk';
import {createCoreModule, type LogRecord} from '../src/index.js';
import {lifecycleOf} from './fixtures/agents.js';
import {contextOf, entry, fixture, health, it, run} from './support.js';

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
