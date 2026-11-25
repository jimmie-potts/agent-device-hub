import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import type {DeviceHistoryQuery} from '@jimmie-potts/event-contracts/v2/assistant-actions';
import {History} from '../src/core/history.js';
import {devicePowerHistoryTool} from '../src/core/read-tools.js';

void test('the Core host and bounded tool share whole device evidence, including gaps, removal and competing causes', () => {
  const database = new DatabaseSync(':memory:');
  try {
    const history = new History(database);
    const append = database.prepare(`INSERT INTO core_history
      (at_ms, revision, kind, source, type, subject, request_id, record, origin, origin_seq)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const source of ['bunny/modules/wemo', 'bunny/modules/lifx'] as const) {
      let ordinal = source === 'bunny/modules/wemo' ? 0 : 100;
      const target = source.endsWith('wemo') ? 'fixture-plug' : 'fixture-light';
      const add = (at: number, kind: string, type: string, record: object, request: string | null = null) =>
        append.run(at, ++ordinal, kind, source, type, target, request, JSON.stringify(record), history.origin, ordinal);
      const change = (at: number, on: boolean, extras: Record<string, unknown> = {}, requests: string[] = []) =>
        add(at, 'change', 'org.bunny.device.updated', {family: 'device', id: target, revision: ordinal + 1,
          changed: {observed: {status: 'known', power: {status: 'known', value: on}, observedAtMs: at},
            powerReadbacks: requests.map(requestId => ({requestId, requestedOn: on, reading: {status: 'known', observedAtMs: at, on}}))}, ...extras});
      const step = (at: number, event: string, requestId: string, status: object = {}) =>
        add(at, 'operation', 'power-set', {command: 'power-set', event, ...status}, requestId);
      change(100, true);
      change(230, false, {span: {lastConfirmedAtMs: 180}}, ['one']);
      step(205, 'sent', 'one');
      step(231, 'reply', 'one', {reply: 'accepted'});
      step(232, 'outcome', 'one', {result: 'succeeded', evidence: 'observed'});
      change(310, false, {gapMs: 60, span: {lastConfirmedAtMs: 250}});
      change(350, true, {}, ['two', 'three']);
      step(340, 'sent', 'two');
      step(351, 'outcome', 'two', {result: 'succeeded', evidence: 'observed'});
      add(400, 'removal', 'org.bunny.device.removed', {});
      const query: DeviceHistoryQuery = {source, target, fromAtMs: 125, toAtMs: 500};
      const snapshot = history.devicePower(query);
      assert.equal(snapshot.complete, true);
      assert.deepEqual(snapshot.durations, {on: 55, off: 20, unknown: 300});
      assert.deepEqual(snapshot.evidence.map(row => row.kind), ['observation', 'observation', 'gap', 'observation', 'removal']);
      assert.equal(snapshot.lastChange?.atMs, 350);
      assert.deepEqual(snapshot.causes.map(cause => cause.requestId), ['one']);
      const tool = devicePowerHistoryTool(input => history.devicePower(input));
      assert.deepEqual(tool.read(query), snapshot);
      assert.deepEqual(history.read({kind: 'operation'}).map(row => row.record.event).slice(-5), ['sent', 'reply', 'outcome', 'sent', 'outcome']);
    }
  } finally {database.close();}
});

void test('an open span is captured even when its confirmation does not advance the fact boundary', () => {
  const database = new DatabaseSync(':memory:');
  try {
    const source = 'bunny/modules/wemo', target = 'fixture-plug';
    const history = new History(database);
    const write = (revision: number, atMs: number) => history.write([{kind: 'message', message: {
      specversion: '1.0', bunnyprofile: '2.0', id: `fixture-${String(revision)}`, source, type: 'org.bunny.device.updated', subject: target,
      time: new Date(atMs).toISOString(), kind: 'state', datacontenttype: 'application/json',
      dataschema: 'https://bunny.invalid/events/device/2.0', traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      data: {id: target, revision, availability: 'available',
        observed: {status: 'known', observedAtMs: atMs, power: {status: 'known', value: true}}},
    }}], atMs, revision);
    const query: DeviceHistoryQuery = {source, target, fromAtMs: 110, toAtMs: 200};
    write(1, 100);
    write(2, 140);
    const captured = history.devicePower(query);
    write(3, 180);
    const fresh = history.devicePower(query);
    assert.equal(fresh.boundary, captured.boundary);
    assert.deepEqual(captured.durations, {on: 30, off: 0, unknown: 60});
    assert.deepEqual(fresh.durations, {on: 70, off: 0, unknown: 20});
    assert.equal(captured.evidence[0]?.confirmedThroughMs, 140);
    assert.equal(fresh.evidence[0]?.confirmedThroughMs, 180);
  } finally {database.close();}
});

void test('post-window rows cannot displace requested evidence and oversized rows break duration coverage', () => {
  const database = new DatabaseSync(':memory:');
  try {
    const source = 'bunny/modules/wemo', target = 'fixture-plug';
    const query: DeviceHistoryQuery = {source, target, fromAtMs: 105, toAtMs: 250};
    const history = new History(database);
    const insert = database.prepare(`INSERT INTO core_history
      (at_ms, revision, kind, source, type, subject, record, origin, origin_seq)
      VALUES (?, ?, 'change', ?, 'org.bunny.device.updated', ?, ?, ?, ?)`);
    let seq = 0;
    const row = (atMs: number, on: boolean, extra: object = {}) =>
      insert.run(atMs, ++seq, source, target, JSON.stringify({family: 'device', id: target, revision: seq,
        changed: {observed: {status: 'known', observedAtMs: atMs, power: {status: 'known', value: on}}}, ...extra}), history.origin, seq);
    row(100, true);
    row(125, true, {oversized: 'x'.repeat(20_000)});
    row(200, false, {span: {lastConfirmedAtMs: 190}});
    row(260, false, {span: {lastConfirmedAtMs: 230}});
    for (let index = 0; index < 900; index += 1) row(261 + index, false);
    const result = history.devicePower(query);
    assert.deepEqual(result.evidence.map(point => [point.atMs, point.power]), [[125, 'unknown'], [200, 'off']]);
    assert.deepEqual(result.durations, {on: 0, off: 30, unknown: 115});
    assert.equal(result.complete, false);
  } finally {database.close();}
});
