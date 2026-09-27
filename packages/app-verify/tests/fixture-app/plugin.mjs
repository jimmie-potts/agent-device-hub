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
 * Whether two input maps hold the same names and values, in any order.
 * @param {Readonly<Record<string, string>> | null | undefined} a @param {Readonly<Record<string, string>> | null | undefined} b
 */
export function sameInputs(a, b) {
  const text = (/** @type {Readonly<Record<string, string>> | null | undefined} */ value) => JSON.stringify(Object.entries(value ?? {}).sort(([x], [y]) => (x < y ? -1 : 1)));
  return a != null && b != null && text(a) === text(b);
}

/**
 * The fixture's plug-in. Without `inputs` it is a 1.0-style plug-in: it declares no inputs and reads no 1.1 context field
 * unless a scenario announces an extra endpoint.
 * @param {{root: string, app: string, playwright?: string[], pidFile?: string, markerDir?: string, commandLog?: string, artifact?: import('@jimmie-potts/app-verify').BuildSource['artifact'], bindPort?: number, reservedPorts?: number[], secret?: string, failureCause?: 'match' | 'throw' | 'raw' | 'bidi', envOverride?: Record<string, string>, inputs?: import('@jimmie-potts/app-verify').AppPlugin['inputs'], announcePort?: number, announce?: {url?: string, endpoints?: unknown}, leakyDoctor?: boolean}} options
 */
