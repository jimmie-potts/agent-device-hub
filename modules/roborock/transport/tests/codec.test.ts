import assert from 'node:assert/strict';
import {createCipheriv, createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {gzipSync} from 'node:zlib';
import {SdkError} from '@jimmie-potts/sdk';
import {decodeControl, encodeControl, decodeMap, decodeV1, encodeV1, MAX_MAP_BYTES, TcpFrames, wrapTcp} from '../src/transport/codec.js';

// These bytes were authored with Python's hashlib/struct/binascii/zlib and OpenSSL, separately from the decoder.
const vector = JSON.parse(readFileSync(new URL('../../tests/fixtures/v1.json', import.meta.url), 'utf8')) as {
  localKey: string; payload: string; header: {seq: number; random: number; seconds: number; protocol: number};
  connectHex: string; connackHex: string; pubackHex: string; frameHex: string; nonceHex: string; mapEnvelopeHex: string; mapHex: string;
};
const safeFailure = (code: string) => (error: unknown): boolean => error instanceof SdkError && error.body.error.code === code;

void test('V1 encryption and framing match an independently authored synthetic byte vector', () => {
  const expected = Buffer.from(vector.frameHex, 'hex');
  assert.deepEqual(encodeV1(Buffer.from(vector.payload), vector.localKey, vector.header), expected);
  assert.deepEqual(decodeV1(expected, vector.localKey), {...vector.header, payload: Buffer.from(vector.payload)});
});

void test('fragmented and coalesced TCP frames retain exact boundaries; oversized advertised lengths are refused', () => {
  const expected = Buffer.from(vector.frameHex, 'hex');
  const framed = wrapTcp(expected);
  const chunks = new TcpFrames();
  assert.deepEqual(chunks.push(framed.subarray(0, 2)), []);
  assert.deepEqual(chunks.push(framed.subarray(2, 9)), []);
  assert.deepEqual(chunks.push(Buffer.concat([framed.subarray(9), framed])), [expected, expected]);
  assert.throws(() => new TcpFrames().push(Buffer.from('7fffffff', 'hex')), safeFailure('unsupported-capability'));
});

void test('V1 CRC corruption and invalid payload lengths cannot return an observation', () => {
  const corrupted = Buffer.from(vector.frameHex, 'hex');
  corrupted[20] = (corrupted[20] ?? 0) ^ 1;
  assert.throws(() => decodeV1(corrupted, vector.localKey), safeFailure('unavailable'));
  assert.throws(() => decodeV1(Buffer.from(vector.frameHex, 'hex').subarray(0, 20), vector.localKey), safeFailure('unavailable'));
});

void test('inner map decryption matches its independent vector and refuses mismatched correlation', () => {
  const encoded = Buffer.from(vector.mapEnvelopeHex, 'hex');
  const nonce = Buffer.from(vector.nonceHex, 'hex');
  assert.deepEqual(decodeMap(encoded, nonce, 42), Buffer.from(vector.mapHex, 'hex'));
  assert.throws(() => decodeMap(encoded, nonce, 43), safeFailure('unavailable'));
});

void test('a compressed map exceeding the output bound is refused during inflation', () => {
  const nonce = Buffer.from(vector.nonceHex, 'hex');
  const raw = Buffer.alloc(MAX_MAP_BYTES + 1);
  raw.write('rr', 0, 'ascii'); raw.writeUInt16LE(20, 2); raw.writeUInt32LE(raw.length - 40, 4);
  createHash('sha1').update(raw.subarray(0, -20)).digest().copy(raw, raw.length - 20);
  const zipped = gzipSync(raw);
  const cipher = createCipheriv('aes-128-cbc', nonce, Buffer.alloc(16));
  const envelope = Buffer.alloc(24);
  envelope.writeUInt16LE(42, 16);
  const encoded = Buffer.concat([envelope, cipher.update(zipped), cipher.final()]);
  assert.throws(() => decodeMap(encoded, nonce, 42), safeFailure('unsupported-capability'));
});

void test('control bytes independently encode CONNECT and PUBACK and parse a successful CONNACK', () => {
  assert.deepEqual(encodeControl(0, 0, 9, 10), Buffer.from(vector.connectHex, 'hex'));
  assert.deepEqual(encodeControl(5, 7, 0), Buffer.from(vector.pubackHex, 'hex'));
  assert.deepEqual(decodeControl(Buffer.from(vector.connackHex, 'hex')), {protocol: 1, seq: 0, random: 9, returnCode: 0});
});
