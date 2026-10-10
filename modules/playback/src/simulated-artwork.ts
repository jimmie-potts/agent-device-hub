/** Explicitly selected synthetic artwork only: never fetches a network address. */
import {artworkFailure, artworkUrl, type ArtworkFetch} from './artwork-fetch.js';
import type {SonyReply} from './transport.js';
export const SIMULATED_ARTWORK_MARKER = 'synthetic-playback-artwork';
export const SIMULATED_ARTWORK_PATH = '/synthetic/playback-artwork.png';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQsUn5DwAC0AG0vqck9wAAAABJRU5ErkJggg==', 'base64');

export const simulatedArtworkFetch: ArtworkFetch = (candidate, endpoint, signal) => {
  if (signal.aborted) return Promise.resolve(artworkFailure('unavailable'));
  const url = artworkUrl(candidate, endpoint);
  if (url === undefined || new URL(url).pathname !== SIMULATED_ARTWORK_PATH || new URL(url).search !== '') return Promise.resolve(artworkFailure('unsupported'));
  return Promise.resolve({ok: true, value: new Uint8Array(PNG)});
};

/** The supervisor passes an inert marker; the client binds it to its configured Sony origin. */
export function simulatedArtworkReply(reply: SonyReply, endpoint: string): SonyReply {
  if (!('result' in reply)) return reply;
  const copy = structuredClone(reply);
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    if (typeof value !== 'object' || value === null || !('content' in value)) return;
    const content = value.content;
    if (typeof content === 'object' && content !== null && 'thumbnailUrl' in content && content.thumbnailUrl === SIMULATED_ARTWORK_MARKER) {
      content.thumbnailUrl = `${new URL(endpoint).origin}${SIMULATED_ARTWORK_PATH}`;
    }
  };
  visit(copy.result);
  return copy;
}
