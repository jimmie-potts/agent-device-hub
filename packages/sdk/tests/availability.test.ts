// Repeated device failures (ADR 0012, "Observability", "Repetition"; Hub #949): a polled device that stays offline logs
// one degradation and one recovery, not a warning per poll, and its repeated failures are summarized at DEBUG at most
// once a minute.
import assert from 'node:assert/strict';
import {DeviceAvailability} from '../src/index.js';
import {START, it, logRecorder} from './support.js';

const PARENT = {traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'};

function polled(): {devices: DeviceAvailability; entries: ReturnType<typeof logRecorder>['entries']; advance: (ms: number) => void} {
  const {log, entries} = logRecorder();
  let now = START;
  return {devices: new DeviceAvailability({log, clock: {now: () => now}}), entries, advance: ms => { now += ms; }};
}

it('a polled device that stays offline logs one degradation and one recovery, with its repeats summarized', () => {
  const {devices, entries, advance} = polled();
  for (let poll = 0; poll < 200; poll += 1) {
    devices.unreachable('lamp-1', 'unavailable');
    advance(3000);
  }
  devices.reached('lamp-1', PARENT);
  devices.reached('lamp-1');
  assert.deepEqual(entries.filter(entry => entry.level !== 'debug'), [
    {level: 'warn', event: 'device.unavailable', fields: {'bunny.device.id': 'lamp-1', 'bunny.code': 'unavailable', 'bunny.attempt_count': 1}},
    {level: 'info', event: 'device.available', fields: {'bunny.device.id': 'lamp-1', 'bunny.attempt_count': 200, 'bunny.duration_ms': 600_000}, trace: PARENT},
  ], 'one degradation and one recovery that counts every failed poll; a success while available logs nothing');
  const summaries = entries.filter(entry => entry.level === 'debug');
  assert.ok(summaries.length > 0 && summaries.length <= 10, `at most one summary a minute, ${summaries.length} in ten minutes`);
  assert.ok(summaries.every(entry => entry.event === 'device.unavailable' && entry.fields['bunny.device.id'] === 'lamp-1'));
  const counted = summaries.reduce((sum, entry) => sum + Number(entry.fields['bunny.attempt_count']), 0);
  assert.ok(counted <= 199, 'a summary counts only the repeats since the last record');
});

it('each device is tracked apart, a device that fails again after recovering degrades again, and a working device logs nothing', () => {
  const {devices, entries, advance} = polled();
  for (let poll = 0; poll < 5; poll += 1) devices.reached('lamp-2');
  devices.unreachable('lamp-1', 'unavailable', PARENT);
  devices.unreachable('lamp-2', 'expired');
  advance(1000);
  devices.reached('lamp-1');
  devices.unreachable('lamp-1', 'unavailable');
  const shown = entries.map(entry => `${entry.level} ${entry.event} ${String(entry.fields['bunny.device.id'])} ${String(entry.fields['bunny.attempt_count'])}`);
  assert.deepEqual(shown, [
    'warn device.unavailable lamp-1 1', 'warn device.unavailable lamp-2 1', 'info device.available lamp-1 1', 'warn device.unavailable lamp-1 1',
  ]);
  assert.deepEqual(entries[0]?.trace, PARENT, 'the record carries the poll\'s trace');
});

it('a logger that throws never reaches the module', () => {
  const devices = new DeviceAvailability({log: {debug: () => {}, info: () => { throw new Error('sink'); }, warn: () => { throw new Error('sink'); }, error: () => {}},
    clock: {now: () => START}});
  assert.doesNotThrow(() => {
    devices.unreachable('lamp-1', 'unavailable');
    devices.reached('lamp-1');
  });
});
