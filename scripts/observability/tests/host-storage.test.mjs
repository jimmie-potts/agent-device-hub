import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, rm, writeFile, link, symlink, rename, truncate } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hostTreeIdentity, measureHostRunFiles } from '../host-storage.mjs';

async function fixture(t) {
  const parent = await mkdtemp(join(tmpdir(), 'hs-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = join(parent, '.local'); await mkdir(root);
  return { root, parent, identity: await hostTreeIdentity(root) };
}

test('host measurement counts owned tree metadata and files without following or double-counting hardlinks', async t => {
  const f = await fixture(t); await mkdir(join(f.root, 'state'));
  await writeFile(join(f.root, 'SYNTHETIC_SECRET'), 'x'.repeat(1000));
  await link(join(f.root, 'SYNTHETIC_SECRET'), join(f.root, 'state', 'alias'));
  const result = await measureHostRunFiles([f.identity]);
  assert.equal(result.fileCount, 1); assert.equal(result.directoryCount, 2);
  assert.ok(result.apparentBytes >= 1000);
  assert.equal(result.hostRunBytes, Math.max(result.apparentBytes, result.allocatedBytes));
  assert.equal(JSON.stringify(result).includes('SYNTHETIC_SECRET'), false);
});

test('sparse files count by apparent size when it exceeds allocated storage', async t => {
  const f = await fixture(t), path = join(f.root, 'sparse'); await writeFile(path, '');
  await truncate(path, 1024 * 1024);
  const result = await measureHostRunFiles([f.identity]);
  assert.ok(result.hostRunBytes >= 1024 * 1024);
});

test('symlinks, replaced roots and overlapping roots are refused without visiting foreign content', async t => {
  const f = await fixture(t); await symlink(f.parent, join(f.root, 'escape'));
  await assert.rejects(measureHostRunFiles([f.identity]), error => !error.message.includes(f.parent));
  await rm(join(f.root, 'escape'));
  await assert.rejects(measureHostRunFiles([f.identity, f.identity]));
  await mkdir(join(f.root, 'child'));
  await assert.rejects(measureHostRunFiles([f.identity, await hostTreeIdentity(join(f.root, 'child'))]));
  await rename(f.root, join(f.parent, 'old')); await mkdir(f.root);
  await assert.rejects(measureHostRunFiles([f.identity]), /identity/);
});

test('entry limits and cancellation reject incomplete measurements', async t => {
  const f = await fixture(t); await writeFile(join(f.root, 'file'), 'x');
  await assert.rejects(measureHostRunFiles([f.identity], { maximumEntries: 1 }), /limit/);
  await assert.rejects(measureHostRunFiles([f.identity], { signal: AbortSignal.abort() }), /aborted/);
});
