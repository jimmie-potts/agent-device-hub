import type {FrontendApi} from '@jimmie-potts/sdk/frontend';
import type {BrowserArt} from './model.js';
import type {PresentedArt} from './presentation.js';

export type Decode = (blob: Blob) => Promise<ImageBitmap>;
/** One decoded browser rendition and the presentation evidence it supports. */
export type LoadedArt = {bitmap: ImageBitmap; evidence: PresentedArt};

/**
 * Reads one browser rendition through the module's authenticated content route and decodes it. The bytes must match
 * the declared size and media type and decode to the declared dimensions; otherwise the load fails. When `current`
 * turns false before the load finishes, it resolves undefined and keeps no bitmap.
 */
export async function loadBrowserArt(api: Pick<FrontendApi, 'image'>, art: BrowserArt, current: () => boolean,
  decode: Decode = blob => createImageBitmap(blob)): Promise<LoadedArt | undefined> {
  const {rendition, compositionId, artwork} = art;
  const blob = await api.image(`/modules/art/content/${rendition.ref}`);
  if (!current()) return undefined;
  if (blob.size !== rendition.bytes || blob.type !== `image/${rendition.format}`) throw new Error('invalid-image');
  const bitmap = await decode(blob);
  if (!current()) {bitmap.close();return undefined;}
  if (bitmap.width !== rendition.width || bitmap.height !== rendition.height) {bitmap.close();throw new Error('invalid-dimensions');}
  return {bitmap, evidence: {artworkId: artwork.artworkId, compositionId, renditionId: rendition.renditionId, palette: [...artwork.palette]}};
}
