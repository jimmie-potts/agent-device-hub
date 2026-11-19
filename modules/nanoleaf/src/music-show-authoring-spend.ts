import {MUSIC_AUTHORING_MODEL} from './music-show-data.js';
import {execute, first, number, transaction, type Db} from './sqlite.js';
export const AUTHORING_MAX_OUTPUT_TOKENS = 4096;
const MONTHLY_CEILING_MICROS = 20_000_000;
const DAILY_PACE_MICROS = 3_000_000;

export const authoringCostMicros = (inputTokens: number, outputTokens: number): number =>
  inputTokens * 8 + outputTokens * 40;

type Admission = 'admitted' | 'duplicate' | 'monthly-ceiling' | 'daily-pace';

export class MusicShowAuthoringSpend {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
    transaction(db, () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS music_show_authoring_spend (
          request_id TEXT PRIMARY KEY NOT NULL,
          model TEXT NOT NULL,
          day TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('dispatched', 'settled', 'uncertain')),
          reserved_micros INTEGER NOT NULL CHECK (reserved_micros > 0),
          cost_micros INTEGER CHECK (cost_micros >= 0),
          CHECK ((status = 'settled') = (cost_micros IS NOT NULL))
        ) STRICT;
        CREATE INDEX IF NOT EXISTS music_show_authoring_spend_day ON music_show_authoring_spend(day);
        UPDATE music_show_authoring_spend SET status='uncertain' WHERE status='dispatched';
      `);
    });
  }

  /** Commit the budget and attempt together, immediately before transport. A restart never resends it. */
  dispatch(requestId: string, reservedMicros: number, nowMs: number): Admission {
    const at = new Date(nowMs);
    const month = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}`;
    const day = `${month}-${String(at.getDate()).padStart(2, '0')}`;
    return transaction(this.#db, (): Admission => {
      if (first(this.#db, 'SELECT 1 FROM music_show_authoring_spend WHERE request_id=?', requestId) !== undefined) {
        return 'duplicate';
      }
      const held = first(this.#db, `SELECT COALESCE(SUM(COALESCE(cost_micros, reserved_micros)), 0),
        COALESCE(SUM(CASE WHEN day=? THEN COALESCE(cost_micros, reserved_micros) ELSE 0 END), 0)
        FROM music_show_authoring_spend WHERE day>=? AND day<?`, day, `${month}-01`, `${month}-32`);
      if (held === undefined) throw new Error('Music authoring spend totals are missing.');
      if (number(held, 0) + reservedMicros > MONTHLY_CEILING_MICROS) return 'monthly-ceiling';
      if (number(held, 1) + reservedMicros > DAILY_PACE_MICROS) return 'daily-pace';
      execute(this.#db, `INSERT INTO music_show_authoring_spend
        (request_id,model,day,status,reserved_micros) VALUES (?,?,?,'dispatched',?)`,
      requestId, MUSIC_AUTHORING_MODEL, day, reservedMicros);
      return 'admitted';
    });
  }

  /** Keep the reservation when the attempt may have been billed and the response had no usable usage. */
  finish(requestId: string, costMicros: number | null): void {
    execute(this.#db, 'UPDATE music_show_authoring_spend SET status=?,cost_micros=? WHERE request_id=? AND status=\'dispatched\'',
      costMicros === null ? 'uncertain' : 'settled', costMicros, requestId);
  }
}
