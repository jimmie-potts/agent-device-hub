import { encodeReport, decodeHostReport } from '../dist/protocol.js';
import { ManualClock } from '../dist/clock.js';
import { FakeTransport } from '../dist/fake-transport.js';
import { createChompiBridge } from '../dist/bridge.js';

/** A device descriptor that matches the controller identity in the protocol contract. */
export const CONTROLLER = Object.freeze({
  vendorId: 0x1209, productId: 0x000c, product: 'Agent Controller', manufacturer: 'agent-device-hub',
  serialNumber: '0123456789ABCDEF01234567', usagePage: 0xff00, usage: 0x01, path: 'fake-controller',
});
/** The stock CHOMPI presents MIDI under the generic ST ID; a HID interface with that ID must never match. */
export const STOCK_CHOMPI = Object.freeze({ vendorId: 0x0483, productId: 0x5740, product: 'CHOMPI', usagePage: 0xff00, usage: 0x01, path: 'fake-stock' });

/** Lets pending promise chains (transport writes, list/open) run to completion. */
export async function settle(rounds = 8) { for (let i = 0; i < rounds; i++) await new Promise(resolve => setImmediate(resolve)); }

export const hello = (epoch, overrides = {}) => encodeReport({ type: 'hello', version: 1, epoch, firmware: [0, 1, 0], controls: 34, encoders: 6, leds: 35, ...overrides });
export const input = (epoch, sequence, control, kind, delta = 0) => encodeReport({ type: 'input', version: 1, epoch, sequence, control, kind, delta });
export const heartbeat = (epoch, ledFrame = 0, hostAlive = true) => encodeReport({ type: 'heartbeat', version: 1, epoch, ledFrame, hostAlive });

/** Decodes everything the bridge wrote on one fake connection. */
export const sent = connection => connection.written.map(report => { const d = decodeHostReport(report); if (!d.ok) throw new Error(d.reason); return d.message; });

export const colors = (seed = 0) => Array.from({ length: 35 }, (_, i) => [(i + seed) % 256, (i * 2 + seed) % 256, (i * 3 + seed) % 256]);

/**
 * A started bridge over a fake transport and a manual clock. With `epoch`, the fake device answers the open with
 * that hello so the bridge is connected on return.
 */
export async function setup(t, { epoch = 0x1234, devices = [CONTROLLER], ...options } = {}) {
  const clock = new ManualClock();
  const transport = new FakeTransport(devices);
  const bridge = createChompiBridge({ transport, clock, ...options });
  const events = bridge.events();
  t.after(() => bridge.stop());
  bridge.start();
  await settle();
  if (epoch) {
    transport.connection.inject(hello(epoch));
    await settle();
  }
  return { clock, transport, bridge, events, connection: () => transport.connection };
}

/** Advances the manual clock in small steps, letting async work run between them. */
export async function advance(clock, ms, step = 50) {
  for (let elapsed = 0; elapsed < ms; elapsed += step) { clock.advance(Math.min(step, ms - elapsed)); await settle(2); }
}
