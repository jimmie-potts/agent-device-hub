import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { main, type SimulationParts } from '../cli.js';
import { ManualClock } from '../clock.js';
import { DEFAULT_PROFILE_PATH } from '../routing/profile.js';
import type { ChompiSimulator } from '../simulator.js';
import type { SimulatedDesktop } from './desktop.js';
import { SyntheticHub } from './hub.js';
import { ready, seedDesktop, seedHub, type BridgeLogLine, type Harness, type RunSeed } from './scenarios.js';

/**
 * Tier 1 of the scenario catalog (#853): the real bridge CLI, `run --simulate --desktop sim`, in this process on a
 * manual clock, with the synthetic Hub feed answering in memory. Nothing listens on a port, opens a device or reaches
 * a desktop. Profile, token and slot files live in a private temporary directory that `close` removes.
 */
export interface MemoryHarness extends Harness {
  /** Stops the bridge and removes the temporary directory; resolves to the CLI's exit code. */
  close(): Promise<number>;
  /** Everything the CLI printed, for diagnosing a failure. */
  output(): string;
}

/** Virtual time per wait step: small enough for the bridge's timers, large enough to keep runs fast. */
const STEP_MS = 50;
const realTick = () => new Promise(resolve => setTimeout(resolve, 1));
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };

export async function startMemoryHarness(seed: RunSeed): Promise<MemoryHarness> {
  const dir = await mkdtemp(join(tmpdir(), 'chompi-scenario-'));
  const paths = { profile: join(dir, 'profile.json'), token: join(dir, 'token'), state: join(dir, 'state') };
  const token = randomBytes(24).toString('base64url');
  let profile = JSON.parse(await readFile(DEFAULT_PROFILE_PATH, 'utf8')) as Record<string, any>;
  await writeFile(paths.profile, JSON.stringify(profile, null, 2));
  await writeFile(paths.token, `${token}\n`, { mode: 0o600 });

  const clock = new ManualClock(1_700_000_000_000);
  const hub = new SyntheticHub({ token, clock });
  seedHub(hub, seed);
  let parts: SimulationParts | undefined;
  const output: string[] = [];
  const logs: BridgeLogLine[] = [];
  const sink = {
    write(text: string) {
      output.push(text);
      for (const line of text.split('\n')) {
        if (!line.startsWith('{')) continue;
        try { logs.push(JSON.parse(line) as BridgeLogLine); } catch { /* not a log line */ }
      }
      return true;
    },
  };
  const controller = new AbortController();
  const running = main(['run', '--simulate', '--desktop', 'sim', '--profile', paths.profile, '--hub', 'http://127.0.0.1:9', '--token-file', paths.token, '--state', paths.state], {
    stdout: sink, stderr: sink, env: { XDG_RUNTIME_DIR: dir }, clock, fetch: hub.fetch, signal: controller.signal,
    process: Object.assign(new EventEmitter(), { exit(code: number) { output.push(`exit ${code}\n`); } }),
    createHidTransport: () => { throw new Error('a memory run never opens a HID device'); },
    onSimulation: value => {
      parts = value;
      if (value.desktop) seedDesktop(value.desktop, seed);
    },
  });

  const wait = async (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += STEP_MS) {
      clock.advance(Math.min(STEP_MS, ms - elapsed));
      await settle();
      await realTick();
    }
  };
  // The CLI loads the profile, token and slot files on the thread pool before it creates the simulated parts.
  for (let i = 0; i < 500 && !parts; i++) await realTick();
  let closed: Promise<number> | undefined;
  const close = () => closed ??= (async () => {
    controller.abort();
    const code = await running;
    hub.close();
    await rm(dir, { recursive: true, force: true });
    return code;
  })();
  if (!parts?.simulator || !parts.desktop) {
    await close();
    throw new Error(`the bridge did not start: ${output.join('').trim().split('\n').at(-1) ?? 'no output'}`);
  }
  const simulator: ChompiSimulator = parts.simulator;
  const desktop: SimulatedDesktop = parts.desktop;
  const harness: MemoryHarness = {
    tier: 'memory', simulator, desktop, hub,
    logs: () => logs,
    profile: () => profile,
    async writeProfile(edit) {
      profile = edit(structuredClone(profile));
      await writeFile(paths.profile, JSON.stringify(profile, null, 2));
    },
    wait,
    close,
    output: () => output.join(''),
  };
  const started = await ready(harness, seed);
  if (started !== true) {
    await close();
    throw new Error(`the run did not become ready: ${started}`);
  }
  return harness;
}
