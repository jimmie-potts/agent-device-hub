import assert from 'node:assert/strict';
import {once} from 'node:events';
import {readFileSync} from 'node:fs';
import {createConnection, createServer, type Socket} from 'node:net';
import {test} from 'node:test';
import type {connect as connectTls} from 'node:tls';
import debug from 'debug';
import {SdkError} from '@jimmie-potts/sdk';
import {decodeV1, encodeV1} from '../src/transport/codec.js';
import {mqttRead} from '../src/transport/network.js';
import type {Config, Session} from '../src/transport/private.js';
import type {WireRequest} from '../src/transport/reader.js';
const vector = JSON.parse(readFileSync(new URL('../../tests/fixtures/v1.json', import.meta.url), 'utf8')) as {mapEnvelopeHex: string; mapHex: string; mqttUsername: string; mqttPassword: string; mqttEndpoint: string};
const config: Config = {schemaVersion: 1, deviceId: 'synthetic-robot', address: '127.0.0.1', broker: 'mqtts://mqtt-us.roborock.com:8883', region: 'us'};
const session: Session = {schemaVersion: 1, deviceId: config.deviceId, model: 'roborock.vacuum.a97', protocol: '1.0', localKey: '0123456789abcdef', rriot: {u: 'synthetic-user', s: 'sentinel-auth-secret', k: 'sentinel-auth-key'}, broker: config.broker};
const request: WireRequest = {method: 'get_map_v1', params: [], id: 42, seq: 7, seconds: 1700000000, nonce: Buffer.alloc(16, 0xab)};
function packet(header: number, payload: Buffer): Buffer {
  const length: number[] = []; let value = payload.length;
  do {let byte = value % 128; value = Math.floor(value / 128); if (value > 0) byte |= 0x80; length.push(byte);} while (value > 0);
  return Buffer.concat([Buffer.from([header, ...length]), payload]);
}
function string(value: string): Buffer {const bytes = Buffer.from(value); const length = Buffer.alloc(2); length.writeUInt16BE(bytes.length); return Buffer.concat([length, bytes]);}
async function broker(onPacket: (socket: Socket, header: number, body: Buffer) => void): Promise<{port: number; close: () => Promise<void>}> {
  const clients = new Set<Socket>();
  const server = createServer(socket => {
    clients.add(socket); socket.on('error', () => {}); socket.on('close', () => clients.delete(socket)); let pending = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]); assert.ok(pending.length < 65536);
      for (;;) {
        if (pending.length < 2) return;
        let length = 0; let multiplier = 1; let offset = 1; let complete = false;
        while (offset < pending.length && offset <= 4) {const byte = pending[offset] ?? 0; offset++; length += (byte & 127) * multiplier; if ((byte & 128) === 0) {complete = true; break;} multiplier *= 128;}
        if (!complete || pending.length < offset + length) return;
        const header = pending[0] ?? 0; const body = pending.subarray(offset, offset + length); pending = pending.subarray(offset + length); onPacket(socket, header, body);
      }
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); assert.ok(address !== null && typeof address === 'object');
  return {port: address.port, close: () => {for (const socket of clients) socket.destroy(); return new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error)));}};
}
function seam(port: number, capture?: (options: unknown) => void): typeof connectTls {
  return ((options: unknown) => {capture?.(options); return createConnection({host: '127.0.0.1', port});}) as unknown as typeof connectTls;
}
void test('real MQTT client subscribes exact topic and treats acknowledgment separately from the encrypted map', async () => {
  let publications = 0; let subscription: string | undefined; let tlsOptions: unknown;
  const inbound = `rr/m/o/${session.rriot.u}/${vector.mqttUsername}/${config.deviceId}`;
  const outbound = `rr/m/i/${session.rriot.u}/${vector.mqttUsername}/${config.deviceId}`;
  const server = await broker((socket, header, body) => {
    const command = header >> 4;
    if (command === 1) {
      // CONNECT carries both independent Python-derived credentials, never the raw RRIOT secret/key.
      assert.equal(body.includes(Buffer.from(vector.mqttUsername)), true); assert.equal(body.includes(Buffer.from(vector.mqttPassword)), true);
      assert.equal(body.includes(Buffer.from(session.rriot.s)), false); socket.write(Buffer.from([0x20, 2, 0, 0]));
    } else if (command === 8) {
      const length = body.readUInt16BE(2); subscription = body.subarray(4, 4 + length).toString(); assert.equal(subscription, inbound);
      socket.write(Buffer.from([0x90, 3, body[0] ?? 0, body[1] ?? 0, 1]));
    } else if (command === 3) {
      publications++; const length = body.readUInt16BE(0); assert.equal(body.subarray(2, 2 + length).toString(), outbound);
      const id = body.subarray(2 + length, 4 + length); socket.write(packet(0x40, id));
      const frame = decodeV1(body.subarray(4 + length), session.localKey); assert.equal(frame.protocol, 101);
      const envelope = JSON.parse(frame.payload.toString()) as {dps: {'101': string}};
      const rpc = JSON.parse(envelope.dps['101']) as {id: number; method: string; params: unknown[]; security: {endpoint: string; nonce: string}};
      assert.deepEqual(rpc, {id: 42, method: 'get_map_v1', params: [], security: {endpoint: vector.mqttEndpoint, nonce: 'AB'.repeat(16)}});
      const ack = encodeV1(Buffer.from(JSON.stringify({id: 42, result: ['ok']})), session.localKey, {seq: 7, random: 9, seconds: request.seconds, protocol: 102});
      const map = encodeV1(Buffer.from(vector.mapEnvelopeHex, 'hex'), session.localKey, {seq: 8, random: 9, seconds: request.seconds, protocol: 301});
      socket.write(Buffer.concat([packet(0x30, Buffer.concat([string(inbound), ack])), packet(0x30, Buffer.concat([string(inbound), map]))]));
    }
  });
  try {
    const result = await mqttRead(config, session, request, AbortSignal.timeout(1000), {tlsConnect: seam(server.port, value => {tlsOptions = value;})});
    assert.deepEqual(result, {kind: 'map', bytes: Buffer.from(vector.mapHex, 'hex')}); assert.equal(publications, 1); assert.equal(subscription, inbound);
    assert.deepEqual(tlsOptions, {host: 'mqtt-us.roborock.com', port: 8883, servername: 'mqtt-us.roborock.com', rejectUnauthorized: true});
  } finally {await server.close();}
});
void test('production MQTT constructor rejects an oversized advertised packet and closes its socket', async () => {
  let socket: Socket | undefined;
  const server = await broker((connected, header) => {socket = connected; if (header >> 4 === 1) connected.write(Buffer.from([0x30, 0xff, 0xff, 0x7f]));});
  try {
    await assert.rejects(mqttRead(config, session, request, AbortSignal.timeout(1000), {tlsConnect: seam(server.port)}), (error: unknown) => error instanceof SdkError && error.body.error.code === 'unsupported-capability');
    assert.ok(socket !== undefined); if (!socket.destroyed) await new Promise<void>(resolve => {socket?.once('close', () => resolve());}); assert.equal(socket.destroyed, true);
  } finally {await server.close();}
});
void test('retained enabled packet debugging is refused before the client or TLS seam can run', async () => {
  const previous = debug.disable(); let opened = false;
  try {
    debug.enable('mqtt-packet:*');
    delete process.env.DEBUG; // The dependency's retained enabled state still applies.
    await assert.rejects(mqttRead(config, session, request, AbortSignal.timeout(1000), {tlsConnect: (() => {opened = true; assert.fail('no TLS connection');})}), (error: unknown) => error instanceof SdkError && error.body.error.code === 'forbidden');
    assert.equal(opened, false);
  } finally {debug.enable(previous);}
});
