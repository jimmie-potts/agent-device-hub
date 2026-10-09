import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import {Worker} from 'node:worker_threads';
import {emptySnapshot, emptyTotals, validateSnapshot, type Snapshot, type CollectorStatus} from '@jimmie-potts/wispr-contracts';
import {configureWispr} from '../src/configuration.js';
import {createWispr} from '../src/wispr.js';

export async function world(t: TestContext, shareText = false) {
  const directory = await mkdtemp(join(tmpdir(), 'wispr-unit-'));
  let now = Date.parse('2026-10-02T16:00:00.000Z');
  const snapshot = emptySnapshot({namespace: randomUUID(), generation: randomUUID(), now: new Date(now).toISOString(), timezone: 'America/New_York'});
  snapshot.health = 'ok'; snapshot.revision = 1; snapshot.lastSuccessAt = snapshot.generatedAt; snapshot.latestSourceDate = '2026-10-02';
  const cell = {...emptyTotals(), date: '2026-10-02', hour: 12, weekday: 5, app: 'chatgpt' as const, category: 'ai-prompts' as const,
    archived: false, words: 120, dictations: 2, speechSeconds: 60, speechWords: 120, speechSamples: 2};
  snapshot.numeric = {cells: [cell], totals: emptyTotals()};
  for (const key of Object.keys(snapshot.numeric.totals) as (keyof typeof snapshot.numeric.totals)[]) snapshot.numeric.totals[key] = cell[key];
  snapshot.coverage.captured = {from: cell.date, to: cell.date}; snapshot.coverage.retained = {...snapshot.coverage.captured};
  snapshot.coverage.sourceRows = 2; snapshot.coverage.statuses.formatted = 2;
  assert.equal(validateSnapshot(snapshot).ok, true);
  const configured = configureWispr({sourceId: 'dictation', aggregatePath: join(directory, 'aggregate.json'), diagnosticsPath: join(directory, 'status.json'), shareTextAggregates: shareText});
  assert.ok(!('error' in configured));
  const config = configured.config;
  const publish = async (value: Snapshot = snapshot, enabled = false): Promise<void> => {
    const status: CollectorStatus = {schemaVersion: '1.0', namespace: value.namespace, generation: value.generation, revision: value.revision,
      lastAttemptAt: value.generatedAt, lastSuccessAt: value.lastSuccessAt, latestSourceDate: value.latestSourceDate, health: value.health, languageEnabled: enabled};
    await writeFile(config.aggregatePath, JSON.stringify(value), {mode: 0o600});
    await writeFile(config.diagnosticsPath, JSON.stringify(status), {mode: 0o600});
  };
  await publish();
  const workers: Worker[] = [];
  const reader = createWispr(config, () => now, data => {
    const worker = new Worker(new URL('../src/wispr-worker.js', import.meta.url), {workerData: data}); workers.push(worker); return worker;
  });
  t.after(async () => { await reader.close(); await Promise.all(workers.map(worker => worker.terminate())); await rm(directory, {recursive: true, force: true}); });
  return {directory, snapshot, config, reader, workers, publish, now: () => now, advance: (ms: number): void => { now += ms; }};
}

export function addLanguage(snapshot: Snapshot): void {
  snapshot.language = {availability: 'available', algorithmVersion: 'english-1', stopwordVersion: 'english-stop-1', tables: [{
    preset: 'today', app: 'all', category: 'all', corpus: 'formatted', words: [{text: '=SUM(1,2)', occurrences: 3, dictations: 3}],
    usefulWords: [], phrases: [], changes: [], omitted: {words: 0, usefulWords: 0, phrases: 0, changes: 0},
    coverage: {eligible: 3, missing: 0, unsupportedLanguage: 0, oversized: 0, uncertain: 0, longChanges: 0},
    comparison: 'raw-to-formatted', finality: 'unknown', insertions: 0, deletions: 0, substitutions: 0, comparedDictations: 3, changedDictations: 0,
  }]};
}
