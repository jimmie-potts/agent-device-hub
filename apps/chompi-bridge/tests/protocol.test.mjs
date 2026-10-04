import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  PROTOCOL_VERSION, REPORT_BYTES, LED_COUNT, REJECT_REASONS,
  decodeDeviceReport, decodeHostReport, encodeReport, ledFrameReports, isPressControl, isTurnControl,
} from '../dist/protocol.js';

const require = createRequire(import.meta.url);
const fixtures = JSON.parse(readFileSync(require.resolve('@jimmie-potts/chompi-protocol/fixtures/v1.json'), 'utf8'));
const bytes = hex => Uint8Array.from(Buffer.from(hex, 'hex'));
const hex = report => Buffer.from(report).toString('hex');
const decoderFor = direction => direction === 'device-to-host' ? decodeDeviceReport : decodeHostReport;

test('the codec targets the fixture protocol and report size', () => {
  assert.equal(fixtures.protocol, 'chompi-hid');
  assert.equal(fixtures.version, PROTOCOL_VERSION);
  assert.equal(fixtures.reportBytes, REPORT_BYTES);
  assert.equal(LED_COUNT, 35);
});

for (const vector of fixtures.vectors) {
  test(`fixture vector: ${vector.name}`, () => {
    const decoded = decoderFor(vector.direction)(bytes(vector.report));
    if (vector.valid) {
      assert.deepEqual(decoded, { ok: true, message: vector.message });
      assert.equal(hex(encodeReport(vector.message)), vector.report);
    } else {
      assert.deepEqual(decoded, { ok: false, reason: vector.reason });
    }
  });
}

test('every rejection reason named by the contract appears in the fixtures', () => {
  const reasons = new Set(fixtures.vectors.filter(v => !v.valid).map(v => v.reason));
  assert.deepEqual([...reasons].sort(), [...REJECT_REASONS].sort());
});

test('each direction treats the other direction\'s message types as unknown', () => {
  for (const vector of fixtures.vectors.filter(v => v.valid)) {
    const other = vector.direction === 'device-to-host' ? decodeHostReport : decodeDeviceReport;
    assert.deepEqual(other(bytes(vector.report)), { ok: false, reason: 'unknown-type' }, vector.name);
  }
});

test('length is checked before type and version, and long reports are rejected too', () => {
  assert.deepEqual(decodeDeviceReport(new Uint8Array(65)), { ok: false, reason: 'invalid-length' });
  assert.deepEqual(decodeDeviceReport(new Uint8Array(0)), { ok: false, reason: 'invalid-length' });
  assert.deepEqual(decodeHostReport(new Uint8Array(63)), { ok: false, reason: 'invalid-length' });
});

test('nonzero unused bytes are ignored and reserved heartbeat flag bits do not change the result', () => {
  const report = bytes(fixtures.vectors.find(v => v.name === 'heartbeat').report);
  report[6] = 0xfe; report[63] = 0xff;
  assert.deepEqual(decodeDeviceReport(report), { ok: true, message: { type: 'heartbeat', version: 1, epoch: 4660, ledFrame: 7, hostAlive: false } });
});

test('a press or release on a turn ID and a turn on a click ID are invalid kinds', () => {
  const input = (control, kind, delta) => { const r = new Uint8Array(64); r.set([2, 1, 1, 0, 1, 0, control, kind, delta & 0xff]); return r; };
  assert.deepEqual(decodeDeviceReport(input(41, 1, 0)), { ok: false, reason: 'invalid-kind' });
  assert.deepEqual(decodeDeviceReport(input(46, 2, 0)), { ok: false, reason: 'invalid-kind' });
  assert.deepEqual(decodeDeviceReport(input(29, 3, 1)), { ok: false, reason: 'invalid-kind' });
  for (const control of [0, 35, 40, 47, 255]) assert.deepEqual(decodeDeviceReport(input(control, 1, 0)), { ok: false, reason: 'invalid-control' });
  assert.equal(decodeDeviceReport(input(34, 1, 0)).ok, true);
  assert.equal(decodeDeviceReport(input(46, 3, -128)).ok, true);
});

test('control ID helpers follow the contract table', () => {
  const press = [], turn = [];
  for (let id = 0; id < 256; id++) { if (isPressControl(id)) press.push(id); if (isTurnControl(id)) turn.push(id); }
  assert.deepEqual(press, Array.from({ length: 34 }, (_, i) => i + 1));
  assert.deepEqual(turn, [41, 42, 43, 44, 45, 46]);
});

test('a 35-color frame splits into the two fixture parts', () => {
  const part0 = fixtures.vectors.find(v => v.name === 'leds frame 7 part 0');
  const part1 = fixtures.vectors.find(v => v.name === 'leds frame 7 part 1');
  const colors = [...part0.message.colors, ...part1.message.colors];
  assert.deepEqual(ledFrameReports(7, colors).map(hex), [part0.report, part1.report]);
});

test('encoding refuses messages the receiver would reject', () => {
  const colors = Array.from({ length: 35 }, () => [1, 2, 3]);
  assert.throws(() => ledFrameReports(1, colors.slice(1)), RangeError);
  assert.throws(() => ledFrameReports(1, colors.map((c, i) => i === 3 ? [256, 0, 0] : c)), RangeError);
  assert.throws(() => ledFrameReports(1, colors.map((c, i) => i === 3 ? [1.5, 0, 0] : c)), RangeError);
  assert.throws(() => ledFrameReports(65536, colors), RangeError);
  assert.throws(() => encodeReport({ type: 'host-heartbeat', version: 1, profileVersion: 0, brightnessPercent: 101 }), RangeError);
  assert.throws(() => encodeReport({ type: 'host-heartbeat', version: 1, profileVersion: 2 ** 32, brightnessPercent: 1 }), RangeError);
  assert.throws(() => encodeReport({ type: 'input', version: 1, epoch: 1, sequence: 1, control: 3, kind: 'turn', delta: 1 }), RangeError);
  assert.throws(() => encodeReport({ type: 'input', version: 1, epoch: 1, sequence: 1, control: 41, kind: 'turn', delta: 0 }), RangeError);
  assert.throws(() => encodeReport({ type: 'leds', version: 1, frame: 1, part: 1, first: 19, colors: colors.slice(0, 19) }), RangeError);
  assert.throws(() => encodeReport({ type: 'hello', version: 2, epoch: 1, firmware: [0, 1, 0], controls: 34, encoders: 6, leds: 35 }), RangeError);
  assert.throws(() => encodeReport({ type: 'bogus', version: 1 }), RangeError);
});
