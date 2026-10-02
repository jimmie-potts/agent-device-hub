import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const archive = new URL('../../vendor/jimmie-potts-bunny-observability-1.0.0.tgz', import.meta.url);
const receipt = new URL('../../vendor/bunny-observability-1.0.0-source-receipt.json', import.meta.url);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const pins = Object.freeze({
  archive: '7c48025059a92677790182c84c5b5d3b830f69470a9adc791386ad89c2185894',
  manifest: '9cd89008b15af5c52cc15fe712ac9d803404e342b01b2d8c593f251d26898508',
  receipt: 'fbd1889bb3d6825927c1bf6fa454608b7fb12649900d8db1ffc442a0295d1e7a',
});

export function verifyReleaseInputs(archiveBytes, receiptBytes) {
  assert.equal(sha256(archiveBytes), pins.archive, 'released archive checksum');
  assert.equal(sha256(receiptBytes), pins.receipt, 'released receipt checksum');
  return JSON.parse(receiptBytes);
}

async function files(directory, prefix = '') {
  const found = [];
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    if (!prefix && ['node_modules', 'package-lock.json'].includes(entry.name)) continue;
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...await files(directory, name));
    else if (entry.isFile()) found.push(name);
    else throw new Error(`unexpected package entry:${name}`);
  }
  return found.sort();
}

export async function verifyInstalledContract(directory) {
  const bytes = await readFile(join(directory, 'manifest.json'));
  assert.equal(sha256(bytes), pins.manifest, 'released manifest checksum');
  const manifest = JSON.parse(bytes);
  assert.deepEqual(await files(directory), [...Object.keys(manifest.files), 'manifest.json'].sort());
  for (const [name, digest] of Object.entries(manifest.files)) {
    assert.equal(sha256(await readFile(join(directory, name))), digest, `integrity:${name}`);
  }
  return manifest;
}

/** Installs only the pinned, bundled archive into a new task-owned directory. */
export async function prepareReleasedContract(directory) {
  verifyReleaseInputs(await readFile(archive), await readFile(receipt));
  if (!process.env.npm_execpath) throw new Error('run the pilot through its npm command');
  await mkdir(directory); // Existing state is not reused or overwritten.
  await writeFile(join(directory, 'package.json'), JSON.stringify({
    name: 'isolated-observability-pilot-consumer', private: true, type: 'module',
  }));
  const result = spawnSync(process.execPath, [process.env.npm_execpath, 'install',
    '--offline', '--ignore-scripts', '--bin-links=false', '--no-audit', '--no-fund', fileURLToPath(archive)],
  { cwd: directory, encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`released contract installation failed: ${result.error?.message ?? result.stderr}`);
  const installed = join(directory, 'node_modules/@jimmie-potts/bunny-observability');
  await verifyInstalledContract(installed);
  return installed;
}
