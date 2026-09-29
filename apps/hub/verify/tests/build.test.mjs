// Hub #494: build-current, the check that a run serves a build of the checkout,
// judged without a supervisor. A newer package source or dashboard bundle input
// fails it, and every input esbuild compiles into the dashboard is one it watches.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir, mkdtemp, realpath, rm, utimes, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {build} from 'esbuild';
import {BUILD_OUTPUTS, BUILD_SOURCES, buildCurrent} from '../plugin.mjs';

const root = fileURLToPath(new URL('../../../..', import.meta.url));

test('a newer package source, Places manifest or dashboard build script fails build-current', async () => {
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'hub-build-')));
  try {
    const sources = ['apps/hub/src/server.ts', 'apps/dashboard/src/main.tsx', 'packages/agent-state/src/index.ts', 'packages/contracts/src/types.ts', 'packages/lifecycle-contracts/src/index.ts', 'packages/mcp/src/index.ts', 'packages/app-verify/src/proof.ts', 'docs/skins/places.json', 'scripts/build-dashboard.mjs'];
    for (const file of [...sources, ...BUILD_OUTPUTS]) {
      await mkdir(dirname(join(repo, file)), {recursive: true});
      await writeFile(join(repo, file), '');
    }
    const git = (...args) => execFileSync('git', ['-C', repo, ...args], {encoding: 'utf8', env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
    git('init', '-q');
    git('add', ...sources);
    const at = seconds => new Date(1_790_000_000_000 + seconds * 1000);
    const age = async (files, seconds) => {
      for (const file of files) await utimes(join(repo, file), at(seconds), at(seconds));
    };
    await age(sources, 0);
    await age(BUILD_OUTPUTS, 10);
    assert.deepEqual(await buildCurrent(repo), {outcome: 'passed'});
    for (const newer of ['packages/app-verify/src/proof.ts', 'packages/agent-state/src/index.ts', 'packages/contracts/src/types.ts', 'docs/skins/places.json', 'scripts/build-dashboard.mjs']) {
      await age([newer], 20);
      assert.deepEqual(await buildCurrent(repo), {outcome: 'failed', reason: `${newer} is newer than the build; run npm run build`}, newer);
      await age([newer], 0);
    }
  } finally {
    await rm(repo, {recursive: true, force: true});
  }
});

test('build-current watches every source file esbuild bundles into the served dashboard', async () => {
  const bundled = await build({absWorkingDir: root, entryPoints: ['apps/dashboard/src/main.tsx'], bundle: true, format: 'esm', target: 'es2022', outfile: 'dashboard.js', write: false, metafile: true, logLevel: 'silent'});
  const inputs = Object.keys(bundled.metafile.inputs).filter(path => !path.startsWith('node_modules/'));
  assert.ok(inputs.includes('docs/skins/places.json'), 'the Places manifest is a bundle input');
  const watched = new Set(execFileSync('git', ['-C', root, 'ls-files', '-z', '--', ...BUILD_SOURCES], {encoding: 'utf8'}).split('\0').filter(Boolean));
  assert.deepEqual(inputs.filter(path => !watched.has(path)), [], 'every dashboard input is a build source');
});
