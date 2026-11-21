import {createContext, useContext} from 'react';

/**
 * Unfolding a light in place (#1932, the Clear reference). A light card in the Small square shape on Home's unit grid
 * has an arrow that opens it to Large square with its full controls; the panels it moves ease from where they were.
 * One card is open at a time; its arrow or Escape closes it. The open card lives only in the page's memory: it is never
 * saved, reloading shows none, and Edit Home, a narrow screen or the Phone arrangement close it.
 *
 * Home provides this to a card that can unfold, and undefined everywhere else. `focus` asks the card to move focus once
 * after a change, into its opened controls or back to its arrow, and the card calls `focused` when it has.
 */
export type HomeUnfold = {open: boolean; toggle: () => void; focus: 'controls' | 'arrow' | undefined; focused: () => void};
export const HomeUnfoldContext = createContext<HomeUnfold | undefined>(undefined);
export const useHomeUnfold = (): HomeUnfold | undefined => useContext(HomeUnfoldContext);

/** The reference's move and resize: 720 ms with a small overshoot. */
export const UNFOLD_MS = 720;
export const UNFOLD_EASING = 'linear(0, .3 7%, .68 18%, .96 31%, 1.05 43%, 1.02 57%, .994 74%, 1)';
const FLIP = 'home-unfold';

type Box = {left: number; top: number; width: number; height: number};
/** Where each placed card is on screen now, mid-move included, by its Home card id. */
export function cardBoxes(grid: HTMLElement | null): Map<string, Box> {
  return new Map([...grid?.querySelectorAll<HTMLElement>(':scope > [data-home-card]') ?? []].map(card => [card.dataset['homeCard'] ?? '', card.getBoundingClientRect()]));
}
/**
 * FLIP: every card whose box changed since `before` eases from where it was to where it is now, by a transform from
 * its top left corner, so a card that grows scales up as it moves. A move still running restarts from where it is.
 */
export function easeCards(grid: HTMLElement | null, before: ReadonlyMap<string, Box>): void {
  for (const card of grid?.querySelectorAll<HTMLElement>(':scope > [data-home-card]') ?? []) {
    // A card that follows the pointer to be grouped, or is easing home from a drop (#1933), moves by its own transform.
    if (card.dataset['glassDragged'] !== undefined) continue;
    for (const animation of card.getAnimations()) if (animation.id === FLIP) animation.cancel();
    const was = before.get(card.dataset['homeCard'] ?? ''), now = card.getBoundingClientRect();
    if (was === undefined || now.width === 0 || now.height === 0) continue;
    const dx = was.left - now.left, dy = was.top - now.top, sx = was.width / now.width, sy = was.height / now.height;
    if (Math.abs(dx) + Math.abs(dy) <= 1 && Math.abs(sx - 1) + Math.abs(sy - 1) <= 0.01) continue;
    card.animate([{transformOrigin: '0 0', transform: `translate(${String(dx)}px, ${String(dy)}px) scale(${String(sx)}, ${String(sy)})`}, {transformOrigin: '0 0', transform: 'none'}],
      {duration: UNFOLD_MS, easing: UNFOLD_EASING}).id = FLIP;
  }
}
