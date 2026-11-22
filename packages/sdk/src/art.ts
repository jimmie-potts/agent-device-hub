import type {ArtComposition, ArtTarget, ArtworkSummary} from '@jimmie-potts/event-contracts/v2/art-state';
import {Outcome} from './evidence.js';

/** A saved composition that the Gallery, Conversation and the core can present without generating new art. */
export function usableArtComposition(artwork: Pick<ArtworkSummary, 'compositions'>, kind: ArtTarget): ArtComposition | undefined {
  return artwork.compositions.find(item => item.target === kind && item.outcome === Outcome.succeeded &&
    item.compositionId !== null && item.renditions.length > 0);
}
