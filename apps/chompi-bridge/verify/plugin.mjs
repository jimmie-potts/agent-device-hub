// The CHOMPI bridge adapter's plug-in for @jimmie-potts/app-verify (Hub #853). A run serves server.mjs: the real
// bridge CLI (`run --simulate --desktop sim`) with the simulated controller and desktop, a synthetic Hub feed and
// the control page, all on one loopback listener. The README beside this file lists the steps and scenarios.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { definePlugin } from '@jimmie-potts/app-verify';
import { SCENARIOS } from '../dist/sim/scenarios.js';
import { checkNoDesktopCalls, checkNoHid, checkOwnFeedOnly } from './boundaries.mjs';
import { RUN_SCENARIOS, seedRun } from './seed.mjs';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const bridge = join(root, 'apps/chompi-bridge');
const serve = fileURLToPath(new URL('serve.mjs', import.meta.url));
const version = JSON.parse(await readFile(join(bridge, 'package.json'), 'utf8')).version;
const CATALOG = SCENARIOS.map(s => s.id);

/** The boundary negative controls: each crosses a boundary, so its start fails a check by design. Start-only. */
export const START_ONLY = Object.freeze(Object.keys(RUN_SCENARIOS).filter(name => RUN_SCENARIOS[name]?.fault));

/**
 * Refuses, before the core acts, an operation that would reseed a running run into a boundary negative control:
 * `scenario <run-id> <control>` and `handoff <run-id> --reset <control>`. The reseed would fail its boundary check and
 * stop the whole run. Start one with `start --scenario <control>` instead.
 *
 * The arguments are read as the core's parser reads them (packages/app-verify/src/cli.ts, which does not export it):
 * a `--flag` anywhere takes the next argument as its value, and the rest are positionals in order. So
 * `handoff --reset <control> <run-id>` and `scenario --input <i>=<v> <run-id> <control>` are refused too. It errs
 * toward refusing: every `--reset` value and every positional after the run ID count, although the core keeps only
 * the last `--reset` and rejects extra positionals as a usage error.
 * @param {readonly string[]} argv
 * @returns {{operation: string, error: string, detail: string} | undefined}
 */
export function startOnlyRefusal(argv) {
  const [operation = 'help', ...rest] = argv;
  if (operation !== 'scenario' && operation !== 'handoff') return undefined;
  /** @type {string[]} */
  const positional = [];
  /** @type {string[]} */
  const resets = [];
  for (let index = 0; index < rest.length; index++) {
    const argument = rest[index] ?? '';
    if (!argument.startsWith('--')) { positional.push(argument); continue; }
    const value = rest[index + 1];
    if (value === undefined || value.startsWith('--')) continue;
    index++;
    if (argument === '--reset') resets.push(value);
  }
  const candidates = operation === 'scenario' ? positional.slice(1) : resets;
  const target = candidates.find(name => START_ONLY.includes(name));
  if (!target) return undefined;
  return {
    operation, error: 'start-only-scenario',
    detail: `${target} is a boundary negative control: its start fails a boundary check by design, so reseeding a running run into it would stop the run. Start it on its own with npm run -s verify:chompi -- start --scenario ${target}.`,
  };
}

/** The served candidate: every built bridge module and the page, hashed as `sha256sum <files> | sha256sum` prints. */
export function artifactFiles(at = root) {
  const dist = join(at, 'apps/chompi-bridge/dist');
  const built = existsSync(dist) ? readdirSync(dist, { recursive: true }).map(String).filter(file => file.endsWith('.js')).sort().map(file => `apps/chompi-bridge/dist/${file}`) : [];
  return [...built, ...['server.mjs', 'serve.mjs', 'guard.mjs', 'page/index.html', 'page/page.css', 'page/page.js'].map(file => `apps/chompi-bridge/verify/${file}`)];
}

export const BUILD_SOURCES = [':(glob)apps/chompi-bridge/src/**', ':(glob)packages/app-verify/src/**'];
export const BUILD_OUTPUTS = ['apps/chompi-bridge/dist/cli.js', 'apps/chompi-bridge/dist/sim/desktop.js', 'apps/chompi-bridge/dist/sim/scenarios.js', 'packages/app-verify/dist/index.js'];

