import {SdkError, type Scheduler} from '@jimmie-potts/sdk';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {BOUNDS, type Operation, type Power, type Version} from '@jimmie-potts/bb8/link';
import {encodeCommand, PacketCollector, PacketError, type Packet} from './packet.js';
export const UUID = {
  command: '22bb746f2ba175542d6f726568705327', response: '22bb746f2ba675542d6f726568705327',
  unlock: '22bb746f2bbd75542d6f726568705327', txPower: '22bb746f2bb275542d6f726568705327', wake: '22bb746f2bbf75542d6f726568705327',
} as const;
export interface Gatt {
  readonly characteristics: ReadonlyMap<string, readonly string[]>;
  subscribe(uuid: string, handler: (bytes: Uint8Array) => void, signal: AbortSignal): Promise<void>;
  write(uuid: string, bytes: Uint8Array, signal: AbortSignal): Promise<void>;
  close(): Promise<void>;
  onDisconnected?(handler: () => void): void;
}
export interface Adapter {open(signal: AbortSignal): Promise<Gatt>}
export type TransportObservation = {power?: Power; version?: Version};
const refusal = (code: 'unavailable' | 'unsupported-capability' | 'invalid-request' | 'invalid-message' | 'capacity'): SdkError => new SdkError(errorBody(code, {detail: 'BB-8 transport refused the operation'}));
/** Only this executor can write the selected GATT characteristics. Native loading belongs to the injected adapter. */
export class PacketTransport {
  readonly #adapter: () => Adapter;
  readonly #scheduler: Scheduler;
  readonly #now: () => number;
  readonly #onLost: () => void;
  #gatt: Gatt | undefined;
  #sequence = 0;
  #collector = new PacketCollector();
  #pending: {sequence: number; resolve: (packet: Packet) => void; reject: (reason: unknown) => void} | undefined;
  #lastWriteAtMs = -Infinity;
  #notifications = 0;
  #fault: Error | undefined;
  constructor(adapter: () => Adapter, scheduler: Scheduler, now: () => number, onLost: () => void = () => {}) {this.#adapter = adapter; this.#scheduler = scheduler; this.#now = now; this.#onLost = onLost;}
  async close(): Promise<void> {
    const gatt = this.#gatt; this.#gatt = undefined;
    this.#pending?.reject(refusal('unavailable')); this.#pending = undefined; this.#collector.clear();
    await gatt?.close();
  }
  async execute(operation: Operation, signal: AbortSignal, check: () => void, effect: () => void): Promise<TransportObservation> {
    this.#notifications = 0; this.#fault = undefined;
    check();
    switch (operation.kind) {
      case 'connect': {
        effect(); await this.close(); check();
        const gatt = await this.#adapter().open(signal);
        if (signal.aborted) {await gatt.close(); check();}
        this.#gatt = gatt; gatt.onDisconnected?.(() => {if (this.#gatt === gatt) {this.#pending?.reject(refusal('unavailable')); this.#onLost();}}); this.#sequence = 0; this.#lastWriteAtMs = -Infinity;
        if (![UUID.command, UUID.unlock, UUID.txPower].every(id => gatt.characteristics.get(id)?.includes('write') === true) || gatt.characteristics.get(UUID.response)?.includes('notify') !== true) {
          await this.close(); throw refusal('unsupported-capability');
        }
        await gatt.subscribe(UUID.response, bytes => {
          if (this.#gatt !== gatt || signal.aborted) return;
          try {
            this.#notifications += 1;
            if (this.#notifications > 128) throw refusal('capacity');
            for (const packet of this.#collector.feed(bytes)) {
              if (packet.kind === 'reply' && packet.sequence === this.#pending?.sequence) this.#pending.resolve(packet);
            }
          } catch (error) {this.#fault = error instanceof Error ? error : refusal('invalid-message'); this.#pending?.reject(this.#fault);}
        }, signal);
        await this.#write(UUID.unlock, new TextEncoder().encode('011i3'), signal, check, effect);
        await this.#write(UUID.txPower, Uint8Array.of(7), signal, check, effect);
        await this.#packet(0, 1, new Uint8Array(), 0, signal, check, effect);
        const bytes = await this.#packet(0, 2, new Uint8Array(), 8, signal, check, effect);
        return {version: {bytes: [...bytes] as Version['bytes'], observedAtMs: this.#now()}};
      }
      case 'disconnect': effect(); await this.close(); return {};
      case 'wake':
        if (this.#gatt?.characteristics.get(UUID.wake)?.includes('write') !== true) throw refusal('unsupported-capability');
        await this.#write(UUID.wake, Uint8Array.of(1), signal, check, effect); return {};
      case 'led-set':
        await this.#packet(2, operation.led.target === 'main' ? 0x20 : 0x21, operation.led.target === 'main' ? Uint8Array.from(operation.led.rgb) : Uint8Array.of(operation.led.brightness), 0, signal, check, effect); return {};
      case 'power-refresh': {
        const bytes = await this.#packet(0, 0x20, new Uint8Array(), 8, signal, check, effect);
        const version = bytes[0], category = bytes[1];
        if (version !== 1 || (category !== 1 && category !== 2 && category !== 3 && category !== 4)) throw refusal('unsupported-capability');
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        return {power: {recordVersion: 1, category, voltageHundredths: view.getUint16(2), rechargeCount: view.getUint16(4), secondsAwakeSinceRecharge: view.getUint16(6), observedAtMs: this.#now()}};
      }
    }
  }
  #wait(delay: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(refusal('unavailable'));
    return new Promise((resolve, reject) => {
      const cancelled = (): void => {cancel(); reject(refusal('unavailable'));};
      const cancel = this.#scheduler.after(delay, () => {signal.removeEventListener('abort', cancelled); resolve();});
      signal.addEventListener('abort', cancelled, {once: true});
    });
  }
  async #write(uuid: string, bytes: Uint8Array, signal: AbortSignal, check: () => void, effect: () => void): Promise<void> {
    for (let at = 0; at < bytes.length; at += BOUNDS.writeBytes) {
      const delay = this.#lastWriteAtMs + BOUNDS.spacingMs - this.#now();
      if (delay > 0) await this.#wait(delay, signal);
      if (this.#fault !== undefined) throw this.#fault;
      check(); if (signal.aborted) throw refusal('unavailable');
      const gatt = this.#gatt; if (gatt === undefined) throw refusal('unavailable');
      effect(); this.#lastWriteAtMs = this.#now();
      await gatt.write(uuid, bytes.slice(at, at + BOUNDS.writeBytes), signal);
    }
  }
  async #packet(did: number, cid: number, data: Uint8Array, length: number, signal: AbortSignal, check: () => void, effect: () => void): Promise<Uint8Array> {
    if (this.#sequence > 255) throw refusal('capacity');
    const sequence = this.#sequence++; this.#collector.clear();
    let finish: (() => void) | undefined;
    const reply = new Promise<Packet>((resolve, reject) => {
      const cancel = this.#scheduler.after(BOUNDS.responseMs, () => {reject(refusal('unavailable'));});
      const aborted = (): void => {reject(refusal('unavailable'));};
      signal.addEventListener('abort', aborted, {once: true});
      finish = () => {cancel(); signal.removeEventListener('abort', aborted);};
      this.#pending = {sequence, resolve, reject};
    });
    // A deadline/stream rejection while a native write is awaiting must never become an unhandled rejection.
    void reply.catch(() => {});
    try {
      await this.#write(UUID.command, encodeCommand(did, cid, sequence, data), signal, check, effect);
      const packet = await reply;
      if (this.#fault !== undefined) throw this.#fault;
      check();
      if (packet.code !== 0) throw refusal([4, 5, 9].includes(packet.code) ? 'unsupported-capability' : packet.code === 7 ? 'invalid-request' : 'invalid-message');
      if (packet.data.length !== length) throw refusal('invalid-message');
      return packet.data;
    } catch (error) {
      if (error instanceof PacketError) throw new SdkError(errorBody(error.code, {detail: 'BB-8 packet collector refused the response'}), {cause: error});
      throw error;
    } finally {finish?.(); this.#pending = undefined;}
  }
}
