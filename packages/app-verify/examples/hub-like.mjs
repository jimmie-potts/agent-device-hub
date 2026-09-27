// Caller example: a Node application with fake controllers, like the Hub adapter (#494).
// The wrapper is `scripts/verify.mjs`, run as `npm run verify -- <operation> …`:
//
//   import {runCli} from '@jimmie-potts/app-verify';
//   import plugin from '../apps/hub/verify/plugin.mjs';
//   process.exitCode = await runCli(plugin, process.argv.slice(2));
//
// The serve script (not shown) starts the application and its fake controllers
// from `dataDir`, binds 127.0.0.1 on `--port`, and prints `{"ready":true,"url":…}`.
// It exposes the fake controller's observed writes on a Unix socket inside
// `dataDir`, so capture steps can assert what reached the fake.
import {readFile} from 'node:fs/promises';
import {request} from 'node:http';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {definePlugin} from '@jimmie-potts/app-verify';

const root = fileURLToPath(new URL('../../..', import.meta.url));

/** Read the fake controller's observations over the run's private socket. */
function observed(/** @type {string} */ dataDir) {
  return new Promise((resolve, reject) => {
    request({socketPath: join(dataDir, 'fixture.sock'), path: '/writes'}, response => {
      let text = '';
      response.on('data', chunk => (text += chunk));
      response.on('end', () => resolve(JSON.parse(text)));
    }).on('error', reject).end();
  });
}

/** @param {string} line */
function readyLine(line) {
  try {
    const value = JSON.parse(line);
    return value?.ready === true && typeof value.url === 'string' ? {url: value.url} : undefined;
  } catch {
    return undefined;
  }
}

export default definePlugin({
  app: 'hub',
  repository: 'jimmie-potts/agent-device-hub',
  command: 'npm run verify --',
  root,
  defaultScenario: 'lifecycle-basic',
  scenarios: {
    'lifecycle-basic': {
      description: 'One Codex session with a label and two fake controllers',
      // The scenario definition lives with the fixtures; the serve script reads it at launch.
      seed: async ({dataDir, scenario}) => {
        const {writeFile} = await import('node:fs/promises');
        await writeFile(join(dataDir, 'scenario.json'), JSON.stringify({scenario}));
      },
    },
  },
  build: {version: JSON.parse(await readFile(join(root, 'apps/hub/package.json'), 'utf8')).version, artifact: {route: '/dashboard.js'}},
  launch: ({node, dataDir, port}) => ({
    argv: [node, 'apps/hub/verify/serve.mjs', '--data', dataDir, '--port', String(port)],
  }),
  readiness: {
    line: readyLine,
    probe: async ({url, signal}) => {
      const response = await fetch(new URL('/api/hub/v1/health', url), {signal});
      return response.ok ? {ok: true} : {ok: false, reason: `health answered ${response.status}`};
    },
    // The hub CLI prints one stable cause line, never a path or value, when it refuses to start.
    failureCause: tail => /^hub-start-failed: [a-z0-9-]+$/im.exec(tail)?.[0],
  },
  components: [
    {id: 'hub', kind: 'actual'},
    {id: 'dashboard', kind: 'actual'},
    {id: 'wall-controller', kind: 'simulated', note: 'fake loopback controller from apps/dashboard/tests/fixture.mjs'},
  ],
  captureSteps: {
    'task-appears': {
      description: 'The seeded session card shows on the home page',
      scenario: 'lifecycle-basic',
      run: async t => {
        await t.page.goto(t.url);
        await t.expect('session card is visible', () =>
          t.page.getByRole('heading', {name: 'Build the integration', exact: true}).waitFor());
        await t.expect('reading the page sent no controller command', async () => {
          const writes = /** @type {unknown[]} */ (await observed(t.dataDir));
          if (writes.length !== 0) throw new Error(`expected no writes, saw ${writes.length}`);
        });
      },
    },
  },
});
