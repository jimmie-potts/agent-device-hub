import { createChompiBridge, type BridgeEvent } from './bridge.js';
import { ManualClock } from './clock.js';
import { acquireInstanceLock, defaultLockPath, InstanceLockHeldError, type InstanceLock } from './lock.js';
import { matchesController } from './matcher.js';
import { createNodeHidTransport } from './node-hid-transport.js';
import { LED_COUNT, type Rgb } from './protocol.js';
import { ChompiSimulator } from './simulator.js';
import type { Transport } from './transport.js';

export interface CliDeps {
  stdout: { write(text: string): unknown };
  stderr: { write(text: string): unknown };
  env: Record<string, string | undefined>;
  createHidTransport: () => Transport;
  /** Ends `run`; without it, SIGINT or SIGTERM does. */
  signal?: AbortSignal;
}

export const USAGE = `usage: chompi-bridge probe
       chompi-bridge monitor --simulate
       chompi-bridge run [--simulate] [--test-pattern] [--serial <serial>]
`;

type Command =
  | { command: 'probe' }
  | { command: 'monitor' }
  | { command: 'run'; simulate: boolean; testPattern: boolean; serial: string | undefined };

function parse(argv: readonly string[]): Command | undefined {
  const [command, ...rest] = argv;
  if (command === 'probe') return rest.length === 0 ? { command } : undefined;
  if (command === 'monitor') return rest.length === 1 && rest[0] === '--simulate' ? { command } : undefined;
  if (command !== 'run') return undefined;
  const seen = new Set<string>();
  let serial: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i]!;
    if (seen.has(flag) || !['--simulate', '--test-pattern', '--serial'].includes(flag)) return undefined;
    seen.add(flag);
    if (flag === '--serial') {
      serial = rest[++i];
      if (!serial || !/^[0-9A-Fa-f]{1,64}$/.test(serial)) return undefined;
    }
  }
  return { command, simulate: seen.has('--simulate'), testPattern: seen.has('--test-pattern'), serial };
}

const hex = (value: number | undefined, digits: number) => value === undefined ? null : value.toString(16).padStart(digits, '0');
const line = (event: BridgeEvent) => `${JSON.stringify(event)}\n`;
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };

/** Read-only enumeration. Prints matching controllers without serial or path, and only a count of other devices. */
async function probe(deps: CliDeps): Promise<number> {
  let devices;
  try {
    devices = await deps.createHidTransport().list();
  } catch (error) {
    deps.stderr.write(`chompi-bridge-probe-failed: ${(error as Error).message}\n`);
    return 1;
  }
  const matches = devices.filter(device => matchesController(device));
  deps.stdout.write(`${JSON.stringify({
    matches: matches.map(device => ({ vendorId: hex(device.vendorId, 4), productId: hex(device.productId, 4), product: device.product, usagePage: hex(device.usagePage, 4), usage: hex(device.usage, 2) })),
    otherHidDevices: devices.length - matches.length,
  }, null, 2)}\n`);
  return 0;
}

/** A scripted session against the simulator in virtual time, printed as JSON lines. */
async function monitorSimulated(deps: CliDeps): Promise<number> {
  const clock = new ManualClock();
  const simulator = new ChompiSimulator({ clock });
  const bridge = createChompiBridge({ transport: simulator.transport, clock });
  const events = bridge.events({ limit: 1024 });
  const print = () => { for (const event of events.drain()) deps.stdout.write(line(event)); };
  const run = async (ms: number) => { for (let elapsed = 0; elapsed < ms; elapsed += 10) { clock.advance(10); await settle(); } print(); };
  simulator.plug();
  bridge.start();
  await run(3000);
  simulator.click(1);
  simulator.turn(41, 1);
  simulator.turn(41, 2);
  simulator.click(33);
  simulator.press(26);
  await run(100);
  simulator.unplug();
  await run(100);
  simulator.plug();
  await run(4000);
  simulator.press(15);
  await run(100);
  await bridge.stop();
  print();
  simulator.unplug();
  return 0;
}

/** A static, dim hue gradient across all 35 LEDs. */
export function testPattern(): Rgb[] {
  return Array.from({ length: LED_COUNT }, (_, i) => {
    const hue = (i / LED_COUNT) * 6;
    const x = Math.round(64 * (1 - Math.abs((hue % 2) - 1)));
    const sector = Math.floor(hue);
    const rgb: Rgb[] = [[64, x, 0], [x, 64, 0], [0, 64, x], [0, x, 64], [x, 0, 64], [64, 0, x]];
    return rgb[sector]!;
  });
}

function stopRequested(signal: AbortSignal | undefined): Promise<void> {
  if (signal) return signal.aborted ? Promise.resolve() : new Promise(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
  return new Promise(resolve => {
    const done = () => { process.off('SIGINT', done); process.off('SIGTERM', done); resolve(); };
    process.once('SIGINT', done);
    process.once('SIGTERM', done);
  });
}

/** Takes the single-instance lock first; only then creates a transport and opens the controller. */
async function run(command: Extract<Command, { command: 'run' }>, deps: CliDeps): Promise<number> {
  let lock: InstanceLock;
  try {
    lock = await acquireInstanceLock(defaultLockPath({ env: deps.env }));
  } catch (error) {
    deps.stderr.write(error instanceof InstanceLockHeldError ? 'chompi-bridge-already-running\n' : `chompi-bridge-lock-failed: ${(error as Error).message}\n`);
    return error instanceof InstanceLockHeldError ? 3 : 1;
  }
  const stop = stopRequested(deps.signal);
  try {
    const simulator = command.simulate ? new ChompiSimulator() : undefined;
    simulator?.plug();
    const transport = simulator?.transport ?? deps.createHidTransport();
    const bridge = createChompiBridge({ transport, ...(command.serial ? { serialNumber: command.serial } : {}) });
    const events = bridge.events({ limit: 1024 });
    const pump = (async () => { for await (const event of events) deps.stdout.write(line(event)); })();
    if (command.testPattern) bridge.setLeds(testPattern());
    bridge.start();
    await stop;
    await bridge.stop();
    await pump;
    simulator?.unplug();
    if (events.closedReason === 'overflow') deps.stderr.write('chompi-bridge-output-overflow\n');
    return events.closedReason === 'overflow' ? 1 : 0;
  } finally {
    await lock.release();
  }
}

export async function main(argv: readonly string[], overrides: Partial<CliDeps> = {}): Promise<number> {
  const deps: CliDeps = {
    stdout: process.stdout, stderr: process.stderr, env: process.env, createHidTransport: () => createNodeHidTransport(), ...overrides,
  };
  const command = parse(argv);
  if (!command) {
    deps.stderr.write(USAGE);
    return 2;
  }
  if (command.command === 'probe') return probe(deps);
  if (command.command === 'monitor') return monitorSimulated(deps);
  return run(command, deps);
}
