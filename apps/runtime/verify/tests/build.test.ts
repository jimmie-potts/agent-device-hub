// Hub #920: build-current, the check that a run serves a build of the checkout, judged without a supervisor. A newer
// source of anything the run loads fails it, and every source file the run's entry points load, in the runtime or in a
// workspace package, is one it watches.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir, mkdtemp, realpath, rm, utimes, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {BUILD_OUTPUTS, BUILD_SOURCES, artifactFiles, buildCurrent} from '../plugin.js';

const root = fileURLToPath(new URL('../../../../../', import.meta.url));

void test('a newer source of the runtime, its run or a workspace package it loads fails build-current', async () => {
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'runtime-build-')));
  try {
    const sources = [
      'apps/runtime/src/runtime.ts', 'apps/runtime/verify/supervisor.ts', 'apps/runtime/tests/fixtures/lamp.ts', 'apps/runtime/tests/scenarios/catalog.ts',
      'packages/sdk/src/index.ts', 'packages/app-verify/src/index.ts', 'packages/event-contracts/src/v2/index.ts',
      'packages/observability/src/catalog.json', 'modules/playback/src/module.ts', 'modules/lifx/src/module.ts', 'modules/tidbyt/src/module.ts',
      'modules/nanoleaf/src/index.ts',
    ];
    for (const file of [...sources, ...BUILD_OUTPUTS]) {
      await mkdir(dirname(join(repo, file)), {recursive: true});
      await writeFile(join(repo, file), '');
    }
    const git = (...args: string[]): string => execFileSync('git', ['-C', repo, ...args], {encoding: 'utf8', env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
    git('init', '-q');
    git('add', ...sources);
    const at = (seconds: number): Date => new Date(1_790_000_000_000 + seconds * 1000);
    const age = async (files: readonly string[], seconds: number): Promise<void> => {
      for (const file of files) await utimes(join(repo, file), at(seconds), at(seconds));
    };
    await age(sources, 0);
    await age(BUILD_OUTPUTS, 10);
    assert.deepEqual(await buildCurrent(repo), {outcome: 'passed'});
    for (const newer of sources) {
      await age([newer], 20);
      assert.deepEqual(await buildCurrent(repo), {outcome: 'failed', reason: `${newer} is newer than the build; run npm run build`}, newer);
      await age([newer], 0);
    }
    await rm(join(repo, 'packages/event-contracts/src/v2/index.ts'));
    assert.equal((await buildCurrent(repo)).outcome, 'failed', 'a deleted tracked source cannot qualify retained outputs');
  } finally {
    await rm(repo, {recursive: true, force: true});
  }
});

void test('build-current watches every source the run loads, and the served candidate holds every package build it loads', async () => {
  const entryPoints = ['apps/runtime/src/main.ts', 'apps/runtime/verify/supervisor.ts', 'apps/runtime/verify/child.ts', 'apps/runtime/verify/plugin.ts'];
  const bundled = await build({
    absWorkingDir: root, entryPoints, bundle: true, platform: 'node', format: 'esm', target: 'es2022', outdir: 'unused', write: false,
    metafile: true, logLevel: 'silent', external: ['*.node'],
  });
  const inputs = Object.keys(bundled.metafile.inputs).filter(path => !path.startsWith('node_modules/'));
  const watched = new Set(execFileSync('git', ['-C', root, 'ls-files', '-z', '--', ...BUILD_SOURCES], {encoding: 'utf8'}).split('\0').filter(Boolean));
  const packages = new Set<string>();
  const unwatched: string[] = [];
  for (const path of inputs) {
    // A workspace package's or a shipped module's build, such as `modules/playback/dist/` (#929) or `modules/pixoo/dist/` (#843).
    const built = /^((?:packages|modules)\/[^/]+)\/dist\//.exec(path);
    if (built?.[1] !== undefined) packages.add(built[1]);
    else if (!watched.has(path)) unwatched.push(path);
  }
  assert.deepEqual(unwatched, [], 'every runtime source the run loads is a build source');
  for (const name of ['packages/event-contracts', 'packages/sdk', 'packages/app-verify', 'packages/observability', 'modules/playback', 'modules/lifx', 'modules/tidbyt', 'modules/pixoo',
    'modules/nanoleaf']) {
    assert.ok(packages.has(name), `the run loads ${name}: ${[...packages].join(', ')}`);
  }
  const candidate = artifactFiles();
  for (const name of packages) {
    assert.ok([...watched].some(file => file.startsWith(`${name}/src/`)), `${name}'s sources are build sources`);
    assert.ok(BUILD_OUTPUTS.some(file => file.startsWith(`${name}/dist/`)), `${name}'s build is a build output`);
    if (name !== 'packages/app-verify') assert.ok(candidate.some(file => file.startsWith(`${name}/dist/`)), `the served candidate holds ${name}'s build`);
  }
});
