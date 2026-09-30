// The Hub adapter's plug-in for @jimmie-potts/app-verify (Hub #494). It runs the
// real hub and B.U.N.N.Y. dashboard (apps/hub/verify/serve.mjs) with the fake
// loopback controllers of apps/dashboard/tests/fixture.mjs and synthetic
// lifecycle events. The feature map in apps/hub/verify/README.md names each
// step's UI entry, driver action, scenario and expected observation.
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile, stat, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {definePlugin} from '@jimmie-potts/app-verify';
import {INPUTS, INSTALLED_PORTS, REQUIRED, launchIntegrated, pause, seedIntegrated} from './integrated.mjs';
import {integratedSteps} from './integrated-steps.mjs';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const serve = fileURLToPath(new URL('serve.mjs', import.meta.url));
const version = JSON.parse(await readFile(join(root, 'apps/hub/package.json'), 'utf8')).version;
const SIGNED_IN = 'Control enabled · Local';

/** @param {string} dataDir */
const apiToken = async dataDir => (await readFile(join(dataDir, 'api-token'), 'utf8')).trim();

/**
 * The run's fake-controller control listener.
 * @param {{dataDir: string, signal?: AbortSignal}} t @param {string} path @param {unknown} [body]
 */
async function control(t, path, body) {
  const {port} = JSON.parse(await readFile(join(t.dataDir, 'control.json'), 'utf8'));
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {authorization: `Bearer ${await apiToken(t.dataDir)}`, ...(body === undefined ? {} : {'content-type': 'application/json'})},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    signal: t.signal,
  });
  if (!response.ok) throw new Error(`control ${path} answered ${response.status}`);
  return response.json();
}

/** Commands the fakes parsed so far, with their content. @param {{dataDir: string, signal?: AbortSignal}} t */
const writes = async t => /** @type {{id: string, integration: boolean, command: any}[]} */ (await control(t, '/writes'));

/**
 * Every command-shaped request any fake received, counted before an offline or
 * uncertain answer, so a command sent to an unavailable device is still seen.
 * @param {{dataDir: string, signal?: AbortSignal}} t
 */
const commands = async t => /** @type {{id: string, method: string, url: string}[]} */ (await control(t, '/commands'));

/**
 * The command count once it has held still for a second, so a late or
 * debounced command is counted before a "no command" or "exactly one" check.
 * @param {{dataDir: string, signal?: AbortSignal}} t
 */
async function settledCommands(t) {
  let seen = (await commands(t)).length, still = 0;
  for (let waited = 0; waited < 10000 && still < 4; waited += 250) {
    await pause(250);
    const now = (await commands(t)).length;
    still = now === seen ? still + 1 : 0;
    seen = now;
  }
  return seen;
}

/**
 * The reference assertion that exactly one Pixoo brightness command with this
 * value reached the fakes, and nothing else.
 * @param {any} t @param {number} percent
 */
async function exactlyOneBrightness(t, percent) {
  await t.expect(`the fake received exactly one brightness.set of ${percent}`, async () => {
    await until(() => writes(t), list => list.length >= 1, 'no command reached the fake');
    const count = await settledCommands(t);
    if (count !== 1) throw new Error(`expected 1 command, saw ${count}`);
    const [write] = await writes(t);
    if (write.id !== 'pixel' || write.integration || JSON.stringify(write.command.command) !== JSON.stringify({kind: 'brightness.set', percent})) throw new Error(`unexpected command ${JSON.stringify(write)}`);
  });
}

/** @param {any} t @param {string} name @param {number} expected */
async function commandCount(t, name, expected) {
  await t.expect(name, async () => {
    const count = await settledCommands(t);
    if (count !== expected) throw new Error(`expected ${expected} command${expected === 1 ? '' : 's'}, saw ${count}`);
  });
}

