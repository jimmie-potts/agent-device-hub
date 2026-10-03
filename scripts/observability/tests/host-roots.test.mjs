import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, rm, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareBackendDirectory } from '../backend-files.mjs';
import { registerHostRoots, readHostRoots } from '../host-roots.mjs';

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'hr-')); t.after(() => rm(base, { recursive: true, force: true }));
  const local = join(base, '.local'); await mkdir(local);
  const stateParent = join(local, 'state'); await mkdir(stateParent);
  const directory = join(local, 'backend');
  const { plan } = await prepareBackendDirectory(directory, { runId: 'roots-001',
    ports: { grafana: 43000, otlp: 43001, loki: 43002, tempo: 43003, health: 43004 } });
  return { base, stateParent, directory, plan };
}

test('registration creates private synthetic state with a durable owner and verified root identities', async t => {
  const f = await fixture(t), saved = await registerHostRoots(f.directory, f.stateParent);
  assert.deepEqual(await readHostRoots(f.directory), saved);
  assert.equal(saved.roots.backend.path, f.directory);
  assert.ok(saved.roots.state.path.startsWith(f.stateParent + '/s-'));
  assert.equal((await stat(saved.roots.state.path)).mode & 0o777, 0o700);
  await assert.rejects(registerHostRoots(f.directory, f.stateParent));
  assert.deepEqual(await readHostRoots(f.directory), saved);
});

test('state under a Git checkout is refused before creating registration intent', async t => {
  const f = await fixture(t); await mkdir(join(f.base, '.git'));
  await assert.rejects(registerHostRoots(f.directory, f.stateParent), /Git checkout/);
  await assert.rejects(readFile(join(f.directory, 'host-roots-intent.json')), { code: 'ENOENT' });
});

test('existing state is never adopted or overwritten, and an interrupted registration cannot repeat', async t => {
  const f = await fixture(t), path = join(f.stateParent, 's-' + f.plan.ownerToken.replaceAll('-', '').slice(0, 16));
  await mkdir(path); await writeFile(join(path, 'unrelated'), 'keep');
  await assert.rejects(registerHostRoots(f.directory, f.stateParent));
  assert.equal(await readFile(join(path, 'unrelated'), 'utf8'), 'keep');
  assert.ok(await readFile(join(f.directory, 'host-roots-intent.json')));
  await assert.rejects(registerHostRoots(f.directory, f.stateParent));
  await assert.rejects(readHostRoots(f.directory));
});

test('changed state identity or owner marker invalidates readback without repairing evidence', async t => {
  const f = await fixture(t), saved = await registerHostRoots(f.directory, f.stateParent);
  const marker = join(saved.roots.state.path, 'observability-owner.json');
  const original = await readFile(marker, 'utf8');
  await writeFile(marker, JSON.stringify({ ...JSON.parse(original), ownerToken: 'foreign' }) + '\n');
  await assert.rejects(readHostRoots(f.directory), /owner/);
  await writeFile(marker, original);
  await rename(saved.roots.state.path, saved.roots.state.path + '-old'); await mkdir(saved.roots.state.path);
  await assert.rejects(readHostRoots(f.directory), /identity/);
});
