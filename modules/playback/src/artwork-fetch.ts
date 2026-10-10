/** Sony artwork IO: private URLs enter here and only bounded bytes or fixed failures leave. */
export const ARTWORK_INPUT_BYTES = 1_048_576;
export const ARTWORK_FETCH_MS = 2000;
export const ARTWORK_DECODE_MS = 2000;
export type ArtworkFailure = {ok: false; code: 'unsupported' | 'capacity' | 'unavailable' | 'invalid-response'; transient: boolean};
export type ArtworkResult<T> = {ok: true; value: T} | ArtworkFailure;
export const artworkFailure = (code: ArtworkFailure['code'], transient = false): ArtworkFailure => ({ok: false, code, transient});
export type ArtworkFetch = (candidate: string, endpoint: string, signal: AbortSignal) => Promise<ArtworkResult<Uint8Array>>;

/** Absolute HTTP only, on the already configured receiver origin. Never resolves relative URLs or hostnames. */
export function artworkUrl(candidate: unknown, endpoint: string): string | undefined {
  if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > 2048 || !URL.canParse(candidate) || !URL.canParse(endpoint)) return undefined;
  const url = new URL(candidate), configured = new URL(endpoint);
  if (url.protocol !== 'http:' || configured.protocol !== 'http:' || url.origin !== configured.origin ||
    url.username !== '' || url.password !== '' || url.hash !== '' || candidate.trim() !== candidate || [...candidate].some(character => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)) return undefined;
  return url.href;
}

/** The caller bounds the whole operation with its scheduler and supplies the deadline's signal. */
export function createArtworkFetch(fetcher: typeof fetch = fetch): ArtworkFetch {
  return async (candidate, endpoint, signal) => {
    const url = artworkUrl(candidate, endpoint);
    if (url === undefined) return artworkFailure('unsupported');
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetcher(url, {method: 'GET', redirect: 'manual', credentials: 'omit', signal});
      reader = response.body?.getReader();
      if (response.redirected || (response.status >= 300 && response.status < 400)) return artworkFailure('unsupported');
      if (!response.ok) return artworkFailure('unavailable', response.status === 408 || response.status === 429 || response.status >= 500);
      if (response.body === null) return artworkFailure('invalid-response');
      const declared = response.headers.get('content-length');
      if (declared !== null && /^\d+$/u.test(declared) && Number(declared) > ARTWORK_INPUT_BYTES) {
        return artworkFailure('capacity');
      }
      if (reader === undefined) return artworkFailure('invalid-response');
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const item = await reader.read();
        if (item.done) break;
        size += item.value.byteLength;
        if (size > ARTWORK_INPUT_BYTES) return artworkFailure('capacity');
        chunks.push(item.value);
      }
      if (size === 0) return artworkFailure('invalid-response');
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return {ok: true, value: bytes};
    } catch {
      return artworkFailure('unavailable', true);
    } finally {
      await reader?.cancel().catch(() => {});
    }
  };
}
