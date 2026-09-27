// The Hub adapter's plug-in for @jimmie-potts/app-verify (Hub #494). It runs the
// real hub and B.U.N.N.Y. dashboard (apps/hub/verify/serve.mjs) with the fake
// loopback controllers of apps/dashboard/tests/fixture.mjs and synthetic
// lifecycle events. The feature map in apps/hub/README.md names each step's UI
// entry, driver action, scenario and expected observation.
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile, stat, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {definePlugin} from '@jimmie-potts/app-verify';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const serve = fileURLToPath(new URL('serve.mjs', import.meta.url));
const version = JSON.parse(await readFile(join(root, 'apps/hub/package.json'), 'utf8')).version;
/** The installed services' ports (docs/app-verification.md); a run never uses them. */
const INSTALLED_PORTS = [8788, 8765, 8787, 8791, 41230, 41231];
const SIGNED_IN = 'Control enabled · Local';
const pause = (/** @type {number} */ ms) => new Promise(resolve => setTimeout(resolve, ms));

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

/** Commands that reached the fake controllers so far. @param {{dataDir: string, signal?: AbortSignal}} t */
const writes = async t => /** @type {{id: string, integration: boolean, command: any}[]} */ (await control(t, '/writes'));

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
 * Loopback links on the current page that target an installed service's port, outside the dashboard's own
 * Places navigation (product links to the installed B.U.N.N.Y. and wall, docs/skins/places.json).
 * @param {any} t
 */
