import assert from 'node:assert/strict';
import test from 'node:test';
import {clampPage, fitColumns, fitRows, listFit, listPageSize, pageCount, pageKeys, pageOf} from '../src/paging.ts';

void test('pages cover every row and an empty list keeps one page', () => {
  assert.equal(pageCount(0, 7), 1);
  assert.equal(pageCount(7, 7), 1);
  assert.equal(pageCount(13, 7), 2);
  assert.deepEqual(pageKeys(['a', 'b', 'c', 'd', 'e'], 1, 2), ['c', 'd']);
  assert.deepEqual(pageKeys(['a', 'b', 'c', 'd', 'e'], 2, 2), ['e']);
  assert.equal(pageOf(6, 7), 0);
  assert.equal(pageOf(7, 7), 1);
});

void test('removing the last row of the last page moves back one page', () => {
  assert.equal(clampPage(1, 8, 7), 1);
  assert.equal(clampPage(1, 7, 7), 0);
  assert.equal(clampPage(5, 0, 7), 0);
  assert.equal(clampPage(-1, 13, 7), 0);
  assert.deepEqual(pageKeys(['a', 'b', 'c'], 4, 2), ['c'], 'a page past the end shows the last page');
});

void test('every list card pages at least two rows', () => {
  for (const size of Object.values(listPageSize)) assert.ok(Number.isInteger(size) && size >= 2);
});

void test('a shaped list card calculates its rows from its size: all rows when they fit, otherwise those above the pager', () => {
  // A Tall or Large square Inbox at 1440 px: 467 px high, so 365 px below its heading.
  const room = 467.2 - listFit.frame - listFit.inbox.heading;
  assert.equal(fitRows(room, listFit.inbox.row, 6), 6, 'six items fit without a pager');
  assert.equal(fitRows(room, listFit.inbox.row, 13), 5, 'thirteen leave room for the pager');
  assert.equal(fitRows(room, listFit.inbox.row, 0), 6, 'an empty list still has a page size');
  assert.equal(fitRows(10, listFit.inbox.row, 13), 1, 'at least one row');
  assert.equal(fitRows(room, listFit.inbox.row, 13, 0, false), 6, 'without a pager every row that fits shows');
  // Tiles count the gap between rows only.
  assert.equal(fitRows(2 * listFit.sessions.tile + listFit.sessions.gap, listFit.sessions.tile, 2, listFit.sessions.gap), 2);
  assert.equal(fitRows(2 * listFit.sessions.tile + listFit.sessions.gap - 1, listFit.sessions.tile, 2, listFit.sessions.gap), 1);
  // A full page leaves less than one row above the pager.
  for (let height = 200; height <= 1200; height += 7) {
    const space = height - listFit.frame - listFit.inbox.heading, rows = fitRows(space, listFit.inbox.row, 100);
    assert.ok(space - listFit.pager - rows * listFit.inbox.row < listFit.inbox.row || rows === 1, String(height));
  }
});

void test('tile columns follow the card width: tiles at least 180 px wide with 8 px between', () => {
  assert.equal(fitColumns(226), 1, 'Tall at 1440');
  assert.equal(fitColumns(467), 2, 'Large square at 1440');
  assert.equal(fitColumns(563), 2, 'Large square at 1100');
  assert.equal(fitColumns(50 + 3 * 180 + 2 * 8), 3);
  assert.equal(fitColumns(50 + 3 * 180 + 2 * 8 - 1), 2);
});
