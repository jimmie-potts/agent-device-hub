// The Volcano collector with a fake transport and a recording publisher (#615 AC1, AC3): what it reads, what it publishes
// and when, identity, backoff, and that no operation outside the allowlist exists. Synthetic values only; no radio.
import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {chmod, mkdir, mkdtemp, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test, type TestContext} from 'node:test';
import {MessageValidator, type Message} from '@jimmie-potts/event-contracts/v2';
import {registerCoreFamilies, type VolcanoObservation} from '@jimmie-potts/event-contracts/v2/families';
import type {Logger, PublishOnceResult} from '@jimmie-potts/sdk';
import {
  BACKOFF_FIRST_MS, BACKOFF_MAX_MS, READABLE, SUBSCRIBABLE, VOLCANO_REGISTERS, VOLCANO_SERIAL, loadCollector, readCollectorConfig, runCollector, serialDigest, volcanoFeedOf,
  type Collector, type ReadUuid, type SubscribeUuid, type VolcanoTransport,
} from '../src/collector/volcano.js';
import {producerSource} from '../src/hook/index.js';

const SERIAL = 'SYNTHETIC-SERIAL-615';
const SERIAL_HASH = createHash('sha256').update(SERIAL, 'utf8').digest('hex');
const CONFIGURATION = {provider: 'storz-bickel', client: 'volcano', hostId: 'mac-sim', sourceId: 'volcano-sim', feed: 'volcano-observation'} as const;
const SOURCE = producerSource(CONFIGURATION);
const FEED = {provider: 'storz-bickel', client: 'volcano', hostId: 'mac-sim', sourceId: 'volcano-sim'} as const;
const validator = new MessageValidator();
registerCoreFamilies(validator);
const le = (value: number): Uint8Array => Uint8Array.of(value & 0xff, value >> 8);

const collector: Collector = {producer: '/private/producer.json', advertisedName: 'S&B VOLCANO H', serialSha256: SERIAL_HASH, feed: FEED,
  publisher: {edge: 'http://127.0.0.1:1', token: 'synthetic-token', configuration: CONFIGURATION, source: SOURCE}};

/** A device with registers, which fails the test on anything outside the five operations and the allowlist. */
class FakeDevice implements VolcanoTransport {
  readonly operations: string[] = [];
  readonly notifications = new Map<string, (bytes: Uint8Array) => void>();
  registers: Record<string, number> = {status1: 0x0603, status2: 0x0200, current: 400, target: 1850, hours: 12, minutes: 5};
  serial = SERIAL;
  advertising = true;
  connectFails = false;
  lost: (() => void) | undefined;
  readFails = false;

  scan(advertisedName: string): Promise<boolean> {
    this.operations.push(`scan ${advertisedName}`);
    return Promise.resolve(this.advertising);
  }
  connect(lost: () => void): Promise<void> {
    this.operations.push('connect');
    this.lost = lost;
    return this.connectFails ? Promise.reject(new Error('synthetic')) : Promise.resolve();
  }
  read(uuid: ReadUuid): Promise<Uint8Array> {
    assert.ok(READABLE.includes(uuid), 'read of a characteristic outside the allowlist');
    this.operations.push(`read ${uuid.slice(0, 8)}`);
    if (this.readFails) return Promise.reject(new Error('synthetic'));
    if (uuid === VOLCANO_SERIAL) return Promise.resolve(Buffer.from(`${this.serial}\0\0`));
    const name = Object.entries(VOLCANO_REGISTERS).find(([, value]) => value === uuid)?.[0] ?? '';
    return Promise.resolve(le(this.registers[name] ?? 0));
  }
  subscribe(uuid: SubscribeUuid, listener: (bytes: Uint8Array) => void): Promise<void> {
    assert.ok(SUBSCRIBABLE.includes(uuid), 'subscription to a characteristic outside the allowlist');
    this.operations.push(`subscribe ${uuid.slice(0, 8)}`);
    this.notifications.set(uuid, listener);
    return Promise.resolve();
  }
  disconnect(): Promise<void> {
    this.operations.push('disconnect');
    return Promise.resolve();
  }
  notify(name: keyof typeof VOLCANO_REGISTERS, value: number): void {
    this.registers[name] = value;
    this.notifications.get(VOLCANO_REGISTERS[name])?.(le(value));
  }
}

