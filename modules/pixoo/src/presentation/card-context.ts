import {createHash} from 'node:crypto';
import type {PlaybackArtwork} from '@jimmie-potts/event-contracts/v2/families';
/** Private renderer input; never part of the browser-facing playback view. */
export type CardContext = {observation: string; artwork?: PlaybackArtwork};
/** Equality of the image input, independent of its observation generation. */
export function artworkKey(artwork?: PlaybackArtwork): string {
  return artwork?.status === 'ready'
    ? createHash('sha256').update(JSON.stringify([artwork.mediaType, artwork.width, artwork.height, artwork.base64])).digest('hex')
    : 'text';
}
