import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {DeviceAvailability, type LogFields, type Logger, type ModuleScheduler, type Tracing} from '@jimmie-potts/sdk';
import {DeviceLink, DeviceUnreachable, LinkStopped, REQUEST_MS} from '../src/module/link.js';
import {ReadTimingProbe} from '../src/module/read-timing.js';
import {HttpError, nodeTransport, type LightRequest} from '../src/transport.js';
import {test} from './support.js';

class FakeTime {
  now = 0;
  readonly queued = new Set<{at: number; callback: () => void | Promise<void>}>();
  readonly scheduler: ModuleScheduler = {after: (delay, callback) => {
    const task = {at: this.now + delay, callback};
    this.queued.add(task);
    return () => { this.queued.delete(task); };
  }};

  run(at: number): void {
    const task = [...this.queued].find(item => item.at === at);
    assert.ok(task, `callback scheduled for ${at}`);
    this.queued.delete(task);
    void task.callback();
  }
}

function pendingReply() {
  let resolve: (value: unknown) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<unknown>((accept, refuse) => { resolve = accept; reject = refuse; });
  return {promise, resolve, reject};
}

function fixture(throwFromLogger = false, transportOverride?: LightRequest) {
  const time = new FakeTime();
  const signal = new AbortController();
  const records: {level: string; event: string; fields: LogFields}[] = [];
  const add = (level: string): Logger['info'] => (event, fields = {}) => {
    if (!event.startsWith('nanoleaf.http.read.')) return;
    if (throwFromLogger) throw new Error('synthetic sink failure');
    records.push({level, event, fields});
  };
  const log = {debug: add('debug'), info: add('info'), warn: add('warn'), error: add('error')};
  const replies: ReturnType<typeof pendingReply>[] = [];
  const methods: string[] = [];
  const transport: LightRequest = (_target, method) => {
    methods.push(method);
    const pending = pendingReply();
    replies.push(pending);
    return pending.promise;
  };
  const clock = {now: () => time.now};
  const trace: Tracing = {span: () => { throw new Error('GET cannot open a span'); }, start: () => { throw new Error('GET cannot open a span'); }};
  const link = new DeviceLink({device: 'lines', address: '127.0.0.1', token: 'SyntheticOnly', transport: transportOverride ?? transport,
    datagram: () => { throw new Error('GET cannot stream'); }, clock, scheduler: time.scheduler, signal: signal.signal,
    availability: new DeviceAvailability({log, clock}), log, trace, readTiming: new ReadTimingProbe(time.scheduler, clock.now),
    commandWrite: () => { throw new Error('GET cannot look for a write'); }, onWrite: () => { throw new Error('GET cannot write'); },
    onSettled: () => undefined});
  return {time, signal, records, replies, methods, link};
}

test('overlapping reads keep the winning branch and attribute overdue probe time only while each read was active', async () => {
  const {time, link, replies, records, methods} = fixture();
  const sampler = assert.rejects(link.read('sampler', '/state'), DeviceUnreachable);
  time.now = 140;
  const session = assert.rejects(link.read('music-session', '/effects'), HttpError);
  time.now = 150;
  time.run(100);
  time.now = 160;
  replies[1]?.reject(new HttpError(503));
  await session;
  time.now = 1250;
  time.run(REQUEST_MS);
  await sampler;

  assert.deepEqual(methods, ['GET', 'GET']);
  assert.equal(link.status, 'reached', 'an older timeout cannot change newer reachability');
  assert.deepEqual(records.map(record => record.fields), [
    {'bunny.device.id': 'lines', 'bunny.nanoleaf.read.source': 'music-session', 'bunny.nanoleaf.read.end': 'http-error',
      'bunny.duration_ms': 20, 'bunny.timeout_ms': 1200, 'bunny.nanoleaf.probe.sample_count': 1,
      'bunny.lag.duration_ms': 10, 'bunny.attempt_count': 1},
    {'bunny.device.id': 'lines', 'bunny.nanoleaf.read.source': 'sampler', 'bunny.nanoleaf.read.end': 'link-deadline',
      'bunny.duration_ms': 1250, 'bunny.timeout_ms': 1200, 'bunny.nanoleaf.probe.sample_count': 1,
      'bunny.lag.duration_ms': 50, 'bunny.nanoleaf.probe.pending_ms': 1000, 'bunny.attempt_count': 1},
  ]);
  assert.equal(time.queued.size, 0);
  replies[0]?.resolve({});
  await Promise.resolve();
  assert.equal(records.length, 2, 'the late transport completion emits no second record');
});

