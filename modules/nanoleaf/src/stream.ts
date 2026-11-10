// External-control streaming for live Lines frames (#1598). The Start's journaled write puts the light in version 2
// streaming mode, and each frame then goes as one UDP datagram to the light's streaming port. A scene chosen on the light
// leaves the mode, so later datagrams cannot replace it. No datagram is answered, retried or resent.
import {createSocket} from 'node:dgram';
import type {Zone} from './effects.js';
import {LIGHT_TIMEOUT_SECONDS} from './transport.js';

/** The light's external-control streaming port; version 2 reports no other. */
export const STREAM_PORT = 60222;
/** The selection a light reports while it is in external-control mode. */
export const STREAMING = '*ExtControl*';
/** The write that enters version 2 external-control mode. */
export const ENTER_STREAMING = Object.freeze({write: Object.freeze({command: 'display', animType: 'extControl', extControlVersion: 'v2'})});
/** A frame's transition in 100 ms units, as each display frame's. */
export const STREAM_TRANSITION = 1;

/** Sends one datagram to a light's streaming port, settling once it is sent or has failed. Nothing answers it. */
export type LightDatagram = (address: {ip: string}, packet: Uint8Array) => Promise<void>;

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

/** A datagram transport to `port`: one socket per datagram, closed once the send settles or the light timeout passes. */
export const datagramTo = (port: number): LightDatagram => (address, packet) => new Promise<void>((resolve, reject) => {
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
  socket.send(packet, port, address.ip, error => { settle(error ?? undefined); });
});

/** The real datagram transport, to the light's streaming port. */
export const lightDatagram: LightDatagram = datagramTo(STREAM_PORT);
