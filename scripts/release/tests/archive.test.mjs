import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {gzipSync} from 'node:zlib';
import {savedImageMetadata} from '../build.mjs';

const candidate = 'a'.repeat(40);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value));
function checksum(header) {
  header.fill(32, 148, 156);
  const sum = header.reduce((total, byte) => total + byte, 0);
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
}
function tar(entries) {
  const chunks = [];
  for (const [name, bytes] of entries) {
    const header = Buffer.alloc(512);
    header.write(name); header.write('0000600\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116);
    header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124); header.write('00000000000\0', 136);
    header.fill(32, 148, 156); header[156] = 48; header.write('ustar\0' + '00', 257);
    checksum(header);
    chunks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  return Buffer.concat([...chunks, Buffer.alloc(1024)]);
}
function fixture({compressed = false, mutateConfig, mutateManifest, mutateIndex, mutateLegacy} = {}) {
  const layers = [Buffer.from('synthetic first production layer'), Buffer.from('synthetic second production layer')];
  const diffs = layers.map(bytes => 'sha256:' + hash(bytes));
  const config = {architecture: 'arm64', os: 'linux', config: {User: '1000:1000',
    Labels: {'org.opencontainers.image.revision': candidate}}, rootfs: {type: 'layers', diff_ids: diffs}};
  const productionConfig = structuredClone(config.config);
  mutateConfig?.(config);
  const configBytes = json(config), configId = 'sha256:' + hash(configBytes);
  const stored = compressed ? layers.map(bytes => gzipSync(bytes)) : layers;
  const descriptors = stored.map(bytes => ({mediaType: 'application/vnd.oci.image.layer.v1.tar' + (compressed ? '+gzip' : ''),
    digest: 'sha256:' + hash(bytes), size: bytes.length}));
  const manifest = {schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json',
    config: {mediaType: 'application/vnd.oci.image.config.v1+json', digest: configId, size: configBytes.length}, layers: structuredClone(descriptors)};
  mutateManifest?.(manifest);
  const manifestBytes = json(manifest), manifestId = 'sha256:' + hash(manifestBytes);
  const blob = digest => 'blobs/sha256/' + digest.slice(7);
  const index = {schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json',
    manifests: [{mediaType: manifest.mediaType, digest: manifestId, size: manifestBytes.length}]};
  mutateIndex?.(index);
  const legacy = [{Config: blob(configId), RepoTags: null, Layers: descriptors.map(layer => blob(layer.digest))}];
  mutateLegacy?.(legacy);
  const entries = [['oci-layout', json({imageLayoutVersion: '1.0.0'})], ['index.json', json(index)],
    ['manifest.json', json(legacy)], [blob(manifestId), manifestBytes], [blob(configId), configBytes],
    ...stored.map((bytes, i) => [blob(descriptors[i].digest), bytes])];
  const production = {Id: configId, Os: 'linux', Architecture: 'arm64', Config: productionConfig, RootFS: {Layers: diffs}};
  return {entries, production, manifestId, configId, config, manifest, index, legacy, blob};
}
async function archive(t, entries) {
  const root = await mkdtemp(join(tmpdir(), 'release-archive-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const bytes = gzipSync(tar(entries)), path = join(root, 'production-image.tar.gz');
  await writeFile(path, bytes, {mode: 0o600});
  return {path, archiveSha256: hash(bytes)};
}
test('producer metadata identifies the saved manifest rather than its local configuration ID', async t => {
  const f = fixture(), a = await archive(t, f.entries);
  assert.notEqual(f.configId, f.manifestId);
  assert.deepEqual(await savedImageMetadata(a.path, candidate, f.production), {id: f.manifestId, revision: candidate,
    archive: 'production-image.tar.gz', archiveSha256: a.archiveSha256});
});
test('gzip layer content digests remain distinct from verified uncompressed DiffIDs', async t => {
  const f = fixture({compressed: true}), a = await archive(t, f.entries);
  assert.notEqual(f.manifest.layers[0].digest, f.production.RootFS.Layers[0]);
  assert.equal((await savedImageMetadata(a.path, candidate, f.production)).id, f.manifestId);
});
test('producer-local manifest identity binds the same archive without changing the emitted fields', async t => {
  const f = fixture(), a = await archive(t, f.entries);
  f.production.Id = f.manifestId; f.production.Descriptor = {digest: f.manifestId};
  assert.deepEqual(Object.keys(await savedImageMetadata(a.path, candidate, f.production)).sort(), ['archive', 'archiveSha256', 'id', 'revision']);
});
test('an absent classic-store descriptor does not change the verified config binding', async t => {
  const f = fixture(), a = await archive(t, f.entries); f.production.Descriptor = null;
  assert.equal((await savedImageMetadata(a.path, candidate, f.production)).id, f.manifestId);
});
for (const [name, options] of [
  ['wrong archive source', {mutateConfig: value => {value.config.Labels['org.opencontainers.image.revision'] = 'b'.repeat(40);}}],
  ['wrong archive user', {mutateConfig: value => {value.config.User = 'root';}}],
  ['wrong archive architecture', {mutateConfig: value => {value.architecture = 'amd64';}}],
  ['wrong archive OS', {mutateConfig: value => {value.os = 'windows';}}],
  ['wrong ordered DiffIDs', {mutateConfig: value => {value.rootfs.diff_ids.reverse();}}],
  ['wrong manifest layer order', {mutateManifest: value => {value.layers.reverse();}}],
  ['missing manifest layer', {mutateManifest: value => {value.layers.pop();}}],
  ['missing config blob', {mutateManifest: value => {value.config.digest = 'sha256:' + 'f'.repeat(64);}}],
  ['wrong config size', {mutateManifest: value => {value.config.size++;}}],
  ['wrong manifest size', {mutateIndex: value => {value.manifests[0].size++;}}],
  ['ambiguous image manifests', {mutateIndex: value => {value.manifests.push(value.manifests[0]);}}],
  ['unknown index shape', {mutateIndex: value => {value.manifests[0].mediaType = 'application/vnd.oci.image.index.v1+json';}}],
  ['unsupported layer encoding', {mutateManifest: value => {value.layers[0].mediaType += '+zstd';}}],
  ['mislabeled gzip layer', {compressed: true, mutateManifest: value => {value.layers[0].mediaType = 'application/vnd.oci.image.layer.v1.tar';}}],
  ['wrong compatibility config', {mutateLegacy: value => {value[0].Config = 'blobs/sha256/' + 'f'.repeat(64);}}],
  ['wrong compatibility layer order', {mutateLegacy: value => {value[0].Layers.reverse();}}],
]) test(`producer refuses ${name}`, async t => {
  const f = fixture(options), a = await archive(t, f.entries);
  await assert.rejects(savedImageMetadata(a.path, candidate, f.production), /release-archive-refused/);
});
for (const name of ['config', 'manifest']) test(`producer refuses corrupted ${name} bytes under an unchanged digest`, async t => {
  const f = fixture(), id = name === 'config' ? f.configId : f.manifestId;
  f.entries.find(entry => entry[0] === f.blob(id))[1] = Buffer.from('different bytes');
  const a = await archive(t, f.entries);
  await assert.rejects(savedImageMetadata(a.path, candidate, f.production), /release-archive-refused/);
});
test('producer refuses an image outside the exact saved graph', async t => {
  const f = fixture(), a = await archive(t, f.entries);
  f.production.Id = 'sha256:' + 'f'.repeat(64);
  await assert.rejects(savedImageMetadata(a.path, candidate, f.production), /release-archive-refused/);
  f.production.Id = f.configId; f.production.Descriptor = {digest: 'sha256:' + 'f'.repeat(64)};
  await assert.rejects(savedImageMetadata(a.path, candidate, f.production), /release-archive-refused/);
});
for (const [name, mutate] of [
  ['duplicate entry', entries => {entries.push(entries[0]);}],
  ['unsafe path', entries => {entries.push(['../outside', Buffer.from('refuse')]);}],
  ['malformed JSON', entries => {entries.find(entry => entry[0] === 'index.json')[1] = Buffer.from('{');}],
  ['oversized metadata', entries => {entries.find(entry => entry[0] === 'index.json')[1] = Buffer.alloc(1024 ** 2 + 1, 32);}],
  ['too many entries', entries => {for (let i = 0; i < 513; i++) {const bytes = Buffer.from('entry-' + i); entries.push(['blobs/sha256/' + hash(bytes), bytes]);}}],
]) test(`archive reader refuses ${name}`, async t => {
  const f = fixture(); mutate(f.entries); const a = await archive(t, f.entries);
  await assert.rejects(savedImageMetadata(a.path, candidate, f.production), /release-archive-refused/);
});
for (const [name, mutate] of [
  ['invalid header checksum', bytes => {bytes[0] ^= 1; return bytes;}],
  ['link entry', bytes => {bytes[156] = 50; checksum(bytes.subarray(0, 512)); return bytes;}],
  ['unsupported PAX entry', bytes => {bytes[156] = 120; checksum(bytes.subarray(0, 512)); return bytes;}],
  ['non-ASCII entry name', bytes => {bytes[0] |= 128; checksum(bytes.subarray(0, 512)); return bytes;}],
  ['truncated archive', bytes => bytes.subarray(0, bytes.length - 1024)],
  ['nonzero trailing bytes', bytes => Buffer.concat([bytes, Buffer.from('unexpected')])],
]) test(`archive reader refuses ${name}`, async t => {
  const f = fixture(), a = await archive(t, f.entries);
  await writeFile(a.path, gzipSync(mutate(tar(f.entries))));
  await assert.rejects(savedImageMetadata(a.path, candidate, f.production), /release-archive-refused/);
});

for (const failure of ['CRC', 'truncated', 'already-aborted']) test(`archive ${failure} refusal settles within the archive deadline`, async t => {
  const f = fixture({compressed: true});
  if (failure === 'CRC') f.entries.at(-1)[1][f.entries.at(-1)[1].length - 8] ^= 1;
  if (failure === 'truncated') f.entries.at(-1)[1] = f.entries.at(-1)[1].subarray(0, -5);
  const a = await archive(t, f.entries);
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', `
    import assert from 'node:assert/strict';
    import {savedImageMetadata} from ${JSON.stringify(new URL('../build.mjs', import.meta.url).href)};
    const original = AbortSignal.timeout;
    AbortSignal.timeout = ${failure === 'already-aborted' ? "() => AbortSignal.abort(new Error('synthetic archive cancellation'))" : '() => original(50)'};
    const keepAlive = setInterval(() => {}, 100);
    try {
      await assert.rejects(savedImageMetadata(${JSON.stringify(a.path)}, ${JSON.stringify(candidate)},
        ${JSON.stringify(f.production)}), /release-archive-refused/);
      console.log('archive refusal settled');
    } finally { clearInterval(keepAlive); }
  `], {encoding: 'utf8', timeout: 3000, killSignal: 'SIGKILL'});
  assert.equal(child.error, undefined, `archive refusal did not settle: ${child.error?.code}`);
  assert.equal(child.signal, null, child.stderr);
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /archive refusal settled/);
});
// A packaged lane tests only the archive its own attempt's build reported (#1512).
test('a verification lane accepts only the exact archive the build reported, loaded as that image', async t => {
  const {expectedImage, loadedIdentity} = await import('../verify.mjs');
  const f = fixture(), a = await archive(t, f.entries);
  const reported = await savedImageMetadata(a.path, candidate, f.production);
  const expected = expectedImage(JSON.stringify(reported), candidate);
  assert.equal(await loadedIdentity(a.path, f.production, candidate, expected), f.configId);
  await assert.rejects(loadedIdentity(a.path, f.production, candidate, {...expected, archiveSha256: 'c'.repeat(64)}), /release-image-refused/);
  await assert.rejects(loadedIdentity(a.path, f.production, candidate, {...expected, id: 'sha256:' + 'c'.repeat(64)}), /release-image-refused/);
  const other = fixture({mutateConfig: value => {value.config.Labels.extra = 'another build';}}), b = await archive(t, other.entries);
  await assert.rejects(loadedIdentity(b.path, other.production, candidate, expected), /release-(image|archive)-refused/, 'another build of the same source');
  const reordered = structuredClone(f.production); reordered.RootFS.Layers.reverse();
  await assert.rejects(loadedIdentity(a.path, reordered, candidate, expected), /release-archive-refused/, 'a loaded image with other layers');
  await assert.rejects(loadedIdentity(a.path, {...f.production, Architecture: 'amd64'}, candidate, expected), /release-image-refused/);
  for (const text of ['', 'null', '{}', JSON.stringify({...reported, revision: 'b'.repeat(40)}), JSON.stringify({...reported, extra: 1}),
    JSON.stringify({...reported, archive: 'other.tar.gz'}), JSON.stringify({...reported, id: 'mutable:tag'})]) {
    assert.throws(() => expectedImage(text, candidate), /release-verify-refused/, text);
  }
});
