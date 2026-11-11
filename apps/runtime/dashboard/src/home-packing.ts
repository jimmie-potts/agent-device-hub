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
export type GridPlacement = {column: number; columns: number; row: number; rows: 1 | 2};

/**
 * Places packed rows on one grid of GRID_COLUMNS equal columns, so cards stay flat children in saved order. A column's
 * span follows its preferred width plus its share of the spare width, as flex grew it; `tracks` lists each grid row,
 * `free` for a row that only holds a tall card and so takes its content height.
 */
export function gridPlacements(rows: readonly PackedRow[], width: number, gap: number, tall: (id: string) => boolean): {cards: Map<string, GridPlacement>; tracks: ('standard' | 'free')[]} {
  const cards = new Map<string, GridPlacement>(), tracks: ('standard' | 'free')[] = [];
  for (const row of rows) {
    const first = tracks.length + 1, free = row.cards.every(card => tall(card.id));
    for (let index = 0; index < row.tracks; index += 1) tracks.push(free ? 'free' : 'standard');
    let spans = [GRID_COLUMNS];
    if (!row.wide) {
      const fixed = row.columns.reduce((total, column) => total + column.basis, 0) + gap * Math.max(0, row.columns.length - 1);
      const grow = row.columns.reduce((total, column) => total + column.grow, 0), spare = Math.max(0, width - fixed);
      const widths = row.columns.map(column => column.basis + spare * column.grow / grow), total = widths.reduce((sum, value) => sum + value, 0);
      spans = widths.map(value => Math.max(1, Math.round(value / total * GRID_COLUMNS)));
      // Rounding can miss the row's width by a column or two; the widest column absorbs the difference.
      const widest = spans.indexOf(Math.max(...spans));
      spans[widest] = (spans[widest] ?? 1) + GRID_COLUMNS - spans.reduce((sum, value) => sum + value, 0);
    }
    const starts = spans.map((_, index) => 1 + spans.slice(0, index).reduce((sum, value) => sum + value, 0));
    for (const card of row.cards) cards.set(card.id, {column: starts[card.column - 1] ?? 1, columns: spans[card.column - 1] ?? GRID_COLUMNS, row: first + card.row - 1, rows: card.rows});
  }
  return {cards, tracks};
}
