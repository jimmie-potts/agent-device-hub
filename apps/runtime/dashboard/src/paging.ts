// Browser-only paging over records the dashboard already holds (#1658): no request, no polling.

/**
 * Rows per page for each list card, fixed so a list never makes its card taller than one page of rows. Agent status
 * counts rows of tiles; its tiles per page are these rows times the grid's current columns.
 */
export const listPageSize = {inbox: 5, timeline: 5, sessionRows: 2} as const;

/**
 * Fixed sizes of the list cards in a Home shape (#1672), in CSS pixels. Rows per page are calculated from the card's
 * size, which the unit grid already knows, and these sizes; no list measures itself. home-shapes.css sets each size on
 * the element it describes, and tests/home-shapes.browser.ts checks every one against the rendered card.
 */
export const listFit = {
  /** The card frame: the widget's 24px padding and 1px border, top and bottom together. */
  frame: 50,
  /** The pager at the card's bottom: its 44px buttons and 8px above them. */
  pager: 52,
  /**
   * Inbox: the heading row (44px) and 8px below it; each stale or read-only line (20px) and 4px above it; one closed
   * item (55px) and its 1px rule.
   */
  inbox: {heading: 52, notice: 24, row: 56},
  /**
   * Timeline: the heading row (44px) and 8px below it, or in Tall the heading over the period choice (76px) and 8px;
   * Tall's link to the filters (44px); Large square's category buttons (44px) and 8px; the status line (20px) and 8px,
   * reserved even while empty so a refresh never changes the page size; one closed entry (51px) and its 1px rule.
   */
  timeline: {heading: 52, tallHeading: 84, tallLink: 44, filters: 52, status: 28, row: 52},
  /**
   * Agent sessions: the card heading (44px) and 4px; the counts (30px, or in Tall 56px with each count over its label)
   * and 8px; the find field and provider choice (48px in one row, or in Tall 92px in two rows) and 8px; one tile (124px)
   * with 8px between tiles, each at least 180px wide.
   */
  sessions: {heading: 48, summary: 38, tallSummary: 64, filters: 56, tallFilters: 100, tile: 124, tileWidth: 180, gap: 8},
} as const;

/**
 * Rows per page for a list with `room` pixels below its card's fixed chrome: every row when all `count` fit, otherwise
 * as many as fit above the pager. `row` is one row's height and `gap` the space between rows. Always at least one.
 */
export function fitRows(room: number, row: number, count: number, gap = 0, pager = true): number {
  const fit = (space: number): number => Math.max(1, Math.floor((space + gap) / (row + gap)));
  return !pager || count <= fit(room) ? fit(room) : fit(room - listFit.pager);
}
/** Tile columns in a card `width` pixels wide: tiles at least `listFit.sessions.tileWidth` wide with gaps between. */
export function fitColumns(width: number): number {
  const {tileWidth, gap} = listFit.sessions;
  return Math.max(1, Math.floor((width - listFit.frame + gap) / (tileWidth + gap)));
}

/** How many pages `count` rows fill; an empty list still has one (empty) page. */
export function pageCount(count: number, size: number): number {
  return Math.max(1, Math.ceil(count / Math.max(1, size)));
}

/** The page to show: a page that no longer exists, such as after its last row went away, moves back to the last one. */
export function clampPage(page: number, count: number, size: number): number {
  return Math.min(Math.max(0, page), pageCount(count, size) - 1);
}

/** The page holding the row at `index`. */
export function pageOf(index: number, size: number): number {
  return Math.floor(Math.max(0, index) / Math.max(1, size));
}

/** The keys shown on `page`. */
export function pageKeys<T>(keys: readonly T[], page: number, size: number): T[] {
  const current = clampPage(page, keys.length, size), step = Math.max(1, size);
  return keys.slice(current * step, current * step + step);
}