async function installedLinks(t) {
  /** @type {{href: string, places: boolean}[]} */
  const links = await t.page.locator('a[href]').evaluateAll((/** @type {HTMLAnchorElement[]} */ all) => all.map(a => ({href: a.href, places: !!a.closest('nav[aria-label="Places"]')})));
  return links.filter(link => {
    try {
      const url = new URL(link.href);
      return !link.places && ['127.0.0.1', 'localhost'].includes(url.hostname) && INSTALLED_PORTS.includes(Number(url.port));
    } catch {
      return false;
    }
  }).map(link => link.href);
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
 * The newest tracked source must be older than the oldest build output the run
 * serves; otherwise the served candidate is not the checkout's revision.
 */
async function buildCurrent() {
  const sources = execFileSync('git', ['-C', root, 'ls-files', '-z', 'apps/hub/src', 'apps/dashboard/src', 'packages/*/src'], {encoding: 'utf8'}).split('\0').filter(Boolean);
  let newest = 0, newestFile = '';
  for (const file of sources) {
    const time = (await stat(join(root, file)).catch(() => undefined))?.mtimeMs ?? 0;
    if (time > newest) [newest, newestFile] = [time, file];
  }
  const outputs = ['apps/hub/dist/server.js', 'apps/hub/public/dashboard.js', 'packages/agent-state/dist/index.js', 'packages/contracts/dist/index.js', 'packages/lifecycle-contracts/dist/index.js', 'packages/mcp/dist/index.js'];
  let oldest = Infinity;
  for (const file of outputs) {
    const time = (await stat(join(root, file)).catch(() => undefined))?.mtimeMs;
    if (time === undefined) return {outcome: /** @type {const} */ ('failed'), reason: `${file} is missing; run npm run build`};
    oldest = Math.min(oldest, time);
  }
  return newest <= oldest ? {outcome: /** @type {const} */ ('passed')} : {outcome: /** @type {const} */ ('failed'), reason: `${newestFile} is newer than the build; run npm run build`};
}

export default definePlugin({
  app: 'hub',
  repository: 'jimmie-potts/agent-device-hub',
  command: 'npm run -s verify --',
  root,
  defaultScenario: 'lifecycle-basic',
  scenarios: {
    'lifecycle-basic': scenario({}, 'One labelled Codex session and two healthy fake controllers (Nanoleaf wall, Pixoo pixel)'),
    'pixel-offline': scenario({offline: 'pixel'}, 'As lifecycle-basic, with the Pixoo fake unavailable until a step restores it'),
    'control-startup-fails': scenario({browserAccess: 'invalid'}, 'Negative control: an invalid browserAccess makes the hub refuse to start'),
    'control-installed-links': scenario({editorLinks: {wall: 'http://127.0.0.1:8765/wall'}}, 'Negative control: a wall editor link to the installed wall port'),
  },
  build: {version, artifact: {route: '/dashboard.js'}},
  launch: ({node, dataDir, port}) => ({argv: [node, serve, '--data', dataDir, '--port', String(port)]}),
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
    {id: 'wall-controller', kind: 'simulated', note: 'fake loopback Nanoleaf controller from apps/dashboard/tests/fixture.mjs'},
    {id: 'pixel-controller', kind: 'simulated', note: 'fake loopback Pixoo controller from apps/dashboard/tests/fixture.mjs'},
    {id: 'lifecycle-events', kind: 'simulated', note: 'synthetic Codex session events posted with a run-generated credential'},
  ],
  checks: [
    {id: 'build-current', doctor: true, run: buildCurrent},
    {
      id: 'no-installed-ports',
      doctor: true,
      run: async t => {
        const ports = await control(t, '/ports');
        const used = [ports.hub, ports.control, ...ports.controllers.map((/** @type {{port: number}} */ c) => c.port)];
        const clash = used.filter(port => INSTALLED_PORTS.includes(port));
        return clash.length ? {outcome: 'failed', reason: `uses installed port ${clash.join(', ')}`} : {outcome: 'passed'};
      },
    },
  ],
  captureSteps: {
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
        await t.expect('read-only browsing sent no controller command', async () => {
          const seen = await writes(t);
          if (seen.length !== 0) throw new Error(`expected no command, saw ${JSON.stringify(seen)}`);
        });
      },
    },
    'command-reaches-fake': {
      description: 'Setting Pixoo brightness to 30% sends exactly one brightness command to the fake controller',
      scenario: 'lifecycle-basic',
      fresh: true,
      run: async t => {
        await open(t);
        const brightness = await openPixel(t);
        await t.expect('opening the device sent no command', async () => {
          if ((await writes(t)).length !== 0) throw new Error('a command was sent before the change');
        });
        await brightness.fill('30');
        await brightnessStatus(t).filter({hasText: /^(Queued\. The device hasn’t received it yet\.|Sent to the device\.)/}).waitFor();
        await formReady(t);
        await t.expect('the fake received exactly one brightness.set of 30', async () => {
          const seen = await until(() => writes(t), list => list.length >= 1, 'no command reached the fake');
          await pause(500);
          const settled = await writes(t);
          if (settled.length !== 1) throw new Error(`expected 1 command, saw ${settled.length}`);
          const [write] = settled;
          if (write.id !== 'pixel' || write.integration || JSON.stringify(write.command.command) !== JSON.stringify({kind: 'brightness.set', percent: 30})) throw new Error(`unexpected command ${JSON.stringify(seen[0])}`);
        });
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
        await t.expect('the uncertain command reached the fake once and was not retried', async () => {
          const seen = await writes(t);
          if (seen.length !== 1) throw new Error(`expected 1 command, saw ${seen.length}`);
        });
        await control(t, '/uncertain', {on: false});
        await t.page.locator('form.edit').filter({visible: true}).getByRole('button', {name: 'Reload current values', exact: true}).click();
        await formReady(t);
        await t.expect('reload shows the controller value; the lost command never applied', async () => {
          if ((await brightness.inputValue()) !== '60') throw new Error(`slider shows ${await brightness.inputValue()}`);
        });
        await pause(1000);
        await t.expect('recovery replayed nothing', async () => {
          const seen = await writes(t);
          if (seen.length !== 1) throw new Error(`expected still 1 command, saw ${seen.length}`);
        });
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
        await t.expect('recovery sent no command', async () => {
          const seen = await writes(t);
          if (seen.length !== 0) throw new Error(`expected no command, saw ${seen.length}`);
        });
      },
    },
    'control-duplicate-command': {
      description: 'Negative control: expects two commands from one brightness change and must fail',
      scenario: 'lifecycle-basic',
      fresh: true,
      run: async t => {
        await open(t);
        const brightness = await openPixel(t);
        await brightness.fill('30');
        await brightnessStatus(t).filter({hasText: /^(Queued\. The device hasn’t received it yet\.|Sent to the device\.)/}).waitFor();
        await pause(500);
        await t.expect('the fake received two commands', async () => {
          const seen = await writes(t);
          if (seen.length !== 2) throw new Error(`expected 2 commands, saw ${seen.length}`);
        });
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