const logs: {level: string; event: string; fields: unknown}[] = [];
const log: Logger = Object.fromEntries((['debug', 'info', 'warn', 'error'] as const).map(level => [level, (event: string, fields: unknown) => { logs.push({level, event, fields}); }])) as unknown as Logger;
const sleepFor = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms); });

type Run = {published: {key: string; message: Message<VolcanoObservation>}[]; stop: () => Promise<void>; waits: number[]};
function start(context: TestContext, device: VolcanoTransport, options: {timing?: Parameters<typeof runCollector>[1]['timing']; result?: () => PublishOnceResult} = {}): Run {
  const published: Run['published'] = [];
  const waits: number[] = [];
  const controller = new AbortController();
  const running = runCollector(collector, {
    log, signal: controller.signal, transport: device,
    timing: {pollMs: 40, heartbeatMs: 60, minPublishMs: 15, scanMs: 200, connectMs: 200, readMs: 200, ...options.timing},
    publish: (_options, key, message) => {
      published.push({key, message: message as Message<VolcanoObservation>});
      return Promise.resolve(options.result?.() ?? {status: 'published'});
    },
    sleep: async (ms, signal) => { waits.push(ms); if (!signal.aborted) await sleepFor(25); },
  });
  const stop = async (): Promise<void> => { controller.abort(); await running; };
  context.after(stop);
  return {published, stop, waits};
}
const until = async (check: () => boolean, what: string, ms = 2000): Promise<void> => {
  const deadline = performance.now() + ms;
  while (!check()) {
    if (performance.now() > deadline) assert.fail(`waited for ${what}`);
    await sleepFor(2);
  }
};
const snapshots = (run: Run): VolcanoObservation[] => run.published.map(item => item.message.data);
const connected = (run: Run): VolcanoObservation[] => snapshots(run).filter(item => item.link === 'connected');

void test('it connects, proves the serial, reads every register and publishes a schema-valid snapshot on the feed key', async t => {
  const device = new FakeDevice();
  const run = start(t, device);
  await until(() => connected(run).length > 0, 'a connected snapshot');
  const {key, message} = run.published.find(item => item.message.data.link === 'connected') ?? assert.fail('none');
  assert.equal(validator.validate(message).ok, true);
  assert.match(key, /^bunny\.event\.volcano-observation\.[0-9a-f]{64}$/);
  assert.equal(message.source, SOURCE);
  assert.deepEqual(message.data.reading, {status1: 0x0603, status2: 0x0200, currentDeciC: 400, targetDeciC: 1850, heatingHours: 12, heatingMinutes: 5});
  assert.deepEqual(message.data.feed, FEED);
  assert.equal(JSON.stringify(run.published).includes(SERIAL), false, 'the serial never leaves');
  assert.equal(JSON.stringify(logs).includes(SERIAL), false, 'or reaches a record');
  await run.stop();
});

void test('it asks the transport for the five operations on the allowlist, and the interface has no write', async t => {
  const device = new FakeDevice();
  const run = start(t, device);
  await until(() => connected(run).length > 2, 'some snapshots');
  await run.stop();
  const names = new Set(device.operations.map(operation => operation.split(' ')[0]));
  assert.deepEqual([...names].sort(), ['connect', 'disconnect', 'read', 'scan', 'subscribe']);
  assert.equal(device.operations.filter(operation => operation.startsWith('subscribe')).length, SUBSCRIBABLE.length);
  assert.equal(device.operations.filter(operation => operation === `read ${VOLCANO_SERIAL.slice(0, 8)}`).length, 1, 'the serial is read once per connection');
  const written: VolcanoTransport = device;
  assert.equal(Object.keys(written).some(key => /write/iu.test(key)), false);
});

