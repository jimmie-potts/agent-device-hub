import assert from 'node:assert/strict';
import {chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {test} from 'node:test';
import {provisionLocal} from '../provision-local.mjs';

test('fresh local provisioning creates no client credential and refuses changed or partial inputs', {
  skip: process.platform !== 'linux' || process.getuid?.() === 0,
}, async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bunny-local-provision-')));
  t.after(() => rm(root, {recursive: true, force: true}));
  async function dirs(name) {
    const config = join(root, name + '-config'), secrets = join(root, name + '-secrets');
    await mkdir(config, {mode: 0o700}); await mkdir(secrets, {mode: 0o700});
    await writeFile(join(config, 'runtime.json'), '{"schema":"runtime-config/1.0","modules":{}}\n', {mode: 0o600});
    return [config, secrets];
  }
  const [config, secrets] = await dirs('fresh');
  assert.equal((await provisionLocal(config, secrets)).startup, 'stopped');
  assert.deepEqual(JSON.parse(await readFile(join(secrets, 'edge.json'), 'utf8')), {schema: 'edge-credentials/1.0', credentials: []});
  const prepared = JSON.parse(await readFile(join(config, 'runtime.json'), 'utf8'));
  assert.deepEqual(prepared.modules, {}); assert.equal(prepared.edge.browserAccess, 'trusted-loopback');
  assert.equal(prepared.edge.mcp, false); assert.equal(prepared.edge.launcher, false);
  await assert.rejects(provisionLocal(config, secrets));
  for (const change of ['config', 'extra', 'secret', 'mode', 'link']) {
    const [c, s] = await dirs(change);
    if (change === 'config') await writeFile(join(c, 'runtime.json'), '{"private":"retain"}');
    if (change === 'extra') await writeFile(join(c, 'unexpected'), 'retain');
    if (change === 'secret') await writeFile(join(s, 'edge.json'), 'retain', {mode: 0o600});
    if (change === 'mode') await chmod(c, 0o755);
    if (change === 'link') {await rm(join(c, 'runtime.json')); await symlink(join(config, 'runtime.json'), join(c, 'runtime.json'));}
    const before = await readdir(s);
    await assert.rejects(provisionLocal(c, s)); assert.deepEqual(await readdir(s), before);
  }
});
