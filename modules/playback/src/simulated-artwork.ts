/** Explicitly selected synthetic artwork only: never fetches a network address. */
import {artworkFailure, artworkUrl, type ArtworkFetch} from './artwork-fetch.js';
import type {SonyReply} from './transport.js';
export const SIMULATED_ARTWORK_MARKER = 'synthetic-playback-artwork';
export const SIMULATED_ARTWORK_PATH = '/synthetic/playback-artwork.png';
export const SIMULATED_ARTWORK_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQsUn5DwAC0AG0vqck9wAAAABJRU5ErkJggg==';

/** Candidate validation stays local: only an explicit synthetic marker may cross the simulation link. */
export function simulatedArtworkCandidate(candidate: string, endpoint: string): boolean {
  const url = artworkUrl(candidate, endpoint);
  return url !== undefined && new URL(url).pathname === SIMULATED_ARTWORK_PATH && new URL(url).search === '';
}

export function createSimulatedArtworkFetch(acquired: () => void = () => {}): ArtworkFetch {
  return (candidate, endpoint, signal) => {
    if (signal.aborted) return Promise.resolve(artworkFailure('unavailable'));
    if (!simulatedArtworkCandidate(candidate, endpoint)) return Promise.resolve(artworkFailure('unsupported'));
    acquired();
    return Promise.resolve({ok: true, value: new Uint8Array(Buffer.from(SIMULATED_ARTWORK_BASE64, 'base64'))});
  };
}
export const simulatedArtworkFetch = createSimulatedArtworkFetch();

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
