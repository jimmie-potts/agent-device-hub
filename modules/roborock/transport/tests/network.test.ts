import assert from 'node:assert/strict';
import {deferred} from './helpers.js';
import {createConnection, createServer, type Socket} from 'node:net';
import {once} from 'node:events';
import {test} from 'node:test';
import {SdkError} from '@jimmie-potts/sdk';
import {decodeV1, encodeV1, TcpFrames, wrapTcp} from '../src/transport/codec.js';
import {localRead, MqttPacketGuard} from '../src/transport/network.js';
import type {Config, Session} from '../src/transport/private.js';
import type {WireRequest} from '../src/transport/reader.js';
const config: Config = {schemaVersion: 1, deviceId: 'synthetic-robot', address: '127.0.0.1', broker: 'mqtts://mqtt-us.roborock.com:8883', region: 'us'};
const session: Session = {schemaVersion: 1, deviceId: config.deviceId, model: 'roborock.vacuum.a97', protocol: '1.0', localKey: '0123456789abcdef', rriot: {u: 'synthetic-user', s: 'sentinel-auth-secret', k: 'sentinel-auth-key'}, broker: config.broker};
const request: WireRequest = {method: 'get_status', params: [], id: 42, seq: 7, seconds: 1700000000, nonce: Buffer.alloc(16, 0xab)};
function connack(code = 0): Buffer { const frame = Buffer.alloc(21); frame.write('1.0'); frame.writeUInt32BE(9, 7); frame.writeUInt16BE(1, 15); frame.writeUInt32BE(code, 17); return wrapTcp(frame); }
async function peer(reply: (socket: Socket, frames: Buffer[]) => void): Promise<{port: number; close: () => Promise<void>}> {
  const clients = new Set<Socket>();
  const server = createServer(socket => {clients.add(socket); socket.on('close', () => clients.delete(socket)); socket.on('error', () => {}); const frames = new TcpFrames(); socket.on('data', (chunk: Buffer) => reply(socket, frames.push(chunk)));});
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); assert.ok(address !== null && typeof address === 'object');
  return {port: address.port, close: () => {for (const socket of clients) socket.destroy(); return new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error)));}};
}
void test('real loopback TCP handshake and fragmented vendor reply reach the exact final read encoder', async () => {
  const received: string[] = [];
  const server = await peer((socket, frames) => { for (const frame of frames) {
    const protocol = frame.readUInt16BE(15);
    if (protocol === 0) {assert.equal(frame.readUInt32BE(3), 0); assert.equal(frame.readUInt32BE(11), 0); assert.equal(frame.readUInt32BE(17), 10); socket.write(connack().subarray(0, 3)); socket.write(connack().subarray(3)); continue;}
    if (protocol !== 4) continue;
    const envelope = JSON.parse(decodeV1(frame, session.localKey).payload.toString()) as {dps: {'101': string}};
    const rpc = JSON.parse(envelope.dps['101']) as {id: number; method: string; params: unknown[]};
    received.push(rpc.method); assert.deepEqual(rpc.params, rpc.method === 'get_clean_record' ? [1700000000] : []); assert.equal(rpc.id, 42);
    const payload = Buffer.from(JSON.stringify({dps: {'102': JSON.stringify({id: 42, result: [{battery: 95}]})}}));
    const response = wrapTcp(encodeV1(payload, session.localKey, {seq: 7, random: 9, seconds: request.seconds, protocol: 102}));
    socket.write(response.subarray(0, 11)); socket.write(response.subarray(11));
  }});
  try {
    const methods: WireRequest['method'][] = ['get_status', 'get_consumable', 'get_clean_summary', 'get_clean_record', 'get_room_mapping'];
    for (const method of methods) {
      const result = await localRead(config, session, {...request, method, params: method === 'get_clean_record' ? [1700000000] : []}, AbortSignal.timeout(1000), {connect: () => createConnection({host: '127.0.0.1', port: server.port})});
      assert.deepEqual(result, {kind: 'json', value: [{battery: 95}]});
    }
    assert.deepEqual(received, methods);
  } finally {await server.close();}
});
void test('authentication refusal cannot send the read RPC and carries only safe registry text', async () => {
  let sent = 0;
  const server = await peer((socket, frames) => {for (const frame of frames) {if (frame.readUInt16BE(15) === 0) socket.write(connack(1)); else sent++;}});
  try {await assert.rejects(localRead(config, session, request, AbortSignal.timeout(1000), {connect: () => createConnection({host: '127.0.0.1', port: server.port})}), (error: unknown) => error instanceof SdkError && error.body.error.code === 'unauthenticated'); assert.equal(sent, 0);} finally {await server.close();}
});
void test('MQTT guard rejects an oversized advertised packet before forwarding any header or body', async () => {
  const guard = new MqttPacketGuard(); const forwarded: Buffer[] = [];
  guard.on('data', (bytes: Buffer) => forwarded.push(bytes));
  const failure = once(guard, 'error');
  guard.write(Buffer.from([0x30, 0xff])); guard.write(Buffer.from([0xff, 0x7f]));
  const values: unknown[] = await failure; const error = values[0];
  assert.ok(error instanceof SdkError); assert.equal(error.body.error.code, 'unsupported-capability'); assert.equal(forwarded.length, 0);
});
void test('MQTT guard preserves fragmented/coalesced legal packets exactly', async () => {
  const guard = new MqttPacketGuard(); const forwarded: Buffer[] = [];
  guard.on('data', (bytes: Buffer) => forwarded.push(bytes));
  guard.write(Buffer.from([0x20])); guard.write(Buffer.from([2, 0])); guard.end(Buffer.from([0, 0xd0, 0]));
  await once(guard, 'end'); assert.deepEqual(Buffer.concat(forwarded), Buffer.from([0x20, 2, 0, 0, 0xd0, 0]));
});

