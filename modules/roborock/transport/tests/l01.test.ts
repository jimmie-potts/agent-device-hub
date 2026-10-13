import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {SdkError} from '@jimmie-potts/sdk';
import * as codec from '../src/transport/codec.js';
// Independently generated with Python hashlib/struct/binascii and cryptography AESGCM.
const vector = JSON.parse(readFileSync(new URL('../../tests/fixtures/l01.json', import.meta.url), 'utf8')) as {
  localKey: string; header: codec.FrameHeader; clientNonce: number; ackNonce: number; payload: string; frameHex: string;
};
const l01 = codec as unknown as {
  encodeL01(payload: Uint8Array, localKey: string, header: codec.FrameHeader, clientNonce: number, ackNonce: number): Buffer;
  decodeL01(input: Uint8Array, localKey: string, clientNonce: number, ackNonce: number): codec.FrameHeader & {payload: Buffer};
};
const refused = (error: unknown): boolean => error instanceof SdkError && error.body.error.code === 'unavailable';
void test('L01 codec matches independent authenticated byte vector', () => {
  const expected = Buffer.from(vector.frameHex, 'hex');
  assert.deepEqual(l01.encodeL01(Buffer.from(vector.payload), vector.localKey, vector.header, vector.clientNonce, vector.ackNonce), expected);
  assert.deepEqual(l01.decodeL01(expected, vector.localKey, vector.clientNonce, vector.ackNonce), {...vector.header, payload: Buffer.from(vector.payload)});
});
void test('L01 authenticates both connection nonces, key and encrypted payload', () => {
  const frame = Buffer.from(vector.frameHex, 'hex');
  assert.throws(() => l01.decodeL01(frame, vector.localKey, vector.clientNonce + 1, vector.ackNonce), refused);
  assert.throws(() => l01.decodeL01(frame, vector.localKey, vector.clientNonce, vector.ackNonce + 1), refused);
  assert.throws(() => l01.decodeL01(frame, 'fedcba9876543210', vector.clientNonce, vector.ackNonce), refused);
  // Recalculate CRC so this negative control reaches the GCM tag, not checksum validation.
  const changed = Buffer.from(frame); changed[20] = (changed[20] ?? 0) ^ 1;
  let crc = 0xffffffff;
  for (const byte of changed.subarray(0, -4)) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0); }
  changed.writeUInt32BE((crc ^ 0xffffffff) >>> 0, changed.length - 4);
  assert.throws(() => l01.decodeL01(changed, vector.localKey, vector.clientNonce, vector.ackNonce), refused);
  assert.throws(() => l01.decodeL01(frame.subarray(0, 20), vector.localKey, vector.clientNonce, vector.ackNonce), refused);
  assert.throws(() => codec.decodeV1(frame, vector.localKey), (error: unknown) => error instanceof SdkError && error.body.error.code === 'unsupported-capability');
});
