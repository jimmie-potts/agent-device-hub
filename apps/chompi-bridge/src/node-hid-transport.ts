import type { HidDeviceInfo, Transport } from './transport.js';

/** The subset of node-hid 3.x this transport uses, typed locally so builds and tests never need the native module. */
export interface NodeHidHandle {
  on(event: 'data', listener: (data: Uint8Array) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  write(values: Buffer): Promise<number>;
  close(): Promise<void>;
}

export interface NodeHidModule {
  devicesAsync(): Promise<HidDeviceInfo[]>;
  getHidapiVersion?(): string;
  HIDAsync: { open(path: string): Promise<NodeHidHandle> };
}

/** Loads node-hid on first use. It is an optional dependency, so its absence is an ordinary error here. */
export async function loadNodeHid(): Promise<NodeHidModule> {
  const specifier = 'node-hid';
  try {
    const loaded = await import(specifier) as { default?: NodeHidModule } & NodeHidModule;
    return loaded.default ?? loaded;
  } catch (cause) {
    throw new Error('node-hid-unavailable', { cause });
  }
}

const pick = (device: HidDeviceInfo): HidDeviceInfo => ({
  vendorId: device.vendorId, productId: device.productId, path: device.path, product: device.product,
  manufacturer: device.manufacturer, serialNumber: device.serialNumber, usagePage: device.usagePage, usage: device.usage,
});

/**
 * USB HID through node-hid (hidapi). Windows is the only qualified platform for now. Reports have no report ID:
 * hidapi strips the zero ID from reads, and writes need it prefixed. hidapi opens Windows HID devices with shared
 * access, so one-writer enforcement comes from the single-instance lock, not from the open.
 */
export function createNodeHidTransport(load: () => Promise<NodeHidModule> = loadNodeHid): Transport {
  let module: Promise<NodeHidModule> | undefined;
  const hid = () => (module ??= load());
  return {
    async list() {
      return (await (await hid()).devicesAsync()).map(pick);
    },
    async open(device, handlers) {
      if (!device.path) throw new Error('device-path-missing');
      const handle = await (await hid()).HIDAsync.open(device.path);
      let closed = false;
      handle.on('data', data => { if (!closed) handlers.report(Uint8Array.from(data)); });
      handle.on('error', error => {
        if (closed) return;
        closed = true;
        void handle.close().catch(() => undefined);
        handlers.closed(error);
      });
      return {
        async write(report) {
          if (closed) throw new Error('device-closed');
          const out = Buffer.alloc(report.length + 1);
          out.set(report, 1);
          const written = await handle.write(out);
          if (written < report.length) throw new Error('short-write');
        },
        async close() {
          if (closed) return;
          closed = true;
          await handle.close();
        },
      };
    },
  };
}
