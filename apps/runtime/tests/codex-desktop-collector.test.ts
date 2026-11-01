// The Codex Desktop collector (Hub #567): snapshot bounds and stamp, the collector and producer files' refusals, and the
// real entry point against a real runtime's edge with a synthetic Codex home. No test reads a real Codex file.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {chmod, link, mkdir, mkdtemp, realpath, rm, symlink, utimes, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import {fileURLToPath} from 'node:url';
import {MARKER_FILE} from '@jimmie-potts/codex-desktop';
import {MAX_MESSAGE_BYTES, type Message} from '@jimmie-potts/event-contracts/v2';
import {desktopFeedId, type DesktopFeed, type DesktopMetadataSnapshot, type Title} from '@jimmie-potts/event-contracts/v2/families';
import {parseRecord} from '@jimmie-potts/bunny-observability';
import {connectRemote, publishOnce, traceFields} from '@jimmie-potts/sdk';
import {
  MAX_ARCHIVED, MAX_TITLES, MAX_UNREAD, MESSAGE_BUDGET_BYTES, loadCollector, readCollectorConfig, runCollector, snapshotMessage, snapshotStamp,
  type Collector,
} from '../src/collector/codex-desktop.js';
import {producerCredentialId, producerSource} from '../src/hook/index.js';
import {createCoreModule} from '../src/index.js';
import {INSTANCE_ID, LogWriter, type LogRecord} from '../src/log.js';
import {MODULE_SCOPE, runtimeResource} from '../src/record.js';
import {edgeConfig, it, run, waitFor} from './support.js';

const BIN = fileURLToPath(new URL('../../bin/codex-desktop-collector.mjs', import.meta.url));
const CONFIGURATION = {provider: 'codex', client: 'desktop', hostId: 'pc-sim', sourceId: 'codex-desktop-metadata', feed: 'desktop-metadata'} as const;
const FEED: DesktopFeed = {provider: 'codex', client: 'desktop', hostId: 'pc-sim', sourceId: 'codex-desktop-metadata'};
const SOURCE = producerSource(CONFIGURATION);
const SECRET_TITLE = 'Synthetic567 private title canary';
const THREAD = 'synthetic567-thread-alpha';
const ids = (count: number, prefix = 'id'): string[] => Array.from({length: count}, (_, index) => `${prefix}-${String(index).padStart(5, '0')}`);
const title = (value: string): Title => ({value, source: 'provider'});

async function scratch(context: TestContext): Promise<string> {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'gh567-collector-')));
  await chmod(directory, 0o700);
  context.after(() => rm(directory, {recursive: true, force: true}));
  return directory;
}

const marker = (unread: readonly string[]): string => JSON.stringify({'electron-thread-read-state-v1': {version: 1, unreadByIdentity: {host: {'local:a': unread}}}});

async function producerFiles(directory: string, endpoint: string, token: string, source: Record<string, unknown> = CONFIGURATION): Promise<string> {
  await mkdir(directory, {mode: 0o700, recursive: true});
  const path = join(directory, 'producer.json');
  await writeFile(path, JSON.stringify({enabled: true, qualified: true, source, token, endpoint}), {mode: 0o600});
  await writeFile(join(directory, 'receipt.json'), JSON.stringify({version: 1, state: 'installed', token, input: {directory, source, endpoint, qualified: true}}), {mode: 0o600});
  return path;
}

async function collectorFile(directory: string, body: unknown, mode = 0o600): Promise<string> {
  const path = join(directory, `collector-${randomBytes(4).toString('hex')}.json`);
  await writeFile(path, JSON.stringify(body), {mode});
  await chmod(path, mode);
  return path;
}

