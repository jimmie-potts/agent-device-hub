import { join } from 'node:path';
import { createChompiBridge, type BridgeEvent } from './bridge.js';
import { ManualClock, systemClock, type Clock } from './clock.js';
import { acquireInstanceLock, defaultLockPath, InstanceLockHeldError, type InstanceLock } from './lock.js';
import { matchesController } from './matcher.js';
import { createNodeHidTransport } from './node-hid-transport.js';
import { LED_COUNT, type Rgb } from './protocol.js';
import { ChompiSimulator } from './simulator.js';
import type { Transport } from './transport.js';
import { OS_ADAPTER_VERSION, type OsAdapter } from './os-adapter.js';
import {
  FeedConfigError, ProfileError, ProfileWatcher, SlotStateError, SlotStore, TaskRouter, createHubFeed, loadOsAdapter, loadProfile,
  type FeedView, type HubFeed, type RoutingProfile,
} from './routing/index.js';

export interface CliDeps {
  stdout: { write(text: string): unknown };
  stderr: { write(text: string): unknown };
  env: Record<string, string | undefined>;
  createHidTransport: () => Transport;
  /** Ends `run`; without it, SIGINT or SIGTERM does. */
  signal?: AbortSignal;
  /** Time source for routing runs; tests pass a ManualClock. */
  clock?: Clock;
  /** HTTP client for the Hub feed; tests pass a fake Hub. */
  fetch?: typeof fetch;
  /** Creates the OS adapter; defaults to the platform adapter (Windows only). */
  createOsAdapter?: () => Promise<OsAdapter>;
}

export const USAGE = `usage: chompi-bridge probe
       chompi-bridge monitor --simulate
       chompi-bridge run [--simulate] [--test-pattern] [--serial <serial>]
       chompi-bridge run --profile <file> --hub <origin> --token-file <path> --state <dir> [--simulate] [--serial <serial>]
`;

type Command =
  | { command: 'probe' }
  | { command: 'monitor' }
  | { command: 'run'; simulate: boolean; testPattern: boolean; serial: string | undefined; routing: RoutingFlags | undefined };

/** `run` with task routing: all four are required together. */
interface RoutingFlags { profile: string; hub: string; tokenFile: string; state: string }
const VALUE_FLAGS: Record<string, keyof RoutingFlags | 'serial'> = {
  '--serial': 'serial', '--profile': 'profile', '--hub': 'hub', '--token-file': 'tokenFile', '--state': 'state',
};

function parse(argv: readonly string[]): Command | undefined {
  const [command, ...rest] = argv;
  if (command === 'probe') return rest.length === 0 ? { command } : undefined;
  if (command === 'monitor') return rest.length === 1 && rest[0] === '--simulate' ? { command } : undefined;
  if (command !== 'run') return undefined;
  const seen = new Set<string>();
  const values: Partial<Record<keyof RoutingFlags | 'serial', string>> = {};
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i]!;
    if (seen.has(flag) || !['--simulate', '--test-pattern', ...Object.keys(VALUE_FLAGS)].includes(flag)) return undefined;
    seen.add(flag);
    const name = VALUE_FLAGS[flag];
    if (name) {
      const value = rest[++i];
      if (!value || value.startsWith('--')) return undefined;
      values[name] = value;
    }
  }
  if (values.serial !== undefined && !/^[0-9A-Fa-f]{1,64}$/.test(values.serial)) return undefined;
  const routingNames = ['profile', 'hub', 'tokenFile', 'state'] as const;
  const given = routingNames.filter(name => values[name] !== undefined);
  if (given.length !== 0 && given.length !== routingNames.length) return undefined;
  const routing = given.length ? { profile: values.profile!, hub: values.hub!, tokenFile: values.tokenFile!, state: values.state! } : undefined;
  if (routing && seen.has('--test-pattern')) return undefined;
  return { command, simulate: seen.has('--simulate'), testPattern: seen.has('--test-pattern'), serial: values.serial, routing };
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
    if (command.routing) return await runRouting(command, command.routing, deps, stop);
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