void test('a notification publishes at most once per minimum interval, and a poll catches what notifications missed', async t => {
  const device = new FakeDevice();
  const run = start(t, device, {timing: {minPublishMs: 30, heartbeatMs: 10_000, pollMs: 25}});
  await until(() => connected(run).length === 1, 'the first snapshot');
  const before = run.published.length;
  for (let value = 500; value < 520; value += 1) device.notify('current', value);
  await until(() => connected(run).some(item => item.reading?.currentDeciC === 519), 'the coalesced notification');
  assert.ok(run.published.length - before <= 2, `${String(run.published.length - before)} publications for one burst`);
  device.registers.minutes = 6;
  await until(() => connected(run).some(item => item.reading?.heatingMinutes === 6), 'the poll');
  const times = connected(run).map(item => item.observedAtMs);
  assert.ok(times.every((at, index) => index === 0 || at >= (times[index - 1] ?? 0)));
  const sequences = snapshots(run).map(item => item.sequence);
  assert.ok(sequences.every((value, index) => index === 0 || value === (sequences[index - 1] ?? 0) + 1), 'sequences count up by one');
  assert.equal(new Set(snapshots(run).map(item => item.collectorEpoch)).size, 1, 'one epoch per process');
});

void test('status2 bit 13 alone publishes nothing before the heartbeat, which publishes regardless', async t => {
  const device = new FakeDevice();
  const run = start(t, device, {timing: {minPublishMs: 1, heartbeatMs: 150, pollMs: 10_000}});
  await until(() => connected(run).length === 1, 'the first snapshot');
  const before = run.published.length;
  device.notify('status2', 0x2200);
  device.notify('status2', 0x0200);
  await sleepFor(50);
  assert.equal(run.published.length, before, 'no publication for the flipping bit');
  await until(() => run.published.length > before, 'the heartbeat');
});

void test('a publication that fails is never retried: the next snapshot is a new one', async t => {
  const device = new FakeDevice();
  let refused = 0;
  const run = start(t, device, {timing: {heartbeatMs: 30}, result: () => { refused += 1; return {status: 'uncertain', error: {error: {code: 'uncertain-result', retryable: false}}}; }});
  await until(() => refused >= 3, 'three attempts');
  const sequences = snapshots(run).map(item => item.sequence);
  assert.equal(new Set(sequences).size, sequences.length, 'each attempt is a new snapshot');
  assert.equal(logs.filter(entry => entry.event === 'operation.failed' && entry.level !== 'debug').length >= 1, true);
});

void test('a serial that differs reports identity-mismatch and disconnects, with no reading', async t => {
  const device = new FakeDevice();
  device.serial = 'ANOTHER-SYNTHETIC-DEVICE';
  const run = start(t, device);
  await until(() => snapshots(run).some(item => item.link === 'identity-mismatch'), 'the mismatch');
  await until(() => device.operations.includes('disconnect'), 'the disconnect');
  assert.equal(snapshots(run).every(item => item.reading === null), true);
  assert.equal(device.operations.some(operation => operation.startsWith('subscribe')), false);
  assert.equal(device.operations.filter(operation => operation.startsWith('read')).every(operation => operation === `read ${VOLCANO_SERIAL.slice(0, 8)}`), true, 'nothing else is read from another device');
  assert.equal(JSON.stringify(run.published).includes('ANOTHER-SYNTHETIC-DEVICE'), false);
});

void test('with nothing advertising it reports unavailable and backs off, doubling to the cap', async t => {
  const device = new FakeDevice();
  device.advertising = false;
  const run = start(t, device);
  await until(() => run.waits.length >= 8, 'eight attempts');
  assert.deepEqual(run.waits.slice(0, 8), [2000, 4000, 8000, 16_000, 32_000, BACKOFF_MAX_MS, BACKOFF_MAX_MS, BACKOFF_MAX_MS]);
  assert.equal(run.waits[0], BACKOFF_FIRST_MS);
  assert.ok(snapshots(run).every(item => item.link === 'unavailable' && item.reading === null));
  assert.equal(device.operations.includes('connect'), false);
});

void test('a lost link reports disconnected, reconnects, and resets its backoff', async t => {
  const device = new FakeDevice();
  const run = start(t, device);
  await until(() => connected(run).length > 0 && device.lost !== undefined, 'the connection');
  device.connectFails = true;
  device.lost?.();
  await until(() => snapshots(run).some(item => item.link === 'disconnected'), 'the disconnect');
  await until(() => run.waits.length >= 2, 'failed attempts');
  assert.deepEqual(run.waits.slice(0, 2), [2000, 4000], 'the link had worked, so backoff starts over from its first step');
  device.connectFails = false;
  const seen = connected(run).length;
  await until(() => connected(run).length > seen, 'the reconnect');
  assert.equal(device.operations.filter(operation => operation.startsWith('subscribe')).length, SUBSCRIBABLE.length * 2);
});

