import type {ErrorCode} from '@jimmie-potts/event-contracts/v2';
import type {PlaybackArtwork} from '@jimmie-potts/event-contracts/v2/families';
import {nowPlayingFrame, type CardView} from './nowplaying.js';
import type {Frame} from './render.js';
import {decodeArtwork} from './artwork-png.js';
export type ArtworkCardReply = {frame: Frame; artworkCode?: ErrorCode};

/** The default text entry point remains synchronous; decoding belongs to the worker. */
export async function renderArtworkCard(view: CardView, artwork?: PlaybackArtwork): Promise<ArtworkCardReply> {
  const decoded = await decodeArtwork(artwork);
  if (decoded.status === 'fallback') return {frame: nowPlayingFrame(view), ...(decoded.code === undefined ? {} : {artworkCode: decoded.code})};
  const frame = nowPlayingFrame(view, true);
  for (let y = 0; y < 24; y += 1) for (let x = 0; x < 24; x += 1) {
    const source = (y * 24 + x) * 3, target = ((y + 8) * 64 + x) * 3;
    for (let channel = 0; channel < 3; channel += 1) {
      const value = decoded.rgb[source + channel] ?? 0;
      frame.rgb[target + channel] = view.stale ? Math.floor(value / 3) : value;
    }
  }
  return {frame};
}