/**
 * Task routing under the lock already held: load the profile, slot state and OS adapter (so a bad setup stops before
 * any device is opened), then wire bridge → feed → router and run until stopped. Prints router and link events as JSON
 * lines; never titles, text or the token.
 */
async function runRouting(command: Extract<Command, { command: 'run' }>, flags: RoutingFlags, deps: CliDeps, stop: Promise<void>): Promise<number> {
  const clock = deps.clock ?? systemClock;
  const print = (event: object) => deps.stdout.write(`${JSON.stringify({ at: clock.now(), ...event })}\n`);
  let profile: RoutingProfile;
  try {
    profile = await loadProfile(flags.profile);
  } catch (error) {
    deps.stderr.write(`chompi-bridge-profile-invalid: ${error instanceof ProfileError ? error.issues.join('; ') : (error as Error).message}\n`);
    return 1;
  }
  let feed: HubFeed;
  try {
    feed = createHubFeed({ origin: flags.hub, tokenFile: flags.tokenFile, clock, ...(deps.fetch ? { fetch: deps.fetch } : {}) });
  } catch (error) {
    deps.stderr.write(`chompi-bridge-hub-invalid: ${error instanceof FeedConfigError ? error.message : 'invalid origin'}\n`);
    return 1;
  }
  let slots: SlotStore;
  try {
    slots = await SlotStore.open(join(flags.state, 'slots.json'), { clock, onWriteError: error => print({ type: 'slot-state-write-failed', message: error.message }) });
  } catch (error) {
    deps.stderr.write(`chompi-bridge-state-invalid: ${error instanceof SlotStateError ? error.message : (error as Error).message}\n`);
    return 1;
  }
  let adapter: OsAdapter;
  try {
    adapter = await (deps.createOsAdapter ?? (() => loadOsAdapter()))();
    if (adapter.version !== OS_ADAPTER_VERSION) throw new Error(`adapter version ${String(adapter.version)} is not ${OS_ADAPTER_VERSION}`);
  } catch (error) {
    deps.stderr.write(`chompi-bridge-os-adapter-unavailable: ${(error as Error).message}\n`);
    return 1;
  }

  const simulator = command.simulate ? new ChompiSimulator({ clock }) : undefined;
  simulator?.plug();
  const transport = simulator?.transport ?? deps.createHidTransport();
  const bridge = createChompiBridge({
    transport, clock, profileVersion: profile.profileVersion, brightnessPercent: profile.brightnessPercent,
    ...(command.serial ? { serialNumber: command.serial } : {}),
  });
  const router = new TaskRouter({ adapter, lights: bridge, slots, profile, clock, log: print });
  let lastFeed = '';
  feed.subscribe((view: FeedView) => {
    router.handleFeed(view);
    const summary = JSON.stringify([view.status, view.reason, view.snapshotVersion]);
    if (summary !== lastFeed) {
      lastFeed = summary;
      print({ type: 'feed', status: view.status, reason: view.reason, snapshotVersion: view.snapshotVersion });
    }
  });
  const watcher = new ProfileWatcher({
    path: flags.profile, initial: profile, clock,
    onReload: next => router.setProfile(next),
    onReject: error => print({ type: 'profile-rejected', issues: error.issues }),
  });
  let stopping = false;
  // A subscription that overflows is closed with its queue discarded; treat it like a disconnect and subscribe again.
  const pump = (async () => {
    while (!stopping) {
      const events = bridge.events({ limit: 1024 });
      for await (const event of events) {
        if (event.type !== 'input') print(event);
        router.handleBridgeEvent(event);
      }
      if (events.closedReason !== 'overflow') break;
      print({ type: 'subscription-overflow' });
      router.invalidate('subscription-overflow');
    }
  })();
  router.start();
  feed.start();
  watcher.start();
  bridge.start();
  await stop;
  stopping = true;
  await watcher.stop();
  await feed.stop();
  await router.close();
  await bridge.stop();
  await pump;
  await adapter.close().catch(() => undefined);
  simulator?.unplug();
  return 0;
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
