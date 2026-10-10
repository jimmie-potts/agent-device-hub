import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {test} from 'node:test';
import {promisify} from 'node:util';

const run = promisify(execFile);
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const helper = join(process.cwd(), 'apps/runtime/bin/runtime-upgrade-check.mjs');
const anchors = ['.nvmrc', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.strict.json',
  'apps/runtime/package.json', 'apps/runtime/tsconfig.json', 'apps/runtime/src/main.ts', 'apps/runtime/src/launch.ts',
  'apps/runtime/src/process.ts', 'apps/runtime/src/modules.ts', 'apps/runtime/src/state.ts', 'apps/runtime/src/core/store.ts',
  'apps/runtime/build/registry.ts', 'apps/runtime/dashboard/build.mjs', 'packages/sdk/src/database.ts', 'packages/sdk/src/outbox.ts',
  'packages/agent-state/package.json', 'packages/contracts/package.json', 'packages/event-contracts/package.json',
  ...['playback', 'nanoleaf', 'pixoo', 'tidbyt', 'lifx'].map(name => `modules/${name}/package.json`),
  'controllers/lifx/package.json', 'controllers/tidbyt/package.json'];

void test('release source comparison derives format inputs and refuses changes or executable build identities', async t => {
  const root = await mkdtemp(join(tmpdir(), 'bunny-upgrade-source-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const revisions = {previous: 'a'.repeat(40), target: 'b'.repeat(40), recovery: 'a'.repeat(40)};
  const inputs = anchors.map(path => ({path, sha256: hash(path === 'apps/runtime/package.json'
    ? JSON.stringify({name: '@jimmie-potts/runtime', version: '0.1.0'}) : 'synthetic production input\n')}))
    .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const releases: Record<string, {identity: string; directory: string; archive: string}> = {};
  const inventories: Record<string, string> = {};
  const seal = async (name: keyof typeof revisions): Promise<void> => {
    const paths = releases[name];
    assert.ok(paths);
    const result = await run(process.execPath, ['--input-type=module', '-e',
      'import {inventory} from "./apps/hub/dist/install/files.js";process.stdout.write(JSON.stringify((await inventory(process.argv[1])).entries.filter(e=>e.path!=="manifest.json")))', paths.directory], {cwd: process.cwd()});
    const entries: unknown = JSON.parse(result.stdout);
    const manifest = JSON.stringify({artifact: '@jimmie-potts/runtime', sourceRevision: revisions[name], version: '0.1.0', inventory: entries});
    await writeFile(join(paths.directory, 'manifest.json'), manifest, {mode: 0o600});
    await writeFile(paths.identity, JSON.stringify({kind: 'release', sourceRevision: revisions[name], version: '0.1.0',
      archiveSha256: hash('synthetic retained archive'), manifestSha256: hash(manifest)}), {mode: 0o600});
  };
  for (const name of ['previous', 'target', 'recovery'] as const) {
    const directory = join(root, name);
    await mkdir(directory, {mode: 0o700});
    for (const path of anchors) {
      await mkdir(dirname(join(directory, path)), {recursive: true, mode: 0o700});
      await writeFile(join(directory, path), path === 'apps/runtime/package.json'
        ? JSON.stringify({name: '@jimmie-potts/runtime', version: '0.1.0'}) : 'synthetic production input\n', {mode: 0o600});
    }
    const stamp = join(directory, 'apps/runtime/dist/src/build-identity.js');
    await mkdir(dirname(stamp), {recursive: true, mode: 0o700});
    await writeFile(stamp, 'export const BUILD_IDENTITY = Object.freeze(' + JSON.stringify({schema: 'runtime-build/2.0',
      version: '0.1.0', revision: revisions[name], dirty: false, builtAt: '2026-10-10T00:00:00.000Z'}) + ');\n', {mode: 0o600});
    releases[name] = {directory, identity: join(root, name + '-identity.json'), archive: join(root, name + '.tar.gz')};
    await writeFile(releases[name].archive, 'synthetic retained archive', {mode: 0o600});
    await seal(name);
    inventories[name] = join(root, name + '-formats.json');
    await writeFile(inventories[name], JSON.stringify({schema: 'runtime-format-input-inventory/1.0', scope: 'runtime-durable-formats/1.0',
      sourceRevision: revisions[name], inputs}), {mode: 0o600});
  }
  inventories.qualification = join(root, 'qualification-formats.json');
  await writeFile(inventories.qualification, JSON.stringify({schema: 'runtime-format-input-inventory/1.0', scope: 'runtime-durable-formats/1.0',
    sourceRevision: revisions.target, inputs}), {mode: 0o600});
  const request = join(root, 'request.json');
  await writeFile(request, JSON.stringify({installationId: 'synthetic-runtime', provenanceDirectory: root, releases,
    qualificationRevision: revisions.target, formatInventoryFiles: inventories}), {mode: 0o600});
  const result = await run(process.execPath, [helper, 'verify-formats', request]);
  assert.deepEqual(JSON.parse(result.stdout), {verified: true, scope: 'runtime-durable-formats/1.0', inputs: anchors.length});

  await t.test('a changed producer, outbox, controller, lockfile or registry generator refuses despite resealed artifacts', async () => {
    const target = releases.target;
    assert.ok(target);
    for (const path of ['apps/runtime/src/state.ts', 'packages/sdk/src/outbox.ts', 'controllers/lifx/package.json',
      'package-lock.json', 'apps/runtime/build/registry.ts']) {
      const file = join(target.directory, path);
      const original = await readFile(file);
      await writeFile(file, 'changed synthetic production input', {mode: 0o600});
      await seal('target');
      await assert.rejects(run(process.execPath, [helper, 'verify-formats', request]), error => {
        assert.ok(error instanceof Error && 'stderr' in error);
        assert.match(String(error.stderr), /runtime-upgrade-source-refused/);
        return true;
      });
      await writeFile(file, original, {mode: 0o600});
      await seal('target');
    }
  });
  await t.test('a named operator-only helper does not alter the format inventory', async () => {
    const target = releases.target;
    assert.ok(target);
    await writeFile(join(target.directory, 'apps/runtime/src/upgrade-owner.ts'), 'synthetic operator-only change', {mode: 0o600});
    await seal('target');
    await run(process.execPath, [helper, 'verify-formats', request]);
  });
  await t.test('delivery admission and app-verification packaging tools do not alter durable formats', async () => {
    const target = releases.target;
    assert.ok(target);
    for (const path of ['scripts/package-app-verify.mjs', ...['ci', 'cli', 'context', 'preflight', 'receipts', 'report', 'records']
      .map(name => `scripts/delivery-preflight/${name}.mjs`)]) {
      await mkdir(dirname(join(target.directory, path)), {recursive: true, mode: 0o700});
      await writeFile(join(target.directory, path), 'synthetic delivery-only change', {mode: 0o600});
    }
    await seal('target');
    await run(process.execPath, [helper, 'verify-formats', request]);
  });
  await t.test('build scripts and unknown scripts remain conservative format inputs', async () => {
    const target = releases.target;
    assert.ok(target);
    for (const path of ['scripts/build-observability-validator.mjs', 'scripts/build-dashboard.mjs', 'scripts/unknown-producer.mjs']) {
      await mkdir(dirname(join(target.directory, path)), {recursive: true, mode: 0o700});
      await writeFile(join(target.directory, path), 'synthetic producer change', {mode: 0o600});
      await seal('target');
      await assert.rejects(run(process.execPath, [helper, 'verify-formats', request]));
      await rm(join(target.directory, path));
      await seal('target');
    }
  });
  await t.test('a missing required source anchor refuses', async () => {
    const target = releases.target;
    assert.ok(target);
    await rm(join(target.directory, 'packages/sdk/src/database.ts'));
    await seal('target');
    await assert.rejects(run(process.execPath, [helper, 'verify-formats', request]));
    await writeFile(join(target.directory, 'packages/sdk/src/database.ts'), 'synthetic production input\n', {mode: 0o600});
    await seal('target');
  });
  await t.test('build identity text is parsed as data and never executed', async () => {
    const target = releases.target;
    assert.ok(target);
    await writeFile(join(target.directory, 'apps/runtime/dist/src/build-identity.js'),
      'export const BUILD_IDENTITY = Object.freeze((()=>{throw new Error("synthetic executable marker")})());\n', {mode: 0o600});
    await seal('target');
    await assert.rejects(run(process.execPath, [helper, 'verify-formats', request]), error => {
      assert.ok(error instanceof Error && 'stderr' in error);
      assert.match(String(error.stderr), /runtime-upgrade-source-refused/);
      assert.doesNotMatch(String(error.stderr), /synthetic executable marker/);
      return true;
    });
  });
});
