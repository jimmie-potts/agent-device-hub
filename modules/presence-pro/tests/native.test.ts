import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer, type Socket} from 'node:net';
import {createRequire} from 'node:module';
import {test, type TestContext} from 'node:test';
import {channels} from '../src/configuration.js';
import {nativeFactory, switchMissing, type NativeFault} from '../src/native.js';
import type {ScalarReport} from '../src/projection.js';
import {SYNTHETIC_SENSOR, reports} from '../src/simulated.js';

const varint = (value: number): Buffer => {
  const out: number[] = []; do { out.push(value % 128 | (value >= 128 ? 128 : 0)); value = Math.floor(value / 128); } while (value > 0); return Buffer.from(out);
};
const scalar = (field: number, value: number): Buffer => Buffer.concat([varint(field * 8), varint(value)]);
const text = (field: number, value: string): Buffer => Buffer.concat([varint(field * 8 + 2), varint(Buffer.byteLength(value)), Buffer.from(value)]);
const fixed = (field: number, value: number): Buffer => { const result = Buffer.alloc(5); result[0] = field * 8 + 5; result.writeUInt32LE(value, 1); return result; };
const float = (field: number, value: number): Buffer => { const result = Buffer.alloc(5); result[0] = field * 8 + 5; result.writeFloatLE(value, 1); return result; };
const frame = (type: number, body: Buffer = Buffer.alloc(0)): Buffer => Buffer.concat([Buffer.from([0]), varint(body.length), varint(type), body]);
const TYPES = {BinarySensor: [12, 21], Sensor: [16, 25], Switch: [17, 26], Number: [49, 50], Select: [52, 53], Text: [97, 98]} as const;
const until = async (check: () => boolean): Promise<void> => {
  const end = Date.now() + 1500;
  while (!check()) { assert.ok(Date.now() < end, 'expected callback arrives'); await new Promise(resolve => { setTimeout(resolve, 5); }); }
};
async function device(t: TestContext, options: {invalidPassword?: boolean; wrongIdentity?: boolean; missingEntity?: boolean; silence?: boolean; noiseMismatch?: boolean} = {}) {
  const sockets = new Set<Socket>(), requests: {type: number; body: Buffer}[] = [], raw: Buffer[] = [];
  const server = createServer(socket => {
    sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => { sockets.delete(socket); });
    let buffer = Buffer.alloc(0);
    socket.on('data', data => {
      raw.push(data);
      if (options.silence === true) return;
      if (options.noiseMismatch === true) { socket.write(Buffer.from([0, 0, 0])); return; }
      buffer = Buffer.concat([buffer, data]);
      while (buffer.length > 2) {
        let offset = 1;
        const read = (): number | undefined => { let value = 0, shift = 0; while (offset < buffer.length) { const byte = buffer[offset++] as number; value += (byte & 127) * 2 ** shift; if (byte < 128) return value; shift += 7; } return undefined; };
        const length = read(), type = read();
        if (length === undefined || type === undefined || offset + length > buffer.length) return;
        const body = buffer.subarray(offset, offset + length); buffer = buffer.subarray(offset + length); requests.push({type, body});
        if (type === 1) socket.write(frame(2, Buffer.concat([scalar(1, 1), scalar(2, 14)])));
        if (type === 3) socket.write(frame(4, options.invalidPassword === true ? scalar(1, 1) : Buffer.alloc(0)));
        if (type === 9) socket.write(frame(10, text(3, options.wrongIdentity === true ? '02:00:00:00:00:99' : '02:00:00:00:00:41')));
        if (type === 11) {
          for (const channel of channels(SYNTHETIC_SENSOR)) if (options.missingEntity !== true || channel.binding.key !== 1) socket.write(frame(TYPES[channel.type][0], fixed(2, channel.binding.key)));
          socket.write(frame(19));
        }
        if (type === 20) for (const report of reports()) send(report);
        if (type === 5) socket.write(frame(6));
        if (type === 7) socket.write(frame(8));
      }
    });
  });
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); assert.ok(address !== null && typeof address !== 'string');
  const send = (report: ScalarReport): void => {
    const channel = channels(SYNTHETIC_SENSOR).find(channel => channel.binding.key === report.key); assert.ok(channel);
    const data = typeof report.value === 'boolean' ? report.value ? scalar(2, 1) : Buffer.alloc(0)
      : typeof report.value === 'number' ? report.value === 0 ? Buffer.alloc(0) : float(2, report.value)
      : report.value === '' ? Buffer.alloc(0) : text(2, String(report.value));
    const missing = report.missing === true ? scalar(channel.type === 'Switch' ? 4 : 3, 1) : Buffer.alloc(0);
    for (const socket of sockets) socket.write(frame(TYPES[channel.type][1], Buffer.concat([fixed(1, report.key), data, missing])));
  };
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => { server.close(() => { resolve(); }); }); });
  return {sensor: {...SYNTHETIC_SENSOR, address: '127.0.0.1', port: address.port}, requests, raw, send};
}
void test('real Native API discovers typed numeric keys and preserves omitted false, zero, empty and missing-state reports', async t => {
  const wire = await device(t), seen: ScalarReport[] = [];
  const session = nativeFactory(wire.sensor, {}, {report: report => { seen.push(report); }, disconnected: () => {}}); t.after(() => { session.close(); });
  await session.open(AbortSignal.timeout(2000)); await until(() => seen.length === reports().length);
  for (const key of [5, 9]) assert.equal(seen.find(report => report.key === key)?.value, false);
  assert.equal(seen.find(report => report.key === 8)?.value, 0); assert.equal(seen.find(report => report.key === 11)?.value, '');
  wire.send({key: 1, value: false}); wire.send({key: 4, value: false}); wire.send({key: 9, value: false, missing: true});
  await until(() => seen.length === reports().length + 3);
  assert.deepEqual(seen.slice(-3), [{key: 1, value: false, missing: false}, {key: 4, value: false, missing: false}, {key: 9, value: false, missing: true}]);
  assert.ok(wire.requests.every(request => [1, 3, 9, 11, 20, 5, 7].includes(request.type)), 'read-only protocol traffic');
});
void test('a configured password is sent only as configured, invalid password and identity/entity mismatch refuse acquisition', async t => {
  const cases: [Parameters<typeof device>[1], NativeFault['code']][] = [[{invalidPassword: true}, 'forbidden'], [{wrongIdentity: true}, 'forbidden'], [{missingEntity: true}, 'unsupported-capability']];
  for (const [options, code] of cases) {
    const wire = await device(t, options); const session = nativeFactory(wire.sensor, {password: 'synthetic-password'}, {report: () => {}, disconnected: () => {}});
    await assert.rejects(session.open(AbortSignal.timeout(2000)), (error: unknown) => error instanceof Error && error.message === code);
    session.close();
    assert.ok(wire.requests.some(request => request.type === 3 && request.body.includes(Buffer.from('synthetic-password'))));
    assert.ok(!wire.requests.some(request => request.type === 20));
  }
});
void test('configured Noise rejects a plaintext peer without any plaintext authentication or discovery fallback', async t => {
  const wire = await device(t, {noiseMismatch: true});
  const session = nativeFactory({...wire.sensor, security: {mode: 'noise', keySecret: 'key'}}, {key: Buffer.alloc(32, 2).toString('base64')}, {report: () => {}, disconnected: () => {}});
  await assert.rejects(session.open(AbortSignal.timeout(2000))); session.close();
  assert.ok(wire.raw.length > 0); assert.ok(wire.raw.every(chunk => chunk[0] === 1), 'only Noise framing was sent');
});
void test('configured Noise successfully reads through the real encrypted client using a synthetic responder', async t => {
  type Cipher = {EncryptWithAd(ad: number[], bytes: Uint8Array): Uint8Array; DecryptWithAd(ad: number[], bytes: Uint8Array): Uint8Array};
  type Handshake = {Initialize(prologue: Uint8Array, local: null, remote: null, key: Uint8Array): void; ReadMessage(bytes: Uint8Array, final: boolean): void; WriteMessage(): Uint8Array; Split(): [Cipher, Cipher]};
  type Noise = {constants: {NOISE_ROLE_RESPONDER: number}; HandshakeState(name: string, role: number): Handshake};
  const createNoise = createRequire(import.meta.url)('@richardhopton/noise-c.wasm') as (ready: (noise: Noise) => void) => void;
  const noise = await new Promise<Noise>(resolve => { createNoise(resolve); });
  const key = Buffer.alloc(32, 7), sockets = new Set<Socket>(), faults: unknown[] = [], seen: ScalarReport[] = [];
  const server = createServer(socket => {
    sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => { sockets.delete(socket); });
    const handshake = noise.HandshakeState('Noise_NNpsk0_25519_ChaChaPoly_SHA256', noise.constants.NOISE_ROLE_RESPONDER);
    handshake.Initialize(new Uint8Array(Buffer.from('NoiseAPIInit\0\0')), null, null, new Uint8Array(key));
    let stage = 0, buffer: Buffer = Buffer.alloc(0), transmit: Cipher | undefined, receive: Cipher | undefined;
    const sendRaw = (body: Uint8Array): void => { const header = Buffer.alloc(3); header[0] = 1; header.writeUInt16BE(body.length, 1); socket.write(Buffer.concat([header, body])); };
    const send = (type: number, body: Buffer = Buffer.alloc(0)): void => {
      assert.ok(transmit); const header = Buffer.alloc(4); header.writeUInt16BE(type, 0); header.writeUInt16BE(body.length, 2);
      sendRaw(transmit.EncryptWithAd([], Buffer.concat([header, body])));
    };
    socket.on('data', chunk => {
      try {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 3 && buffer.length >= 3 + buffer.readUInt16BE(1)) {
          assert.equal(buffer[0], 1); const length = buffer.readUInt16BE(1), body = buffer.subarray(3, 3 + length); buffer = buffer.subarray(3 + length);
          if (stage === 0) { sendRaw(Buffer.from([1])); stage = 1; }
          else if (stage === 1) {
            handshake.ReadMessage(body.subarray(1), true); sendRaw(Buffer.concat([Buffer.from([0]), handshake.WriteMessage()]));
            [transmit, receive] = handshake.Split(); stage = 2;
          } else {
            assert.ok(receive); const decoded = Buffer.from(receive.DecryptWithAd([], body)), type = decoded.readUInt16BE(0);
            if (type === 1) send(2, Buffer.concat([scalar(1, 1), scalar(2, 14)]));
            if (type === 9) send(10, text(3, '02:00:00:00:00:41'));
            if (type === 11) { send(12, fixed(2, 1)); send(19); }
            if (type === 20) send(21, Buffer.concat([fixed(1, 1), scalar(2, 1)]));
            if (type === 5) send(6);
          }
        }
      } catch (error) { faults.push(error); socket.destroy(); }
    });
  });
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); assert.ok(address !== null && typeof address !== 'string');
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => { server.close(() => { resolve(); }); }); });
  const {held: _held, settings: _settings, calibration: _calibration, ...sensor} = SYNTHETIC_SENSOR;
  const session = nativeFactory({...sensor, targets: [], zones: [], address: '127.0.0.1', port: address.port, security: {mode: 'noise', keySecret: 'key'}}, {key: key.toString('base64')}, {report: report => { seen.push(report); }, disconnected: () => {}});
  t.after(() => { session.close(); });
  await session.open(AbortSignal.timeout(2000)); await until(() => seen.length === 1);
  assert.deepEqual(seen, [{key: 1, value: true, missing: false}]); assert.deepEqual(faults, []);
});
void test('switch compatibility scanner skips length fields, detects unknown, and rejects truncated/oversized varints', () => {
  assert.equal(switchMissing(Buffer.concat([text(6, 'unknown'), fixed(1, 9), scalar(4, 1)])), true);
  assert.equal(switchMissing(fixed(1, 9)), false);
  assert.throws(() => switchMissing(Buffer.from([0x32, 0x7f])));
  assert.throws(() => switchMissing(Buffer.alloc(12, 0x80)));
});
void test('a refused TCP connection stays unavailable even when Noise and a password are configured', async () => {
  const server = createServer(); await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); assert.ok(address !== null && typeof address !== 'string');
  await new Promise<void>(resolve => { server.close(() => { resolve(); }); });
  const session = nativeFactory({...SYNTHETIC_SENSOR, address: '127.0.0.1', port: address.port, security: {mode: 'noise', keySecret: 'key', passwordSecret: 'password'}},
    {key: Buffer.alloc(32, 2).toString('base64'), password: 'synthetic-password'}, {report: () => {}, disconnected: () => {}});
  await assert.rejects(session.open(AbortSignal.timeout(2000)), (error: unknown) => error instanceof Error && error.message === 'unavailable'); session.close();
});
void test('disposal during a silent Hello survives the library late five-second rejection in a child process', {timeout: 10_000}, async t => {
  const wire = await device(t, {silence: true});
  const script = `import {nativeFactory} from ${JSON.stringify(new URL('../src/native.js', import.meta.url).href)};
    const session=nativeFactory(${JSON.stringify(wire.sensor)}, {}, {report(){},disconnected(){}});
    const abort=new AbortController(); const opened=session.open(abort.signal).catch(()=>{});
    setTimeout(()=>{abort.abort();session.close();},20);
    await opened; await new Promise(resolve=>setTimeout(resolve,5400));`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {stdio: ['ignore', 'pipe', 'pipe']});
  let output = ''; child.stderr.on('data', data => { output += String(data); });
  const result = await new Promise<number | null>((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
  assert.equal(result, 0, output); assert.doesNotMatch(output, /unhandled|uncaught/i);
});