void test('untyped control requests fail at the final sender before a connection can open', async () => {
  let opened = 0;
  await assert.rejects(localRead(config, session, {...request, method: 'app_start' as WireRequest['method']}, AbortSignal.timeout(1000), {connect: () => {opened++; assert.fail('control must not open a connection');}}), (error: unknown) => error instanceof SdkError && error.body.error.code === 'forbidden');
  assert.equal(opened, 0);
});
void test('wrong correlation, missing result and corrupt vendor bytes cannot produce an observation', async () => {
  for (const reply of [{id: 43, result: []}, {id: 42}, {id: 42, result: [], error: {code: 401}}]) {
    const server = await peer((socket, frames) => {for (const frame of frames) {
      if (frame.readUInt16BE(15) === 0) socket.write(connack());
      else if (frame.readUInt16BE(15) === 4) socket.write(wrapTcp(encodeV1(Buffer.from(JSON.stringify(reply)), session.localKey, {seq: 7, random: 9, seconds: request.seconds, protocol: 102})));
    }});
    try {await assert.rejects(localRead(config, session, request, AbortSignal.timeout(1000), {connect: () => createConnection({host: '127.0.0.1', port: server.port})}), (error: unknown) => error instanceof SdkError && error.body.error.code === 'unavailable');} finally {await server.close();}
  }
});
void test('abort after handshake retires a pending socket; later bytes cannot satisfy it', async () => {
  let connection: Socket | undefined;
  const handshake = deferred<void>();
  const server = await peer((socket, frames) => {connection = socket; for (const frame of frames) {if (frame.readUInt16BE(15) === 0) {socket.write(connack()); handshake.resolve();}}});
  const abort = new AbortController();
  try {
    const pending = localRead(config, session, request, abort.signal, {connect: () => createConnection({host: '127.0.0.1', port: server.port})});
    await handshake.promise; abort.abort(); await assert.rejects(pending, (error: unknown) => error instanceof SdkError && error.body.error.code === 'cancelled');
    assert.ok(connection !== undefined); if (!connection.destroyed) await new Promise<void>(resolve => {connection?.once('close', () => resolve());}); assert.equal(connection.destroyed, true);
  } finally {await server.close();}
});