it('snapshots bound unread and archived sets fail-open and keep the newest titles', () => {
  const titles = ids(600, 'thread').map(id => ({id, title: title(`title ${id}`)}));
  const {key, snapshot, message} = snapshotMessage(SOURCE, FEED, {unread: ids(4097), archived: ids(2049), titles}, 1_000);
  assert.equal(key, `bunny.event.desktop-metadata.${desktopFeedId(FEED)}`);
  assert.equal(message.subject, desktopFeedId(FEED));
  assert.equal(message.type, 'org.bunny.desktop-metadata.observed');
  assert.equal(message.dataschema, 'https://bunny.invalid/events/desktop-metadata/2.0');
  assert.equal(message.kind, 'occurrence');
  assert.equal(message.source, SOURCE);
  assert.deepEqual(snapshot.feed, FEED);
  assert.equal(snapshot.observedAtMs, 1_000);
  assert.equal(snapshot.unread, null, 'over 4096 unread IDs is unavailable, never truncated');
  assert.equal(snapshot.archived, null, 'over 2048 archived IDs is unavailable, never truncated');
  assert.equal(snapshot.titles.length, MAX_TITLES);
  assert.deepEqual(snapshot.titles, titles.slice(-MAX_TITLES), 'the newest 512, as the index tail lists them');
  const atLimit = snapshotMessage(SOURCE, FEED, {unread: [...ids(MAX_UNREAD), 'id-00000'], archived: ids(MAX_ARCHIVED), titles: []}, 1_000).snapshot;
  assert.equal(atLimit.unread?.length, MAX_UNREAD, 'duplicates count once');
  assert.equal(atLimit.archived?.length, MAX_ARCHIVED);
});

it('a message over its byte budget drops titles in steps, then the archive, and stays under the cap', () => {
  const long = (index: number) => `${'x'.repeat(100)}-${String(index).padStart(5, '0')}`;
  const titles = ids(512, 'thread').map(id => ({id, title: title('t'.repeat(150))}));
  const unread = Array.from({length: 1000}, (_, index) => long(index));
  const archived = Array.from({length: 2000}, (_, index) => long(index + 5000));
  const dropped = snapshotMessage(SOURCE, FEED, {unread, archived, titles}, 1);
  assert.deepEqual(dropped.snapshot.titles, [], 'titles go before the archive');
  assert.equal(dropped.snapshot.archived, null, 'the archive goes when titles alone do not fit');
  assert.equal(dropped.snapshot.unread?.length, 1000);
  assert.ok(Buffer.byteLength(JSON.stringify(dropped.message)) <= MESSAGE_BUDGET_BYTES);
  const some = snapshotMessage(SOURCE, FEED, {unread: unread.slice(0, 1200), archived: archived.slice(0, 200), titles: ids(512, 'thread').map(id => ({id, title: title('😀'.repeat(160))}))}, 1);
  assert.ok([256, 128].includes(some.snapshot.titles.length), `titles step down (${some.snapshot.titles.length})`);
  assert.deepEqual(some.snapshot.titles.at(-1)?.id, 'thread-00511', 'the newest stay');
  assert.equal(some.snapshot.archived?.length, 200);
  const huge = snapshotMessage(SOURCE, FEED, {unread: Array.from({length: 4096}, (_, index) => `${'u'.repeat(120)}${index}`), archived: null, titles: []}, 1);
  assert.equal(huge.snapshot.unread, null, 'a set that cannot fit is unavailable');
  assert.ok(Buffer.byteLength(JSON.stringify(huge.message)) < MAX_MESSAGE_BYTES);
});

it('the stamp is stable across key and set order and changes with content', () => {
  const titles = [{id: 'a', title: title('one')}];
  const first = snapshotMessage(SOURCE, FEED, {unread: ['b', 'a', 'a'], archived: ['z', 'y'], titles}, 1).snapshot;
  const second = snapshotMessage(SOURCE, FEED, {unread: ['a', 'b'], archived: ['y', 'z'], titles: [{id: 'a', title: {source: 'provider', value: 'one'}}]}, 999).snapshot;
  assert.match(first.stamp, /^[0-9a-f]{32}$/);
  assert.equal(first.stamp, second.stamp, 'observation time, key order and set order do not change the stamp');
  assert.equal(snapshotStamp({titles, archived: ['y', 'z'], unread: ['a', 'b']}), first.stamp);
  assert.notEqual(snapshotMessage(SOURCE, FEED, {unread: ['a'], archived: ['y', 'z'], titles}, 1).snapshot.stamp, first.stamp);
  assert.notEqual(snapshotMessage(SOURCE, FEED, {unread: ['a', 'b'], archived: null, titles}, 1).snapshot.stamp, first.stamp);
  assert.notEqual(snapshotMessage(SOURCE, FEED, {unread: ['a', 'b'], archived: ['y', 'z'], titles: [{id: 'a', title: title('two')}]}, 1).snapshot.stamp, first.stamp);
  assert.notEqual(snapshotMessage(SOURCE, FEED, {unread: null, archived: ['y', 'z'], titles}, 1).snapshot.stamp, first.stamp);
});

