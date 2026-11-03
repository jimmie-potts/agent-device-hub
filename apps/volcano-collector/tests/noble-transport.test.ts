// The noble adapter against a fake noble (#615 AC3): the fake fails the test on any write-shaped call, so the adapter's
// permitted operations are exactly scan, connect, discovery of the allowlist, read, subscribe and disconnect. No radio.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {READABLE, VOLCANO_REGISTERS, VOLCANO_SERIAL, VOLCANO_SERVICES, type ReadUuid, type SubscribeUuid} from '@jimmie-potts/runtime/volcano-collector';
import {loadTransport, nobleTransport, type Noble, type NobleCharacteristic, type NoblePeripheral} from '../src/noble-transport.js';

const never = new AbortController().signal;
const noDashes = (uuid: string): string => uuid.replaceAll('-', '');
const WRITE_SHAPED = /write|broadcast|notify$|unsubscribe|descriptor|handle/iu;

/** Records every call and fails on anything write-shaped, even one no type allows. */
function spied<T extends object>(target: T, calls: string[], name: string): T {
  return new Proxy(target, {get(object, property, receiver) {
    if (typeof property === 'string' && WRITE_SHAPED.test(property)) throw new Error(`the adapter touched ${name}.${property}`);
    const value: unknown = Reflect.get(object, property, receiver);
    if (typeof value !== 'function') return value;
    return (...args: unknown[]) => {
      calls.push(`${name}.${String(property)}`);
      return (value as (...args: unknown[]) => unknown).apply(object, args);
    };
  }});
}

function world(names: readonly string[] = ['Other device', 'S&B VOLCANO H'], connectFails = false, connecting: Promise<void> = Promise.resolve()) {
  const calls: string[] = [];
  const disconnectListeners = new Set<() => void>();
  const data = new Map<string, (bytes: Uint8Array) => void>();
  let lost: (() => void) | undefined;
  const discovery: {services?: readonly string[]; characteristics?: readonly string[]} = {};
  const characteristic = (uuid: string): NobleCharacteristic => spied<NobleCharacteristic>({
    uuid, readAsync: () => Promise.resolve(Uint8Array.of(1, 2)), subscribeAsync: () => Promise.resolve(), on: (_event, listener) => { data.set(uuid, listener); return undefined; },
  }, calls, `characteristic(${uuid.slice(0, 8)})`);
  const peripheralOf = (localName: string): NoblePeripheral => spied<NoblePeripheral>({
    advertisement: {localName}, once: (_event, listener) => { lost = listener; disconnectListeners.add(listener); return undefined; }, removeListener: (_event, listener) => { disconnectListeners.delete(listener); return undefined; },
    connectAsync: () => (connectFails ? Promise.reject(new Error('synthetic')) : connecting), disconnectAsync: () => Promise.resolve(),
    discoverSomeServicesAndCharacteristicsAsync: (services, characteristics) => {
      discovery.services = services;
      discovery.characteristics = characteristics;
      return Promise.resolve({characteristics: characteristics.map(characteristic)});
    },
  }, calls, 'peripheral');
  let listener: ((peripheral: NoblePeripheral) => void) | undefined;
  const noble: Noble = spied<Noble>({
    waitForPoweredOnAsync: () => Promise.resolve(),
    startScanningAsync: () => {
      queueMicrotask(() => { for (const name of names) listener?.(peripheralOf(name)); });
      return Promise.resolve();
    },
    stopScanningAsync: () => Promise.resolve(),
    on: (_event, given) => { listener = given; return undefined; },
    removeListener: () => { listener = undefined; return undefined; },
  }, calls, 'noble');
  return {noble, calls, data, discovery, disconnectListeners, lost: () => lost?.()};
}

void test('it connects to the exact advertised name and asks only for the allowlist', async () => {
  const {noble, calls, discovery} = world();
  const transport = nobleTransport(noble);
  assert.equal(await transport.scan('S&B VOLCANO H', never), true);
  await transport.connect(() => {}, never);
  assert.deepEqual(discovery.services, VOLCANO_SERVICES.map(noDashes));
  assert.deepEqual([...(discovery.characteristics ?? [])].sort(), READABLE.map(noDashes).sort());
  assert.ok(calls.includes('noble.stopScanningAsync'));
});

void test('a near-miss name is not the device, and a scan ends empty when its signal does', async () => {
  const {noble} = world(['S&B VOLCANO', 'VOLCANO H']);
  const controller = new AbortController();
  const scanning = nobleTransport(noble).scan('S&B VOLCANO H', controller.signal);
  await new Promise(resolve => { setImmediate(resolve); });
  controller.abort();
  assert.equal(await scanning, false);
});

