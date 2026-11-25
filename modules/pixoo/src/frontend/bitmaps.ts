import {useCallback, useEffect, useLayoutEffect, useMemo, useRef} from 'react';

export type CanvasBitmaps = {
  /** Takes ownership of a decoded bitmap that the caller keeps, in a cache or for the current source. */
  keep: (bitmap: ImageBitmap) => void;
  /** The caller no longer keeps it: it is closed now, or once the canvas stops showing it. */
  drop: (bitmap: ImageBitmap) => void;
};

/**
 * The ownership rule for a component that decodes bitmaps and draws one at a time through PreviewFrame (Hub #1900,
 * #2133). The component owns every bitmap it kept and has not closed. A dropped bitmap is closed at once, unless it is
 * `shown`, the one on the canvas; that one is closed when the canvas shows another, or when the component unmounts.
 * A decode that a newer source superseded is never kept: its caller closes it at once.
 *
 * `shown` is recorded in a layout effect, which runs before the passive cleanups of the same commit. A drop in such a
 * cleanup, as a source changes while a decoded bitmap's state update commits, therefore never closes the bitmap that the
 * canvas effect of that commit is about to draw.
 */
export function useCanvasBitmaps(shown: ImageBitmap | undefined): CanvasBitmaps {
  const owned = useRef(new Set<ImageBitmap>()), kept = useRef(new Set<ImageBitmap>());
  const onCanvas = useRef<ImageBitmap | undefined>(undefined);
  const close = useCallback((bitmap: ImageBitmap): void => {
    kept.current.delete(bitmap); if (owned.current.delete(bitmap)) bitmap.close();
  }, []);
  const keep = useCallback((bitmap: ImageBitmap): void => { owned.current.add(bitmap); kept.current.add(bitmap); }, []);
  const drop = useCallback((bitmap: ImageBitmap): void => {
    kept.current.delete(bitmap); if (bitmap !== onCanvas.current) close(bitmap);
  }, [close]);
  useLayoutEffect(() => {
    onCanvas.current = shown;
    const keeps = kept.current;
    return () => { if (shown !== undefined && !keeps.has(shown)) close(shown); };
  }, [shown, close]);
  useEffect(() => {
    const bitmaps = owned.current, keeps = kept.current;
    return () => { for (const bitmap of bitmaps) bitmap.close(); bitmaps.clear(); keeps.clear(); };
  }, []);
  return useMemo(() => ({keep, drop}), [keep, drop]);
}
