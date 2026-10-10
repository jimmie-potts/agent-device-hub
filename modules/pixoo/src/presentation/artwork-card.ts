import type {ErrorCode} from '@jimmie-potts/event-contracts/v2';
import type {PlaybackArtwork} from '@jimmie-potts/event-contracts/v2/families';
import {renderNowPlaying, type NowPlayingView} from './now-playing.js';
type CardView = Extract<NowPlayingView, {card: true}>;
import {decodeArtwork} from './artwork-png.js';
export type ArtworkCardReply = {frame: Uint8Array; artworkCode?: ErrorCode};

/** The default text entry point remains synchronous; decoding belongs to the worker. */
export async function renderArtworkCard(view: CardView, artwork?: PlaybackArtwork): Promise<ArtworkCardReply> {
  const decoded = await decodeArtwork(artwork);
  if (decoded.status === 'fallback') return {frame: renderNowPlaying(view), ...(decoded.code === undefined ? {} : {artworkCode: decoded.code})};
  const frame = renderNowPlaying(view, true);
  for (let y = 0; y < 24; y += 1) for (let x = 0; x < 24; x += 1) {
    const source = (y * 24 + x) * 3, target = ((y + 13) * 64 + x) * 3;
    for (let channel = 0; channel < 3; channel += 1) {
      const value = decoded.rgb[source + channel] ?? 0;
      frame[target + channel] = view.stale ? Math.floor(value / 3) : value;
    }
  }
  return {frame};
}
