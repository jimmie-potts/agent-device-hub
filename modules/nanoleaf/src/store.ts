// Shared records in the database's meta table: the display wake-up and each device's control state (store.py).
// Each runs inside the caller's transaction; none opens a connection.
import {parseFloatText, parseIntText} from './compat.js';
import {DEFAULT, metaKey} from './devices.js';
import {execute, rows, type Db, type SqlValue} from './sqlite.js';

export interface ControlState {
  mode: string;
  revision: number;
  applied: number;
  wave_cutoff: number;
  error: string | null;
}

export function markDirty(db: Db): void {
  execute(db, "INSERT INTO meta VALUES ('event_revision', '1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1");
  execute(db, "INSERT OR REPLACE INTO meta VALUES ('dirty', '1')");
}

/** Every meta row as key: value. */
export function meta(db: Db): Map<SqlValue, SqlValue> {
  return new Map(rows(db, 'SELECT key,value FROM meta').map(([key = null, value = null]) => [key, value]));
}

const textOf = (value: SqlValue | undefined, fallback: string): string => (value === undefined ? fallback : String(value));

export function controlState(db: Db, device: string = DEFAULT): ControlState {
  const values = meta(db);
  const value = (name: string): SqlValue | undefined => values.get(metaKey(name, device));
  const mode = value('mode');
  const error = value('control_error');
  return {
    mode: textOf(mode, 'work'),
    revision: parseIntText(textOf(value('mode_revision'), '0')),
    applied: parseIntText(textOf(value('mode_applied'), '0')),
    wave_cutoff: parseFloatText(textOf(value('wave_cutoff'), '-inf')),
    error: error === undefined || error === null ? null : String(error),
  };
}

/** Record that the device's worker has applied every mode command up to `revision`. */
export function markApplied(db: Db, revision: number, device: string = DEFAULT): void {
  execute(db, 'INSERT OR REPLACE INTO meta VALUES (?, ?)', metaKey('mode_applied', device), String(revision));
}
