/** Isolated Windows-native owner. Imported binding errors and standard streams never enter the SDK. */
import type {Characteristic, Noble, Peripheral} from '@stoprocent/noble';
import {UUID} from './transport.js';
let noble: Noble | undefined, peripheral: Peripheral | undefined;
const characteristics = new Map<string, Characteristic>();
let opened = false;
const send = (data: object): void => {if (process.connected) process.send?.(data, () => {});};
const MAC = /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i;
const address = (value: string): string => value.replace(/[:-]/g, '').toLowerCase();
let tail = Promise.resolve();
process.on('message', (message: unknown) => {
  if (typeof message !== 'object' || message === null) return;
  const input = message as {id?: unknown; method?: unknown; targetAddress?: unknown; adapterAddress?: unknown; uuid?: unknown; bytes?: unknown};
  if (!Number.isSafeInteger(input.id) || typeof input.id !== 'number' || input.id < 0) return;
  const id = input.id;
  tail = tail.then(async () => {
    switch (input.method) {
      case 'open': {
        if (opened || process.platform !== 'win32' || typeof input.targetAddress !== 'string' || !MAC.test(input.targetAddress) || typeof input.adapterAddress !== 'string' || !MAC.test(input.adapterAddress)) throw new Error('native enrollment refused');
        opened = true;
        // The only runtime import of the native library: after explicit connect and parent writer ownership.
        const loaded = await import('@stoprocent/noble'); noble = loaded.default;
        noble.removeAllListeners('warning');
        const adapterAddress = new Promise<string>(resolve => {
          if (noble?.address !== undefined && noble.address !== 'unknown') resolve(noble.address);
          else noble?.once('addressChange', (value: unknown) => {if (typeof value === 'string') resolve(value);});
        });
        await noble.waitForPoweredOnAsync(10_000);
        const actual = await adapterAddress;
        if (address(actual) !== address(input.adapterAddress)) throw new Error('native adapter mismatch');
        peripheral = await noble.connectAsync(input.targetAddress);
        if (address(peripheral.address) !== address(input.targetAddress)) throw new Error('native target mismatch');
        peripheral.on('disconnect', () => {send({lost: true});});
        const found = await peripheral.discoverAllServicesAndCharacteristicsAsync();
        for (const item of found.characteristics) {
          if (characteristics.has(item.uuid)) throw new Error('ambiguous characteristic'); characteristics.set(item.uuid, item);
        }
        send({id, ok: true, characteristics: [...characteristics].map(([uuid, item]) => [uuid, item.properties])}); return;
      }
      case 'subscribe': {
        if (input.uuid !== UUID.response) throw new Error('native subscription refused');
        const item = characteristics.get(UUID.response); if (item === undefined) throw new Error('native characteristic absent');
        item.on('data', (bytes: Buffer, notification: boolean) => {if (notification) send(bytes.length > 1024 ? {lost: true} : {notification: [...bytes]});});
        await item.subscribeAsync(); send({id, ok: true}); return;
      }
      case 'write': {
        if (typeof input.uuid !== 'string' || ![UUID.command, UUID.unlock, UUID.txPower, UUID.wake].some(uuid => uuid === input.uuid) || !Array.isArray(input.bytes) || input.bytes.length > 20 || !input.bytes.every((b: unknown) => Number.isInteger(b) && Number(b) >= 0 && Number(b) <= 255)) throw new Error('native write refused');
        const item = characteristics.get(input.uuid); if (item === undefined || !item.properties.includes('write')) throw new Error('native characteristic refused');
        await item.writeAsync(Buffer.from(input.bytes as number[]), false); send({id, ok: true}); return;
      }
      default: throw new Error('native method refused');
    }
  }).catch(() => {send({id, ok: false});});
});
process.on('disconnect', () => {void peripheral?.disconnectAsync().catch(() => {}); noble?.stop();});
