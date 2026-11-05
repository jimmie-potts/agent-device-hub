import type {DatabaseSync} from 'node:sqlite';
import type {Condition, WeatherState} from './contracts.js';

/** The conditions the last change signal described, which the next observation is compared with. */
export type Baseline = {condition: Condition; likely: boolean; temperatureF: number; alerts: string[]};
type Row = {revision: number; observedAtMs: number | null; baseline: Baseline | null};

/** One row: the revision, when the last observation was, and the baseline. It holds no weather a restart could republish as current. */
export class WeatherStore {
  readonly #db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.#db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS weather_meta(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,observed_at_ms INTEGER,baseline TEXT) STRICT;
      INSERT OR IGNORE INTO weather_meta(id,revision) VALUES(1,0);`);
  }
  read(): Row {
    const row = this.#db.prepare('SELECT revision,observed_at_ms,baseline FROM weather_meta WHERE id=1').get() as {revision: number; observed_at_ms: number | null; baseline: string | null};
    return {revision: row.revision, observedAtMs: row.observed_at_ms, baseline: row.baseline === null ? null : JSON.parse(row.baseline) as Baseline};
  }
  save(state: WeatherState, baseline: Baseline | null): void {
    this.#db.prepare('UPDATE weather_meta SET revision=?,observed_at_ms=?,baseline=? WHERE id=1').run(state.revision, state.observedAtMs, baseline === null ? null : JSON.stringify(baseline));
  }
}