it('the collector file must be private and exactly its shape', async context => {
  const directory = await scratch(context);
  const good = {producer: join(directory, 'feed', 'producer.json'), home: join(directory, 'home')};
  assert.deepEqual(await readCollectorConfig(await collectorFile(directory, good)), {...good, intervalMs: 2000});
  assert.deepEqual(await readCollectorConfig(await collectorFile(directory, {...good, intervalMs: 1000})), {...good, intervalMs: 1000});
  assert.deepEqual(await readCollectorConfig(await collectorFile(directory, {...good, intervalMs: 5000})), {...good, intervalMs: 5000});
  assert.equal(await readCollectorConfig(await collectorFile(directory, good, 0o640)), undefined, 'group-readable');
  assert.equal(await readCollectorConfig(await collectorFile(directory, good, 0o604)), undefined, 'other-readable');
  const symlinked = join(directory, 'symlinked.json');
  await symlink(await collectorFile(directory, good), symlinked);
  assert.equal(await readCollectorConfig(symlinked), undefined, 'a symbolic link is not followed');
  const large = await collectorFile(directory, good);
  await writeFile(large, JSON.stringify(good) + ' '.repeat(8192), {mode: 0o600});
  assert.equal(await readCollectorConfig(large), undefined, 'a file over 8 KiB');
  const linked = await collectorFile(directory, good);
  await link(linked, join(directory, 'second-link.json'));
  assert.equal(await readCollectorConfig(linked), undefined, 'a second link');
  for (const body of [
    {...good, extra: true}, {producer: good.producer}, {...good, intervalMs: 999}, {...good, intervalMs: 5001}, {...good, intervalMs: 1500.5},
    {...good, home: 'relative/home'}, {...good, home: `${directory}/a/../home`}, {...good, home: `${directory}/home/`}, {...good, home: `/${'h'.repeat(1024)}`},
    {...good, home: `${directory}/ho\0me`}, {...good, producer: 7}, [good],
  ]) assert.equal(await readCollectorConfig(await collectorFile(directory, body)), undefined, JSON.stringify(body).slice(0, 80));
  assert.equal(await readCollectorConfig(join(directory, 'missing.json')), undefined);
});

it('the producer must be the five-member Codex Desktop metadata source', async context => {
  const directory = await scratch(context);
  const token = randomBytes(32).toString('base64url');
  const endpoint = 'http://127.0.0.1:9/api/monitor/v1/events';
  const home = join(directory, 'home');
  const loaded = await loadCollector(await collectorFile(directory, {producer: await producerFiles(join(directory, 'good'), endpoint, token), home}));
  assert.ok(typeof loaded !== 'string');
  assert.deepEqual(loaded.feed, FEED);
  assert.equal(loaded.publisher.source, SOURCE);
  assert.notEqual(SOURCE, producerSource({provider: 'codex', client: 'desktop', hostId: 'pc-sim', sourceId: 'codex-desktop-metadata'}),
    'the collector credential is distinct from a hook credential of the same feed');
  const refusals: [string, Record<string, unknown>][] = [
    ['wrong feed', {...CONFIGURATION, feed: 'lifecycle'}],
    ['client local', {...CONFIGURATION, client: 'local'}],
    ['no feed member', {provider: 'codex', client: 'desktop', hostId: 'pc-sim', sourceId: 'codex-desktop-metadata'}],
    ['extra member', {...CONFIGURATION, hook: 'SessionStart'}],
    ['bad host ID', {...CONFIGURATION, hostId: 'pc sim'}],
    ['provider claude', {...CONFIGURATION, provider: 'claude'}],
  ];
  for (const [name, source] of refusals) {
    const producer = await producerFiles(join(directory, name.replaceAll(' ', '-')), endpoint, token, source);
    assert.equal(await loadCollector(await collectorFile(directory, {producer, home})), 'producer', name);
  }
  assert.equal(await loadCollector(await collectorFile(directory, {producer: join(directory, 'none', 'producer.json'), home})), 'producer', 'missing producer');
  assert.equal(await loadCollector(await collectorFile(directory, {producer: join(directory, 'good', 'producer.json'), home, extra: 1})), 'collector');
});

