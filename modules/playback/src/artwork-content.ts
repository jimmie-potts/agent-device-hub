/** Passive content from the owner's already normalized current image. Never acquires or decodes pixels. */
import type {PlaybackArtwork, PlaybackState} from '@jimmie-potts/event-contracts/v2/families';
import type {ModuleContent} from '@jimmie-potts/sdk';

const MAX_BYTES = 65_536, MAX_BASE64 = Math.ceil(MAX_BYTES / 3) * 4;
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const REF = /^artwork\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([1-9][0-9]{0,15})$/;
export type CurrentArtworkRead = {
  record: PlaybackState | undefined;
  current: PlaybackArtwork | undefined;
  stopped: boolean;
  presentedSonyIsEligible: boolean;
  presentedMetadataMatchesRecord: boolean;
};

/** Only static, singly framed PNG output with matching declared dimensions. Pixel validity belongs to the producer. */
function staticPng(bytes: Buffer, width: number, height: number): boolean {
  if (!bytes.subarray(0, 8).equals(SIGNATURE)) return false;
  let offset = 8, header = false, data = false;
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset), kind = bytes.toString('ascii', offset + 4, offset + 8);
    if (size > bytes.length - offset - 12) return false;
    if (!header && (kind !== 'IHDR' || size !== 13)) return false;
    if (kind === 'IHDR') {
      if (header || size !== 13 || bytes.readUInt32BE(offset + 8) !== width || bytes.readUInt32BE(offset + 12) !== height) return false;
      const depth = bytes[offset + 16], color = bytes[offset + 17];
      const depths: Readonly<Record<number, readonly number[]>> = {0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16]};
      if (color === undefined || depth === undefined || depths[color]?.includes(depth) !== true
        || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || (bytes[offset + 20] !== 0 && bytes[offset + 20] !== 1)) return false;
      header = true;
    }
    if (kind === 'acTL' || kind === 'fcTL' || kind === 'fdAT') return false;
    if (kind === 'IDAT') data = true;
    offset += size + 12;
    if (kind === 'IEND') return size === 0 && data && offset === bytes.length;
  }
  return false;
}

/** Safe missing content for every retired, mismatched or malformed reference. */
export function readArtworkContent(ref: string, state: CurrentArtworkRead): ModuleContent | undefined {
  if (typeof ref !== 'string' || ref.length > 128 || state.stopped || !state.presentedSonyIsEligible || !state.presentedMetadataMatchesRecord) return undefined;
  const match = REF.exec(ref), record = state.record, image = state.current;
  if (match === null || record === undefined || image?.status !== 'ready' || record.artwork?.status !== 'ready'
    || record.availability !== 'available' || record.playback.status !== 'known'
    || (record.playback.player !== 'playing' && record.playback.player !== 'paused')) return undefined;
  const revision = Number(match[2]), committed = record.artwork;
  if (!Number.isSafeInteger(revision) || revision !== record.revision || match[1] !== committed.generation
    || image.generation !== committed.generation || image.mediaType !== 'image/png' || committed.mediaType !== 'image/png'
    || image.width !== committed.width || image.height !== committed.height || image.base64 !== committed.base64) return undefined;
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.width > 128 || image.height < 1 || image.height > 128
    || typeof image.base64 !== 'string' || image.base64.length === 0 || image.base64.length > MAX_BASE64
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.base64)) return undefined;
  const bytes = Buffer.from(image.base64, 'base64');
  if (bytes.byteLength > MAX_BYTES || bytes.toString('base64') !== image.base64 || !staticPng(bytes, image.width, image.height)) return undefined;
  return {type: 'image/png', bytes: new Uint8Array(bytes)};
}
