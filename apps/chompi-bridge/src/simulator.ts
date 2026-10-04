import { randomInt } from 'node:crypto';
import { systemClock, type Clock } from './clock.js';
import { CONTROLLER_IDENTITY } from './matcher.js';
import {
  CONTROL_COUNT, ENCODER_COUNT, LED_COUNT, decodeHostReport, encodeReport,
  type InputKind, type RejectReason, type Rgb,
} from './protocol.js';
import type { HidDeviceInfo, Transport, TransportConnection, TransportHandlers } from './transport.js';

export interface SimulatorOptions {
  clock?: Clock;
  /** Epoch for each enumeration; defaults to a random nonzero u16. */
  nextEpoch?: () => number;
  firmware?: [number, number, number];
  serialNumber?: string;
}

export interface SimulatorCounters {
  /** Device reports sent while no host handle was open, which the OS discards. */
  lostReports: number;
  /** Inputs not sent because no host heartbeat was current; the firmware never queues them. */
  droppedWithoutHost: number;
  /** Host reports the device rejected, by contract reason. */
  rejected: Partial<Record<RejectReason, number>>;
}

const HEARTBEAT_MS = 500;
const HOST_TIMEOUT_MS = 2000;

class SimulatorConnection implements TransportConnection {
  open = true;
  readonly #simulator: ChompiSimulator;
  readonly handlers: TransportHandlers;

