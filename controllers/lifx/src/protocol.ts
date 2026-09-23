import { randomBytes } from "node:crypto";
import { isIPv4 } from "node:net";
import dgram, { type Socket } from "node:dgram";
export interface Hsbk {
  hue: number;
  saturation: number;
  brightness: number;
  kelvin: number;
}
export interface LightState {
  color: Hsbk;
  power: boolean;
}
export interface Transport {
  exchange(
    type: number,
    payload: Uint8Array,
    expectedType: number,
    signal: AbortSignal,
  ): Promise<Buffer>;
  close(): void;
}
const requests = new Map([
  [14, [0, 15, 20]],
  [21, [2, 45, 0]],
  [32, [0, 33, 12]],
  [101, [0, 107, 52]],
  [102, [13, 45, 0]],
]);
export function encodeColor(color: Hsbk): Buffer {
  if (
    !color ||
    ["hue", "saturation", "brightness", "kelvin"].some(
      (k) =>
        !Number.isInteger(color[k as keyof Hsbk]) ||
        color[k as keyof Hsbk] < 0 ||
        color[k as keyof Hsbk] > 65535,
    )
  )
    throw new Error("invalid-hsbk");
  const b = Buffer.alloc(13);
  [color.hue, color.saturation, color.brightness, color.kelvin].forEach(
    (v, i) => b.writeUInt16LE(v, 1 + i * 2),
  );
  return b;
}
export function encodePower(on: boolean): Buffer {
  if (typeof on !== "boolean") throw new Error("invalid-power");
  const b = Buffer.alloc(2);
  b.writeUInt16LE(on ? 65535 : 0);
  return b;
}
export function decodeState(payload: Uint8Array): LightState {
  if (payload.byteLength !== 52) throw new Error("invalid-light-state");
  const b = Buffer.from(payload);
  return {
    color: {
      hue: b.readUInt16LE(0),
      saturation: b.readUInt16LE(2),
      brightness: b.readUInt16LE(4),
      kelvin: b.readUInt16LE(6),
    },
    power: b.readUInt16LE(10) !== 0,
  };
}
/** No socket is opened until exchange. The address is private immutable configuration. */
export class UdpTransport implements Transport {
  readonly #address: string;
  readonly #factory: () => Socket;
  #target: Buffer = Buffer.alloc(8);
  #closed = false;
  readonly #pending = new Set<(error: Error) => void>();
  constructor(options: { address: string; socketFactory?: () => Socket }) {
    if (!isIPv4(options.address)) throw new Error("invalid-lifx-address");
    const octets = options.address.split(".").map(Number);
    // Conservatively exclude common network/broadcast addresses without guessing a subnet.
    if (
      octets[0] === 0 ||
      octets[0] >= 224 ||
      octets[3] === 255 ||
      octets[3] === 0
    )
      throw new Error("invalid-lifx-address");
    this.#address = options.address;
    this.#factory = options.socketFactory ?? (() => dgram.createSocket("udp4"));
  }
  async exchange(
    type: number,
    payload: Uint8Array,
    expected: number,
    signal: AbortSignal,
  ): Promise<Buffer> {
    if (this.#closed || signal.aborted) throw new Error("lifx-closed");
    const spec = requests.get(type);
    if (!spec || spec[0] !== payload.byteLength || spec[1] !== expected)
      throw new Error("invalid-lifx-message");
    let source = 0;
    while (source < 2) source = randomBytes(4).readUInt32LE();
    const sequence = randomBytes(1)[0],
      packet = Buffer.alloc(36 + payload.byteLength);
    packet.writeUInt16LE(packet.length);
    packet.writeUInt16LE(0x1400, 2);
    packet.writeUInt32LE(source, 4);
    this.#target.copy(packet, 8);
    packet[22] = type === 21 || type === 102 ? 2 : 0;
    packet[23] = sequence;
    packet.writeUInt16LE(type, 32);
    Buffer.from(payload).copy(packet, 36);
    let socket: Socket;
    try {
      socket = this.#factory();
    } catch {
      throw new Error("lifx-transport-failure");
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error, response?: Buffer) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abort);
        this.#pending.delete(stop);
        try {
          socket.close();
        } catch {}
        if (error) reject(error);
        else resolve(response!);
      };
      const stop = (error: Error) => finish(error);
      const abort = () => stop(new Error("lifx-aborted"));
      this.#pending.add(stop);
      signal.addEventListener("abort", abort, { once: true });
      socket.on("message", (message, remote) => {
        if (
          settled ||
          remote.address !== this.#address ||
          remote.port !== 56700 ||
          message.length !== 36 + spec[2] ||
          message.readUInt16LE(0) !== message.length ||
          (message.readUInt16LE(2) & 0xfff) !== 1024 ||
          (message[3] & 0x10) === 0 ||
          message.readUInt32LE(4) !== source ||
          message[23] !== sequence ||
          message.readUInt16LE(32) !== expected
        )
          return;
        const target = Buffer.from(message.subarray(8, 16));
        if (
          target.subarray(0, 6).every((v) => v === 0) ||
          target[6] !== 0 ||
          target[7] !== 0 ||
          (!this.#target.equals(Buffer.alloc(8)) &&
            !target.equals(this.#target))
        )
          return;
        this.#target = target;
        finish(undefined, Buffer.from(message.subarray(36)));
      });
      socket.on("error", () => finish(new Error("lifx-transport-failure")));
      if (signal.aborted || this.#closed) {
        abort();
        return;
      }
      try {
        socket.send(packet, 56700, this.#address, (error) => {
          if (error) finish(new Error("lifx-transport-failure"));
        });
      } catch {
        finish(new Error("lifx-transport-failure"));
      }
    });
  }
  close() {
    if (this.#closed) return;
    this.#closed = true;
    for (const stop of this.#pending) stop(new Error("lifx-closed"));
  }
}
