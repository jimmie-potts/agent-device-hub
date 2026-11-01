#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {createReadStream, createWriteStream} from 'node:fs';
import {appendFile, mkdir, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {createGzip} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {createContext} from '../../deploy/container/context.mjs';

async function command(program, args, {capture = false} = {}) {
  const child = spawn(program, args, {stdio: ['ignore', capture ? 'pipe' : 'inherit', 'inherit']});
  let output = '';
  if (capture) child.stdout.on('data', bytes => {output += bytes; if (output.length > 1024 * 1024) child.kill();});
  const code = await new Promise((resolve, reject) => {child.once('error', reject); child.once('close', resolve);});
  if (code !== 0) throw new Error('release-build-failed');
  return output.trim();
}
async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
export function imageIdentity(info, candidate, {derivative = false} = {}) {
  if (!info || !/^sha256:[a-f0-9]{64}$/.test(info.Id ?? '') || info.Os !== 'linux' || info.Architecture !== 'arm64'
    || info.Config?.Labels?.['org.opencontainers.image.revision'] !== candidate || info.Config?.User !== '1000:1000'
    || derivative && info.Config?.Labels?.['org.bunny.verify.portable'] !== '1') throw new Error('release-image-refused');
  return info.Id;
}
export async function buildRelease(candidate, destination) {
  if (!/^[a-f0-9]{40}$/.test(candidate) || !destination || resolve(destination) !== destination) throw new Error('release-build-refused');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  if (await command('git', ['-C', root, 'rev-parse', 'HEAD'], {capture: true}) !== candidate
    || await command('git', ['-C', root, 'status', '--porcelain', '--untracked-files=normal'], {capture: true}) !== '') throw new Error('release-source-refused');
  await mkdir(destination, {mode: 0o700});
  const context = await createContext({repository: root, revision: candidate, destination: join(destination, 'context')});
  const extracted = join(destination, 'source'); await mkdir(extracted, {mode: 0o700});
  await command('tar', ['-xf', context.archive, '-C', extracted]);
  const identity = randomUUID(), coreTag = `bunny-release-${identity}:core`, testTag = `bunny-release-${identity}:test`;
  await command('docker', ['build', '--platform', 'linux/arm64', '--build-arg', `SOURCE_REVISION=${candidate}`,
    '-f', join(extracted, 'deploy/container/Dockerfile'), '-t', coreTag, extracted]);
  const inspect = async reference => {
    const rows = JSON.parse(await command('docker', ['image', 'inspect', reference], {capture: true}));
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error('release-image-refused');
    return rows[0];
  };
  const coreInfo = await inspect(coreTag);
  const core = imageIdentity(coreInfo, candidate);
  await command('docker', ['build', '--platform', 'linux/arm64', '--build-arg', `CORE_IMAGE=${coreTag}`,
    '--build-arg', `SOURCE_REVISION=${candidate}`, '-f', join(extracted, 'deploy/container/Dockerfile.verify'), '-t', testTag, extracted]);
  const testInfo = await inspect(testTag);
  const derivative = imageIdentity(testInfo, candidate, {derivative: true});
  if (!Array.isArray(coreInfo.RootFS?.Layers) || !Array.isArray(testInfo.RootFS?.Layers)
    || coreInfo.RootFS.Layers.some((layer, index) => testInfo.RootFS.Layers[index] !== layer)) throw new Error('release-parent-refused');
  // Test derivative reuses the exact immutable production parent. No host ports, mounts, credentials or devices.
  await command('docker', ['run', '--rm', '--name', `bunny-release-test-${identity}`, '--network', 'none', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges:true', '--env', 'TMPDIR=/tmp', '--env', 'XDG_RUNTIME_DIR=', '--env', 'DBUS_SESSION_BUS_ADDRESS=',
    '--entrypoint', '/usr/bin/timeout', derivative, '--signal=TERM', '--kill-after=30', '1800',
    '/bin/sh', '-c', 'node --test apps/runtime/dist/tests/scenarios/*.test.js && node --test --test-concurrency=1 apps/runtime/dist/verify/tests/*.test.js']);
  if (imageIdentity(await inspect(coreTag), candidate) !== core) throw new Error('release-image-refused');
  const archive = join(destination, 'production-image.tar.gz');
  const save = spawn('docker', ['image', 'save', core], {stdio: ['ignore', 'pipe', 'inherit']});
  const saved = new Promise((resolve, reject) => {save.once('error', reject); save.once('exit', code => code === 0 ? resolve() : reject(new Error('release-archive-failed')));});
  await Promise.all([pipeline(save.stdout, createGzip({level: 1}), createWriteStream(archive, {flags: 'wx', mode: 0o600})), saved]);
  const image = {id: core, revision: candidate, archive: 'production-image.tar.gz', archiveSha256: await hashFile(archive)};
  await writeFile(join(destination, 'image.json'), JSON.stringify(image) + '\n', {flag: 'wx', mode: 0o600});
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `image=${JSON.stringify(image)}\n`);
  return image;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildRelease(...process.argv.slice(2)).catch(() => {process.stderr.write('release-build-failed\n'); process.exitCode = 1;});
}
