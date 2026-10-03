import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, rm, readFile, chmod, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareBackendDirectory, readPreparedBackend } from '../backend-files.mjs';
const ports = { grafana: 43000, otlp: 43001, loki: 43002, tempo: 43003, health: 43004 };
async function root(t) {
  const directory = await mkdtemp(join(tmpdir(), 'backend-files-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, '.local')); return join(directory, '.local');
}

test('preparation creates exclusive owned files with verified deterministic config receipts', async t => {
  const directory = join(await root(t), 'run');
  const created = await prepareBackendDirectory(directory, { runId: 'test-run', ports });
  const verified = await readPreparedBackend(directory);
  assert.deepEqual(verified, created);
  assert.equal(verified.qualification, 'unexecuted');
  assert.equal(Object.keys(verified.configs).length, 2);
  const before = await readFile(join(directory, 'backend.json'), 'utf8');
  await assert.rejects(prepareBackendDirectory(directory, { runId: 'test-run', ports }));
  assert.equal(await readFile(join(directory, 'backend.json'), 'utf8'), before);
});

test('corrupted configuration fails readback without modifying evidence', async t => {
  const directory = join(await root(t), 'run');
  await prepareBackendDirectory(directory, { runId: 'test-run', ports });
  const file = join(directory, 'config', 'loki-config.yaml');
  await chmod(file, 0o600); await writeFile(file, 'SYNTHETIC_CORRUPTION');
  await assert.rejects(readPreparedBackend(directory), /configuration/);
  assert.equal(await readFile(file, 'utf8'), 'SYNTHETIC_CORRUPTION');
});

test('symlinked directories and config files cannot substitute another owner’s files', async t => {
  const base = await root(t), directory = join(base, 'run');
  await prepareBackendDirectory(directory, { runId: 'test-run', ports });
  const alias = join(base, 'alias'); await symlink(directory, alias);
  await assert.rejects(readPreparedBackend(alias), /directory/);
  const file = join(directory, 'config', 'loki-config.yaml');
  const other = join(base, 'other'); await writeFile(other, 'unrelated');
  await rm(file); await symlink(other, file);
  await assert.rejects(readPreparedBackend(directory), /configuration/);
  assert.equal(await readFile(other, 'utf8'), 'unrelated');
});

test('a forged launch plan cannot add privileged commands or environment overrides', async t => {
  const directory = join(await root(t), 'run');
  await prepareBackendDirectory(directory, { runId: 'test-run', ports });
  const path = join(directory, 'backend.json');
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  manifest.plan.containerArgs.splice(1, 0, '--privileged');
  const changed = JSON.stringify(manifest); await writeFile(path, changed);
  await assert.rejects(readPreparedBackend(directory), /manifest plan/);
  assert.equal(await readFile(path, 'utf8'), changed);
});
