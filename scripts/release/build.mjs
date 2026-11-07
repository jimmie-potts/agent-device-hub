#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createWriteStream} from 'node:fs';
import {appendFile, mkdir, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {createGzip} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {createContext} from '../../deploy/container/context.mjs';
import {archiveIdentity} from './archive.mjs';

export async function command(program, args, {capture = false} = {}) {
  const child = spawn(program, args, {stdio: ['ignore', capture ? 'pipe' : 'inherit', 'inherit']});
  let output = '';
  if (capture) child.stdout.on('data', bytes => {output += bytes; if (output.length > 1024 * 1024) child.kill();});
  const code = await new Promise((resolve, reject) => {child.once('error', reject); child.once('close', resolve);});
  if (code !== 0) throw new Error('release-build-failed');
  return output.trim();
}
export async function inspect(reference) {
  const rows = JSON.parse(await command('docker', ['image', 'inspect', reference], {capture: true}));
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('release-image-refused');
  return rows[0];
}
export function imageIdentity(info, candidate, {derivative = false} = {}) {
  if (!info || !/^sha256:[a-f0-9]{64}$/.test(info.Id ?? '') || info.Os !== 'linux' || info.Architecture !== 'arm64'
    || info.Config?.Labels?.['org.opencontainers.image.revision'] !== candidate || info.Config?.User !== '1000:1000'
    || derivative && info.Config?.Labels?.['org.bunny.verify.portable'] !== '1') throw new Error('release-image-refused');
  return info.Id;
}
export async function savedImageMetadata(archive, candidate, production) {
  imageIdentity(production, candidate);
  const identity = await archiveIdentity(archive, production, candidate);
  return {id: identity.id, revision: candidate, archive: 'production-image.tar.gz', archiveSha256: identity.archiveSha256};
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
  const coreTag = `bunny-release-${randomUUID()}:core`;
  await command('docker', ['build', '--platform', 'linux/arm64', '--build-arg', `SOURCE_REVISION=${candidate}`,
    '-f', join(extracted, 'deploy/container/Dockerfile'), '-t', coreTag, extracted]);
  const coreInfo = await inspect(coreTag);
  const core = imageIdentity(coreInfo, candidate);
  // Packaged checks run in parallel jobs, each on this exact archive after it verifies the archive's identity (verify.mjs).
  const archive = join(destination, 'production-image.tar.gz');
  const save = spawn('docker', ['image', 'save', core], {stdio: ['ignore', 'pipe', 'inherit']});
  const saved = new Promise((resolve, reject) => {save.once('error', reject); save.once('exit', code => code === 0 ? resolve() : reject(new Error('release-archive-failed')));});
  await Promise.all([pipeline(save.stdout, createGzip({level: 1}), createWriteStream(archive, {flags: 'wx', mode: 0o600})), saved]);
  const image = await savedImageMetadata(archive, candidate, coreInfo);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
    `### Packaged candidate built\n\nProduction manifest: \`${image.id}\`. Archive SHA-256: \`${image.archiveSha256}\`.\n\nProducer-local image: \`${core}\`. Each packaged verification lane loads this archive and checks its identity before it tests it.\n`);
  await writeFile(join(destination, 'image.json'), JSON.stringify(image) + '\n', {flag: 'wx', mode: 0o600});
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `image=${JSON.stringify(image)}\n`);
  return image;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildRelease(...process.argv.slice(2)).catch(() => {process.stderr.write('release-build-failed\n'); process.exitCode = 1;});
}