export function createPlugin({root, app, playwright = defaultPlaywright(), pidFile, markerDir, commandLog, artifact = {route: '/app.js'}, bindPort, reservedPorts, secret = 'not-set', failureCause = 'match', envOverride, inputs, announcePort, announce, leakyDoctor}) {
  /** With `leakyDoctor`, a `leak` file in the run's data directory makes the probe and a read-only check fail naming private paths. */
  const leaking = async (/** @type {string} */ dataDir) => leakyDoctor === true && existsSync(join(dataDir, 'leak'));
  /** @param {Record<string, unknown>} value */
  const scenario = value => ({
    /** @param {import('@jimmie-potts/app-verify').SeedContext} context */
    seed: async ({dataDir, scenario: name, inputs: given}) => {
      await writeFile(join(dataDir, 'scenario.json'), JSON.stringify({name, pidFile, commandLog, ...value, ...(inputs ? {inputs: given} : {})}));
    },
  });
  /** @param {import('@jimmie-potts/app-verify').CaptureContext} t */
  const inputsShown = async t => {
    await t.page.goto(t.url);
    await t.expect('the application was seeded and launched with the run inputs', async () => {
      const seen = await (await fetch(new URL('/inputs', t.url), {signal: t.signal})).json();
      if (!sameInputs(seen.seeded, t.inputs) || !sameInputs(seen.launched, t.inputs)) throw new Error(`the app saw ${JSON.stringify(seen)}, the step has ${JSON.stringify(t.inputs)}`);
    });
  };
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
      'noisy-crash': {description: 'Exits 2 after printing a cause line and a secret-looking line on stderr', ...scenario({behavior: 'noisy-crash', secret})},
      'fixed-port': {description: 'Binds the port the test chose instead of 0', ...scenario({behavior: 'reference', start: 0, bindPort})},
      'check-fails': {description: 'Ready, but its boundary check fails', ...scenario({behavior: 'reference', start: 0, failCheck: true})},
      endpoint: {description: 'Counter plus a controller listener announced as an extra endpoint', ...scenario({behavior: 'reference', start: 0, endpoint: 'bind'})},
      'endpoint-moves': {description: 'Controller endpoint that ignores its recorded port on relaunch', ...scenario({behavior: 'reference', start: 0, endpoint: 'moves'})},
      'endpoint-announce': {description: 'Announces the test\'s chosen endpoint port without binding it', ...scenario({behavior: 'reference', start: 0, endpoint: 'announce', announcePort})},
      'announce-raw': {description: 'Announces the test\'s chosen URL ({port} is the bound port) and endpoints, verbatim', ...scenario({behavior: 'reference', start: 0, endpoint: 'raw', announce})},
      // Only with a declared `feed` input: the plug-in check refuses a scenario that requires an undeclared input.
      ...(inputs?.feed || inputs?.label ? {paired: {description: 'Counter at 0 paired with a peer feed', requiredInputs: ['feed'], ...scenario({behavior: 'reference', start: 0})}} : {}),
      'seed-leaks': {
        description: 'Seeding fails like a child process whose error names private absolute paths',
        seed: ({dataDir}) => {
          throw new Error(`Command failed: /opt/private-tool/bin/seed --data ${dataDir} --config /home/someone/.config/private.json (see "/srv/private/log")`);
        },
      },
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
    ...(inputs ? {inputs} : {}),
    launch: ({node, dataDir, port, inputs: given, endpointPorts}) => ({
      argv: [
        node, server, '--data', dataDir, '--port', String(port),
        ...(inputs ? ['--inputs', JSON.stringify(given)] : []),
        ...(endpointPorts?.controller ? ['--endpoint-port', String(endpointPorts.controller)] : []),
      ],
      ...(envOverride ? {env: envOverride} : {}),
    }),
    readiness: {
      line: line => {
        try {
          const value = JSON.parse(line);
          return value?.ready === true && typeof value.url === 'string' ? {url: value.url, ...(value.endpoints ? {endpoints: value.endpoints} : {})} : undefined;
        } catch {
          return undefined;
        }
      },
      probe: async ({url, signal, dataDir}) => {
        if (await leaking(dataDir)) return {ok: false, reason: 'Command failed: /opt/private-probe/bin/health --config /home/someone/.config/probe.json'};
        const response = await fetch(new URL('/health', url), {signal});
        return response.ok ? {ok: true} : {ok: false, reason: `health answered ${response.status}`};
      },
      timeoutMs: 4000,
      // Match only the stable cause line; the modes let tests prove a throw or a raw tail never leaks.
      failureCause: tail => {
        if (failureCause === 'throw') throw new Error(tail);
        if (failureCause === 'raw') return tail;
        if (failureCause === 'bidi') return 'fixture-start-failed: port\u202ein-use';
        return /^fixture-start-failed: [a-z-]+$/m.exec(tail)?.[0];
      },
    },
    ...(reservedPorts ? {reservedPorts} : {}),
    components: [
      {id: 'counter', kind: 'actual'},
      {id: 'command-sink', kind: 'simulated', note: 'the fixture records commands instead of reaching a device'},
    ],
    checks: [
      {
        id: 'seeded-scenario',
        // Read-only, so doctor re-runs it.
        doctor: true,
        run: async ({url, scenario: name, dataDir, signal}) => {
          const health = await json(new URL('/health', url).href, signal);
          const {failCheck} = JSON.parse(await (await import('node:fs/promises')).readFile(join(dataDir, 'scenario.json'), 'utf8'));
          if (failCheck) return {outcome: 'failed', reason: 'fixture boundary check refused'};
          return health.scenario === name ? {outcome: 'passed'} : {outcome: 'failed', reason: `health reports ${health.scenario}`};
        },
      },
      ...(leakyDoctor ? [{
        id: 'leaky-check',
        doctor: true,
        /** @param {import('@jimmie-potts/app-verify').ProbeContext} context */
        run: async ({dataDir}) => {
          if (await leaking(dataDir)) throw new Error('Command failed: /opt/private-check/bin/check /home/someone/secret');
          return {outcome: /** @type {const} */ ('passed')};
        },
      }] : []),
      ...(inputs ? [{
        id: 'inputs-seen',
        doctor: true,
        /** @param {import('@jimmie-potts/app-verify').ProbeContext} context */
        run: async ({url, inputs: given, signal}) => {
          const seen = await json(new URL('/inputs', url).href, signal);
          return sameInputs(seen.seeded, given) && sameInputs(seen.launched, given) ? {outcome: /** @type {const} */ ('passed')} : {outcome: /** @type {const} */ ('failed'), reason: `the app saw ${JSON.stringify(seen)}`};
        },
      }] : []),
    ],
    browser: {modules: playwright},
    captureSteps: {
      'count-twice': {
        description: 'Two clicks advance the counter by two',
        run: async t => clicks(t, 2, 2),
      },
      'inputs-shown': {
        description: 'The step and the application see the same run inputs',
        run: inputsShown,
      },
      'fresh-inputs': {
        description: 'After a fresh reseed, the application still runs with the run inputs',
        fresh: true,
        run: inputsShown,
      },
      'rebuild-during-step': {
        description: 'Rewrites the file artifact under root while the step runs, as a rebuild in the same checkout would',
        run: async t => {
          await t.page.goto(t.url);
          await writeFile(join(t.root, 'bundle.js'), 'rebuilt during the step\n');
          await t.expect('the counter is shown', () => t.page.getByRole('status').isVisible());
        },
      },
      ...(inputs?.feed ? {'fresh-paired': {
        description: 'A fresh step pinned to the paired scenario',
        scenario: 'paired',
        fresh: true,
        run: inputsShown,
      }} : {}),
      'leaky-assertion': {
        description: 'Fails with an assertion error and a note that name a private path',
        run: async t => {
          await t.page.goto(t.url);
          t.note('reading /srv/private/fixture.json');
          await t.expect('the private fixture is readable', () => {
            throw new Error('ENOENT: no such file or directory, open `/srv/private/fixture.json`');
          });
        },
      },
      'controller-answers': {
        description: 'The controller endpoint the ready line announced answers',
        run: async t => {
          await t.page.goto(t.url);
          await t.expect('the controller endpoint answers for this scenario', async () => {
            const answer = await (await fetch(t.endpoints.controller, {signal: t.signal})).json();
            if (answer.controller !== true || answer.scenario !== t.scenario) throw new Error(`the controller answered ${JSON.stringify(answer)}`);
          });
        },
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
      'attach-proof': {
        description: 'One click, then attach the observed state and a label',
        run: async t => {
          await clicks(t, 1, 1);
          await t.screenshot('clicked');
          await t.attach('observed.json', JSON.stringify({text: await t.page.getByRole('status').textContent()}));
          await t.attach('label.txt', 'fixture rendering, not device evidence\n');
        },
      },
      'attach-bad-name': {
        description: 'Attaching outside the capture directory fails the step',
        run: async t => {
          await clicks(t, 1, 1);
          await t.attach('../escape.txt', 'no');
        },
      },
      'control-returns-false': {
        description: 'Negative control: a predicate that answers false must fail',
        run: async t => {
          await t.page.goto(t.url);
          await t.expect('the counter shows 999', async () => (await t.page.getByRole('status').textContent()) === 'Count: 999');
        },
      },
      'control-not-visible': {
        description: 'Negative control: isVisible() of text that is not there must fail',
        run: async t => {
          await t.page.goto(t.url);
          await t.expect('a missing heading is visible', () => t.page.getByText('No such text anywhere').isVisible());
        },
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