/** Fails unless every record is a diagnostic contract record carrying no private value. */
function assertQuietRecords(records: readonly unknown[], secrets: readonly string[]): void {
  for (const entry of records) {
    const line = JSON.stringify(entry);
    assert.equal(parseRecord(line).ok, true, `a contract record: ${line.slice(0, 200)}`);
    for (const secret of secrets) assert.equal(line.includes(secret), false, 'no path, token, thread ID or title');
  }
}

it('records are contract records: one failure per run, its recovery, and read stall transitions', async context => {
  const directory = await scratch(context);
  const records: LogRecord[] = [];
  const controller = new AbortController();
  context.after(() => { controller.abort(); });
  const collector: Collector = {
    producer: join(directory, 'producer.json'), home: join(directory, 'home'), intervalMs: 1000, feed: FEED,
    publisher: {edge: 'http://127.0.0.1:9', token: 'x'.repeat(43), configuration: CONFIGURATION, source: SOURCE},
  };
  let clock = 0;
  const writer = new LogWriter(entry => { records.push(entry); }, 'debug', {now: () => clock}, runtimeResource('test', INSTANCE_ID));
  const results: Awaited<ReturnType<typeof publishOnce>>[] = [
    {status: 'rejected', error: {error: {code: 'forbidden', retryable: false, traceId: 'a'.repeat(32)}}},
    {status: 'uncertain', error: {error: {code: 'uncertain-result', retryable: true}}},
    {status: 'published'},
  ];
  let calls = 0;
  let reads = 0;
  let stall = false;
  let release: (() => void) | undefined;
  const sent: Message[] = [];
  const done = runCollector(collector, {
    signal: controller.signal, log: writer.logger(MODULE_SCOPE, {'bunny.module': 'codex-desktop'}), now: () => clock,
    publish: (_options, _key, message) => {
      sent.push(message);
      return Promise.resolve(results[Math.min(calls++, results.length - 1)] ?? {status: 'published'});
    },
    // Each read changes the unread set, so every cycle publishes without waiting for a heartbeat.
    readMarker: () => Promise.resolve({status: 'read', stamp: `s${reads}`, unread: [`${THREAD}-${reads++}`]}),
    readMetadata: () => stall ? new Promise(resolve => { release = () => { resolve({archived: null, titles: []}); }; })
      : Promise.resolve({archived: [THREAD], titles: [{id: THREAD, title: title(SECRET_TITLE)}]}),
  });
  await waitFor(() => calls >= 3, 8000, 'three publications');
  clock += 10_000;
  stall = true;
  await waitFor(() => records.some(entry => entry.event_name === 'device.unavailable'), 9000, 'a stall record');
  stall = false;
  release?.();
  await waitFor(() => records.some(entry => entry.event_name === 'device.available'), 4000, 'a recovery record');
  controller.abort();
  await done;
  assert.equal(writer.counts().dropped, 0, 'the contract refused no record');
  assertQuietRecords(records, [THREAD, SECRET_TITLE, directory, 'x'.repeat(43), 'pc-sim']);
  const summary = records.map(entry => `${entry.severity_text} ${entry.event_name} ${String(entry.attributes['bunny.code'] ?? entry.attributes['bunny.outcome'] ?? '')}`.trimEnd());
  assert.deepEqual(summary.filter(line => !line.startsWith('DEBUG')), [
    'WARN operation.failed forbidden', 'INFO operation.completed succeeded', 'WARN device.unavailable unavailable', 'INFO device.available',
  ], 'the uncertain result inside the same failure run is summarized, not logged again');
  const failed = records.find(entry => entry.event_name === 'operation.failed');
  assert.equal(failed?.attributes['bunny.outcome'], 'rejected');
  assert.equal(failed?.attributes['bunny.operation'], 'lifecycle');
  assert.equal(failed?.trace_id, traceFields(sent[0] ?? {traceparent: ''})?.traceId, 'the record carries the message\'s trace');
  assert.equal(records.find(entry => entry.event_name === 'device.unavailable')?.attributes['bunny.device.id'], 'marker');
  const published = records.filter(entry => entry.event_name === 'operation.completed' && entry.severity_text === 'DEBUG');
  assert.ok(published.length >= 1);
  assert.equal(published[0]?.attributes['bunny.message.kind'], 'occurrence');
  assert.equal(published[0]?.attributes['bunny.message.id'], sent[2]?.id);
});