void test('read and subscribe reach the allowlist only, and any other UUID is refused before the device', async () => {
  const {noble, calls, data} = world();
  const transport = nobleTransport(noble);
  await transport.scan('S&B VOLCANO H', never);
  await transport.connect(() => {}, never);
  assert.deepEqual([...await transport.read(VOLCANO_SERIAL, never)], [1, 2]);
  const heard: number[][] = [];
  await transport.subscribe(VOLCANO_REGISTERS.status1, bytes => { heard.push([...bytes]); }, never);
  data.get(noDashes(VOLCANO_REGISTERS.status1))?.(Uint8Array.of(0x23, 0x06));
  assert.deepEqual(heard, [[0x23, 0x06]]);
  const before = calls.length;
  // The setpoint, heater and pump characteristics sit beside these: not on the allowlist, whatever a caller asks.
  for (const other of ['10110003-5354-4f52-5a26-4249434b454d', '1011000f-5354-4f52-5a26-4249434b454c', '10110010-5354-4f52-5a26-4249434b454c']) {
    await assert.rejects(transport.read(other as ReadUuid, never));
    await assert.rejects(transport.subscribe(other as SubscribeUuid, () => {}, never));
  }
  await assert.rejects(transport.subscribe(VOLCANO_SERIAL as unknown as SubscribeUuid, () => {}, never), 'the serial is read and never subscribed to');
  assert.equal(calls.length, before, 'nothing reached the device');
});

void test('a lost link tells the collector, and disconnect forgets the device', async () => {
  const {noble, calls, lost} = world();
  const transport = nobleTransport(noble);
  await transport.scan('S&B VOLCANO H', never);
  let told = 0;
  await transport.connect(() => { told += 1; }, never);
  lost();
  assert.equal(told, 1);
  await transport.disconnect();
  assert.ok(calls.includes('peripheral.disconnectAsync'));
  await assert.rejects(transport.read(VOLCANO_REGISTERS.status1, never));
  await transport.disconnect();
});

void test('only a missing binding reads as missing: any other fault in loading it escapes', async () => {
  assert.equal(await loadTransport(() => Promise.reject(Object.assign(new Error('synthetic'), {code: 'ERR_MODULE_NOT_FOUND'}))), undefined);
  await assert.rejects(loadTransport(() => Promise.reject(new Error('synthetic native fault'))), /synthetic native fault/);
  const {noble} = world();
  assert.notEqual(await loadTransport(() => Promise.resolve({default: noble})), undefined);
});

void test('a failed connect leaves no disconnect listener behind', async () => {
  const {noble, disconnectListeners} = world(['S&B VOLCANO H'], true);
  const transport = nobleTransport(noble);
  await transport.scan('S&B VOLCANO H', never);
  await assert.rejects(transport.connect(() => {}, never));
  assert.equal(disconnectListeners.size, 0);
});

void test('a connect settling after its disconnect runs no discovery, keeps no characteristics and closes what it opened', async () => {
  let settle: () => void = () => {};
  const {noble, calls, discovery, disconnectListeners} = world(['S&B VOLCANO H'], false, new Promise<void>(resolve => { settle = resolve; }));
  const transport = nobleTransport(noble);
  await transport.scan('S&B VOLCANO H', never);
  const connecting = transport.connect(() => {}, never);
  await transport.disconnect();
  const closes = calls.filter(call => call === 'peripheral.disconnectAsync').length;
  settle();
  await assert.rejects(connecting, /after it was given up/);
  assert.equal(discovery.characteristics, undefined, 'no discovery ran');
  await assert.rejects(transport.read(VOLCANO_REGISTERS.status1, never), 'no characteristic was kept');
  assert.equal(disconnectListeners.size, 0);
  assert.equal(calls.filter(call => call === 'peripheral.disconnectAsync').length, closes + 1, 'the late link is closed');
});

void test('no call the adapter made through a whole session is write-shaped', async () => {
  const {noble, calls} = world();
  const transport = nobleTransport(noble);
  await transport.scan('S&B VOLCANO H', never);
  await transport.connect(() => {}, never);
  for (const uuid of READABLE) await transport.read(uuid as ReadUuid, never);
  for (const uuid of Object.values(VOLCANO_REGISTERS)) await transport.subscribe(uuid, () => {}, never);
  await transport.disconnect();
  assert.ok(calls.length > 0);
  assert.deepEqual(calls.filter(call => WRITE_SHAPED.test(call)), []);
  assert.deepEqual([...new Set(calls.map(call => call.replace(/\(.*\)/u, '')))].sort(), [
    'characteristic.on', 'characteristic.readAsync', 'characteristic.subscribeAsync', 'noble.on', 'noble.removeListener', 'noble.startScanningAsync', 'noble.stopScanningAsync', 'noble.waitForPoweredOnAsync',
    'peripheral.connectAsync', 'peripheral.disconnectAsync', 'peripheral.discoverSomeServicesAndCharacteristicsAsync', 'peripheral.once',
  ]);
});
