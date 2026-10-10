import {UUID, type Gatt} from './transport.js';
export class FakeGatt implements Gatt {
  readonly characteristics = new Map(Object.values(UUID).map(id => [id, id === UUID.response ? ['notify'] : ['write']]));
  readonly writes: {uuid: string; bytes: number[]; atMs: number}[] = [];
  callback: ((bytes: Uint8Array) => void) | undefined;
  closed = false;
  reply = true;
  corrupt = false;
  staleSequence = false;
  power = [1, 2, 1, 164, 0, 5, 0, 100];
  async subscribe(_uuid: string, handler: (bytes: Uint8Array) => void): Promise<void> {this.callback = handler; await Promise.resolve();}
  async write(uuid: string, bytes: Uint8Array, signal: AbortSignal): Promise<void> {
    if (this.closed || signal.aborted) throw new Error('fake GATT is closed');
    this.writes.push({uuid, bytes: [...bytes], atMs: Date.now()});
    if (uuid === UUID.command && this.reply) {
      const seq = bytes[4]; if (seq === undefined) throw new Error('fake command lacks sequence');
      const data = bytes[2] === 0 && bytes[3] === 2 ? [1, 2, 3, 4, 5, 6, 7, 8] : bytes[2] === 0 && bytes[3] === 32 ? this.power : [];
      const body = [0, this.staleSequence ? (seq + 1) & 255 : seq, data.length + 1, ...data];
      const frame = Uint8Array.of(255, 255, ...body, this.corrupt ? 0 : 255 - (body.reduce((a, b) => a + b, 0) & 255));
      this.callback?.(frame.slice(0, 3)); this.callback?.(frame.slice(3));
    }
    await Promise.resolve();
  }
  async close(): Promise<void> {this.closed = true; await Promise.resolve();}
}
export const scheduler = {after: (ms: number, f: () => void) => {const t = setTimeout(f, ms); return () => clearTimeout(t);}};
