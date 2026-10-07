// The LIFX LAN protocol (Hub #928). Copied from controllers/lifx/src/protocol.ts at main 483d3a93 and converted to the
// strict profile: indexed reads are checked, and nothing is asserted non-null. The packets, their correlation and the
// address rules are unchanged. The old controller keeps its own copy for the installed service until #839.
import {randomBytes} from 'node:crypto';
import dgram, {type Socket} from 'node:dgram';
import {isIPv4} from 'node:net';

/** Absolute hue, saturation, brightness and kelvin in LIFX wire units, each an integer from 0 to 65535. */
export interface Hsbk {
  hue: number;
  saturation: number;
  brightness: number;
  kelvin: number;
}

/** What a LightGet answers: the bulb's color and whether it is on. */
export interface LightState {
  color: Hsbk;
  power: boolean;
}

/**
 * One bulb's packet exchange: a request of `type`, answered by a payload of `expectedType`. Once `signal` aborts, the
 * exchange stops waiting and rejects, at once or as soon as whatever it sent has ended: the queue waits for it.
 */
export interface Transport {
  exchange(type: number, payload: Uint8Array, expectedType: number, signal: AbortSignal): Promise<Buffer>;
  close(): void;
}

/** LightGet, its LightState answer, DeviceSetPower, LightSetColor and their acknowledgment. */
export const PACKET = {setPower: 21, acknowledgment: 45, lightGet: 101, setColor: 102, lightState: 107} as const;

/** Each request type the transport sends: its payload size, the answer it expects and that answer's payload size. */
const requests: ReadonlyMap<number, readonly [number, number, number]> = new Map([
  [14, [0, 15, 20]],
  [21, [2, 45, 0]],
  [32, [0, 33, 12]],
  [101, [0, 107, 52]],
  [102, [13, 45, 0]],
]);

const HSBK_FIELDS = ['hue', 'saturation', 'brightness', 'kelvin'] as const;

/** A zero-duration absolute LightSetColor payload. Throws `invalid-hsbk` for a value outside 0 to 65535. */
export function encodeColor(color: Hsbk): Buffer {
  if (HSBK_FIELDS.some(key => !Number.isInteger(color[key]) || color[key] < 0 || color[key] > 65535)) throw new Error('invalid-hsbk');
  const buffer = Buffer.alloc(13);
  [color.hue, color.saturation, color.brightness, color.kelvin].forEach((value, index) => buffer.writeUInt16LE(value, 1 + index * 2));
  return buffer;
}

/** A DeviceSetPower payload. */
export function encodePower(on: boolean): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(on ? 65535 : 0);
  return buffer;
}

/** Reads a LightState payload. Throws `invalid-light-state` for any other size. */
export function decodeState(payload: Uint8Array): LightState {
  if (payload.byteLength !== 52) throw new Error('invalid-light-state');
  const buffer = Buffer.from(payload);
  return {
    color: {hue: buffer.readUInt16LE(0), saturation: buffer.readUInt16LE(2), brightness: buffer.readUInt16LE(4), kelvin: buffer.readUInt16LE(6)},
    power: buffer.readUInt16LE(10) !== 0,
  };
}

/**
 * Whether `address` is a unicast IPv4 address the transport accepts. It conservatively excludes common network and
 * broadcast addresses without guessing a subnet. Hostnames are not accepted.
 */
export function unicastAddress(address: string): boolean {
  if (!isIPv4(address)) return false;
  const [first = 0, , , last = 0] = address.split('.').map(Number);
  return first !== 0 && first < 224 && last !== 255 && last !== 0;
}

/** No socket is opened until an exchange. The address is private, immutable configuration. */
export class UdpTransport implements Transport {
  readonly #address: string;
  readonly #factory: () => Socket;
  #target: Buffer = Buffer.alloc(8);
  #closed = false;
  readonly #pending = new Set<(error: Error) => void>();

  constructor(options: {address: string; socketFactory?: () => Socket}) {
    if (!unicastAddress(options.address)) throw new Error('invalid-lifx-address');
    this.#address = options.address;
    this.#factory = options.socketFactory ?? (() => dgram.createSocket('udp4'));
  }

  async exchange(type: number, payload: Uint8Array, expected: number, signal: AbortSignal): Promise<Buffer> {
    if (this.#closed || signal.aborted) throw new Error('lifx-closed');
    const spec = requests.get(type);
    if (spec === undefined || spec[0] !== payload.byteLength || spec[1] !== expected) throw new Error('invalid-lifx-message');
    let source = 0;
    while (source < 2) source = randomBytes(4).readUInt32LE();
    const sequence = randomBytes(1).readUInt8(0);
    const packet = Buffer.alloc(36 + payload.byteLength);
    packet.writeUInt16LE(packet.length);
    packet.writeUInt16LE(0x1400, 2);
    packet.writeUInt32LE(source, 4);
    this.#target.copy(packet, 8);
    // Ask for an acknowledgment of the two writes.
    packet.writeUInt8(type === 21 || type === 102 ? 2 : 0, 22);
    packet.writeUInt8(sequence, 23);
    packet.writeUInt16LE(type, 32);
    Buffer.from(payload).copy(packet, 36);
    let socket: Socket;
    try {
      socket = this.#factory();
    } catch {
      throw new Error('lifx-transport-failure');
    }
    return await new Promise<Buffer>((resolve, reject) => {
      let settled = false;
      const finish = (outcome: {error: Error} | {response: Buffer}): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', abort);
        this.#pending.delete(stop);
        try {
          socket.close();
        } catch {}
        if ('error' in outcome) reject(outcome.error);
        else resolve(outcome.response);
      };
      const stop = (error: Error): void => { finish({error}); };
      const abort = (): void => { stop(new Error('lifx-aborted')); };
      this.#pending.add(stop);
      signal.addEventListener('abort', abort, {once: true});
      socket.on('message', (message, remote) => {
        if (
          settled || remote.address !== this.#address || remote.port !== 56700 || message.length !== 36 + spec[2] ||
          message.readUInt16LE(0) !== message.length || (message.readUInt16LE(2) & 0xfff) !== 1024 || (message.readUInt8(3) & 0x10) === 0 ||
          message.readUInt32LE(4) !== source || message.readUInt8(23) !== sequence || message.readUInt16LE(32) !== expected
        ) return;
        const target = Buffer.from(message.subarray(8, 16));
        if (
          target.subarray(0, 6).every(value => value === 0) || target.readUInt8(6) !== 0 || target.readUInt8(7) !== 0 ||
          (!this.#target.equals(Buffer.alloc(8)) && !target.equals(this.#target))
        ) return;
        this.#target = target;
        finish({response: Buffer.from(message.subarray(36))});
      });
      socket.on('error', () => { stop(new Error('lifx-transport-failure')); });
      if (signal.aborted || this.#closed) {
        abort();
        return;
      }
      try {
        socket.send(packet, 56700, this.#address, error => {
          if (error !== null && error !== undefined) stop(new Error('lifx-transport-failure'));
        });
      } catch {
        stop(new Error('lifx-transport-failure'));
      }
    });
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const stop of this.#pending) stop(new Error('lifx-closed'));
  }
}
