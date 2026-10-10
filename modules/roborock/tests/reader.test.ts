import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {SdkError, type Scheduler} from '@jimmie-potts/sdk';
import {checkModuleRecord, RecordedSpans, type HarnessRecord} from '@jimmie-potts/sdk/testing';
import {ConnectionFailure} from '../src/transport/failure.js';
import {reader, type Reading, type WireRequest, type WireResult} from '../src/transport/reader.js';
import type {Config, Session} from '../src/transport/private.js';
const config: Config = {schemaVersion: 1, deviceId: 'synthetic-robot', address: '192.168.10.20', broker: 'mqtts://mqtt-us.roborock.com:8883', region: 'us'};
const session: Session = {schemaVersion: 1, deviceId: config.deviceId, model: 'roborock.vacuum.a97', protocol: '1.0', localKey: '0123456789abcdef', rriot: {u: 'synthetic-user', s: 'sentinel-auth-secret', k: 'sentinel-auth-key'}, broker: config.broker};
class Time implements Scheduler {
  nowMs = 1700000000000;
  readonly jobs = new Set<{at: number; run: () => void}>();
  now(): number { return this.nowMs; }
  after(delay: number, run: () => void): () => void { const job = {at: this.nowMs + delay, run}; this.jobs.add(job); return () => {this.jobs.delete(job);}; }
  advance(delay: number): void { this.nowMs += delay; for (const job of [...this.jobs]) if (job.at <= this.nowMs) {this.jobs.delete(job); job.run();} }
}
function code(result: Reading<unknown>): string | undefined { return result.ok ? undefined : result.error.error.code; }
async function tick(): Promise<void> { await new Promise<void>(resolve => setImmediate(resolve)); }
void test('construction is inert and all six typed reads retain route, time and identity', async () => {
  const time = new Time(); const sent: WireRequest[] = []; const routes: string[] = [];
  const local = (_config: Config, _session: Session, request: WireRequest): Promise<WireResult> => {sent.push(request); routes.push('local'); return Promise.resolve({kind: 'json', value: [{battery: 95}]});};
  const mqtt = (_config: Config, _session: Session, request: WireRequest): Promise<WireResult> => {sent.push(request); routes.push('mqtt'); return Promise.resolve({kind: 'map', bytes: Buffer.from('synthetic map')});};
  const instance = reader(config, session, {clock: time, scheduler: time, local, mqtt});
  assert.equal(sent.length, 0);
  const values = await Promise.all([instance.readStatus(), instance.readConsumables(), instance.readCleanSummary(), instance.readCleanRecord(1700000000), instance.readRoomMapping(), instance.readCurrentMap()]);
  assert.ok(values.every(value => value.ok && value.observedAt === new Date(time.now()).toISOString()));
  assert.deepEqual(routes, ['local', 'local', 'local', 'local', 'local', 'mqtt']);
  assert.equal(new Set(sent.map(request => request.id)).size, 6);
  assert.deepEqual(sent[3]?.params, [1700000000]);
  instance.stop();
});
void test('one active owner, eight waiting; aborted queued work never reaches a sender', async () => {
  let sent = 0; let release: ((result: WireResult) => void) | undefined;
  const pending = (): Promise<WireResult> => {sent++; return new Promise(resolve => {release = resolve;});};
  const time = new Time(); const instance = reader(config, session, {clock: time, scheduler: time, local: pending, mqtt: pending});
  const active = instance.readStatus(); const abort = new AbortController(); const cancelled = instance.readStatus({signal: abort.signal});
  const queued = Array.from({length: 7}, () => instance.readStatus());
  assert.equal(code(await instance.readStatus()), 'capacity'); assert.equal(sent, 1);
  abort.abort(); assert.equal(code(await cancelled), 'cancelled');
  instance.stop(); assert.equal(code(await active), 'cancelled'); assert.ok((await Promise.all(queued)).every(value => code(value) === 'cancelled'));
  release?.({kind: 'json', value: ['late']}); await tick(); assert.equal(sent, 1); assert.equal(time.jobs.size, 0);
});
void test('deadlines include waiting, stop retires late results, invalid record inputs never transmit', async () => {
  const time = new Time(); let sent = 0;
  const pending = (): Promise<WireResult> => {sent++; return new Promise(() => {});};
  const instance = reader(config, session, {clock: time, scheduler: time, local: pending, mqtt: pending});
  assert.equal(code(await instance.readCleanRecord(-1)), 'invalid-request');
  const first = instance.readStatus({timeoutMs: 100}); const second = instance.readStatus({timeoutMs: 50});
  time.advance(50); assert.equal(code(await second), 'unavailable'); assert.equal(sent, 1);
  time.advance(50); assert.equal(code(await first), 'unavailable');
  instance.stop(); assert.equal(code(await instance.readStatus()), 'cancelled'); assert.equal(time.jobs.size, 0);
});
void test('auth/malformed replies are not retried and errors, telemetry and results exclude credential sentinels', async () => {
  let calls = 0; const records: unknown[] = [];
  const fail = (): Promise<WireResult> => {calls++; return Promise.reject(new SdkError(errorBody('unauthenticated', {detail: session.rriot.s})));};
  const log = {debug: (...args: unknown[]) => {records.push(args);}, info: (...args: unknown[]) => {records.push(args);}, warn: (...args: unknown[]) => {records.push(args);}, error: (...args: unknown[]) => {records.push(args);}};
  const time = new Time(); const instance = reader(config, session, {clock: time, scheduler: time, local: fail, mqtt: fail, log});
  const result = await instance.readStatus(); assert.equal(code(result), 'unauthenticated'); assert.equal(calls, 1);
  assert.equal(JSON.stringify([result, records]).includes('sentinel'), false); instance.stop();
  const leaks = reader(config, session, {clock: time, scheduler: time, local: () => Promise.resolve({kind: 'json', value: {secret: session.rriot.k}}), mqtt: fail});
  const leaked = await leaks.readStatus(); assert.equal(code(leaked), 'unavailable'); assert.equal(JSON.stringify(leaked).includes('sentinel'), false); leaks.stop();
});

