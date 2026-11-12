import type {DisplayRecord} from '../module/schemas.js';

/**
 * When the Pixoo card reads its player again: whenever the display record changes, except for its Monitor fields. The
 * Monitor pages through sessions every cadence, which says nothing about the player; reading again on each page made
 * the card show Stale and disable its controls for a moment while nobody acted (#1672 PR B round 2).
 */
export function playerKey(display: DisplayRecord | undefined): string | undefined {
  return display === undefined ? undefined : JSON.stringify({...display, revision: 0, monitor: null});
}
