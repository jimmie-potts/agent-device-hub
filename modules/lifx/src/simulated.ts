// Simulated LIFX bulbs (Hub #928): the transport tests and disposable runs give the module, so no bulb is reached. They
// answer the packets the old controller's fake-packet tests answered: a LightGet with a 52-byte LightState, and a
// LightSetColor or DeviceSetPower with an acknowledgment after applying it. Like real bulbs, they keep their state when
// the runtime restarts. A test can switch a bulb off the network, make it lose its next acknowledgment after applying
// the write, or change it as the LIFX app would.
import {PACKET, type Hsbk, type LightState, type Transport} from './protocol.js';

/** How the module reaches its bulbs: one transport per configured address, which opens no socket until it exchanges a packet. */
export interface LifxNetwork {
  connect(address: string): Transport;
}

/** One simulated bulb, as plain data. */
export type SimulatedBulb = {online: boolean; power: boolean; color: Hsbk};
/** What the simulated bulbs show, as plain data so a disposable run can report it: each bulb by address, and every packet it got. */
export type LifxDeviceState = {bulbs: Record<string, SimulatedBulb>; packets: {address: string; type: number}[]};

const WARM: Hsbk = {hue: 0, saturation: 0, brightness: 32768, kelvin: 3500};

function lightState({power, color}: LightState): Buffer {
  const payload = Buffer.alloc(52);
  [color.hue, color.saturation, color.brightness, color.kelvin].forEach((value, index) => payload.writeUInt16LE(value, index * 2));
  payload.writeUInt16LE(power ? 65535 : 0, 10);
  return payload;
}

/** Simulated bulbs, each created on first use: on, warm white, and online unless the network starts offline. */
export class SimulatedLifx implements LifxNetwork {
  readonly #bulbs = new Map<string, SimulatedBulb>();
  readonly #packets: {address: string; type: number}[] = [];
  readonly #loseNext = new Set<string>();
  readonly #online: boolean;

  constructor({online = true}: {online?: boolean} = {}) {
    this.#online = online;
  }

  connect(address: string): Transport {
    this.#bulb(address);
    return {exchange: (type, payload, expected, signal) => this.exchange(address, type, payload, expected, signal), close: () => {}};
  }

  /** One packet to the bulb at `address`. An offline bulb never answers, until `signal` aborts the wait. */
  exchange(address: string, type: number, payload: Uint8Array, _expected: number, signal: AbortSignal): Promise<Buffer> {
    const bulb = this.#bulb(address);
    this.#packets.push({address, type});
    const silent = (): Promise<Buffer> => new Promise((_, reject) => {
      const gone = (): void => { reject(new Error('the bulb did not answer')); };
      if (signal.aborted) gone();
      else signal.addEventListener('abort', gone, {once: true});
    });
    if (!bulb.online) return silent();
    const data = Buffer.from(payload);
    if (type === PACKET.lightGet) return Promise.resolve(lightState(bulb));
    if (type === PACKET.setPower) bulb.power = data.readUInt16LE(0) !== 0;
    else if (type === PACKET.setColor) {
      bulb.color = {hue: data.readUInt16LE(1), saturation: data.readUInt16LE(3), brightness: data.readUInt16LE(5), kelvin: data.readUInt16LE(7)};
    } else return Promise.reject(new Error('the bulb does not answer that packet'));
    if (this.#loseNext.delete(address)) return silent();
    return Promise.resolve(Buffer.alloc(0));
  }

  /** Brings every bulb, or the one at `address`, back on the network. */
  online(address?: string): void {
    for (const bulb of this.#select(address)) bulb.online = true;
  }

  /** Takes every bulb, or the one at `address`, off the network, as a bulb switched off at the wall. */
  offline(address?: string): void {
    for (const bulb of this.#select(address)) bulb.online = false;
  }

  /** The bulb at `address` applies its next write but its acknowledgment is lost. */
  loseNextAcknowledgment(address: string): void {
    this.#loseNext.add(address);
  }

  /** Changes the bulb at `address` as the LIFX app would, outside the module. */
  change(address: string, change: Partial<LightState>): void {
    const bulb = this.#bulb(address);
    if (change.power !== undefined) bulb.power = change.power;
    if (change.color !== undefined) bulb.color = {...change.color};
  }

  state(): LifxDeviceState {
    return {
      bulbs: Object.fromEntries([...this.#bulbs].map(([address, bulb]) => [address, {...bulb, color: {...bulb.color}}])),
      packets: this.#packets.map(packet => ({...packet})),
    };
  }

  #bulb(address: string): SimulatedBulb {
    let bulb = this.#bulbs.get(address);
    if (bulb === undefined) {
      bulb = {online: this.#online, power: true, color: {...WARM}};
      this.#bulbs.set(address, bulb);
    }
    return bulb;
  }

  #select(address: string | undefined): SimulatedBulb[] {
    return address === undefined ? [...this.#bulbs.values()] : [this.#bulb(address)];
  }
}
