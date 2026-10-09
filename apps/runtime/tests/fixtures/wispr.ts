// Private published-file fixture for Wispr scenarios and browser checks (Hub #927). No collector or database runs.
import {chmod, mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {WisprConfig} from '@jimmie-potts/wispr';
import {emptySnapshot, emptyTotals, validateSnapshot, type CollectorStatus} from '@jimmie-potts/wispr-contracts';

export type WisprFixture = {
  readonly observation: 'fresh' | 'stale' | 'missing';
  readonly exposeToDashboard?: boolean;
  readonly language?: boolean;
};

/** Select only files in this fresh disposable run's private configuration folder, before its runtime starts. */
export async function prepareWisprFixture(configDir: string, observedAtMs: number, fixture: WisprFixture): Promise<WisprConfig> {
  const folder = join(configDir, 'wispr');
  await mkdir(folder, {recursive: true, mode: 0o700}); await chmod(folder, 0o700);
  const config: WisprConfig = {
    sourceId: 'dictation-sim', aggregatePath: join(folder, 'aggregate.json'), diagnosticsPath: join(folder, 'status.json'),
    freshnessMs: 600_000, exposeToDashboard: fixture.exposeToDashboard === true, shareTextAggregates: false,
  };
  if (fixture.observation === 'missing') return config;
  const time = new Date(observedAtMs - (fixture.observation === 'stale' ? 3_600_000 : 0));
  const now = time.toISOString(), date = now.slice(0, 10);
  const snapshot = emptySnapshot({namespace: randomUUID(), generation: randomUUID(), now, timezone: 'UTC'});
  snapshot.health = 'ok'; snapshot.revision = 1; snapshot.lastSuccessAt = now; snapshot.latestSourceDate = date;
  const cell = {...emptyTotals(), date, hour: time.getUTCHours(), weekday: time.getUTCDay(),
    app: 'chatgpt' as const, category: 'ai-prompts' as const, archived: false,
    words: 120, dictations: 3, speechSeconds: 60, speechWords: 120, speechSamples: 3};
  snapshot.numeric.cells = [cell];
  for (const key of Object.keys(snapshot.numeric.totals) as (keyof typeof snapshot.numeric.totals)[]) snapshot.numeric.totals[key] = cell[key];
  snapshot.coverage.captured = {from: date, to: date}; snapshot.coverage.retained = {...snapshot.coverage.captured};
  snapshot.coverage.sourceRows = 3; snapshot.coverage.statuses.formatted = 3;
  if (fixture.language === true) {
    // Same synthetic supported term and table as modules/wispr/tests/support.ts; no source text is collected.
    snapshot.language = {availability: 'available', algorithmVersion: 'english-1', stopwordVersion: 'english-stop-1', tables: [{
      preset: 'today', app: 'all', category: 'all', corpus: 'formatted', words: [{text: '=SUM(1,2)', occurrences: 3, dictations: 3}],
      usefulWords: [], phrases: [], changes: [], omitted: {words: 0, usefulWords: 0, phrases: 0, changes: 0},
      coverage: {eligible: 3, missing: 0, unsupportedLanguage: 0, oversized: 0, uncertain: 0, longChanges: 0},
      comparison: 'raw-to-formatted', finality: 'unknown', insertions: 0, deletions: 0, substitutions: 0, comparedDictations: 3, changedDictations: 0,
    }]};
  }
  if (!validateSnapshot(snapshot).ok) throw new Error('the synthetic Wispr snapshot is invalid');
  const status: CollectorStatus = {schemaVersion: '1.0', namespace: snapshot.namespace, generation: snapshot.generation, revision: snapshot.revision,
    lastAttemptAt: now, lastSuccessAt: now, latestSourceDate: date, health: snapshot.health, languageEnabled: fixture.language === true};
  for (const [file, value] of [[config.aggregatePath, snapshot], [config.diagnosticsPath, status]] as const) {
    await writeFile(file, JSON.stringify(value), {mode: 0o600}); await chmod(file, 0o600);
  }
  return config;
}