void test('only connection failures retry once with fresh correlation; cancellation interrupts backoff', async () => {
  const time = new Time(); const requests: WireRequest[] = [];
  const local = (_config: Config, _session: Session, request: WireRequest): Promise<WireResult> => {requests.push(request); return requests.length === 1 ? Promise.reject(new ConnectionFailure()) : Promise.resolve({kind: 'json', value: [{battery: 0}]});};
  const instance = reader(config, session, {clock: time, scheduler: time, local, mqtt: local});
  const result = instance.readStatus(); await tick(); assert.equal(requests.length, 1);
  time.advance(249); await tick(); assert.equal(requests.length, 1);
  time.advance(1); assert.equal((await result).ok, true); assert.equal(requests.length, 2);
  assert.notEqual(requests[0]?.id, requests[1]?.id); assert.notDeepEqual(requests[0]?.nonce, requests[1]?.nonce); instance.stop();
  const abort = new AbortController(); let calls = 0;
  const fail = (): Promise<WireResult> => {calls++; return Promise.reject(new ConnectionFailure());};
  const second = reader(config, session, {clock: time, scheduler: time, local: fail, mqtt: fail});
  const pending = second.readStatus({signal: abort.signal}); await tick(); abort.abort();
  assert.equal(code(await pending), 'cancelled'); time.advance(250); await tick(); assert.equal(calls, 1); second.stop(); assert.equal(time.jobs.size, 0);
});
void test('registered availability diagnostics and spans preserve parentage and close even on a fenced late sender', async () => {
  const time = new Time(); const records: HarnessRecord[] = []; const spans = new RecordedSpans();
  const record = (level: HarnessRecord['level']) => (event: string, fields: HarnessRecord['fields'] = {}, trace?: HarnessRecord['trace']): void => {records.push({level, event, fields, ...(trace === undefined ? {} : {trace})});};
  const log = {debug: record('debug'), info: record('info'), warn: record('warn'), error: record('error')};
  const parent = {traceparent: '00-11111111111111111111111111111111-2222222222222222-01'};
  let failures = true;
  const local = (): Promise<WireResult> => failures ? Promise.reject(new SdkError(errorBody('unavailable'))) : Promise.resolve({kind: 'json', value: []});
  const instance = reader(config, session, {clock: time, scheduler: time, local, mqtt: local, log, trace: spans});
  await instance.readStatus({trace: parent}); await instance.readStatus({trace: parent}); time.advance(60000); await instance.readStatus({trace: parent}); failures = false; await instance.readStatus({trace: parent}); instance.stop();
  assert.deepEqual(records.map(entry => [entry.level, entry.event]), [['warn', 'device.unavailable'], ['debug', 'device.unavailable'], ['info', 'device.available']]);
  for (const entry of records) assert.equal(checkModuleRecord('roborock', entry), undefined);
  assert.ok(spans.spans.every(span => span.traceId === '11111111111111111111111111111111' && span.parentSpanId === '2222222222222222' && span.endedAtMs !== undefined));
  assert.equal(JSON.stringify([records, spans.spans]).includes('sentinel'), false);
  const hung = reader(config, session, {clock: time, scheduler: time, local: () => new Promise(() => {}), mqtt: local, trace: spans}); const pending = hung.readStatus({trace: parent}); hung.stop(); await pending;
  assert.ok(spans.spans.every(span => span.endedAtMs !== undefined));
});

void test('known account IDs and derived broker credentials cannot escape in JSON or raw-map results', async () => {
  const vector = JSON.parse(readFileSync(new URL('../../tests/fixtures/v1.json', import.meta.url), 'utf8')) as {mqttUsername: string; mqttPassword: string};
  const secrets = [session.rriot.u, session.rriot.s, session.rriot.k, session.localKey, vector.mqttUsername, vector.mqttPassword];
  for (const secret of secrets) {
    const time = new Time();
    const local = (): Promise<WireResult> => Promise.resolve({kind: 'json', value: {account: secret}});
    const mqtt = (): Promise<WireResult> => Promise.resolve({kind: 'map', bytes: Buffer.from(`map containing ${secret}`)});
    const instance = reader(config, session, {clock: time, scheduler: time, local, mqtt});
    const json = await instance.readStatus(); assert.equal(code(json), 'unavailable'); assert.equal(JSON.stringify(json).includes(secret), false);
    const map = await instance.readCurrentMap(); assert.equal(code(map), 'unavailable'); instance.stop();
  }
  const escapedSession = {...session, rriot: {...session.rriot, s: 'sentinel"secret'}};
  const wire = (): Promise<WireResult> => Promise.resolve({kind: 'json', value: {secret: escapedSession.rriot.s}});
  const escaped = reader(config, escapedSession, {local: wire, mqtt: wire});
  assert.equal(code(await escaped.readStatus()), 'unavailable'); escaped.stop();
});
