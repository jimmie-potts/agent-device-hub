import {lstat, mkdir, rename, rm} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {MAX_APARTMENT_BYTES, MAX_APARTMENT_IMAGE_BYTES, apartmentDigest, type ApartmentImage} from '../apartment-model.js';
import {takeExistingLock} from '../core/lock.js';
import {checkStateDirectory, PrivateFileError, readPrivateFile} from '../state.js';
import {apartmentSha256, validApartmentArtwork} from './artwork.js';
import {stageApartmentFile, syncApartmentDirectory} from './files.js';
import {
  ApartmentRefusal, apartmentActiveFile, apartmentAssetFile, apartmentDirectory, readApartmentDocument, requireApartmentDirectory,
} from './content.js';

async function ifMissing<T>(task: Promise<T>): Promise<T | undefined> {
  try { return await task; }
  catch (error) {
    if (error instanceof PrivateFileError ? error.problem === 'missing' : error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function createDirectory(path: string, sync: typeof syncApartmentDirectory): Promise<void> {
  if (await ifMissing(lstat(path)) === undefined) await mkdir(path,{mode:0o700});
  await requireApartmentDirectory(path);
  // A previous helper may have created the directory before it could sync its parent.
  await sync(dirname(path));
}

async function writeVersion(
  file: string, bytes: Buffer, sync: typeof syncApartmentDirectory, afterAssetRename?: () => void | Promise<void>,
): Promise<void> {
  const existing = await ifMissing(readPrivateFile(file,bytes.length));
  if (existing !== undefined) {
    if (!existing.equals(bytes)) throw new ApartmentRefusal('invalid-state', 'An immutable apartment file differs from its expected digest.');
  } else {
    const temporary = await stageApartmentFile(file,bytes);
    try {
      await rename(temporary,file);
      await afterAssetRename?.();
    } finally { await rm(temporary,{force:true}).catch(() => {}); }
  }
  // A matching visible name is insufficient if the previous writer stopped before syncing.
  await sync(dirname(file));
}

async function checkedAsset(file: string, image: ApartmentImage): Promise<Buffer> {
  const bytes = await readPrivateFile(file,MAX_APARTMENT_IMAGE_BYTES);
  if (!validApartmentArtwork(bytes,image)) throw new ApartmentRefusal('invalid-request', 'Invalid prepared artwork.');
  return bytes;
}

async function installedDirectory(stateDir: string): Promise<string> {
  const state = await checkStateDirectory(stateDir);
  await requireApartmentDirectory(state);
  await requireApartmentDirectory(join(state,'modules'));
  const marker = await ifMissing(lstat(join(state,'modules','core.sqlite-owner')));
  if (marker === undefined || !marker.isFile() || marker.uid !== process.getuid?.() || marker.nlink !== 1
    || marker.size !== 0 || (marker.mode & 0o7777) !== 0o600) {
    throw new ApartmentRefusal('forbidden','The selected state has no safe existing core lease.');
  }
  return state;
}

export async function activeApartmentDigest(stateDir: string): Promise<string | null> {
  const state = await installedDirectory(stateDir);
  const folder = join(state,'modules','core');
  if (await ifMissing(lstat(folder)) === undefined) return null;
  await requireApartmentDirectory(folder);
  const directory = apartmentDirectory(folder);
  if (await ifMissing(lstat(directory)) === undefined) return null;
  await requireApartmentDirectory(directory);
  const active = await ifMissing(readApartmentDocument(apartmentActiveFile(directory)));
  return active === undefined ? null : apartmentSha256(active.bytes);
}

type PublishRequest = {stateDir: string; candidate: string; expected: string | null; signal?: AbortSignal};
/** Fault checkpoints are injected only in disposable tests of the real file/lease path. */
type PublicationChecks = {
  afterAssetRename?: () => void | Promise<void>;
  beforeActivate?: () => void | Promise<void>;
  afterActivate?: () => void | Promise<void>;
  confirmDirectory?: (directory: string) => Promise<void>;
};

export async function publishApartment(
  {stateDir,candidate,expected,signal}: PublishRequest, checks?: PublicationChecks,
): Promise<{digest: string; previous: string | null}> {
  if (expected !== null && !apartmentDigest(expected)) throw new ApartmentRefusal('invalid-request', 'Invalid expected active digest.');
  const state = await installedDirectory(stateDir);
  const {bytes,model} = await readApartmentDocument(candidate);
  const digest = apartmentSha256(bytes);
  const originalAssets = join(dirname(candidate),'assets');
  const preparedAssets = new Map<string,Buffer>();
  if (model.artwork.length > 0) await requireApartmentDirectory(originalAssets);
  for (const image of model.artwork) {
    preparedAssets.set(image.id,await checkedAsset(join(originalAssets,image.id+'.png'),image));
  }

  let lease;
  try { lease = await takeExistingLock(join(state,'modules','core.sqlite')); }
  catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApartmentRefusal('unavailable','The runtime state lease is held.');
    }
    throw new ApartmentRefusal('forbidden','The existing core lease could not be opened safely.');
  }
  const cancelled = (): void => {
    if (signal?.aborted === true) throw new ApartmentRefusal('cancelled','Publication stopped before activation.');
  };
  const confirm = checks?.confirmDirectory ?? syncApartmentDirectory;
  let activationAttempted = false;
  try {
    cancelled();
    const core = join(state,'modules','core');
    if (await ifMissing(lstat(core)) !== undefined) await requireApartmentDirectory(core);
    const directory = apartmentDirectory(core);
    if (await ifMissing(lstat(directory)) !== undefined) await requireApartmentDirectory(directory);
    const activeFile = apartmentActiveFile(directory);
    const active = await ifMissing(readApartmentDocument(activeFile));
    const previous = active === undefined ? null : apartmentSha256(active.bytes);
    if (previous !== expected) throw new ApartmentRefusal('revision-conflict','Read the active digest and review the candidate before publishing.');
    if (active !== undefined && active.model.artwork.length > 0) {
      const assets = join(directory,'assets');
      await requireApartmentDirectory(assets);
      for (const image of active.model.artwork) await checkedAsset(apartmentAssetFile(directory,image.id),image);
      await confirm(assets);
    }
    await createDirectory(core,confirm);
    await createDirectory(directory,confirm);
    if (previous === digest) {
      // A retry after an interrupted activation can see the digest before it is durable.
      activationAttempted = true;
      try { await confirm(directory); }
      catch { throw new ApartmentRefusal('uncertain-result','Read the active digest before trying again.'); }
      return {digest,previous};
    }
    if (preparedAssets.size > 0) await createDirectory(join(directory,'assets'),confirm);
    for (const [id,data] of preparedAssets) {
      cancelled();
      await writeVersion(apartmentAssetFile(directory,id),data,confirm,checks?.afterAssetRename);
    }
    if (active !== undefined && previous !== null) {
      const versions = join(directory,'versions');
      await createDirectory(versions,confirm);
      await writeVersion(join(versions,previous+'.json'),active.bytes,confirm);
    }
    const temporary = await stageApartmentFile(activeFile,bytes);
    try {
      await checks?.beforeActivate?.();
      cancelled();
      activationAttempted = true;
      await rename(temporary,activeFile);
      await checks?.afterActivate?.();
      await confirm(directory);
      const stored = await readPrivateFile(activeFile,MAX_APARTMENT_BYTES);
      if (!stored.equals(bytes)) throw new Error('apartment readback mismatch');
      return {digest,previous};
    } catch (error) {
      if (activationAttempted) throw new ApartmentRefusal('uncertain-result','Read the active digest before trying again.');
      throw error;
    } finally { await rm(temporary,{force:true}).catch(() => {}); }
  } finally {
    try { lease.release(); }
    catch (error) {
      if (activationAttempted) throw new ApartmentRefusal('uncertain-result','Read the active digest before trying again.');
      throw error;
    }
  }
}