  constructor(simulator: ChompiSimulator, handlers: TransportHandlers) { this.#simulator = simulator; this.handlers = handlers; }

  async write(report: Uint8Array): Promise<void> {
    if (!this.open) throw new Error('simulator-connection-closed');
    const copy = Uint8Array.from(report);
    queueMicrotask(() => this.#simulator.receive(copy));
  }

  async close(): Promise<void> { this.#simulator.detach(this); }
}

/**
 * The device side of protocol v1, for routing development and tests without hardware. It sends `hello` at
 * enumeration and again whenever host heartbeats resume after the 2 s host timeout, numbers inputs per epoch,
 * sends heartbeats every 500 ms, applies two-part LED frames and drops input while no host heartbeat is current.
 */
export class ChompiSimulator {
  readonly counters: SimulatorCounters = { lostReports: 0, droppedWithoutHost: 0, rejected: {} };
  readonly transport: Transport;
  readonly #clock: Clock;
  readonly #nextEpoch: () => number;
  readonly #firmware: [number, number, number];
  readonly #descriptor: HidDeviceInfo;
  readonly #connections = new Set<SimulatorConnection>();
  readonly #pressed = new Set<number>();
  #plugged = false;
  #epoch = 0;
  #sequence = 0;
  #heartbeatTimer: unknown;
  #heartbeatsPaused = false;
  #hostSeenAt: number | undefined;
  #brightness = 0;
  #profileVersion = 0;
  #leds: Rgb[] = Array.from({ length: LED_COUNT }, () => [0, 0, 0] as const);
  #appliedFrame = 0;
  #pending: { frame: number; parts: [Rgb[] | undefined, Rgb[] | undefined] } | undefined;

  constructor(options: SimulatorOptions = {}) {
    this.#clock = options.clock ?? systemClock;
    this.#nextEpoch = options.nextEpoch ?? (() => randomInt(1, 0x10000));
    this.#firmware = options.firmware ?? [0, 1, 0];
    this.#descriptor = { ...CONTROLLER_IDENTITY, manufacturer: 'agent-device-hub', serialNumber: options.serialNumber ?? '000000000000000000000000', path: 'chompi-simulator' };
    this.transport = {
      list: async () => this.#plugged ? [{ ...this.#descriptor }] : [],
      open: async (device, handlers) => {
        if (!this.#plugged || device.path !== this.#descriptor.path) throw new Error('simulator-device-not-present');
        const connection = new SimulatorConnection(this, handlers);
        this.#connections.add(connection);
        return connection;
      },
    };
  }

  get plugged(): boolean { return this.#plugged; }
  /** Controls physically held down, whether or not their events reached a host. */
  get pressed(): number[] { return [...this.#pressed].sort((a, b) => a - b); }
  get epoch(): number { return this.#epoch; }
  /** Open host handles. */
  get connections(): TransportConnection[] { return [...this.#connections]; }
  get leds(): Rgb[] { return this.#leds.map(([r, g, b]) => [r, g, b] as const); }
  get appliedFrame(): number { return this.#appliedFrame; }
  get brightnessPercent(): number { return this.#brightness; }
  get profileVersion(): number { return this.#profileVersion; }
  get hostAlive(): boolean { return this.#hostSeenAt !== undefined && this.#clock.now() - this.#hostSeenAt < HOST_TIMEOUT_MS; }
  /** `disconnected` is the firmware's dim breathe on the CHOMPI key; `host` shows the host's last frame. */
  get display(): 'disconnected' | 'host' { return this.#plugged && this.hostAlive ? 'host' : 'disconnected'; }

  /** USB enumeration: a new epoch, sequence restart and an immediate `hello`. */
  plug(): void {
    if (this.#plugged) return;
    this.#plugged = true;
    const epoch = this.#nextEpoch();
    if (!Number.isInteger(epoch) || epoch < 1 || epoch > 0xffff) throw new RangeError('epoch must be a nonzero u16');
    this.#epoch = epoch;
    this.#sequence = 0;
    this.#hostSeenAt = undefined;
    this.#heartbeatTimer = this.#clock.setInterval(() => this.#heartbeat(), HEARTBEAT_MS);
    this.#sendHello();
  }

  /** Removes the device: every host handle closes and nothing more is sent. Physical key state is kept. */
  unplug(): void {
    if (!this.#plugged) return;
    this.#plugged = false;
    this.#clock.clearInterval(this.#heartbeatTimer);
    this.#hostSeenAt = undefined;
    for (const connection of [...this.#connections]) {
      this.detach(connection);
      queueMicrotask(() => connection.handlers.closed());
    }
  }

  press(control: number): void { this.#input(control, 'press', 0); }
  release(control: number): void { this.#input(control, 'release', 0); }
  click(control: number): void { this.press(control); this.release(control); }
  /** `control` is an encoder turn ID (41-46); positive delta is clockwise. */
  turn(control: number, delta: number): void { this.#input(control, 'turn', delta); }

  /** Stops or resumes device heartbeats, to exercise the host's stale handling. */
  pauseHeartbeats(paused: boolean): void { this.#heartbeatsPaused = paused; }

  /** Sends any report, valid or not, to the open host handles. */
  sendRaw(report: Uint8Array): void { this.#deliver(Uint8Array.from(report)); }

  /** @internal Host report arrival. */
  receive(report: Uint8Array): void {
    if (!this.#plugged) return;
    const decoded = decodeHostReport(report);
    if (!decoded.ok) {
      this.counters.rejected[decoded.reason] = (this.counters.rejected[decoded.reason] ?? 0) + 1;
      return;
    }
    const message = decoded.message;
    if (message.type === 'host-heartbeat') {
      const resumed = !this.hostAlive;
      this.#hostSeenAt = this.#clock.now();
      this.#brightness = message.brightnessPercent;
      this.#profileVersion = message.profileVersion;
      if (resumed) this.#sendHello();
      return;
    }
    if (this.#pending?.frame !== message.frame) this.#pending = { frame: message.frame, parts: [undefined, undefined] };
    this.#pending.parts[message.part] = message.colors;
    const [first, second] = this.#pending.parts;
    if (first && second) {
      this.#leds = [...first, ...second];
      this.#appliedFrame = message.frame;
      this.#pending = undefined;
    }
  }

  /** @internal */
  detach(connection: SimulatorConnection): void {
    connection.open = false;
    this.#connections.delete(connection);
  }

  #input(control: number, kind: InputKind, delta: number): void {
    const sequence = (this.#sequence + 1) & 0xffff;
    const report = encodeReport({ type: 'input', version: 1, epoch: this.#epoch || 1, sequence, control, kind, delta });
    if (kind === 'press') this.#pressed.add(control);
    if (kind === 'release') this.#pressed.delete(control);
    if (!this.#plugged || !this.hostAlive) {
      this.counters.droppedWithoutHost++;
      return;
    }
    this.#sequence = sequence;
    this.#deliver(report);
  }

  #sendHello(): void {
    this.#deliver(encodeReport({ type: 'hello', version: 1, epoch: this.#epoch, firmware: this.#firmware, controls: CONTROL_COUNT, encoders: ENCODER_COUNT, leds: LED_COUNT }));
  }

  #heartbeat(): void {
    if (!this.#plugged || this.#heartbeatsPaused) return;
    this.#deliver(encodeReport({ type: 'heartbeat', version: 1, epoch: this.#epoch, ledFrame: this.#appliedFrame, hostAlive: this.hostAlive }));
  }

  #deliver(report: Uint8Array): void {
    if (this.#connections.size === 0) {
      this.counters.lostReports++;
      return;
    }
    for (const connection of this.#connections) queueMicrotask(() => { if (connection.open) connection.handlers.report(Uint8Array.from(report)); });
  }
}
