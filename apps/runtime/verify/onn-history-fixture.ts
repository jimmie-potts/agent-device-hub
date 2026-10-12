import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import type {HistoryPage, HistoryDetail} from '@jimmie-potts/onn';
import type {MetadataSession} from '../../../modules/onn/dist/src/metadata.js';

/** Canonical owner queries over synthetic prior-day originals, confined to one capture. */
export async function historyBrowserFixture(priorDayMs: number): Promise<{
  history(query: Record<string, unknown>): HistoryPage;
  detail(query: Record<string, unknown>): HistoryDetail;
  close(): void;
}> {
  const {OnnHistoryStore} = await import(new URL('../../../../modules/onn/dist/src/history.js', import.meta.url).href) as typeof import('../../../modules/onn/dist/src/history.js');
  const database = new DatabaseSync(':memory:');
  const store = new OnnHistoryStore(database);
  database.exec('BEGIN');
  store.gap({intakeId: 'browser-startup', runId: 'synthetic-browser', poll: 0, receivedAtMs: priorDayMs, reason: 'startup'});
  database.exec('COMMIT');
  let poll = 0;
  const put = (app: 'youtube' | 'stremio', number: number, stable = false): void => {
    poll += 1;
    const receivedAtMs = priorDayMs + 20 * 60 * 60 * 1000 + poll * 1000;
    const metadata: MetadataSession = {
      app,
      metadata: {
        title: app === 'youtube' ? `SYNTHETIC prior YouTube title ${number}${number === 60 ? ' <script>synthetic</script>' + ' X'.repeat(300) : ''}` : 'SYNTHETIC prior series',
        displayTitle: null, subtitle: app === 'stremio' ? `SYNTHETIC prior episode ${number}` : null,
        artist: app === 'youtube' ? 'SYNTHETIC prior channel' : null, album: null, genre: null,
        description: null, mediaId: stable ? 'synthetic-last-episode' : null, durationMs: 120000,
      },
      playback: {state: 2, positionMs: number * 1000, speed: 0, positionUpdatedElapsedMs: receivedAtMs},
      omissions: [],
    };
    database.exec('BEGIN');
    try {
      assert.equal(store.ingest({intakeId: `browser-${poll}`, runId: 'synthetic-browser', poll, receivedAtMs,
        sample: {schema: 'onn-metadata/2.0', deviceElapsedMs: receivedAtMs, sessions: [metadata]}}), true);
      database.exec('COMMIT');
    } catch (error) {
      if (database.isTransaction) database.exec('ROLLBACK');
      throw error;
    }
  };
  try {
    for (let index = 1; index <= 60; index += 1) {put('youtube', index); put('stremio', index);}
    // Each revision belongs to one continuously identified episode, allowing detail continuation.
    for (let index = 1; index <= 60; index += 1) put('stremio', 61, true);
    return {
      history(query) {const page = store.history(query); assert.ok(!('error' in page)); return page;},
      detail(query) {const detail = store.detail(query); assert.ok(!('error' in detail)); return detail;},
      close() {database.close();},
    };
  } catch (error) {database.close(); throw error;}
}