/** The newest tracked source must be older than the oldest build output the run serves. */
export async function buildCurrent(at = root) {
  const sources = execFileSync('git', ['-C', at, 'ls-files', '-z', '--', ...BUILD_SOURCES], { encoding: 'utf8' }).split('\0').filter(Boolean);
  if (sources.length === 0) return { outcome: /** @type {const} */ ('failed'), reason: 'no build sources matched; the check cannot vouch for the build' };
  let newest = 0, newestFile = '';
  for (const file of sources) {
    const time = (await stat(join(at, file)).catch(() => undefined))?.mtimeMs;
    if (time === undefined) return { outcome: /** @type {const} */ ('failed'), reason: `${file} is missing or unreadable; restore the source and run npm run build` };
    if (time > newest) [newest, newestFile] = [time, file];
  }
  let oldest = Infinity;
  for (const file of BUILD_OUTPUTS) {
    const time = (await stat(join(at, file)).catch(() => undefined))?.mtimeMs;
    if (time === undefined) return { outcome: /** @type {const} */ ('failed'), reason: `${file} is missing; run npm run build` };
    oldest = Math.min(oldest, time);
  }
  return newest <= oldest ? { outcome: /** @type {const} */ ('passed') } : { outcome: /** @type {const} */ ('failed'), reason: `${newestFile} is newer than the build; run npm run build` };
}

/** @param {{url: string, signal?: AbortSignal}} t @param {string} path */
async function harness(t, path) {
  const response = await fetch(new URL(path, t.url), { signal: t.signal });
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  return response.json();
}

/** @param {{url: string, signal?: AbortSignal}} t @param {(report: any, url: string) => {outcome: 'passed'} | {outcome: 'failed', reason: string}} check */
async function boundaryCheck(t, check) {
  return check(await harness(t, '/api/harness/boundaries'), t.url);
}

/** Open the page and wait until the simulated controller is connected to the bridge. @param {any} t */
async function open(t) {
  await t.page.goto(t.url);
  await t.expect('the page loads the run state', () => t.page.locator('body[data-ready="true"]').waitFor());
  await t.expect('the simulated controller is connected to the bridge', () => t.page.locator('#run-controller').filter({ hasText: 'connected to the bridge' }).waitFor({ timeout: 15000 }));
}

/** @param {any} t @param {string} title */
async function slotOf(t, title) {
  const cell = t.page.locator('#sessions tr').filter({ has: t.page.getByRole('rowheader', { name: new RegExp(`^${title}`) }) }).locator('td').first();
  await cell.filter({ hasText: /^Slot \d+$/ }).waitFor({ timeout: 10000 });
  return Number((await cell.textContent()).replace('Slot ', ''));
}

/** @param {any} t */
async function boundariesHold(t) {
  await t.expect('the run stayed inside its boundaries: simulator transport, simulated desktop, its own feed', async () => {
    const report = await harness(t, '/api/harness/boundaries');
    for (const check of [checkNoHid(report), checkNoDesktopCalls(report), checkOwnFeedOnly(report, t.url)]) if (check.outcome !== 'passed') throw new Error(check.reason);
  });
}

/** One capture step per catalog scenario: run it from the page and wait for its verdict. */
const scenarioSteps = Object.fromEntries(CATALOG.map(id => [`scenario-${id}`, {
  description: `Runs the catalog scenario ${id} from the control page on a freshly seeded run`,
  scenario: id,
  fresh: true,
  timeoutMs: 90000,
  viewport: { width: 1440, height: 1100 },
  run: async (/** @type {any} */ t) => {
    await open(t);
    const run = t.page.getByRole('button', { name: 'Run scenario', exact: true });
    await t.expect('Run scenario is enabled once the run is ready', () => run.and(t.page.locator(':enabled')).waitFor({ timeout: 20000 }));
    await run.click();
    const outcome = t.page.locator('#scenario-outcome');
    await outcome.filter({ hasText: /: (passed|failed)/ }).waitFor({ timeout: 60000 });
    const state = await harness(t, '/api/harness/state');
    await t.attach('scenario-result.json', JSON.stringify({ synthetic: true, physical: false, ...state.scenario }, null, 2));
    await t.expect(`the scenario ${id} passed every step`, async () => {
      const text = await outcome.textContent();
      if (text !== `${id}: passed`) throw new Error(`${text}; ${JSON.stringify(state.scenario?.steps.at(-1))}`);
    });
    await t.page.locator('#scenario-heading').scrollIntoViewIfNeeded();
    await boundariesHold(t);
  },
}]));