/**
 * Wait until `check` holds, polling the fake. Throws with the last observation.
 * @template T @param {() => Promise<T>} read @param {(value: T) => boolean} check @param {string} what
 */
async function until(read, check, what, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!check(value)) {
    if (Date.now() > deadline) throw new Error(`${what}; last saw ${JSON.stringify(value)}`);
    await pause(100);
    value = await read();
  }
  return value;
}

/** Open the preview as the owner does: the plain loopback URL, signed in by trusted-loopback. @param {any} t */
async function open(t) {
  await t.page.goto(t.url);
  await t.expect('the page signs in on load without a token', () => t.page.getByText(SIGNED_IN, {exact: true}).waitFor());
}

/**
 * Loopback links on the current page that target an installed service's port, including the dashboard's Places
 * navigation: a run's Hub configures its own Local places (Hub #495), so none may lead to an installed service.
 * @param {any} t
 */
async function installedLinks(t) {
  /** @type {string[]} */
  const links = await t.page.locator('a[href]').evaluateAll((/** @type {HTMLAnchorElement[]} */ all) => all.map(a => a.href));
  return links.filter(href => {
    try {
      const url = new URL(href);
      return ['127.0.0.1', 'localhost'].includes(url.hostname) && INSTALLED_PORTS.includes(Number(url.port));
    } catch {
      return false;
    }
  });
}

/** @param {any} t */
async function openPixel(t) {
  await t.page.getByRole('link', {name: 'pixel pixoo', exact: true}).click();
  const brightness = t.page.getByLabel('Brightness (%)').filter({visible: true});
  await brightness.waitFor();
  return brightness;
}

/** @param {any} t */
const brightnessStatus = t => t.page.locator('form.edit').filter({visible: true}).filter({has: t.page.getByRole('heading', {name: 'Brightness', exact: true})}).locator(':scope>[role=status]');

/** @param {any} t */
async function formReady(t) {
  await t.page.waitForFunction(() => {
    const input = Array.from(document.querySelectorAll('input[type=range]')).find(el => /** @type {HTMLElement} */ (el).offsetParent);
    return input && !(/** @type {HTMLInputElement} */ (input).disabled);
  });
}

/** Scenario seed: the scenario definition plus run-generated credentials, 0600 in the run's private data directory. */
const scenario = (/** @type {Record<string, unknown>} */ definition, /** @type {string} */ description) => ({
  description,
  /** @param {{dataDir: string, scenario: string}} context */
  seed: async ({dataDir, scenario: name}) => {
    await writeFile(join(dataDir, 'scenario.json'), JSON.stringify({name, ...definition}), {mode: 0o600});
    await writeFile(join(dataDir, 'api-token'), randomBytes(32).toString('base64url'), {mode: 0o600});
    await writeFile(join(dataDir, 'reader-token'), randomBytes(32).toString('base64url'), {mode: 0o600});
  },
});

/**
 * What the run serves and what it is built from. Sources are Git pathspecs: the
 * hub and dashboard sources, the packages the hub imports, and the dashboard
 * bundle's other inputs (its Places manifest and build script). The build
 * check's test proves every esbuild input of the dashboard is covered.
 */
export const BUILD_SOURCES = [
  ':(glob)apps/hub/src/**',
  ':(glob)apps/dashboard/src/**',
  ...['agent-state', 'contracts', 'lifecycle-contracts', 'mcp', 'app-verify'].map(name => `:(glob)packages/${name}/src/**`),
  'docs/skins/places.json',
  'scripts/build-dashboard.mjs',
];
export const BUILD_OUTPUTS = ['packages/app-verify/dist/proof.js', 'apps/hub/dist/cli-runner.js', 'apps/hub/dist/server.js', 'apps/hub/public/dashboard.js', 'packages/agent-state/dist/index.js', 'packages/contracts/dist/index.js', 'packages/lifecycle-contracts/dist/index.js', 'packages/mcp/dist/index.js'];

