/** PacketV1, ported from the pinned MIT reference in the qualification guide. No native/device access. */
export type Packet = {kind: 'reply' | 'notification'; code: number; sequence: number; data: Uint8Array};
export const MAX_COLLECTOR_BYTES = 1024;
export class PacketError extends Error {
  readonly code: 'capacity' | 'invalid-message';
  constructor(code: 'capacity' | 'invalid-message') { super('BB-8 packet refused'); this.code = code; }
}
const byte = (value: number): boolean => Number.isInteger(value) && value >= 0 && value <= 255;
const checksum = (bytes: Uint8Array): number => 255 - (bytes.reduce((sum, value) => sum + value, 0) & 255);
export function encodeCommand(did: number, cid: number, sequence: number, data: Uint8Array): Uint8Array {
  if (![did, cid, sequence].every(byte) || data.length > 254) throw new PacketError('invalid-message');
  const bytes = Uint8Array.of(255, 255, did, cid, sequence, data.length + 1, ...data);
  return Uint8Array.of(...bytes, checksum(bytes.subarray(2)));
}

/** Corrupt frames are discarded without completing a transaction; truncated frames time out at the caller. */
export class PacketCollector {
  #bytes = new Uint8Array();
  get buffered(): number { return this.#bytes.length; }
  clear(): void { this.#bytes = new Uint8Array(); }
  feed(bytes: Uint8Array): Packet[] {
    if (bytes.length > MAX_COLLECTOR_BYTES || this.#bytes.length + bytes.length > MAX_COLLECTOR_BYTES) {
      this.clear(); throw new PacketError('capacity');
    }
    this.#bytes = Uint8Array.of(...this.#bytes, ...bytes);
    const packets: Packet[] = [];
    while (this.#bytes.length >= 5) {
      const b = this.#bytes;
      if (b[0] !== 255 || (b[1] !== 255 && b[1] !== 254)) { this.#bytes = b.slice(1); continue; }
      const code = b[2], hi = b[3], low = b[4];
      if (code === undefined || hi === undefined || low === undefined) break;
      const length = b[1] === 255 ? low : hi * 256 + low;
      if (length === 0) { this.#bytes = b.slice(1); continue; }
      if (length + 5 > MAX_COLLECTOR_BYTES) { this.clear(); throw new PacketError('capacity'); }
      if (b.length < length + 5) break;
      const frame = b.slice(0, length + 5);
      if ((frame.subarray(2).reduce((sum, value) => sum + value, 0) & 255) !== 255) {
        this.#bytes = b.slice(1); continue;
      }
      packets.push({kind: b[1] === 255 ? 'reply' : 'notification', code, sequence: b[1] === 255 ? hi : 0, data: frame.slice(5, -1)});
      this.#bytes = b.slice(frame.length);
    }
    return packets;
  }
}
