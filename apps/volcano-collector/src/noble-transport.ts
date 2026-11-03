// The collector's transport on `@stoprocent/noble`, qualified for reads and notifications on the Mac Mini on 2026-11-03. It
// maps the collector's five operations onto noble and nothing else: it asks for only the allowlisted services and
// characteristics, and it refuses any other UUID before touching the device. It never calls a write. Noble's own
// subscription setup, the client characteristic configuration write, is the one write the Bluetooth stack makes.
//
// The types below describe only the part of noble this file may use, so the root build needs no native dependency and a
// write is not even expressible here.
import {READABLE, SUBSCRIBABLE, VOLCANO_SERVICES, type ReadUuid, type SubscribeUuid, type VolcanoTransport} from '@jimmie-potts/runtime/volcano-collector';

export type NobleCharacteristic = {
  readonly uuid: string;
  readAsync(): Promise<Uint8Array>;
  subscribeAsync(): Promise<void>;
  on(event: 'data', listener: (data: Uint8Array) => void): unknown;
};
export type NoblePeripheral = {
  readonly advertisement: {readonly localName?: string};
  once(event: 'disconnect', listener: () => void): unknown;
  connectAsync(): Promise<void>;
  disconnectAsync(): Promise<void>;
  discoverSomeServicesAndCharacteristicsAsync(services: readonly string[], characteristics: readonly string[]): Promise<{characteristics: readonly NobleCharacteristic[]}>;
};
export type Noble = {
  waitForPoweredOnAsync(timeoutMs: number): Promise<unknown>;
  startScanningAsync(services: readonly string[], allowDuplicates: boolean): Promise<void>;
  stopScanningAsync(): Promise<void>;
  on(event: 'discover', listener: (peripheral: NoblePeripheral) => void): unknown;
  removeListener(event: 'discover', listener: (peripheral: NoblePeripheral) => void): unknown;
};

const POWERED_ON_MS = 15_000;
/** Noble spells a 128-bit UUID in lowercase hex without hyphens. */
const nobleUuid = (uuid: string): string => uuid.replaceAll('-', '').toLowerCase();
const refused = (): Error => new Error('volcano-collector: this characteristic is not allowed');

/** The transport over one noble instance, for one advertiser at a time. */
export function nobleTransport(noble: Noble): VolcanoTransport {
  let peripheral: NoblePeripheral | undefined;
  let characteristics = new Map<string, NobleCharacteristic>();
  const characteristic = (uuid: string): NobleCharacteristic => {
    const found = characteristics.get(nobleUuid(uuid));
    if (found === undefined) throw new Error('volcano-collector: the characteristic was not found');
    return found;
  };
  return {
    async scan(advertisedName, signal) {
      peripheral = undefined;
      await noble.waitForPoweredOnAsync(POWERED_ON_MS);
      return await new Promise<boolean>((resolve, reject) => {
        const finish = (result: boolean): void => {
          noble.removeListener('discover', discovered);
          signal.removeEventListener('abort', ended);
          noble.stopScanningAsync().then(() => { resolve(result); }, () => { resolve(result); });
        };
        const discovered = (candidate: NoblePeripheral): void => {
          if (candidate.advertisement.localName !== advertisedName) return;
          peripheral = candidate;
          finish(true);
        };
        const ended = (): void => { finish(false); };
        noble.on('discover', discovered);
        signal.addEventListener('abort', ended, {once: true});
        if (signal.aborted) { ended(); return; }
        // Duplicates, so a device seen before a reconnect, or first seen without its scan response, is seen again.
        noble.startScanningAsync([], true).catch((error: unknown) => {
          noble.removeListener('discover', discovered);
          signal.removeEventListener('abort', ended);
          reject(error instanceof Error ? error : new Error('volcano-collector: the scan did not start'));
        });
      });
    },
    async connect(lost) {
      if (peripheral === undefined) throw new Error('volcano-collector: nothing was found to connect to');
      characteristics = new Map();
      peripheral.once('disconnect', lost);
      await peripheral.connectAsync();
      const discovered = await peripheral.discoverSomeServicesAndCharacteristicsAsync(VOLCANO_SERVICES.map(nobleUuid), READABLE.map(nobleUuid));
      characteristics = new Map(discovered.characteristics.map(found => [found.uuid, found]));
    },
    async read(uuid: ReadUuid) {
      if (!READABLE.includes(uuid)) throw refused();
      return await characteristic(uuid).readAsync();
    },
    async subscribe(uuid: SubscribeUuid, listener) {
      if (!SUBSCRIBABLE.includes(uuid)) throw refused();
      const found = characteristic(uuid);
      found.on('data', data => { listener(data); });
      await found.subscribeAsync();
    },
    async disconnect() {
      const current = peripheral;
      peripheral = undefined;
      characteristics = new Map();
      await current?.disconnectAsync();
    },
  };
}

/** The transport on the installed binding, or undefined when `npm ci` has not been run in this package. */
export async function loadTransport(): Promise<VolcanoTransport | undefined> {
  // A computed name, so the root build, which does not install this binding, compiles without it.
  const binding: string = '@stoprocent/noble';
  try {
    const {default: noble} = await import(binding) as {default: Noble};
    return nobleTransport(noble);
  } catch {
    return undefined;
  }
}
