import {createHash} from 'node:crypto';
import {crc32, inflateSync} from 'node:zlib';
import {apartmentPngSize, type ApartmentImage} from '../apartment-model.js';

export const apartmentSha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** Prepared artwork is one static, noninterlaced RGB/RGBA PNG with no ancillary chunks. */
export function validApartmentArtwork(bytes: Buffer, image: ApartmentImage): boolean {
  const dimensions = apartmentPngSize(bytes);
  if (bytes.byteLength !== image.bytes || dimensions?.width !== image.width || dimensions.height !== image.height
    || crc32(bytes.subarray(12, 29)) !== bytes.readUInt32BE(29) || apartmentSha256(bytes) !== image.id) return false;
  const compressed: Uint8Array[] = [];
  for (let offset = 33; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    const start = offset + 8, end = start + length;
    if (end + 4 > bytes.length || crc32(bytes.subarray(offset + 4, end)) !== bytes.readUInt32BE(end)) return false;
    const type = bytes.toString('latin1', offset + 4, start);
    offset = end + 4;
    if (type === 'IDAT' && length > 0 && compressed.length < 128) compressed.push(bytes.subarray(start, end));
    else if (type === 'IEND' && length === 0 && offset === bytes.length && compressed.length > 0) {
      const stride = 1 + image.width * (bytes[25] === 2 ? 3 : 4);
      const maxOutputLength = stride * image.height;
      try {
        const input = Buffer.concat(compressed);
        const result: unknown = inflateSync(input, {maxOutputLength, info: true});
        if (typeof result !== 'object' || result === null || !('buffer' in result) || !Buffer.isBuffer(result.buffer)
          || !('engine' in result) || typeof result.engine !== 'object' || result.engine === null || !('bytesWritten' in result.engine)
          || result.engine.bytesWritten !== input.length || result.buffer.length !== maxOutputLength) return false;
        const {buffer} = result;
        for (let row = 0; row < buffer.length; row += stride) {
          if (buffer.readUInt8(row) > 4) return false;
        }
        return true;
      } catch { return false; }
    } else return false;
  }
  return false;
}
