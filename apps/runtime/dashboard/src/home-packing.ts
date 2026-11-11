// Two-height Home packing (#1658). A pure function of saved order, sizes, heights and the grid's width; the browser
// renders each row as a CSS grid with these placements. It reads and writes nothing else.
import type {WidgetHeight, WidgetSize} from './widgets.ts';

export type PackCard = {id: string; size: WidgetSize; height: WidgetHeight; tall?: boolean};
export type Placement = {id: string; column: number; row: 1 | 2; rows: 1 | 2};
export type PackedColumn = {basis: number; grow: number};
/** One row: its cards in saved order, its columns and whether it holds one short track or two. */
export type PackedRow = {cards: Placement[]; columns: PackedColumn[]; tracks: 1 | 2; wide: boolean};

/** Preferred widths and shares of spare width, as the former flex rule gave them: Small 260px, Standard 340px and twice the share. */
const BASIS: Readonly<Record<'small' | 'medium', number>> = {small: 260, medium: 340};
const GROW: Readonly<Record<'small' | 'medium', number>> = {small: 1, medium: 2};

type Column = {size: 'small' | 'medium'; long: boolean; cards: Placement[]};
const isLong = (card: PackCard): boolean => card.height === 'long' || card.tall === true;

/**
 * Lays out one row. When the row holds a long card, short cards share columns two at a time, so a long card stands
 * beside two stacked short cards: a short card goes under the first earlier short card left alone in the row, of the
 * same size when there is one, and that is the only case where a card can appear before one saved ahead of it. A short
 * card left alone in a row with a long card fills both tracks, so no hole remains.
 */
function layoutRow(cards: readonly PackCard[], gap: number): {row: PackedRow; width: number} {
  const two = cards.some(isLong), columns: Column[] = [];
  for (const card of cards) {
    const size = card.size === 'small' ? 'small' : 'medium';
    if (two && !isLong(card)) {
      const open = columns.filter(column => !column.long && column.cards.length === 1);
      const partner = open.find(column => column.size === size) ?? open[0];
      if (partner !== undefined) {
        if (size === 'medium') partner.size = 'medium';
        partner.cards.push({id: card.id, column: columns.indexOf(partner) + 1, row: 2, rows: 1});
        continue;
      }
    }
    columns.push({size, long: isLong(card), cards: [{id: card.id, column: columns.length + 1, row: 1, rows: two && isLong(card) ? 2 : 1}]});
  }
  if (two) for (const column of columns) {const only = column.cards[0];if (column.cards.length === 1 && only !== undefined) only.rows = 2;}
  const placements = columns.flatMap(column => column.cards), order = new Map(cards.map((card, index) => [card.id, index]));
  placements.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const width = columns.reduce((total, column) => total + BASIS[column.size], 0) + gap * Math.max(0, columns.length - 1);
  return {row: {cards: placements, columns: columns.map(column => ({basis: BASIS[column.size], grow: GROW[column.size]})), tracks: two ? 2 : 1, wide: false}, width};
}

/**
 * Packs saved cards into rows in saved order. A row takes cards while their preferred widths and gaps fit `width`,
 * as wrapping did before, and Wide cards take a row of their own. Rows never reorder cards across rows.
 */
export function packHomeRows(cards: readonly PackCard[], width: number, gap: number): PackedRow[] {
  const rows: PackedRow[] = [];
  let current: PackCard[] = [];
  const flush = (): void => {if (current.length > 0) rows.push(layoutRow(current, gap).row);current = [];};
  for (const card of cards) {
    if (card.size === 'large') {
      flush();
      const long = isLong(card);
      rows.push({cards: [{id: card.id, column: 1, row: 1, rows: long ? 2 : 1}], columns: [{basis: 0, grow: 1}], tracks: long ? 2 : 1, wide: true});
      continue;
    }
    const trial = [...current, card];
    if (current.length === 0 || layoutRow(trial, gap).width <= width) current = trial;
    else {flush();current = [card];}
  }
  flush();
  return rows;
}