void test('a read that fails ends the connection, and a stop ends the loop promptly', async t => {
  const device = new FakeDevice();
  const run = start(t, device);
  await until(() => connected(run).length > 0, 'the connection');
  device.readFails = true;
  await until(() => snapshots(run).some(item => item.link === 'disconnected'), 'the failed poll');
  const started = performance.now();
  await run.stop();
  assert.ok(performance.now() - started < 500);
});

void test('serials are compared without trailing padding', () => {
  assert.equal(serialDigest(Buffer.from(`${SERIAL}\0\0 `)), SERIAL_HASH);
  assert.notEqual(serialDigest(Buffer.from(`${SERIAL}X`)), SERIAL_HASH);
});

void test('a producer names exactly the Volcano feed', () => {
  assert.deepEqual(volcanoFeedOf(CONFIGURATION), FEED);
  for (const bad of [{...CONFIGURATION, feed: 'desktop-metadata'}, {...CONFIGURATION, provider: 'codex'}, {...CONFIGURATION, client: 'desktop'}, {...CONFIGURATION, hostId: 'has space'}, {...CONFIGURATION, extra: 1}]) {
    assert.equal(volcanoFeedOf(bad), undefined, JSON.stringify(bad));
  }
});

async function scratch(context: TestContext): Promise<string> {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'gh615-collector-')));
  await chmod(directory, 0o700);
  context.after(() => rm(directory, {recursive: true, force: true}));
  return directory;
}

void test('the collector and producer files are refused unless private and exact', async t => {
  const directory = await scratch(t);
  const collectorFile = async (body: unknown, mode = 0o600): Promise<string> => {
    const path = join(directory, `collector-${String(Math.random()).slice(2)}.json`);
    await writeFile(path, JSON.stringify(body), {mode});
    await chmod(path, mode);
    return path;
  };
  const producerDirectory = join(directory, 'producer');
  await mkdir(producerDirectory, {mode: 0o700});
  const producer = join(producerDirectory, 'producer.json');
  const good = {producer, advertisedName: 'S&B VOLCANO H', serialSha256: SERIAL_HASH};
  assert.deepEqual(await readCollectorConfig(await collectorFile(good)), good);
  assert.equal(await readCollectorConfig(await collectorFile(good, 0o644)), undefined, 'not private');
  for (const bad of [{...good, serialSha256: 'short'}, {...good, serial: SERIAL}, {...good, producer: 'relative.json'}, {...good, advertisedName: ''}, {producer, advertisedName: 'S&B VOLCANO H'}]) {
    assert.equal(await readCollectorConfig(await collectorFile(bad)), undefined, JSON.stringify(bad));
  }
  assert.equal(await loadCollector(await collectorFile(good)), 'producer', 'the producer file is missing');
  const write = async (source: unknown): Promise<void> => {
    const token = randomBytes(32).toString('base64url');
    const endpoint = 'http://127.0.0.1:1/api/monitor/v1/events';
    await writeFile(producer, JSON.stringify({enabled: true, qualified: true, source, token, endpoint}), {mode: 0o600});
    await writeFile(join(producerDirectory, 'receipt.json'), JSON.stringify({version: 1, state: 'installed', token, input: {directory: producerDirectory, source, endpoint, qualified: true}}), {mode: 0o600});
  };
  await write({provider: 'codex', client: 'desktop', hostId: 'mac-sim', sourceId: 'desktop', feed: 'desktop-metadata'});
  assert.equal(await loadCollector(await collectorFile(good)), 'producer', 'another feed\'s producer');
  await write(CONFIGURATION);
  const loaded = await loadCollector(await collectorFile(good));
  assert.ok(typeof loaded === 'object');
  assert.deepEqual(loaded.feed, FEED);
  assert.equal(loaded.publisher.source, SOURCE);
});
