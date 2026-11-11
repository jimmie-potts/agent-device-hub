import assert from 'node:assert/strict';
import test from 'node:test';
import {GRID_COLUMNS, gridPlacements, packHomeRows, rowSpans, type PackCard} from '../src/home-packing.ts';

const long = (id: string, size: PackCard['size'] = 'medium'): PackCard => ({id, size, height: 'long'});
const short = (id: string, size: PackCard['size'] = 'medium'): PackCard => ({id, size, height: 'short'});
const ids = (rows: ReturnType<typeof packHomeRows>): string[][] => rows.map(row => row.cards.map(card => card.id));

void test('a long card stands beside two stacked short cards, in saved order', () => {
  const [row] = packHomeRows([long('inbox'), short('hub'), short('wispr', 'small'), long('sessions')], 1192, 16);
  assert.ok(row !== undefined);
  assert.equal(row.tracks, 2);
  assert.deepEqual(row.cards, [
    {id: 'inbox', column: 1, row: 1, rows: 2}, {id: 'hub', column: 2, row: 1, rows: 1},
    {id: 'wispr', column: 2, row: 2, rows: 1}, {id: 'sessions', column: 3, row: 1, rows: 2},
  ]);
});

void test('rows take cards while their preferred widths fit, and Wide cards take their own row', () => {
  assert.deepEqual(ids(packHomeRows([long('a'), long('b'), long('c'), long('d')], 1192, 16)), [['a', 'b', 'c'], ['d']]);
  assert.deepEqual(ids(packHomeRows([long('a'), long('b', 'large'), short('c')], 1192, 16)), [['a'], ['b'], ['c']]);
  assert.equal(packHomeRows([short('a'), short('b'), short('c')], 1192, 16).length, 1, 'short cards without a long one share one row');
  assert.equal(packHomeRows([short('a'), short('b')], 1192, 16)[0]?.tracks, 1, 'that row is one short track');
});

void test('a short card stacks under an earlier lone short card, and a lone one fills both tracks', () => {
  const [row] = packHomeRows([short('a'), long('b'), short('c')], 1192, 16);
  assert.deepEqual(row?.cards, [{id: 'a', column: 1, row: 1, rows: 1}, {id: 'b', column: 2, row: 1, rows: 2}, {id: 'c', column: 1, row: 2, rows: 1}]);
  const [lone] = packHomeRows([long('a'), short('b')], 1192, 16);
  assert.deepEqual(lone?.cards[1], {id: 'b', column: 2, row: 1, rows: 2});
});

void test('grid placements fill each row and number tracks across rows', () => {
  const rows = packHomeRows([long('a'), short('b'), short('c', 'small'), long('d'), long('e', 'large'), {id: 'art', size: 'large', height: 'long', tall: true}], 1192, 16);
  const {cards, tracks} = gridPlacements(rows, 1192, 16, id => id === 'art');
  assert.deepEqual(tracks, ['standard', 'standard', 'standard', 'standard', 'free', 'free']);
  const first = ['a', 'b', 'd'].map(id => cards.get(id)?.columns ?? 0);
  assert.equal(first.reduce((sum, value) => sum + value, 0), GRID_COLUMNS, 'a row spans the whole grid');
  assert.deepEqual(cards.get('c'), {column: cards.get('b')?.column, columns: cards.get('b')?.columns, row: 2, rows: 1, free: false});
  assert.deepEqual(cards.get('e'), {column: 1, columns: GRID_COLUMNS, row: 3, rows: 2, free: false});
});

void test('same-size columns in a row get the same span, and Standard keeps its preferred width when a split allows', () => {
  const standard = {basis: 340, grow: 2}, small = {basis: 260, grow: 1};
  assert.deepEqual(rowSpans([standard, standard, standard], 1032, 16), [8, 8, 8]);
  assert.deepEqual(rowSpans([standard, standard, standard, standard], 1652, 16), [6, 6, 6, 6]);
  const mixed = rowSpans([small, standard, standard], 1192, 16);
  assert.equal(mixed[1], mixed[2]);
  assert.ok((mixed[0] ?? 0) <= (mixed[1] ?? 0));
  assert.equal(mixed.reduce((sum, value) => sum + value, 0), GRID_COLUMNS);
  const five = rowSpans([standard, standard, standard, standard, standard], 1876, 16);
  assert.equal(five.reduce((sum, value) => sum + value, 0), GRID_COLUMNS);
  assert.ok(Math.max(...five) - Math.min(...five) <= 1, 'with no equal split, spans differ by at most one column');
});

void test('a column alone in a row it does not fill by choice takes its content height', () => {
  const {cards, tracks} = gridPlacements(packHomeRows([long('a'), long('b'), long('c', 'large')], 400, 16), 400, 16, () => false);
  assert.equal(cards.get('a')?.free, true);
  assert.equal(cards.get('c')?.free, false, 'a Wide card fills its row by choice');
  assert.deepEqual(tracks, ['free', 'free', 'free', 'free', 'standard', 'standard']);
});
