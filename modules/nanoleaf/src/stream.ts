// External-control streaming for live Music frames. The Start's journaled write puts the light in external-control mode,
// and each frame then goes as one UDP datagram to the light's streaming port. A scene chosen on the light leaves the
// mode, so later datagrams cannot replace it. No datagram is answered, retried or resent.
// The Lines take version 2 on the fixed port 60222 (#1598). The original NL22 Light Panels take version 1 (#1272): the
// entry's 200 answer names the streaming port, and each datagram carries one-byte panel IDs. Nanoleaf's OpenAPI
// documentation, sections 3.2.6.2 and 5.7, describes both layouts; the OpenSpec change gh-1272-nl22-live-sessions
// separates what it documents from what only the installed light can show.
import {createSocket} from 'node:dgram';
import {isObject} from './compat.js';
import type {Kind} from './devices.js';
import type {Zone} from './effects.js';
import {LIGHT_TIMEOUT_SECONDS} from './transport.js';

/** The streaming port of a version 2 light; it reports no other. */
export const STREAM_PORT = 60222;
/** The selection a light reports while it is in external-control mode. */
export const STREAMING = '*ExtControl*';
/** The write that enters version 2 external-control mode. */
// Lines frames address the two logical zones of each Line, as every Lines display write does (`effects.ts`).
export const ENTER_STREAMING = Object.freeze({write: Object.freeze({command: 'display', animType: 'extControl', extControlVersion: 'v2',
  logicalPanelsEnabled: true})});
/** The write that enters version 1 external-control mode, the version the documentation gives the Light Panels. */
export const ENTER_STREAMING_V1 = Object.freeze({write: Object.freeze({command: 'display', animType: 'extControl', extControlVersion: 'v1'})});
/** A frame's transition in 100 ms units, as each display frame's. */
export const STREAM_TRANSITION = 1;
/** The largest panel ID, and the most panels, a version 1 datagram carries: each is one byte. */
export const V1_MAX_ID = 0xff;

/** Sends one datagram to a light's streaming port, settling once it is sent or has failed. Nothing answers it. */
export type LightDatagram = (address: {ip: string; port: number}, packet: Uint8Array) => Promise<void>;

/** How one kind of light streams: its entry write, the port its answer leaves frames to, and its datagram layout. */
export type StreamProtocol = {
  readonly version: 'v1' | 'v2';
  readonly entry: object;
  /** The port frames go to, from the entry's answer, or undefined when the answer names none. */
  port(answer: unknown): number | undefined;
  packet(zones: readonly Zone[]): Uint8Array;
  /** Whether one datagram can address every zone ID. */
  addresses(ids: readonly number[]): boolean;
};

/**
 * The version 2 datagram for zones of one color each: a two-byte zone count, then per zone its two-byte ID, red, green,
 * blue and white (0) bytes and a two-byte transition, all big-endian. Only each zone's first keyframe is sent.
 */
export function streamPacket(zones: readonly Zone[]): Uint8Array {
  if (zones.length > 0xffff) throw new RangeError('Too many zones for one datagram.');
  const packet = Buffer.alloc(2 + 8 * zones.length);
  packet.writeUInt16BE(zones.length, 0);
  zones.forEach(([id, frames], index) => {
    const [red, green, blue] = frames[0] ?? [0, 0, 0, 0];
    const at = 2 + 8 * index;
    packet.writeUInt16BE(id, at);
    packet.writeUInt8(red, at + 2);
    packet.writeUInt8(green, at + 3);
    packet.writeUInt8(blue, at + 4);
    packet.writeUInt8(0, at + 5);
    packet.writeUInt16BE(STREAM_TRANSITION, at + 6);
  });
  return packet;
}

/**
 * The version 1 datagram: a one-byte panel count, then per panel its one-byte ID, a frame count of 1, red, green, blue
 * and white (0) bytes and a one-byte transition. Only each panel's first keyframe is sent.
 */
export function streamPacketV1(zones: readonly Zone[]): Uint8Array {
  if (zones.length > V1_MAX_ID) throw new RangeError('Too many panels for one version 1 datagram.');
  const packet = Buffer.alloc(1 + 7 * zones.length);
  packet.writeUInt8(zones.length, 0);
  zones.forEach(([id, frames], index) => {
    if (!Number.isInteger(id) || id < 0 || id > V1_MAX_ID) throw new RangeError('A panel ID too wide for a version 1 datagram.');
    const [red, green, blue] = frames[0] ?? [0, 0, 0, 0];
    const at = 1 + 7 * index;
    packet.writeUInt8(id, at);
    packet.writeUInt8(1, at + 1);
    packet.writeUInt8(red, at + 2);
    packet.writeUInt8(green, at + 3);
    packet.writeUInt8(blue, at + 4);
    packet.writeUInt8(0, at + 5);
    packet.writeUInt8(STREAM_TRANSITION, at + 6);
  });
  return packet;
}

/** The lowest port a light's answer may direct frames to: never a privileged or well-known one. */
export const MIN_STREAM_PORT = 1024;

/**
 * The port a version 1 entry's answer names (`streamControlPort`), or undefined when it names no usable UDP port: only
 * 1024 to 65535, so whatever answers at the light's address cannot direct frames at a well-known service. The documented
 * ports are 60221 and 60222. The answer's address is never used: frames go to the light's configured address only.
 */
export function streamPortV1(answer: unknown): number | undefined {
  if (!isObject(answer)) return undefined;
  const {streamControlPort: port, streamControlProtocol: protocol} = answer;
  if (protocol !== undefined && protocol !== 'udp') return undefined;
  return typeof port === 'number' && Number.isInteger(port) && port >= MIN_STREAM_PORT && port <= 0xffff ? port : undefined;
}

const LINES_STREAM: StreamProtocol = Object.freeze({
  version: 'v2', entry: ENTER_STREAMING, port: () => STREAM_PORT, packet: streamPacket,
  addresses: (ids: readonly number[]) => ids.length <= 0xffff && ids.every(id => Number.isInteger(id) && id >= 0 && id <= 0xffff),
});
const PANELS_STREAM: StreamProtocol = Object.freeze({
  version: 'v1', entry: ENTER_STREAMING_V1, port: streamPortV1, packet: streamPacketV1,
  addresses: (ids: readonly number[]) => ids.length <= V1_MAX_ID && ids.every(id => Number.isInteger(id) && id >= 0 && id <= V1_MAX_ID),
});

/** How a light of `kind` streams: the Lines version 2, the NL22 Light Panels version 1. */
export const streamProtocol = (kind: Kind): StreamProtocol => (kind === 'panels' ? PANELS_STREAM : LINES_STREAM);

/** The real datagram transport: one socket per datagram, closed once the send settles or the light timeout passes. */
export const lightDatagram: LightDatagram = (address, packet) => new Promise<void>((resolve, reject) => {
  const socket = createSocket('udp4');
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settle = (error?: Error): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    socket.close();
    if (error === undefined) resolve();
    else reject(error);
  };
  timer = setTimeout(() => { settle(Object.assign(new Error('The datagram was not sent in time.'), {code: 'ETIMEDOUT'})); },
    LIGHT_TIMEOUT_SECONDS * 1000);
  socket.once('error', error => { settle(error); });
  try {
    socket.send(packet, address.port, address.ip, error => { settle(error ?? undefined); });
  } catch (error) {
    settle(error instanceof Error ? error : new Error('The datagram was not sent.', {cause: error}));
  }
});
