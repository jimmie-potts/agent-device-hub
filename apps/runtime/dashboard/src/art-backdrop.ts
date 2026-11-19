// TEMPORARY adapter until #1928 merges. It copies the agreed types of the art module's backdrop export so the glass
// layer (#1929) can be built against them; once #1928 lands this file re-exports `useArtBackdrop` and
// `useShowArtBackdrop` from `@jimmie-potts/art/frontend` and the synthetic source below is deleted.
import {useEffect, useState} from 'react';

export type ArtBackdropImage = {
  bitmap: ImageBitmap; width: number; height: number;
  artworkId: string; compositionId: string; renditionId: string;
  palette: readonly string[];
};
export type ArtBackdrop = {status: 'none' | 'loading' | 'ready' | 'stale' | 'unavailable'; image: ArtBackdropImage | null};

const NONE: ArtBackdrop = {status: 'none', image: null};

/**
 * Until #1928: no artwork, except a synthetic picture a disposable browser journey hands the page with the
 * `bunny-synthetic-backdrop` event (an ImageBitmap and a rendition id, or null). Nothing in the product sends it.
 */
export function useArtBackdrop(): ArtBackdrop {
  const [value, setValue] = useState<ArtBackdrop>(NONE);
  useEffect(() => {
    const take = (event: Event): void => {
      const detail = (event as CustomEvent<{bitmap: ImageBitmap; renditionId: string} | null>).detail;
      setValue(detail === null ? NONE : {status: 'ready', image: {bitmap: detail.bitmap, width: detail.bitmap.width, height: detail.bitmap.height,
        artworkId: 'synthetic', compositionId: 'synthetic', renditionId: detail.renditionId, palette: []}});
    };
    window.addEventListener('bunny-synthetic-backdrop', take);
    return () => {window.removeEventListener('bunny-synthetic-backdrop', take);};
  }, []);
  return value;
}
/** Until #1928 there is no presentation evidence to publish. */
export function useShowArtBackdrop(): (renditionId: string | null) => void {
  return () => {};
}