test('a transport ETIMEDOUT is a rejection and an overdue callback without a sample remains pending', async () => {
  const {time, link, replies, records} = fixture();
  const reading = assert.rejects(link.read('music-admission', '/effects'), DeviceUnreachable);
  time.now = 135;
  replies[0]?.reject(Object.assign(new Error('synthetic private address or token'), {code: 'ETIMEDOUT'}));
  await reading;
  assert.deepEqual(records[0]?.fields, {
    'bunny.device.id': 'lines', 'bunny.nanoleaf.read.source': 'music-admission', 'bunny.nanoleaf.read.end': 'transport-rejection',
    'bunny.duration_ms': 135, 'bunny.timeout_ms': 1200, 'bunny.nanoleaf.probe.sample_count': 0, 'bunny.nanoleaf.probe.pending_ms': 35,
    'bunny.attempt_count': 1,
  });
  assert.equal(time.queued.size, 0);
});

test('a read stopped with its module cleans up the shared probe and emits no record', async () => {
  const {time, signal, link, records, replies} = fixture();
  const reading = assert.rejects(link.read('sampler', '/state'), LinkStopped);
  signal.abort();
  await reading;
  assert.equal(time.queued.size, 0);
  replies[0]?.resolve({on: {value: true}});
  await Promise.resolve();
  assert.equal(records.length, 0);
  assert.equal(link.observation, undefined);
});

test('a full probe skips excess reads without changing which requests settle', async () => {
  const {time, link, records, replies, signal} = fixture();
  const readings = Array.from({length: 16}, () => assert.rejects(link.read('sampler', '/state'), LinkStopped));
  const excess = link.read('music-session', '/effects');
  time.now = 150;
  time.run(100);
  replies[16]?.resolve('synthetic');
  assert.equal(await excess, 'synthetic');
  assert.equal(records.length, 0);
  signal.abort();
  await Promise.all(readings);
  assert.equal(time.queued.size, 0);
});

test('a throwing timing sink does not change the reply or availability', async () => {
  const {time, link, replies} = fixture(true);
  const reading = link.read('sampler', '/state');
  const reply = {on: {value: true}};
  replies[0]?.resolve(reply);
  assert.equal(await reading, reply);
  assert.equal(link.status, 'reached');
  assert.equal(time.queued.size, 0);
});

test('a failure run emits one warning, a bounded debug summary and one recovery', async () => {
  const {time, link, replies, records} = fixture();
  for (const [index, at] of [0, 1, 2, 60_000].entries()) {
    time.now = at;
    const reading = assert.rejects(link.read('sampler', '/state'), DeviceUnreachable);
    replies[index]?.reject(new Error('synthetic'));
    await reading;
  }
  const reading = link.read('sampler', '/state');
  replies[4]?.resolve({});
  await reading;
  assert.deepEqual(records.map(({level, event, fields}) => [level, event, fields['bunny.attempt_count']]), [
    ['warn', 'nanoleaf.http.read.failed', 1],
    ['debug', 'nanoleaf.http.read.summary', 3],
    ['info', 'nanoleaf.http.read.recovered', 4],
  ]);
});

test('the link reports the transport deadline when its HTTP timer wins', async context => {
  const server = createServer(() => {});
  context.after(() => { server.closeAllConnections(); server.close(); });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}/`;
  const {link, records, time} = fixture(false, () => nodeTransport({url, method: 'GET', headers: {}, body: null, timeoutSeconds: 0.01}));
  await assert.rejects(link.read('sampler', '/state'), DeviceUnreachable);
  assert.equal(records[0]?.fields['bunny.nanoleaf.read.end'], 'transport-deadline');
  assert.equal(time.queued.size, 0);
});
