#!/usr/bin/env node
// One packaged verification lane (#1512). It tests the exact archive this attempt's build job saved. The archive's SHA-256
// must match the build's report before Docker loads it, and the loaded image must match the archive's manifest and the
// reported identity before anything is built on it or tested.
import {createHash, randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {appendFile, mkdtemp, rm} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {archiveIdentity} from './archive.mjs';
import {command, imageIdentity, inspect} from './build.mjs';
import {LANES, invokedAsScript} from './packaged.mjs';

const SHA = /^[a-f0-9]{40}$/, IMAGE = /^sha256:[a-f0-9]{64}$/, HASH = /^[a-f0-9]{64}$/;
/** The build job's image metadata, as its output carries it. Anything else is refused. */
export function expectedImage(text, candidate) {
  let image;
  try {image = JSON.parse(text);} catch {throw new Error('release-verify-refused');}
  if (!image || typeof image !== 'object' || Object.keys(image).sort().join() !== 'archive,archiveSha256,id,revision'
    || !IMAGE.test(image.id) || image.revision !== candidate || image.archive !== 'production-image.tar.gz'
    || !HASH.test(image.archiveSha256)) throw new Error('release-verify-refused');
  return image;
}
/** The loaded image's identity, refused unless the archive is exactly the one the build reported. */
export async function loadedIdentity(archive, loaded, candidate, expected) {
  imageIdentity(loaded, candidate);
  const identity = await archiveIdentity(archive, loaded, candidate);
  if (identity.id !== expected.id || identity.archiveSha256 !== expected.archiveSha256) throw new Error('release-image-refused');
  return loaded.Id;
}
/** The archive file's SHA-256, read before Docker sees it. */
export async function fileSha256(path) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}
export async function verifyRelease(candidate, archive, lane, imageText = process.env.RELEASE_IMAGE) {
  if (!SHA.test(candidate) || !archive || resolve(archive) !== archive || !LANES.includes(lane)) throw new Error('release-verify-refused');
  const expected = expectedImage(imageText, candidate);
  const root = fileURLToPath(new URL('../../', import.meta.url));
  if (await command('git', ['-C', root, 'rev-parse', 'HEAD'], {capture: true}) !== candidate
    || await command('git', ['-C', root, 'status', '--porcelain', '--untracked-files=normal'], {capture: true}) !== '') throw new Error('release-source-refused');
  if (await fileSha256(archive) !== expected.archiveSha256) throw new Error('release-archive-refused');
  const loaded = (await command('docker', ['load', '--quiet', '--input', archive], {capture: true})).match(/sha256:[a-f0-9]{64}/g);
  if (loaded?.length !== 1) throw new Error('release-image-refused');
  const coreInfo = await inspect(loaded[0]);
  const core = await loadedIdentity(archive, coreInfo, candidate, expected);
  const identity = randomUUID(), coreTag = `bunny-release-${identity}:core`, testTag = `bunny-release-${identity}:test`;
  await command('docker', ['image', 'tag', core, coreTag]);
  // The derivative only adds the browser and the portable label. Its build reads nothing from its empty context.
  const context = await mkdtemp(join(tmpdir(), 'bunny-release-context-'));
  try {
    await command('docker', ['build', '--platform', 'linux/arm64', '--build-arg', `CORE_IMAGE=${coreTag}`,
      '--build-arg', `SOURCE_REVISION=${candidate}`, '-f', join(root, 'deploy/container/Dockerfile.verify'), '-t', testTag, context]);
  } finally {await rm(context, {recursive: true, force: true});}
  const testInfo = await inspect(testTag);
  const derivative = imageIdentity(testInfo, candidate, {derivative: true});
  if (!Array.isArray(coreInfo.RootFS?.Layers) || !Array.isArray(testInfo.RootFS?.Layers)
    || coreInfo.RootFS.Layers.some((layer, index) => testInfo.RootFS.Layers[index] !== layer)) throw new Error('release-parent-refused');
  // Test derivative reuses the exact immutable production parent. No host ports, mounts, credentials or devices.
  await command('docker', ['run', '--rm', '--init', '--name', `bunny-release-test-${identity}`, '--network', 'none', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges:true', '--env', 'TMPDIR=/tmp', '--env', 'XDG_RUNTIME_DIR=', '--env', 'DBUS_SESSION_BUS_ADDRESS=',
    '--entrypoint', '/usr/bin/timeout', derivative, '--signal=TERM', '--kill-after=30', '2700',
    '/usr/local/bin/node', 'scripts/release/packaged.mjs', lane]);
  if (imageIdentity(await inspect(core), candidate) !== core) throw new Error('release-image-refused');
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
    `### Packaged lane ${lane} passed\n\nTested archive: \`${expected.archiveSha256}\`, production manifest \`${expected.id}\`, loaded as \`${core}\`. Test derivative: \`${derivative}\`. Its immutable production layers match. No application rebuild runs in the derivative.\n`);
  return {lane, image: expected.id, derivative};
}
if (invokedAsScript(process.argv[1], import.meta.url)) {
  // Only this module's own refusal codes are printed; any other error's text stays out of the log.
  verifyRelease(...process.argv.slice(2)).catch(error => {
    const code = /^release-[a-z-]+$/.test(error?.message ?? '') ? `: ${error.message}` : '';
    process.stderr.write(`release-verify-failed${code}\n`); process.exitCode = 1;
  });
}
