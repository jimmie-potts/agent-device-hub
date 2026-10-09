import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {rm, writeFile} from 'node:fs/promises';
import {test} from 'node:test';
import {emptyTotals} from '@jimmie-potts/wispr-contracts';
import {addLanguage, world} from './support.js';

type NumericAnswer = {revision: number; freshness: string; lastSuccessAt: string; data: {totals: {words: number}; speechWordsPerMinute: number; rows?: {words: number}[]; daily?: {words: number}[]}};
const decode = (body: string): NumericAnswer => JSON.parse(body) as NumericAnswer;

void test('selected numeric files retain all views, filter math and numeric-only exports', async t => {
  const {reader} = await world(t);
  const summary = decode((await reader.request('summary', '')).body);
  assert.equal(summary.data.totals.words, 120); assert.equal(summary.data.speechWordsPerMinute, 120);
  for (const [route, query] of [['series', 'bucket=day'], ['series', 'bucket=week'], ['series', 'bucket=month'], ['heatmap', ''], ['apps', ''], ['export', 'format=json']]) {
    const response = await reader.request(route ?? '', query ?? ''); assert.equal(response.status, 200);
    const value = decode(response.body); assert.equal(value.revision, 1); assert.equal(response.body.includes('language'), false);
    assert.equal((value.data.rows ?? value.data.daily ?? []).reduce((sum, row) => sum + row.words, 0), 120);
  }
  assert.equal(decode((await reader.request('summary', 'app=chatgpt&category=email')).body).data.totals.words, 0);
  for (const query of ['app=unknown', 'from=2026-02-30', 'from=2026-10-01', 'app=chatgpt&app=slack', 'timezone=UTC']) {
    assert.equal((await reader.request('summary', query)).status, 400);
  }
  const csv = await reader.request('export', 'format=csv'); assert.equal(csv.csv, true); assert.match(csv.body, /120/);
});

void test('last-good numeric observation stays stale, but clear identity survives worker replacement', async t => {
  const {reader, snapshot, config, publish, advance, workers} = await world(t);
  const initial = decode((await reader.request('summary', '')).body);
  await writeFile(config.aggregatePath, '{"private":"MALFORMED_CANARY"'); advance(610000);
  const stale = await reader.request('summary', ''); const value = decode(stale.body);
  assert.equal(value.data.totals.words, 120); assert.equal(value.lastSuccessAt, initial.lastSuccessAt); assert.equal(value.freshness, 'stale'); assert.equal(stale.body.includes('CANARY'), false);
  const cleared = structuredClone(snapshot); cleared.generation = randomUUID(); cleared.revision++; cleared.health = 'cleared';
  cleared.numeric = {cells: [], totals: emptyTotals()}; cleared.coverage.captured = {from: null, to: null}; cleared.coverage.retained = {from: null, to: null};
  await publish(cleared); await writeFile(config.aggregatePath, 'bad');
  assert.equal((await reader.request('summary', '')).status, 503);
  await publish(snapshot); assert.equal((await reader.request('summary', '')).status, 503);
  await workers.at(-1)?.terminate(); assert.equal((await reader.request('summary', '')).status, 503);
  await publish(cleared); const recovered = await reader.request('summary', ''); assert.equal(recovered.status, 200); assert.equal(decode(recovered.body).data.totals.words, 0);
  await workers.at(-1)?.terminate(); await publish(snapshot); assert.equal((await reader.request('summary', '')).status, 503);
});

void test('text requires both choices; producer disable removes text immediately and explicit CSV escapes formulas', async t => {
  const {reader, snapshot, publish} = await world(t, true); addLanguage(snapshot); await publish(snapshot, true);
  assert.match((await reader.request('language', 'period=today&corpus=cleaned')).body, /SUM/);
  assert.equal((await reader.request('export', 'format=json')).body.includes('SUM'), false);
  assert.match((await reader.request('export', 'format=csv&includeText=true&period=today&corpus=cleaned')).body, /'=SUM\(1,2\)/);
  await publish(snapshot, false);
  assert.equal((await reader.request('language', 'period=today&corpus=cleaned')).body.includes('SUM'), false);
  assert.equal((await reader.request('export', 'includeText=true&period=today&corpus=cleaned')).status, 403);
  await publish(snapshot, true); reader.privacy(false, false);
  assert.equal((await reader.request('language', 'period=today&corpus=cleaned')).body.includes('SUM'), false);
  reader.privacy(false, true); assert.match((await reader.request('language', 'period=today&corpus=cleaned')).body, /SUM/);
});

void test('missing selected files refuse without fabricated zero or private diagnostics', async t => {
  const {reader, config} = await world(t); await rm(config.aggregatePath);
  const missing = await reader.request('summary', ''); assert.equal(missing.status, 503); assert.equal(missing.body.includes('totals'), false);
  await writeFile(config.diagnosticsPath, '{"private":"DIAGNOSTIC_CANARY"}');
  const malformed = await reader.request('summary', ''); assert.equal(malformed.status, 503); assert.equal(malformed.body.includes('CANARY'), false);
});
