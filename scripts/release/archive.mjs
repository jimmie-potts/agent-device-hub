import {constants} from 'node:fs';
import {open, lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Transform, Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGunzip} from 'node:zlib';
import {isDeepStrictEqual} from 'node:util';

const MAX_BYTES = 8 * 1024 ** 3, MAX_ENTRIES = 512, MAX_JSON = 1024 ** 2, MAX_METADATA = 8 * MAX_JSON;
const MANIFEST = 'application/vnd.oci.image.manifest.v1+json', CONFIG = 'application/vnd.oci.image.config.v1+json';
const LAYER = 'application/vnd.oci.image.layer.v1.tar', DIGEST = /^sha256:[a-f0-9]{64}$/;
const refuse = () => {throw new Error('release-archive-refused');};
const hash = () => createHash('sha256');
const keys = (value, required, optional = []) => value && typeof value === 'object' && !Array.isArray(value)
  && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => [...required, ...optional].includes(key));
const same = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
function field(header, start, size) {
  const bytes = header.subarray(start, start + size), end = bytes.indexOf(0);
  if (bytes.some(byte => byte > 127) || end !== -1 && bytes.subarray(end).some(byte => byte !== 0)) refuse();
  return bytes.subarray(0, end === -1 ? size : end).toString('ascii');
}
function octal(header, start, size) {
  if (header.subarray(start, start + size).some(byte => byte > 127)) refuse();
  const value = header.subarray(start, start + size).toString('ascii');
  if (!/^ *[0-7]+[\0 ]*$/.test(value)) refuse();
  const number = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(number)) refuse();
  return number;
}
async function readArchive(path, signal) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let input, compressed, decoded, transfer;
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size > MAX_BYTES || !same(before, await lstat(path))) refuse();
    let encodedBytes = 0, decodedBytes = 0, expandedBytes = 0, retainedBytes = 0;
    const archiveHash = hash();
    input = file.createReadStream({autoClose: false});
    compressed = new Transform({transform(chunk, encoding, done) {
      encodedBytes += chunk.length;
      if (encodedBytes > MAX_BYTES) return done(new Error('release-archive-refused'));
      archiveHash.update(chunk); done(null, chunk);
    }});
    decoded = createGunzip();
    transfer = pipeline(input, compressed, decoded, {signal});
    transfer.catch(() => {});
    const iterator = decoded[Symbol.asyncIterator]();
    let chunk = Buffer.alloc(0), offset = 0;
    async function next() {
      const result = await iterator.next();
      if (result.done) return false;
      chunk = result.value; offset = 0; decodedBytes += chunk.length;
      if (decodedBytes > MAX_BYTES) refuse();
      return true;
    }
    async function consume(size, visit) {
      while (size > 0) {
        if (offset === chunk.length && !await next()) refuse();
        const count = Math.min(size, chunk.length - offset);
        await visit(chunk.subarray(offset, offset + count)); offset += count; size -= count;
      }
    }
    async function bytes(size) {
      const pieces = []; await consume(size, piece => {pieces.push(piece);}); return Buffer.concat(pieces, size);
    }
    const entries = new Map(), names = new Set();
    for (;;) {
      const header = await bytes(512);
      if (header.every(byte => byte === 0)) {
        if ((await bytes(512)).some(byte => byte !== 0)) refuse();
        do {if (chunk.subarray(offset).some(byte => byte !== 0)) refuse();} while (await next());
        if (decodedBytes % 512 !== 0) refuse();
        break;
      }
      if (names.size >= MAX_ENTRIES || header.subarray(257, 265).toString('ascii') !== 'ustar\0' + '00'
        || field(header, 345, 155) !== '') refuse();
      const checksum = header.reduce((sum, byte, i) => sum + (i >= 148 && i < 156 ? 32 : byte), 0);
      if (checksum !== octal(header, 148, 8)) refuse();
      const name = field(header, 0, 100), size = octal(header, 124, 12), type = header[156];
      if (names.has(name) || size > MAX_BYTES) refuse();
      names.add(name);
      if (type === 53) {
        if (!['blobs/', 'blobs/sha256/'].includes(name) || size !== 0) refuse();
        continue;
      }
      if (![0, 48].includes(type) || !/^(?:oci-layout|index\.json|manifest\.json|blobs\/sha256\/[a-f0-9]{64})$/.test(name)) refuse();
      const keep = size <= MAX_JSON;
      if (keep && (retainedBytes += size) > MAX_METADATA) refuse();
      const pieces = [], digest = hash(), diff = hash();
      const prefix = await bytes(Math.min(2, size)), gzip = prefix[0] === 31 && prefix[1] === 139;
      let expand, expansion;
      const expanded = piece => {
        expandedBytes += piece.length;
        if (expandedBytes > MAX_BYTES) refuse();
        diff.update(piece);
      };
      if (gzip) {
        expand = createGunzip();
        const sink = new Writable({write(piece, encoding, done) {try {expanded(piece); done();} catch (error) {done(error);}}});
        expansion = pipeline(expand, sink, {signal}); expansion.catch(() => {});
      }
      async function body(piece) {
        digest.update(piece); if (keep) pieces.push(piece);
        if (expand) await new Promise((resolve, reject) => {
          let settled = false;
          const done = error => {
            if (settled) return;
            settled = true;
            expand.removeListener('error', done); expand.removeListener('close', closed);
            signal.removeEventListener('abort', aborted);
            if (error) reject(error); else resolve();
          };
          const closed = () => done(new Error('release-archive-refused'));
          const aborted = () => done(signal.reason);
          expand.once('error', done); expand.once('close', closed);
          signal.addEventListener('abort', aborted, {once: true});
          if (signal.aborted) aborted();
          else if (expand.destroyed) closed();
          else expand.write(piece, done);
        });
        else expanded(piece);
      }
      try {
        await body(prefix); await consume(size - prefix.length, body);
        if (expand) {expand.end(); await expansion;}
      } finally {expand?.destroy(); await expansion?.catch(() => {});}
      await consume((512 - size % 512) % 512, piece => {if (piece.some(byte => byte !== 0)) refuse();});
      const id = 'sha256:' + digest.digest('hex');
      if (name.startsWith('blobs/') && name !== 'blobs/sha256/' + id.slice(7)) refuse();
      entries.set(name, {id, size, gzip, diffId: 'sha256:' + diff.digest('hex'), bytes: keep ? Buffer.concat(pieces, size) : undefined});
    }
    await transfer;
    if (encodedBytes !== before.size || !same(before, await file.stat()) || !same(before, await lstat(path))) refuse();
    return {entries, archiveSha256: archiveHash.digest('hex')};
  } finally {
    input?.destroy(); compressed?.destroy(); decoded?.destroy(); await transfer?.catch(() => {}); await file.close();
  }
}
function json(entry) {if (!entry?.bytes) refuse(); return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(entry.bytes));}
function descriptor(entries, value, mediaTypes) {
  if (!keys(value, ['mediaType', 'digest', 'size']) || !mediaTypes.includes(value.mediaType) || !DIGEST.test(value.digest)
    || !Number.isSafeInteger(value.size) || value.size < 0) refuse();
  const entry = entries.get('blobs/sha256/' + value.digest.slice(7));
  if (!entry || entry.id !== value.digest || entry.size !== value.size) refuse();
  return entry;
}
function identity(entries, production, candidate) {
  const layout = json(entries.get('oci-layout')), index = json(entries.get('index.json'));
  if (!keys(layout, ['imageLayoutVersion']) || layout.imageLayoutVersion !== '1.0.0'
    || !keys(index, ['schemaVersion', 'mediaType', 'manifests']) || index.schemaVersion !== 2
    || index.mediaType !== 'application/vnd.oci.image.index.v1+json' || !Array.isArray(index.manifests) || index.manifests.length !== 1) refuse();
  const selected = descriptor(entries, index.manifests[0], [MANIFEST]), manifest = json(selected);
  if (!keys(manifest, ['schemaVersion', 'mediaType', 'config', 'layers']) || manifest.schemaVersion !== 2 || manifest.mediaType !== MANIFEST
    || !Array.isArray(manifest.layers) || manifest.layers.length > 128) refuse();
  const configuration = descriptor(entries, manifest.config, [CONFIG]), config = json(configuration);
  if (config.os !== 'linux' || config.architecture !== 'arm64' || config.config?.User !== '1000:1000'
    || config.config?.Labels?.['org.opencontainers.image.revision'] !== candidate || config.rootfs?.type !== 'layers'
    || !Array.isArray(config.rootfs.diff_ids) || !config.rootfs.diff_ids.every(value => DIGEST.test(value))
    || config.rootfs.diff_ids.length !== manifest.layers.length || !isDeepStrictEqual(config.rootfs.diff_ids, production.RootFS?.Layers)
    || ![configuration.id, selected.id].includes(production.Id)
    || production.Descriptor != null && production.Descriptor?.digest !== selected.id) refuse();
  for (const [i, value] of manifest.layers.entries()) {
    const layer = descriptor(entries, value, [LAYER, LAYER + '+gzip']);
    if (layer.gzip !== (value.mediaType === LAYER + '+gzip') || layer.diffId !== config.rootfs.diff_ids[i]) refuse();
  }
  const legacy = json(entries.get('manifest.json'));
  if (!Array.isArray(legacy) || legacy.length !== 1 || !keys(legacy[0], ['Config', 'RepoTags', 'Layers'], ['LayerSources'])
    || legacy[0].Config !== 'blobs/sha256/' + configuration.id.slice(7)
    || !(legacy[0].RepoTags === null || Array.isArray(legacy[0].RepoTags) && legacy[0].RepoTags.length === 0)
    || !Array.isArray(legacy[0].Layers) || legacy[0].Layers.length !== config.rootfs.diff_ids.length) refuse();
  for (const [i, path] of legacy[0].Layers.entries()) {
    if (!/^blobs\/sha256\/[a-f0-9]{64}$/.test(path) || entries.get(path)?.diffId !== config.rootfs.diff_ids[i]) refuse();
  }
  if (legacy[0].LayerSources !== undefined) {
    const sources = legacy[0].LayerSources;
    if (!keys(sources, Object.keys(sources ?? {})) || !isDeepStrictEqual(Object.keys(sources).sort(), [...new Set(legacy[0].Layers.map(path => 'sha256:' + path.slice(13)))].sort())) refuse();
    for (const [id, value] of Object.entries(sources)) {if (id !== value?.digest) refuse(); descriptor(entries, value, [LAYER, LAYER + '+gzip']);}
  }
  return selected.id;
}
export async function archiveIdentity(path, production, candidate) {
  try {
    const {entries, archiveSha256} = await readArchive(path, AbortSignal.timeout(120000));
    return {id: identity(entries, production, candidate), archiveSha256};
  } catch {refuse();}
}
