// Adapted protocol framing from the pinned MIT source; see ../../UPSTREAM-LICENSE.txt.
import {createCipheriv, createDecipheriv, createHash, timingSafeEqual} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {SdkError} from '@jimmie-potts/sdk';
import type {LocalProtocol} from './private.js';

export type FrameHeader = {seq: number; random: number; seconds: number; protocol: number};
export const MAX_MAP_BYTES = 2 * 1024 * 1024;
export const MAX_FRAME_BYTES = 19 + 65535 + 4;
const MAX_MESSAGE_BYTES = 1024 * 1024;
function invalid(): never { throw new SdkError(errorBody('invalid-request', {detail: 'The transport input is invalid.'})); }
function unavailable(): never { throw new SdkError(errorBody('unavailable', {detail: 'The vendor message could not be verified.'})); }
function unsupported(): never { throw new SdkError(errorBody('unsupported-capability', {detail: 'The vendor message exceeds the supported format.'})); }
function integer(value: number, max: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) invalid();
}
function bytes(input: Uint8Array, max: number): Buffer {
  if (!(input instanceof Uint8Array)) invalid();
  if (input.byteLength > max) unsupported();
  return Buffer.from(input);
}
function key(localKey: string, seconds: number): Buffer {
  if (typeof localKey !== 'string' || localKey.length !== 16 || /[^\x20-\x7e]/.test(localKey)) invalid();
  const stamp = seconds.toString(16).padStart(8, '0');
  const shuffled = [5, 6, 3, 7, 1, 2, 0, 4].map(index => stamp[index]).join('');
  return createHash('md5').update(shuffled + localKey + 'TXdfu$jyZ#TZHsg4').digest();
}
function crc32(input: Uint8Array): number {
  let result = 0xffffffff;
  for (const byte of input) {
    result ^= byte;
    for (let bit = 0; bit < 8; bit++) result = (result >>> 1) ^ ((result & 1) === 1 ? 0xedb88320 : 0);
  }
  return (result ^ 0xffffffff) >>> 0;
}
function version(frame: Buffer, expected: LocalProtocol = '1.0'): void {
  if (!frame.subarray(0, 3).equals(Buffer.from(expected, 'ascii'))) unsupported();
}
function protocol(value: number): void {
  if (![4, 101, 102, 301].includes(value)) unsupported();
}
export function encodeV1(payload: Uint8Array, localKey: string, header: FrameHeader): Buffer {
  integer(header.seq, 0xffffffff); integer(header.random, 0xffffffff); integer(header.seconds, 0xffffffff);
  protocol(header.protocol);
  const body = bytes(payload, 65535);
  if ((Math.floor(body.length / 16) + 1) * 16 > 65535) unsupported();
  const cipher = createCipheriv('aes-128-ecb', key(localKey, header.seconds), null);
  const encrypted = Buffer.concat([cipher.update(body), cipher.final()]);
  const frame = Buffer.alloc(19 + encrypted.length + 4);
  frame.write('1.0', 0, 'ascii');
  frame.writeUInt32BE(header.seq, 3); frame.writeUInt32BE(header.random, 7);
  frame.writeUInt32BE(header.seconds, 11); frame.writeUInt16BE(header.protocol, 15);
  frame.writeUInt16BE(encrypted.length, 17); encrypted.copy(frame, 19);
  frame.writeUInt32BE(crc32(frame.subarray(0, -4)), frame.length - 4);
  return frame;
}
export function decodeV1(input: Uint8Array, localKey: string): FrameHeader & {payload: Buffer} {
  const frame = bytes(input, MAX_FRAME_BYTES);
  if (frame.length < 23) unavailable();
  version(frame);
  const length = frame.readUInt16BE(17);
  if (length === 0 || length % 16 !== 0 || length + 23 !== frame.length) unavailable();
  if (frame.readUInt32BE(frame.length - 4) !== crc32(frame.subarray(0, -4))) unavailable();
  const header = {seq: frame.readUInt32BE(3), random: frame.readUInt32BE(7), seconds: frame.readUInt32BE(11), protocol: frame.readUInt16BE(15)};
  protocol(header.protocol);
  const cipherKey = key(localKey, header.seconds);
  try {
    const cipher = createDecipheriv('aes-128-ecb', cipherKey, null);
    return {...header, payload: Buffer.concat([cipher.update(frame.subarray(19, -4)), cipher.final()])};
  } catch { return unavailable(); }
}
// L01 primitives adapted from the same pinned MIT cryptoEngine.ts.
function uint32(value: number): Buffer { integer(value, 0xffffffff); const result = Buffer.alloc(4); result.writeUInt32BE(value); return result; }
function l01Material(localKey: string, header: FrameHeader, clientNonce: number, ackNonce: number): {key: Buffer; iv: Buffer; aad: Buffer} {
  integer(header.seq, 0xffffffff); integer(header.random, 0xffffffff); integer(header.seconds, 0xffffffff); protocol(header.protocol);
  if (typeof localKey !== 'string' || localKey.length !== 16 || /[^\x20-\x7e]/.test(localKey)) invalid();
  const stamp = header.seconds.toString(16).padStart(8, '0');
  const shuffled = [5, 6, 3, 7, 1, 2, 0, 4].map(index => stamp[index]).join('');
  return {
    key: createHash('sha256').update(shuffled + localKey + 'TXdfu$jyZ#TZHsg4').digest(),
    iv: createHash('sha256').update(Buffer.concat([uint32(header.seq), uint32(header.random), uint32(header.seconds)])).digest().subarray(0, 12),
    aad: Buffer.concat([uint32(header.seq), uint32(clientNonce), uint32(ackNonce), uint32(header.random), uint32(header.seconds)]),
  };
}
export function encodeL01(payload: Uint8Array, localKey: string, header: FrameHeader, clientNonce: number, ackNonce: number): Buffer {
  const material = l01Material(localKey, header, clientNonce, ackNonce);
  const body = bytes(payload, 65535 - 16);
  const cipher = createCipheriv('aes-256-gcm', material.key, material.iv); cipher.setAAD(material.aad);
  const encrypted = Buffer.concat([cipher.update(body), cipher.final(), cipher.getAuthTag()]);
  const frame = Buffer.alloc(23 + encrypted.length); frame.write('L01', 0, 'ascii');
  frame.writeUInt32BE(header.seq, 3); frame.writeUInt32BE(header.random, 7); frame.writeUInt32BE(header.seconds, 11);
  frame.writeUInt16BE(header.protocol, 15); frame.writeUInt16BE(encrypted.length, 17); encrypted.copy(frame, 19);
  frame.writeUInt32BE(crc32(frame.subarray(0, -4)), frame.length - 4); return frame;
}
export function decodeL01(input: Uint8Array, localKey: string, clientNonce: number, ackNonce: number): FrameHeader & {payload: Buffer} {
  const frame = bytes(input, MAX_FRAME_BYTES); if (frame.length < 39) unavailable(); version(frame, 'L01');
  const length = frame.readUInt16BE(17);
  if (length < 16 || length + 23 !== frame.length || frame.readUInt32BE(frame.length - 4) !== crc32(frame.subarray(0, -4))) unavailable();
  const header = {seq: frame.readUInt32BE(3), random: frame.readUInt32BE(7), seconds: frame.readUInt32BE(11), protocol: frame.readUInt16BE(15)};
  const material = l01Material(localKey, header, clientNonce, ackNonce);
  try {
    const cipher = createDecipheriv('aes-256-gcm', material.key, material.iv); cipher.setAAD(material.aad); cipher.setAuthTag(frame.subarray(-20, -4));
    return {...header, payload: Buffer.concat([cipher.update(frame.subarray(19, -20)), cipher.final()])};
  } catch { return unavailable(); }
}
export function wrapTcp(input: Uint8Array): Buffer {
  const frame = bytes(input, MAX_FRAME_BYTES);
  if (frame.length < 17) unavailable();
  const result = Buffer.alloc(4 + frame.length);
  result.writeUInt32BE(frame.length, 0); frame.copy(result, 4);
  return result;
}
export function encodeControl(kind: 0 | 2 | 5, seq: number, random: number, keepalive?: number, localProtocol: LocalProtocol = '1.0', seconds = 0): Buffer {
  integer(seq, 0xffffffff); integer(random, 0xffffffff); integer(seconds, 0xffffffff);
  if (localProtocol !== '1.0' && localProtocol !== 'L01') invalid();
  if (![0, 2, 5].includes(kind) || (kind !== 0 && keepalive !== undefined)) invalid();
  const interval = keepalive ?? 10;
  if (kind === 0) { integer(interval, 0xffffffff); if (interval === 0) invalid(); }
  const frame = Buffer.alloc(kind === 0 ? 21 : 17);
  frame.write(localProtocol, 0, 'ascii'); frame.writeUInt32BE(seq, 3); frame.writeUInt32BE(random, 7);
  frame.writeUInt32BE(seconds, 11); frame.writeUInt16BE(kind, 15);
  if (kind === 0) frame.writeUInt32BE(localProtocol === 'L01' ? crc32(frame.subarray(0, 17)) : interval, 17);
  return wrapTcp(frame);
}
export function decodeControl(input: Uint8Array, localProtocol: LocalProtocol = '1.0'): {protocol: 1 | 3 | 5; seq: number; random: number; returnCode: number} {
  const frame = bytes(input, MAX_FRAME_BYTES);
  if (frame.length !== 17 && frame.length !== 21) unavailable();
  version(frame, localProtocol);
  const kind = frame.readUInt16BE(15);
  if (kind !== 1 && kind !== 3 && kind !== 5) unavailable();
  if (kind !== 1 && frame.length !== 17) unavailable();
  return {protocol: kind, seq: frame.readUInt32BE(3), random: frame.readUInt32BE(7), returnCode: frame.length === 21 ? frame.readUInt32BE(17) : 0};
}
export class TcpFrames {
  readonly #prefix = Buffer.alloc(4);
  #prefixBytes = 0;
  #frame: Buffer | undefined;
  #frameBytes = 0;
  #retired = false;
  push(chunk: Uint8Array): Buffer[] {
    if (this.#retired) unavailable();
    const frames: Buffer[] = [];
    try {
      if (!(chunk instanceof Uint8Array)) invalid();
      if (chunk.byteLength > MAX_MESSAGE_BYTES) unsupported();
      let offset = 0;
      while (offset < chunk.byteLength) {
        if (this.#frame === undefined) {
          const count = Math.min(4 - this.#prefixBytes, chunk.byteLength - offset);
          this.#prefix.set(chunk.subarray(offset, offset + count), this.#prefixBytes);
          offset += count; this.#prefixBytes += count;
          if (this.#prefixBytes < 4) continue;
          const length = this.#prefix.readUInt32BE(0);
          if (length < 17) unavailable();
          if (length > MAX_FRAME_BYTES) unsupported();
          this.#frame = Buffer.alloc(length); this.#frameBytes = 0; this.#prefixBytes = 0;
        }
        const count = Math.min(this.#frame.length - this.#frameBytes, chunk.byteLength - offset);
        this.#frame.set(chunk.subarray(offset, offset + count), this.#frameBytes);
        offset += count; this.#frameBytes += count;
        if (this.#frameBytes === this.#frame.length) { frames.push(this.#frame); this.#frame = undefined; this.#frameBytes = 0; }
      }
      return frames;
    } catch (error) {
      this.#retired = true; this.#frame = undefined; this.#prefixBytes = 0; this.#frameBytes = 0;
      if (error instanceof SdkError) throw error;
      return unavailable();
    }
  }
}
export function decodeMap(input: Uint8Array, nonce: Uint8Array, requestId: number): Buffer {
  integer(requestId, 65535); if (requestId === 0) invalid();
  const secret = bytes(nonce, 16); if (secret.length !== 16) invalid();
  const envelope = bytes(input, MAX_MESSAGE_BYTES);
  if (envelope.length < 40 || (envelope.length - 24) % 16 !== 0 || envelope.readUInt16LE(16) !== requestId) unavailable();
  let raw: Buffer;
  try {
    const cipher = createDecipheriv('aes-128-cbc', secret, Buffer.alloc(16));
    const compressed = Buffer.concat([cipher.update(envelope.subarray(24)), cipher.final()]);
    raw = gunzipSync(compressed, {maxOutputLength: MAX_MAP_BYTES});
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ERR_BUFFER_TOO_LARGE') unsupported();
    return unavailable();
  }
  if (raw.length < 40) unavailable();
  if (raw[0] !== 0x72 || raw[1] !== 0x72 || raw.readUInt16LE(2) !== 20) unsupported();
  const signed = raw.subarray(0, -20);
  if (raw.readUInt32LE(4) > signed.length) unavailable();
  if (!timingSafeEqual(createHash('sha1').update(signed).digest(), raw.subarray(-20))) unavailable();
  return raw;
}
