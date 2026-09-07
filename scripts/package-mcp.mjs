import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { CONTRACT_ARTIFACT_SHA256, verifyArchiveChecksum } from '../packages/mcp/dist/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? `${command} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
function npm(args, cwd) { return run(process.execPath, [process.env.npm_execpath, ...args], cwd); }
async function files(directory, prefix = '') {
  const result = [];
  for (const entry of (await readdir(join(directory, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!prefix && ['node_modules', 'package-lock.json'].includes(entry.name)) continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await files(directory, path));
    else if (entry.isFile()) result.push(path);
    else throw new Error('Unexpected package entry');
  }
  return result;
}
const scratch = await mkdtemp(join(tmpdir(), 'hub-mcp-package-'));
try {
  const stage = join(scratch, 'stage'); await mkdir(stage);
  const contracts = join(root, 'vendor/jimmie-potts-device-contracts-1.0.0.tgz');
  await verifyArchiveChecksum(contracts, CONTRACT_ARTIFACT_SHA256);
  for (const name of ['package.json', 'src', 'dist', 'tests', 'fixtures', 'SDK-LICENSE', 'README.md', 'examples']) {
    await cp(join(root, 'packages/mcp', name), join(stage, name), { recursive: true });
  }
  const packageJson = await readFile(join(stage, 'package.json'));
  // Installing the verified local archive prevents a private registry lookup. Restore the portable version pin before packing.
  npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', contracts], stage);
  await writeFile(join(stage, 'package.json'), packageJson);
  await rm(join(stage, 'package-lock.json'), { force: true });
  const hashes = {};
  for (const name of await files(stage)) hashes[name] = sha256(await readFile(join(stage, name)));
  await writeFile(join(stage, 'manifest.json'), JSON.stringify({ artifact: '@jimmie-potts/device-mcp', version: '1.0.0',
    contractVersion: '1.0.0', contractSha256: CONTRACT_ARTIFACT_SHA256, sdk: '@modelcontextprotocol/sdk@1.30.0',
    protocolVersions: ['2025-11-25', '2025-06-18'], fixtureFormat: 1, files: hashes }, null, 2) + '\n');
  const destination = join(root, 'artifacts'); await mkdir(destination, { recursive: true });
  const packed = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', destination], stage))[0];
  const archive = join(destination, packed.filename), checksum = sha256(await readFile(archive));
  await writeFile(`${archive}.sha256`, `${checksum}  ${packed.filename}\n`);
  if (process.argv.includes('--test')) {
    const consumer = join(scratch, 'consumer'); await mkdir(consumer);
    await writeFile(join(consumer, 'package.json'), JSON.stringify({ name: 'isolated-mcp-consumer', private: true, type: 'module' }));
    await verifyArchiveChecksum(archive, checksum);
    await assert.rejects(verifyArchiveChecksum(archive, '0'.repeat(64)));
    npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', archive], consumer);
    const installed = join(consumer, 'node_modules/@jimmie-potts/device-mcp');
    const check = 'import {verifyInstalledMcpPackage} from "@jimmie-potts/device-mcp"; await verifyInstalledMcpPackage(process.argv[1]);';
    run(process.execPath, ['--input-type=module', '-e', check, installed], consumer);
    const output = run(process.execPath, ['--test', join(installed, 'tests/tools.test.mjs'), join(installed, 'tests/protocol.test.mjs')], consumer);
    assert.match(output, /fail 0/);
    const tsc = join(root, 'node_modules/typescript/bin/tsc');
    run(process.execPath, [tsc, '--noEmit', '--skipLibCheck', '--strict', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', join(installed, 'examples/consumers.ts')], consumer);
    await writeFile(join(installed, 'dist/index.js'), '// tampered\n', { flag: 'a' });
    assert.throws(() => run(process.execPath, ['--input-type=module', '-e', check, installed], consumer), /Artifact file mismatch/);
    console.log('Isolated MCP archive import, bundled contract hashes, consumer typecheck, both protocol profiles and corruption rejection passed.');
  }
  console.log(JSON.stringify({ archive, sha256: checksum, version: '1.0.0' }));
} finally { await rm(scratch, { recursive: true, force: true }); }
