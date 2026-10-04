import type { HidDeviceInfo, Transport, TransportConnection, TransportHandlers } from './transport.js';

/** One fake open handle. Tests inject device reports and read what the bridge wrote. */
export class FakeConnection implements TransportConnection {
  readonly written: Uint8Array[] = [];
  closed = false;
  readonly #handlers: TransportHandlers;
  readonly #transport: FakeTransport;

  constructor(transport: FakeTransport, handlers: TransportHandlers) { this.#transport = transport; this.#handlers = handlers; }

  async write(report: Uint8Array): Promise<void> {
    if (this.closed) throw new Error('fake-connection-closed');
    if (this.#transport.failWrites) throw new Error('fake-write-failed');
    if (this.#transport.hangWrites) return new Promise<void>(() => undefined);
    this.written.push(Uint8Array.from(report));
  }

  async close(): Promise<void> { this.closed = true; }

  /** Delivers a device report to the bridge, as a read would. Ignored once the handle is closed. */
  inject(report: Uint8Array): void { if (!this.closed) this.#handlers.report(Uint8Array.from(report)); }

  /** The device side drops the handle, as an unplug or read error would. */
  disconnect(error?: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.#handlers.closed(error);
  }
}

/** In-memory transport for tests: a configurable device list and a record of every open. */
export class FakeTransport implements Transport {
  devices: HidDeviceInfo[];
  readonly opens: string[] = [];
  readonly connections: FakeConnection[] = [];
  failOpen = false;
  failWrites = false;
  /** Writes never complete, as with a stalled device. */
  hangWrites = false;
  /** When set, each open waits for this promise before completing. */
  openGate: Promise<unknown> | undefined;

  constructor(devices: HidDeviceInfo[] = []) { this.devices = devices; }

  async list(): Promise<HidDeviceInfo[]> { return this.devices.map(device => ({ ...device })); }

  async open(device: HidDeviceInfo, handlers: TransportHandlers): Promise<TransportConnection> {
    this.opens.push(device.path ?? '');
    if (this.openGate) await this.openGate;
    if (this.failOpen) throw new Error('fake-open-failed');
    const connection = new FakeConnection(this, handlers);
    this.connections.push(connection);
    return connection;
  }

  /** The most recent connection. */
  get connection(): FakeConnection {
    const latest = this.connections.at(-1);
    if (!latest) throw new Error('no fake connection opened');
    return latest;
  }
}