it('the entry point publishes snapshots, heartbeats and changes to a real runtime and stops on SIGTERM', async context => {
  if (process.platform !== 'linux') {
    // This exercise is kept to Linux, where CI runs it; the private-file reader works off Linux too (Hub #1355).
    context.skip('a runtime with an edge configuration file is exercised on Linux only');
    return;
  }
  const token = randomBytes(32).toString('base64url');
  const reader = randomBytes(32).toString('base64url');
  const files = await edgeConfig(context, [
    {id: producerCredentialId(CONFIGURATION), source: SOURCE, token, scopes: ['ingest']},
    {source: 'bunny/parts/reader', token: reader, scopes: ['read']},
  ]);
  const {runtime} = await run(context, {modules: [createCoreModule()], configFile: files.config, edge: {schemas: {}}});
  const directory = await scratch(context);
  const home = join(directory, 'codex-home');
  await mkdir(join(home, 'archived_sessions'), {recursive: true});
  await writeFile(join(home, MARKER_FILE), marker([THREAD, 'synthetic567-thread-beta']));
  for (const id of ['synthetic567-archived-one', 'synthetic567-archived-two']) await writeFile(join(home, 'archived_sessions', `rollout-2026-10-20T10-00-00-${id}.jsonl`), '');
  await writeFile(join(home, 'session_index.jsonl'), `${JSON.stringify({id: THREAD, thread_name: SECRET_TITLE})}\n${JSON.stringify({id: 'synthetic567-thread-beta', thread_name: 'Second synthetic'})}\n`);
  const endpoint = `${runtime.url}/api/monitor/v1/events`;
  const producer = await producerFiles(join(directory, 'feed'), endpoint, token);

  const probe = snapshotMessage(SOURCE, FEED, {unread: [], archived: [], titles: []}, Date.now());
  const admitted = await publishOnce({url: runtime.url, source: SOURCE, token, timeoutMs: 2000}, probe.key, probe.message);
  assert.deepEqual(admitted, {status: 'published'});

  const received: {at: number; data: DesktopMetadataSnapshot}[] = [];
  const subscriber = await connectRemote({url: runtime.url, source: 'bunny/parts/reader', token: reader});
  context.after(() => subscriber.close());
  await subscriber.subscribe('bunny.event.desktop-metadata.*', (message: Message<DesktopMetadataSnapshot>) => {
    if (message.data.stamp !== probe.snapshot.stamp) received.push({at: performance.now(), data: message.data});
  });

  const config = await collectorFile(directory, {producer, home, intervalMs: 1000});
  const child = spawn(process.execPath, [BIN, config], {stdio: ['ignore', 'pipe', 'pipe']});
  context.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

  await waitFor(() => received.length >= 1, 6000, 'the first snapshot');
  const first = received[0];
  assert.ok(first);
  assert.deepEqual(first.data.feed, FEED);
  assert.deepEqual(first.data.unread, [THREAD, 'synthetic567-thread-beta'].sort());
  assert.deepEqual(first.data.archived, ['synthetic567-archived-one', 'synthetic567-archived-two']);
  assert.deepEqual(first.data.titles, [{id: THREAD, title: title(SECRET_TITLE)}, {id: 'synthetic567-thread-beta', title: title('Second synthetic')}]);

  await waitFor(() => received.length >= 2, 7000, 'a heartbeat');
  const heartbeat = received[1];
  assert.ok(heartbeat);
  assert.equal(heartbeat.data.stamp, first.data.stamp, 'an unchanged snapshot is a heartbeat with the same stamp');
  assert.ok(heartbeat.at - first.at < 6500, `the heartbeat came ${Math.round(heartbeat.at - first.at)} ms later`);

  const before = received.length;
  await writeFile(join(home, MARKER_FILE), marker(['synthetic567-thread-beta']));
  const later = new Date(Date.now() + 5000);
  await utimes(join(home, MARKER_FILE), later, later);
  await waitFor(() => received.slice(before).some(entry => entry.data.stamp !== first.data.stamp), 4000, 'the changed snapshot');
  const changed = received.slice(before).find(entry => entry.data.stamp !== first.data.stamp);
  assert.deepEqual(changed?.data.unread, ['synthetic567-thread-beta']);

  // A stopped runtime refuses the next heartbeat: the bin's own writer reports it as one contract record.
  await subscriber.close();
  await runtime.stop();
  await waitFor(() => stderr.includes('"operation.failed"'), 7000, 'the failed publication record');
  const failure = stderr.split('\n').filter(line => line !== '').map(line => JSON.parse(line) as LogRecord).find(entry => entry.event_name === 'operation.failed');
  assert.equal(failure?.severity_text, 'WARN');
  assert.equal(failure.attributes['bunny.code'], 'unavailable');
  assert.equal(failure.attributes['bunny.module'], 'codex-desktop');
  assert.match(failure.trace_id ?? '', /^[0-9a-f]{32}$/, 'the record carries the message\'s trace');

  child.kill('SIGTERM');
  const started = performance.now();
  const [code, signal] = await once(child, 'exit') as [number | null, NodeJS.Signals | null];
  assert.deepEqual([code, signal], [0, null]);
  assert.ok(performance.now() - started < 1000, 'the collector stops within 1 s');
  assert.equal(stdout, '');
  for (const secret of [directory, home, THREAD, 'synthetic567-archived-one', SECRET_TITLE, token, 'pc-sim']) assert.equal(stderr.includes(secret), false, 'stderr carries no path, ID, title or token');
  assertQuietRecords(stderr.split('\n').filter(line => line !== '').map(line => JSON.parse(line) as unknown), [directory, THREAD, SECRET_TITLE, token]);
});

it('the entry point refuses an unusable collector or producer file with exit 2 and a fixed line', async context => {
  const directory = await scratch(context);
  const home = join(directory, 'home');
  const wrong = await producerFiles(join(directory, 'wrong'), 'http://127.0.0.1:9/api/monitor/v1/events', randomBytes(32).toString('base64url'), {...CONFIGURATION, client: 'local'});
  for (const [args, expected] of [
    [[await collectorFile(directory, {producer: wrong, home})], /the producer file is missing/],
    [[await collectorFile(directory, {producer: wrong, home}, 0o644)], /the collector file is missing/],
    [[], /usage/],
  ] as const) {
    const child = spawn(process.execPath, [BIN, ...args], {stdio: ['ignore', 'pipe', 'pipe']});
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    const [code] = await once(child, 'exit') as [number | null];
    assert.equal(code, 2);
    assert.match(output, expected);
    assert.equal(output.trim().split('\n').length, 1, 'one line');
    assert.equal(output.includes(directory), false, 'no path');
  }
});