/**
 * The newest tracked source must be older than the oldest build output the run
 * serves; otherwise the served candidate is not the checkout's revision.
 * @param {string} [at] checkout root
 */
export async function buildCurrent(at = root) {
  const sources = execFileSync('git', ['-C', at, 'ls-files', '-z', '--', ...BUILD_SOURCES], {encoding: 'utf8'}).split('\0').filter(Boolean);
  if (sources.length === 0) return {outcome: /** @type {const} */ ('failed'), reason: 'no build sources matched; the check cannot vouch for the build'};
  let newest = 0, newestFile = '';
  for (const file of sources) {
    const time = (await stat(join(at, file)).catch(() => undefined))?.mtimeMs;
    if (time === undefined) return {outcome: /** @type {const} */ ('failed'), reason: `${file} is missing or unreadable; restore the source and run npm run build`};
    if (time > newest) [newest, newestFile] = [time, file];
  }
  let oldest = Infinity;
  for (const file of BUILD_OUTPUTS) {
    const time = (await stat(join(at, file)).catch(() => undefined))?.mtimeMs;
    if (time === undefined) return {outcome: /** @type {const} */ ('failed'), reason: `${file} is missing; run npm run build`};
    oldest = Math.min(oldest, time);
  }
  return newest <= oldest ? {outcome: /** @type {const} */ ('passed')} : {outcome: /** @type {const} */ ('failed'), reason: `${newestFile} is newer than the build; run npm run build`};
}

/** @param {string} [at] checkout root
 * @returns {Promise<import('@jimmie-potts/app-verify').PrerequisiteCheck[]>}
 */
export async function inspectBuildPrerequisite(at = root) {
  const build = await buildCurrent(at);
  return [{id: 'app-build', phase: 'launch', status: build.outcome === 'passed' ? 'present' : 'missing',
    reason: build.outcome === 'passed' ? 'build-current' : 'build-missing-or-stale',
    ...(build.outcome === 'passed' ? {} : {next: 'Run npm run build from the checkout.'})}];
}

