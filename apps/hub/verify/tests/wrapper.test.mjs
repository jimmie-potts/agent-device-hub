import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {copyFile, mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

const root = new URL('../../../../', import.meta.url);

async function checkout(t) {
  const path = await mkdtemp(join(tmpdir(), 'verify-wrapper-'));
  t.after(() => rm(path, {recursive: true, force: true}));
  for (const dir of ['scripts', 'apps/hub/verify', 'packages/app-verify', 'node_modules/@jimmie-potts']) {
    await mkdir(join(path, dir), {recursive: true});
  }
  await copyFile(new URL('scripts/verify.mjs', root), join(path, 'scripts/verify.mjs'));
  await copyFile(new URL('packages/app-verify/package.json', root), join(path, 'packages/app-verify/package.json'));
  await symlink('../../packages/app-verify', join(path, 'node_modules/@jimmie-potts/app-verify'));
  await writeFile(join(path, 'apps/hub/verify/plugin.mjs'), "throw new Error('plugin must not load before core build check');\n");
  return path;
}

function run(path, ...args) {
  return spawnSync(process.execPath, ['scripts/verify.mjs', ...args], {cwd: path, encoding: 'utf8'});
}

test('the unbuilt wrapper reports one unavailable JSON result before loading the plugin', async t => {
  const path = await checkout(t);
  const result = run(path, 'start');
  assert.equal(result.status, 3, result.stderr);
  assert.equal(result.stderr, '');
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, 1);
  const value = JSON.parse(lines[0]);
  assert.equal(value.operation, 'start');
  assert.equal(value.state, 'unavailable');
  assert.match(value.detail, /npm run build/);
});

test('the built wrapper forwards the plugin and arguments and preserves the core exit status', async t => {
  const path = await checkout(t);
  await mkdir(join(path, 'packages/app-verify/dist'));
  await writeFile(join(path, 'packages/app-verify/dist/index.js'), `
    export async function runCli(plugin, argv) {
      console.log(JSON.stringify({app: plugin.app, argv}));
      return 2;
    }
  `);
  await writeFile(join(path, 'apps/hub/verify/plugin.mjs'), "export default {app: 'hub'};\n");
  const result = run(path, 'capture', 'hub-example', 'step');
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), {app: 'hub', argv: ['capture', 'hub-example', 'step']});
});

test('a missing dependency inside an existing core is not misreported as an unbuilt checkout', async t => {
  const path = await checkout(t);
  await mkdir(join(path, 'packages/app-verify/dist'));
  await writeFile(join(path, 'packages/app-verify/dist/index.js'), "import './missing-dependency.js';\n");
  const result = run(path, 'start');
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /ERR_MODULE_NOT_FOUND/);
  assert.match(result.stderr, /missing-dependency/);
});
