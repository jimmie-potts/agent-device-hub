import type {FrontendApi} from '@jimmie-potts/sdk/frontend';
import type {BrowserArt} from './model.js';
import type {ArtPresentation} from './presentation.js';
import {loadBrowserArt, type Decode} from './rendition.js';

/** The decoded presented composition, validated against its record like the widget's image. */
export type ArtBackdropImage = {
  bitmap: ImageBitmap; width: number; height: number;
  artworkId: string; compositionId: string; renditionId: string; palette: readonly string[];
};
/** `image` is the last ready image; a newer image that is loading, stale or failed leaves it in place. */
export type ArtBackdrop = {status: 'none' | 'loading' | 'ready' | 'stale' | 'unavailable'; image: ArtBackdropImage | null};
export const NO_BACKDROP: ArtBackdrop = {status: 'none', image: null};

/** What the backdrop should show, from the record and selection the widget follows. */
export type BackdropWant = {status: 'none' | 'loading' | 'stale' | 'unavailable'} | {status: 'select'; art: BrowserArt};
export type BackdropLoader = {
  want: (next: BackdropWant) => void;
  /** The image consumers have committed. Bitmaps neither committed nor current are closed. */
  committed: (image: ArtBackdropImage | null) => void;
  dispose: () => void;
};

const imageOf = (bitmap: ImageBitmap, art: BrowserArt): ArtBackdropImage => ({bitmap, width: bitmap.width, height: bitmap.height,
  artworkId: art.artwork.artworkId, compositionId: art.compositionId, renditionId: art.rendition.renditionId, palette: [...art.artwork.palette]});
const sameImage = (image: ArtBackdropImage, art: BrowserArt): boolean => image.artworkId === art.artwork.artworkId && image.compositionId === art.compositionId
  && image.renditionId === art.rendition.renditionId && image.palette.join() === art.artwork.palette.join();

/**
 * Loads each wanted rendition once. A rendition ID names its bytes, so another artwork with the same rendition reuses
 * the decoded bitmap under its own identity. Only the latest wanted load may publish; an obsolete or failed load never
 * replaces the current image. The loader owns every bitmap it decoded until dispose.
 */
export function backdropLoader(api: Pick<FrontendApi, 'image'>, publish: (value: ArtBackdrop) => void, decode?: Decode): BackdropLoader {
  let image: ArtBackdropImage | null = null, committed: ArtBackdropImage | null = null, last: ArtBackdrop | undefined;
  let pending: {art: BrowserArt} | undefined, disposed = false;
  const owned = new Set<ImageBitmap>();
  const emit = (status: ArtBackdrop['status']): void => {
    if (disposed || last?.status === status && last.image === image) return;
    last = {status, image};publish(last);
  };
  const retire = (): void => {
    for (const bitmap of owned) if (bitmap !== image?.bitmap && bitmap !== committed?.bitmap) {bitmap.close();owned.delete(bitmap);}
  };
  return {
    want: next => {
      if (disposed) return;
      if (next.status !== 'select') {
        pending = undefined;
        if (next.status === 'none') image = null;
        emit(next.status);return;
      }
      const {art} = next;
      if (image?.renditionId === art.rendition.renditionId) {
        pending = undefined;
        if (!sameImage(image, art)) image = imageOf(image.bitmap, art);
        emit('ready');return;
      }
      if (pending?.art.rendition.renditionId === art.rendition.renditionId) {pending.art = art;return;}
      const ticket = {art};pending = ticket;emit('loading');
      const current = (): boolean => !disposed && pending === ticket;
      void loadBrowserArt(api, art, current, decode).then(loaded => {
        if (loaded === undefined) return;
        if (!current()) {loaded.bitmap.close();return;}
        pending = undefined;owned.add(loaded.bitmap);image = imageOf(loaded.bitmap, ticket.art);
        emit('ready');
      }, () => {if (current()) {pending = undefined;emit('unavailable');}});
    },
    committed: value => {committed = value;retire();},
    dispose: () => {disposed = true;pending = undefined;for (const bitmap of owned) bitmap.close();owned.clear();},
  };
}

const idle: ArtPresentation = {presented: null, status: 'idle'};
/** Presentation evidence for the rendition the shell reports drawn; nothing while it draws none. */
export function backdropEvidence(backdrop: ArtBackdrop, shown: string | null): ArtPresentation {
  if (shown === null || backdrop.status === 'none') return idle;
  const image = backdrop.image?.renditionId === shown ? backdrop.image : null;
  return {presented: image === null ? null : {artworkId: image.artworkId, compositionId: image.compositionId, renditionId: image.renditionId, palette: [...image.palette]},
    status: backdrop.status};
}
