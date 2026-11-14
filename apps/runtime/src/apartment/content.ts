import {lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {errorBody, type ErrorBody, type ErrorCode} from '@jimmie-potts/event-contracts/v2';
import type {ModuleContent, ModuleContentRequest} from '@jimmie-potts/sdk';
import {apartmentDigest, MAX_APARTMENT_BYTES, MAX_APARTMENT_IMAGE_BYTES, parseApartmentModel, type ApartmentModel} from '../apartment-model.js';
import {PrivateFileError, readPrivateFile} from '../state.js';
import {validApartmentArtwork} from './artwork.js';

export const apartmentDirectory = (coreFolder: string): string => join(coreFolder, 'apartment');
export const apartmentActiveFile = (directory: string): string => join(directory, 'active.json');
export const apartmentAssetFile = (directory: string, digest: string): string => join(directory, 'assets', digest + '.png');

export class ApartmentRefusal extends Error {
  constructor(readonly code: ErrorCode, detail?: string) {
    super(detail);
  }
}

export async function requireApartmentDirectory(directory: string): Promise<void> {
  const status = await lstat(directory);
  if (!status.isDirectory() || status.uid !== process.getuid?.() || (status.mode & 0o077) !== 0) {
    throw new ApartmentRefusal('forbidden');
  }
}

export function apartmentErrorCode(error: unknown): ErrorCode {
  if (error instanceof ApartmentRefusal) return error.code;
  if (error instanceof PrivateFileError) {
    if (error.problem === 'missing') return 'not-found';
    if (error.problem === 'too-large') return 'too-large';
    return 'forbidden';
  }
  if (error instanceof Error && 'code' in error) {
    if (error.code === 'ENOENT') return 'not-found';
    if (error.code === 'EACCES' || error.code === 'EPERM') return 'forbidden';
    if (error.code === 'ENOSPC' || error.code === 'EDQUOT') return 'capacity';
  }
  return 'internal';
}

export function readApartmentJson(bytes: Uint8Array): unknown {
  try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
  catch { throw new ApartmentRefusal('invalid-request', 'Invalid prepared JSON.'); }
}

export async function readApartmentDocument(file: string): Promise<{bytes: Buffer; model: ApartmentModel}> {
  const bytes = await readPrivateFile(file, MAX_APARTMENT_BYTES);
  const model = parseApartmentModel(readApartmentJson(bytes));
  if (model === undefined) throw new ApartmentRefusal('invalid-request', 'Invalid apartment geometry or asset references.');
  return {bytes, model};
}

export async function readApartmentContent(
  coreFolder: () => string, ref: string, lifetime: AbortSignal, request?: ModuleContentRequest,
): Promise<ModuleContent | ErrorBody | undefined> {
  const prefix = 'apartment-art-';
  if (ref !== 'apartment-model' && !ref.startsWith(prefix)) return undefined;
  const aborted = (): boolean => lifetime.aborted || request?.signal.aborted === true;
  if (aborted()) return errorBody('cancelled');
  if (request !== undefined && Object.keys(request.query).length !== 0) return errorBody('invalid-request');
  const digest = ref === 'apartment-model' ? undefined : ref.slice(prefix.length);
  if (digest !== undefined && !apartmentDigest(digest)) return errorBody('invalid-request');
  try {
    const directory = apartmentDirectory(coreFolder());
    await requireApartmentDirectory(directory);
    const {model} = await readApartmentDocument(apartmentActiveFile(directory));
    if (aborted()) return errorBody('cancelled');
    if (digest === undefined) return {type: 'application/json', bytes: Buffer.from(JSON.stringify(model))};
    const image = model.artwork.find(asset => asset.id === digest);
    if (image === undefined) return errorBody('not-found');
    await requireApartmentDirectory(join(directory, 'assets'));
    const bytes = await readPrivateFile(apartmentAssetFile(directory, digest), MAX_APARTMENT_IMAGE_BYTES);
    if (aborted()) return errorBody('cancelled');
    if (!validApartmentArtwork(bytes, image)) return errorBody('invalid-request');
    return {type: 'image/png', bytes};
  } catch (error) {
    return errorBody(aborted() ? 'cancelled' : apartmentErrorCode(error));
  }
}