/** Columns of the one Home grid; a packed column spans a whole number of them, so every row fills the width. */
export const GRID_COLUMNS = 24;
/** `free` marks a card that takes its content height: a row of tall cards, or one card alone in a row it does not fill by choice. */
export type GridPlacement = {column: number; columns: number; row: number; rows: 1 | 2; free: boolean};

/**
 * Whole-column spans for a row's columns that fill GRID_COLUMNS. Columns of the same size get the same span whenever an
 * equal split exists, Standard is never narrower than Small, and a split that keeps every column at its preferred width
 * wins over one that does not; among the rest, the split closest to the widths flex would give wins.
 */
export function rowSpans(columns: readonly PackedColumn[], width: number, gap: number): number[] {
  const unit = (width - gap * (GRID_COLUMNS - 1)) / GRID_COLUMNS, pixels = (span: number): number => span * unit + (span - 1) * gap;
  const fixed = columns.reduce((total, column) => total + column.basis, 0) + gap * Math.max(0, columns.length - 1);
  const grow = columns.reduce((total, column) => total + column.grow, 0), spare = Math.max(0, width - fixed);
  const ideal = columns.map(column => column.basis + spare * column.grow / grow);
  const score = (spans: readonly number[]): number => spans.reduce((total, span, index) => {
    const column = columns[index], wanted = ideal[index] ?? 0, actual = pixels(span);
    return total + Math.abs(actual - wanted) + (column !== undefined && actual < column.basis ? 1_000 * (column.basis - actual) : 0);
  }, 0);
  const smalls = columns.filter(column => column.grow === 1).length, standards = columns.length - smalls;
  let best: number[] | undefined;
  for (let small = smalls === 0 ? 0 : 1; small <= GRID_COLUMNS; small += 1) {
    for (let standard = standards === 0 ? 0 : Math.max(1, small); standard <= GRID_COLUMNS; standard += 1) {
      if (smalls * small + standards * standard !== GRID_COLUMNS) continue;
      const spans = columns.map(column => column.grow === 1 ? small : standard);
      if (best === undefined || score(spans) < score(best)) best = spans;
      if (standards === 0) break;
    }
    if (smalls === 0) break;
  }
  if (best !== undefined) return best;
  // No equal split fills the row (for example five Standard columns): spread the remainder one column at a time.
  const spans = ideal.map(value => Math.max(1, Math.floor(value / ideal.reduce((sum, item) => sum + item, 0) * GRID_COLUMNS)));
  for (let index = 0; spans.reduce((sum, value) => sum + value, 0) < GRID_COLUMNS; index = (index + 1) % spans.length) spans[index] = (spans[index] ?? 0) + 1;
  return spans;
}

/**
 * Places packed rows on one grid of GRID_COLUMNS equal columns, so cards stay flat children in saved order. `tracks`
 * lists each grid row: `free` rows take their content height. A row is free when it holds only tall cards, or when one
 * column of cards stands alone in a row it does not fill by choice, as when a narrow window packs one card per row.
 */
export function gridPlacements(rows: readonly PackedRow[], width: number, gap: number, tall: (id: string) => boolean): {cards: Map<string, GridPlacement>; tracks: ('standard' | 'free')[]} {
  const cards = new Map<string, GridPlacement>(), tracks: ('standard' | 'free')[] = [];
  for (const row of rows) {
    const first = tracks.length + 1, free = row.cards.every(card => tall(card.id)) || !row.wide && row.columns.length === 1;
    for (let index = 0; index < row.tracks; index += 1) tracks.push(free ? 'free' : 'standard');
    const spans = row.wide ? [GRID_COLUMNS] : rowSpans(row.columns, width, gap);
    const starts = spans.map((_, index) => 1 + spans.slice(0, index).reduce((sum, value) => sum + value, 0));
    for (const card of row.cards) cards.set(card.id, {column: starts[card.column - 1] ?? 1, columns: spans[card.column - 1] ?? GRID_COLUMNS, row: first + card.row - 1, rows: card.rows, free});
  }
  return {cards, tracks};
}
