// The executed caller example: the plug-in the core's own tests run against real
// transient user units. `createPlugin` takes the checkout root and a unique app
// name so parallel test files never see each other's runs.
import {existsSync} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {definePlugin} from '@jimmie-potts/app-verify';

const server = fileURLToPath(new URL('server.mjs', import.meta.url));
const require = createRequire(import.meta.url);
/** The consumer's Playwright, resolved from this package's location. */
function defaultPlaywright() {
  try {
    return [require.resolve('playwright')];
  } catch {
    return ['playwright', '@playwright/test'];
  }
}

/** @param {number} ms */
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/** @param {import('@jimmie-potts/app-verify').CaptureContext} t */
async function commands(t) {
  return (await (await fetch(new URL('/api/commands', t.url), {signal: t.signal})).json()).length;
}

/**
 * Click Add `count` times and assert the settled counter advanced by `by`.
 * Waiting for every response to be applied keeps a transient value from satisfying the expectation.
 * @param {import('@jimmie-potts/app-verify').CaptureContext} t @param {number} count @param {number} by
 */
async function clicks(t, count, by) {
  await t.page.goto(t.url);
  const status = t.page.getByRole('status');
  const start = Number((await status.textContent()).replace('Count: ', ''));
  for (let i = 0; i < count; i++) await t.page.getByRole('button', {name: 'Add one'}).click();
  await t.page.locator(`#count[data-applied="${count}"]`).waitFor();
  await t.expect(`the counter advanced by ${by}`, async () => {
    const shown = await status.textContent();
    if (shown !== `Count: ${start + by}`) throw new Error(`expected Count: ${start + by}, saw ${shown}`);
  });
}

/**
 * @param {{root: string, app: string, playwright?: string[], pidFile?: string, markerDir?: string, commandLog?: string, artifact?: import('@jimmie-potts/app-verify').BuildSource['artifact']}} options
 */
export function createPlugin({root, app, playwright = defaultPlaywright(), pidFile, markerDir, commandLog, artifact = {route: '/app.js'}}) {
  /** @param {Record<string, unknown>} value */
  const scenario = value => ({
    /** @param {{dataDir: string, scenario: string}} context */
    seed: async ({dataDir, scenario: name}) => {
      await writeFile(join(dataDir, 'scenario.json'), JSON.stringify({name, pidFile, commandLog, ...value}));
    },
  });
  /** @param {string} url @param {AbortSignal} [signal] */
  const json = async (url, signal) => (await fetch(url, {signal})).json();
  return definePlugin({
    app,
    repository: 'jimmie-potts/agent-device-hub',
    command: 'node verify.mjs',
    root,
    defaultScenario: 'reference',
    scenarios: {
      reference: {description: 'Counter at 0 that adds one per click', ...scenario({behavior: 'reference', start: 0})},
      second: {description: 'Counter at 10', ...scenario({behavior: 'reference', start: 10})},
      broken: {description: 'Known-incorrect counter that adds two per click', ...scenario({behavior: 'broken', start: 0})},
      'never-ready': {description: 'Listens but never prints its ready line', ...scenario({behavior: 'never-ready'})},
      crash: {description: 'Starts a setsid helper and exits 3', ...scenario({behavior: 'crash'})},
      'check-fails': {description: 'Ready, but its boundary check fails', ...scenario({behavior: 'reference', start: 0, failCheck: true})},
      'seed-fails': {
        description: 'Seeding throws',
        seed: () => {
          throw new Error('fixture seed refused');
        },
      },
      'slow-seed': {
        description: 'Seeds, then waits for the test to kill the start',
        seed: async ({dataDir, runId}) => {
          await writeFile(join(dataDir, 'scenario.json'), JSON.stringify({name: 'slow-seed', behavior: 'reference', start: 0}));
          if (markerDir) {
            await mkdir(markerDir, {recursive: true});
            await writeFile(join(markerDir, `${runId}.seeded`), '');
          }
          for (let waited = 0; waited < 60000 && !(markerDir && existsSync(join(markerDir, 'release'))); waited += 100) await pause(100);
        },
      },
    },
    build: {version: '1.0.0-fixture', artifact},
    launch: ({node, dataDir, port}) => ({argv: [node, server, '--data', dataDir, '--port', String(port)]}),
    readiness: {
      line: line => {
        try {
          const value = JSON.parse(line);
          return value?.ready === true && typeof value.url === 'string' ? {url: value.url} : undefined;
        } catch {
          return undefined;
        }
      },
      probe: async ({url, signal}) => {
        const response = await fetch(new URL('/health', url), {signal});
        return response.ok ? {ok: true} : {ok: false, reason: `health answered ${response.status}`};
      },
      timeoutMs: 4000,
    },
    components: [
      {id: 'counter', kind: 'actual'},
      {id: 'command-sink', kind: 'simulated', note: 'the fixture records commands instead of reaching a device'},
    ],
    checks: [
      {
        id: 'seeded-scenario',
        run: async ({url, scenario: name, dataDir, signal}) => {
          const health = await json(new URL('/health', url).href, signal);
          const {failCheck} = JSON.parse(await (await import('node:fs/promises')).readFile(join(dataDir, 'scenario.json'), 'utf8'));
          if (failCheck) return {outcome: 'failed', reason: 'fixture boundary check refused'};
          return health.scenario === name ? {outcome: 'passed'} : {outcome: 'failed', reason: `health reports ${health.scenario}`};
        },
      },
    ],
    browser: {modules: playwright},
    captureSteps: {
      'count-twice': {
        description: 'Two clicks advance the counter by two',
        run: async t => clicks(t, 2, 2),
      },
      'fresh-count': {
        description: 'From a fresh reference seed, two clicks show exactly Count: 2',
        scenario: 'reference',
        fresh: true,
        run: async t => {
          await clicks(t, 2, 2);
          await t.expect('the fresh counter shows exactly 2', async () => {
            const shown = await t.page.getByRole('status').textContent();
            if (shown !== 'Count: 2') throw new Error(`expected Count: 2, saw ${shown}`);
          });
        },
      },
      'control-wrong-expectation': {
        description: 'Negative control: expects three after two clicks and must fail',
        run: async t => clicks(t, 2, 3),
      },
      'no-assertions': {
        description: 'Clicks without asserting anything',
        run: async t => {
          await t.page.goto(t.url);
          await t.page.getByRole('button', {name: 'Add one'}).click();
        },
      },
      'read-only': {
        description: 'Loading and reading the page sends no command',
        run: async t => {
          const before = await commands(t);
          await t.page.goto(t.url);
          await t.expect('the counter is shown', () => t.page.getByRole('status').waitFor());
          await t.page.reload();
          await t.expect('no command reached the sink', async () => {
            const after = await commands(t);
            if (after !== before) throw new Error(`expected no new command, saw ${after - before}`);
          });
        },
      },
      'command-once': {
        description: 'One click sends exactly one command',
        run: async t => {
          const before = await commands(t);
          await clicks(t, 1, 1);
          await t.expect('exactly one command reached the sink', async () => {
            const after = await commands(t);
            if (after !== before + 1) throw new Error(`expected 1 new command, saw ${after - before}`);
          });
        },
      },
      slow: {
        description: 'Clicks, asserts, then waits long enough to be interrupted',
        timeoutMs: 120000,
        run: async t => {
          await clicks(t, 1, 1);
          t.note('waiting to be interrupted');
          await pause(60000);
        },
      },
    },
  });
}