export default definePlugin({
  app: 'chompi',
  servesProof: true,
  repository: 'jimmie-potts/agent-device-hub',
  command: 'npm run -s verify:chompi --',
  root,
  defaultScenario: 'desk-basic',
  scenarios: Object.fromEntries(Object.entries(RUN_SCENARIOS).map(([name, { description }]) => [name, {
    description,
    /** @param {{dataDir: string}} context */
    seed: ({ dataDir }) => seedRun(dataDir, name),
  }])),
  build: { version, artifact: { files: artifactFiles() } },
  prerequisites: {
    inspect: async () => {
      const build = await buildCurrent();
      return [{ id: 'app-build', phase: 'launch', status: build.outcome === 'passed' ? 'present' : 'missing', reason: build.outcome === 'passed' ? 'build-current' : 'build-missing-or-stale', ...(build.outcome === 'passed' ? {} : { next: 'Run npm run build from the checkout.' }) }];
    },
  },
  launch: async ({ node, dataDir, port, proofDir, runId }) => {
    await writeFile(join(dataDir, 'proof.json'), JSON.stringify({ proofDir, runId }), { mode: 0o600 });
    return { argv: [node, serve, '--data', dataDir, '--port', String(port)] };
  },
  readiness: {
    line: line => {
      try {
        const value = JSON.parse(line);
        return value?.ready === true && typeof value.url === 'string' ? { url: value.url } : undefined;
      } catch {
        return undefined;
      }
    },
    probe: async ({ url, signal }) => {
      const response = await fetch(new URL('/api/harness/health', url), { signal });
      if (!response.ok) return { ok: false, reason: `health answered ${response.status}` };
      return { ok: true };
    },
    timeoutMs: 30000,
    failureCause: tail => /^chompi-start-failed(?:: [a-z0-9-]+)?$/m.exec(tail)?.[0],
  },
  components: [
    { id: 'chompi-bridge', kind: 'actual', note: 'the bridge CLI from this checkout: run --simulate --desktop sim, with its routing core, slot store, lights, profile watcher and feed client' },
    { id: 'control-page', kind: 'actual', note: 'the run\'s loopback control page (apps/chompi-bridge/verify/page), a test tool' },
    { id: 'controller', kind: 'simulated', note: 'ChompiSimulator speaking HID protocol v1 to the bridge; the page injects input through it' },
    { id: 'desktop', kind: 'simulated', note: 'SimulatedDesktop behind OS adapter interface version 3: Codex, Claude and another app with composers, cards and a key log' },
    { id: 'hub-feed', kind: 'simulated', note: 'SyntheticHub serving the sessions snapshot 1.3 and change stream with a run-generated token' },
  ],
  checks: [
    { id: 'build-current', doctor: true, run: () => buildCurrent() },
    { id: 'no-hid-device', doctor: true, run: t => boundaryCheck(t, checkNoHid) },
    { id: 'no-desktop-calls', doctor: true, run: t => boundaryCheck(t, checkNoDesktopCalls) },
    { id: 'own-feed-only', doctor: true, run: t => boundaryCheck(t, checkOwnFeedOnly) },
  ],
  captureSteps: {
    'controls-page': {
      description: 'The control page shows every controller control with its light, the desktop and the Hub, and passes the accessibility check',
      scenario: 'desk-basic',
      fresh: true,
      viewport: { width: 1440, height: 1100 },
      run: async t => {
        await open(t);
        const buttons = t.page.getByRole('button');
        await t.expect('15 slot keys, 10 black keys, Record, Play and Loop are buttons', async () => {
          for (let n = 1; n <= 15; n++) await t.page.getByRole('button', { name: new RegExp(`^Slot ${n}, light `) }).waitFor();
          for (let n = 1; n <= 10; n++) await t.page.getByRole('button', { name: new RegExp(`^Black key ${n}, light `) }).waitFor();
          for (const name of ['Record (CHOMPI key)', 'Play', 'Loop']) await t.page.getByRole('button', { name: new RegExp(`^${name.replace(/[()]/g, '\\$&')}, light `) }).waitFor();
        });
        await t.expect('knobs 1-4, the big wheel and volume turn both ways and click', async () => {
          for (const name of ['Knob 1', 'Knob 2', 'Knob 3', 'Knob 4', 'Big wheel', 'Volume']) {
            for (const action of ['turn left', 'turn right', 'click']) await buttons.and(t.page.getByLabel(`${name} ${action}`, { exact: true })).waitFor();
          }
        });
        await t.expect('both seeded tasks hold lit slot keys', async () => {
          const codex = await slotOf(t, 'Synthetic Codex task 1');
          const claude = await slotOf(t, 'Synthetic Claude task 2');
          for (const slot of [codex, claude]) await t.page.getByRole('button', { name: new RegExp(`^Slot ${slot}, light idle$`) }).waitFor();
        });
        await t.expect('the page has no WCAG 2.1 A or AA violations', async () => {
          const { AxeBuilder } = await import('@axe-core/playwright');
          // Legacy mode runs axe in this page only; otherwise axe opens a blank page whose video would sit beside interaction.webm.
          const result = await new AxeBuilder({ page: t.page }).setLegacyMode(true).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
          if (result.violations.length) throw new Error(JSON.stringify(result.violations.map((/** @type {any} */ v) => ({ id: v.id, nodes: v.nodes.length }))));
        });
        await boundariesHold(t);
      },
    },
    'focus-and-send': {
      description: 'From the keyboard, a slot key brings Codex to the front on its task; typed text goes out with one Play press',
      scenario: 'desk-basic',
      fresh: true,
      viewport: { width: 1440, height: 1100 },
      run: async t => {
        await open(t);
        const slot = await slotOf(t, 'Synthetic Codex task 1');
        await t.page.getByRole('button', { name: new RegExp(`^Slot ${slot}, light `) }).focus();
        await t.page.keyboard.press('Space');
        const codex = t.page.locator('article[data-window="codex"]');
        await t.expect('Codex comes to the front on the task with its composer focused', async () => {
          await codex.locator('.badge').filter({ hasText: 'In front' }).waitFor();
          await codex.locator('dd').filter({ hasText: /^Synthetic Codex task 1$/ }).waitFor();
          await codex.locator('dd').filter({ hasText: /^focused$/ }).waitFor();
        });
        await t.page.getByLabel('Type into Codex').fill('synthetic draft');
        await codex.getByRole('button', { name: 'Type', exact: true }).click();
        await t.expect('the draft is in the Codex composer', () => codex.locator('dd.composer-text').filter({ hasText: /^synthetic draft$/ }).waitFor());
        await t.page.getByRole('button', { name: /^Play, light / }).click();
        await t.expect('one Enter submitted the draft', () => codex.locator('dd').filter({ hasText: /^"synthetic draft" \(1 submitted\)$/ }).waitFor());
        await t.expect('the bridge logged `sent` for Codex', () => t.page.locator('#bridge-log li').filter({ hasText: '"type":"sent","client":"codex"' }).waitFor());
        await t.expect('the desktop key log shows the Enter in Codex', () => t.page.locator('#desktop-log li').filter({ hasText: 'Enter submitted "synthetic draft" in Codex' }).waitFor());
        await boundariesHold(t);
      },
    },
    ...scenarioSteps,
    'control-attention-light': {
      description: 'Negative control, not a catalog scenario: expects attention on a slot key while no task needs attention, so it must fail',
      scenario: 'desk-basic',
      run: async t => {
        await open(t);
        await t.expect('slot 1 shows attention', () => t.page.getByRole('button', { name: /^Slot 1, light attention/ }).waitFor({ timeout: 3000 }));
      },
    },
  },
});
