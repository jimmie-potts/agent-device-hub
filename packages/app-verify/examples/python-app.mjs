// Caller example: a Python application with a Node/Playwright toolchain, like the
// Nanoleaf wall demo (codex-nanoleaf#193). The adapter module stays JavaScript;
// only the application process is Python. The argv below is illustrative: the
// adapter names its own entry point and flags.
//
// Wrapper `scripts/verify.mjs`, run as `npm run verify -- <operation> …`:
//
//   import {runCli} from '@jimmie-potts/app-verify';
//   import plugin from './verify-plugin.mjs';
//   process.exitCode = await runCli(plugin, process.argv.slice(2));
//
// A `python3 scripts/verify.py` wrapper can exec `node scripts/verify.mjs` with the
// same arguments and pass its exit status through.
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {definePlugin} from '@jimmie-potts/app-verify';

const run = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
/** The interpreter the unit runs; a bare name is resolved on the adapter's PATH. */
const python = 'python3';

export default definePlugin({
  app: 'wall',
  repository: 'jimmie-potts/codex-nanoleaf',
  command: 'npm run verify --',
  root,
  defaultScenario: 'two-projects',
  scenarios: {
    'two-projects': {
      description: 'Two synthetic projects with one task each on a fixture Lines layout',
      // Seeding runs the application's own preparation step into the empty data directory.
      seed: async ({dataDir}) => {
        await run(python, ['scripts/demo.py', 'prepare', '--state', dataDir, '--scenario', 'two-projects'], {cwd: root});
      },
    },
  },
  build: {version: JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version ?? '0.0.0', artifact: {file: 'wall/static/map.js'}},
  launch: ({dataDir, port}) => ({
    argv: [python, 'scripts/demo.py', 'serve', '--state', dataDir, '--host', '127.0.0.1', '--port', String(port)],
    env: {PYTHONDONTWRITEBYTECODE: '1', PYTHONUNBUFFERED: '1'},
  }),
  readiness: {
    // The demo prints `{"url": "http://127.0.0.1:<port>/"}` once it listens.
    line: line => {
      try {
        const value = JSON.parse(line);
        return typeof value?.url === 'string' ? {url: value.url} : undefined;
      } catch {
        return undefined;
      }
    },
    probe: async ({url, signal}) => {
      const response = await fetch(url, {signal});
      return response.ok ? {ok: true} : {ok: false, reason: `map page answered ${response.status}`};
    },
    timeoutMs: 20000,
  },
  components: [
    {id: 'wall-server', kind: 'actual'},
    {id: 'map-page', kind: 'actual'},
    {id: 'worker', kind: 'simulated', note: 'scripts/demo.py prepare stand-in; request=no_device trap'},
  ],
  checks: [
    {
      id: 'light-trap',
      // The boundary proof: an attempted light request must fail inside the run.
      run: async ({url, signal}) => {
        const response = await fetch(new URL('/demo/try-light-request', url), {method: 'POST', signal});
        return response.status === 409 ? {outcome: 'passed'} : {outcome: 'failed', reason: `trap answered ${response.status}`};
      },
    },
  ],
  captureSteps: {
    'task-transition': {
      description: 'Completing a task moves its Line to the done colour',
      scenario: 'two-projects',
      run: async t => {
        await t.page.goto(t.url);
        await t.page.getByRole('button', {name: 'Complete task'}).click();
        await t.expect('the task shows as done', () => t.page.getByText('Done', {exact: true}).waitFor());
      },
    },
  },
});