export default definePlugin({
  app: 'hub',
  servesProof: true,
  repository: 'jimmie-potts/agent-device-hub',
  command: 'npm run -s verify --',
  root,
  defaultScenario: 'lifecycle-basic',
  scenarios: {
    'lifecycle-basic': scenario({}, 'One labelled Codex session and two healthy fake controllers (Nanoleaf wall, Pixoo pixel)'),
    'pixel-offline': scenario({offline: 'pixel'}, 'As lifecycle-basic, with the Pixoo fake unavailable until a step restores it'),
    'control-startup-fails': scenario({browserAccess: 'invalid'}, 'Negative control: an invalid browserAccess makes the hub refuse to start'),
    'control-installed-links': scenario({editorLinks: {wall: 'http://127.0.0.1:8765/wall'}, placeLinks: {wall: 'http://127.0.0.1:8765/'}}, 'Negative control: a wall editor link and a Places link to the installed wall port'),
    integrated: {
      description: 'The real hub CLI owning agent state, with the paired wall and Pixoo runs as its controllers and feed consumers (compose.mjs writes the pairing credentials first)',
      requiredInputs: REQUIRED,
      seed: seedIntegrated,
    },
  },
  inputs: INPUTS,
  build: {version, artifact: {route: '/dashboard.js'}},
  prerequisites: {inspect: () => inspectBuildPrerequisite()},
  launch: async ({node, dataDir, port, scenario: name, proofDir, runId}) => {
    await writeFile(join(dataDir, 'proof.json'), JSON.stringify({proofDir, runId}), {mode: 0o600});
    return name === 'integrated' ? launchIntegrated({node, dataDir, port}) : {argv: [node, serve, '--data', dataDir, '--port', String(port)]};
  },
  readiness: {
    line: line => {
      try {
        const value = JSON.parse(line);
        return value?.ready === true && typeof value.url === 'string' ? {url: value.url} : undefined;
      } catch {
        return undefined;
      }
    },
    probe: async ({url, dataDir, signal}) => {
      const response = await fetch(new URL('/api/hub/v1/health', url), {headers: {authorization: `Bearer ${await apiToken(dataDir)}`}, signal});
      if (!response.ok) return {ok: false, reason: `health answered ${response.status}`};
      const health = await response.json();
      return health.collector === 'running' ? {ok: true} : {ok: false, reason: `collector ${health.collector}`};
    },
    timeoutMs: 30000,
    // serve.mjs, like the hub CLI, prints one stable cause line and never a path or value.
    failureCause: tail => /^hub-start-failed: [A-Za-z0-9-]+$/m.exec(tail)?.[0],
  },
  components: [
    {id: 'hub', kind: 'actual'},
    {id: 'dashboard', kind: 'actual', note: 'B.U.N.N.Y. bundle served by the hub'},
    {id: 'browser-session', kind: 'actual', note: 'trusted-loopback sign-in; no token in the URL'},
    {id: 'command-replay', kind: 'actual'},
    {id: 'wall-controller', kind: 'simulated', note: 'fake loopback Nanoleaf controller from apps/dashboard/tests/fixture.mjs; in integrated, the paired wall run\'s real controller API, whose light transport that run refuses'},
    {id: 'pixel-controller', kind: 'simulated', note: 'fake loopback Pixoo controller from apps/dashboard/tests/fixture.mjs; in integrated, the paired Pixoo run\'s real controller API on its simulator transport'},
    {id: 'lifecycle-events', kind: 'simulated', note: 'synthetic Codex session events posted with a run-generated credential through the hub\'s own ingest route'},
  ],
  checks: [
    {id: 'build-current', doctor: true, run: () => buildCurrent()},
    {
      id: 'no-installed-ports',
      doctor: true,
      run: async t => {
        // integrated: the real hub CLI is the unit's only listener, and its paired targets are other runs' ports.
        if (t.scenario === 'integrated') {
          const clash = [t.port, ...REQUIRED.map(name => Number(new URL(t.inputs[name]).port))].filter(port => INSTALLED_PORTS.includes(port));
          return clash.length ? {outcome: 'failed', reason: `uses or targets installed port ${clash.join(', ')}`} : {outcome: 'passed'};
        }
        const ports = await control(t, '/ports');
        const used = [ports.hub, ports.control, ...ports.controllers.map((/** @type {{port: number}} */ c) => c.port), ...(ports.relays ?? [])];
        const clash = used.filter(port => INSTALLED_PORTS.includes(port));
        return clash.length ? {outcome: 'failed', reason: `uses installed port ${clash.join(', ')}`} : {outcome: 'passed'};
      },
    },
  ],
  captureSteps: {
    ...integratedSteps,
    'task-appears': {
      description: 'The seeded session shows on the home page, a new question appears on it, and reading sends no command',
      scenario: 'lifecycle-basic',
      fresh: true,
      run: async t => {
        await open(t);
        await t.expect('the seeded session card is shown', () => t.page.getByRole('heading', {name: 'Build the integration', exact: true}).waitFor());
        await control(t, '/event', {kind: 'question.continuing'});
        await t.expect('the question appears on the session', () => t.page.getByText('Question · continuing', {exact: true}).waitFor());
        const reachable = [...await installedLinks(t)];
        await t.page.getByRole('link', {name: 'wall nanoleaf', exact: true}).click();
        await t.page.getByLabel('Device mode').first().waitFor();
        reachable.push(...await installedLinks(t));
        await openPixel(t);
        reachable.push(...await installedLinks(t));
        await t.expect('no run link leads to an installed service port', () => {
          if (reachable.length) throw new Error(`links to installed ports: ${reachable.join(', ')}`);
        });
        await commandCount(t, 'read-only browsing sent no controller command', 0);
      },
    },
    'command-reaches-fake': {
      description: 'Setting Pixoo brightness to 30% sends exactly one brightness command to the fake controller',
      scenario: 'lifecycle-basic',
      fresh: true,
      run: async t => {
        await open(t);
        const brightness = await openPixel(t);
        await commandCount(t, 'opening the device sent no command', 0);
        await brightness.fill('30');
        await brightnessStatus(t).filter({hasText: /^(Queued\. The device hasn’t received it yet\.|Sent to the device\.)/}).waitFor();
        await formReady(t);
        await exactlyOneBrightness(t, 30);
        await t.expect('the page shows the refreshed value', async () => {
          if ((await brightness.inputValue()) !== '30') throw new Error(`slider shows ${await brightness.inputValue()}`);
        });
      },
    },
    'uncertain-no-replay': {
      description: 'An uncertain brightness result locks the form, is never retried, and an explicit reload sends nothing',
      scenario: 'lifecycle-basic',
      fresh: true,
      timeoutMs: 45000,
      run: async t => {
        await open(t);
        const brightness = await openPixel(t);
        await control(t, '/uncertain', {on: true});
        await brightness.fill('25');
        await t.expect('the result is shown as uncertain', () => brightnessStatus(t).filter({hasText: 'Result unknown: this may have reached the device (uncertain-result)'}).waitFor());
        await t.expect('the form stays locked', async () => {
          if (!(await brightness.isDisabled())) throw new Error('the slider is enabled after an uncertain result');
        });
        await pause(5500);
        await commandCount(t, 'the uncertain command reached the fake once and was not retried', 1);
        await control(t, '/uncertain', {on: false});
        await t.page.locator('form.edit').filter({visible: true}).getByRole('button', {name: 'Reload current values', exact: true}).click();
        await formReady(t);
        await t.expect('reload shows the controller value; the lost command never applied', async () => {
          if ((await brightness.inputValue()) !== '60') throw new Error(`slider shows ${await brightness.inputValue()}`);
        });
        await commandCount(t, 'recovery replayed nothing', 1);
      },
    },
    'offline-recovers': {
      description: 'An unavailable Pixoo shows Stale / unavailable, recovers when the fake returns, and nothing is sent',
      scenario: 'pixel-offline',
      fresh: true,
      timeoutMs: 45000,
      run: async t => {
        await open(t);
        await t.page.getByRole('link', {name: 'pixel pixoo', exact: true}).click();
        const stale = t.page.locator('section:visible').getByText('Stale / unavailable', {exact: true});
        await t.expect('the unavailable device is labelled', () => stale.waitFor());
        await t.screenshot('unavailable');
        await control(t, '/offline', {on: false});
        await t.expect('the device recovers without a reload', () => stale.waitFor({state: 'detached', timeout: 20000}));
        await t.page.getByLabel('Brightness (%)').filter({visible: true}).waitFor();
        await commandCount(t, 'recovery sent no command', 0);
      },
    },
    'control-installed-links': {
      description: 'Negative control: the installed-port link check must catch an editor link to the installed wall',
      scenario: 'control-installed-links',
      fresh: true,
      run: async t => {
        await open(t);
        await t.page.getByRole('link', {name: 'wall nanoleaf', exact: true}).click();
        await t.page.getByLabel('Device mode').first().waitFor();
        const reachable = await installedLinks(t);
        await t.expect('no run link leads to an installed service port', () => {
          if (reachable.length) throw new Error(`links to installed ports: ${reachable.join(', ')}`);
        });
      },
    },
    'control-missing-session': {
      description: 'Negative control: expects a session that was never seeded and must fail',
      scenario: 'lifecycle-basic',
      run: async t => {
        await open(t);
        await t.expect('an unseeded session is shown', () => t.page.getByRole('heading', {name: 'A session that was never seeded', exact: true}).waitFor({timeout: 3000}));
      },
    },
  },
});
