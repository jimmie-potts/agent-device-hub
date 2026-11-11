import assert from 'node:assert/strict';
import test from 'node:test';
import {clampPage, listPageSize, pageCount, pageKeys, pageOf} from '../src/paging.ts';

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
