// The device's own record of its live Music session (#1272, design D4): the latest session its single writer admitted,
// as `music-lighting-device` publishes it. Every function runs inside the caller's synchronous transaction and reports a
// change through `report`, so the record commits with the change it describes. It imports only the journal's types, so
// the journal can end a session whose start ends before its first frame. It also keeps each light's last read selection
// (#1614), which the light's `nanoleaf-wall` record publishes.
import type {ErrorCode} from '@jimmie-potts/event-contracts/v2';
import type {LightingDeviceState, LightingEnded, LightingEndReason, LightingRestoration} from '@jimmie-potts/event-contracts/v2/music-lighting-data';
import type {End, JournalRow, Report} from './journal.js';
import {RESTORES, restoresOf, type MusicBase, type Restores, type SelectionRead} from './music-base.js';
import {execute, first, text, type Db} from './sqlite.js';

export const MUSIC_PLAY = 'music.play';
export const MUSIC_STOP = 'music.stop';

export type MusicSessionRow = {device: string; generation: string; status: 'starting' | 'playing' | 'ended'; startId: string; ended: LightingEnded | null};

/**
 * One row per light: `status` is starting, playing or ended; a row read with another ends as ended. Each light's last
 * read selection (#1614) has its own row, kept only from the reads a Start and a playing session already make.
 */
export function initMusicSessions(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS nanoleaf_music_sessions (device TEXT PRIMARY KEY, generation TEXT NOT NULL,
    status TEXT NOT NULL, start_id TEXT NOT NULL, detail TEXT NOT NULL, ended TEXT) STRICT;
    CREATE TABLE IF NOT EXISTS nanoleaf_selections (device TEXT PRIMARY KEY, selection TEXT NOT NULL, saved INTEGER NOT NULL,
    restores TEXT NOT NULL, read_at_ms INTEGER NOT NULL) STRICT`);
}

/** How long an unchanged selection keeps its read time, so a playing session's once-per-second read republishes nothing. */
export const SELECTION_REFRESH_MS = 60_000;
export type SavedSelection = SelectionRead & {readAtMs: number};

/** The light's last read selection, or none before the first read since the store began. */
export function lastSelection(db: Db, device: string): SavedSelection | undefined {
  const row = first(db, 'SELECT selection,saved,restores,read_at_ms FROM nanoleaf_selections WHERE device=?', device);
  if (row === undefined) return undefined;
  const restores = text(row, 2);
  return {selection: text(row, 0), saved: row[1] === 1, restores: (RESTORES as readonly string[]).includes(restores) ? restores as Restores : 'nothing',
    readAtMs: Number(row[3])};
}

/**
 * Keeps one read of the light's selection and reports a change: always when what it found changed, and otherwise once
 * `SELECTION_REFRESH_MS` has passed since the kept read time.
 */
export function saveSelection(db: Db, device: string, read: SelectionRead, atMs: number, report: Report): void {
  const kept = lastSelection(db, device);
  const readAtMs = Math.max(0, Math.round(atMs));
  if (kept !== undefined && kept.selection === read.selection && kept.saved === read.saved && kept.restores === read.restores &&
    readAtMs - kept.readAtMs < SELECTION_REFRESH_MS) return;
  execute(db, 'INSERT OR REPLACE INTO nanoleaf_selections VALUES (?,?,?,?,?)', device, read.selection, read.saved ? 1 : 0, read.restores, readAtMs);
  report({type: 'selection', device});
}

/** The latest admitted session's generation and what its ending puts back, from the base it was admitted with. */
export function sessionBase(db: Db, device: string): {generation: string; restores: Restores} | undefined {
  const row = first(db, 'SELECT generation,detail FROM nanoleaf_music_sessions WHERE device=?', device);
  if (row === undefined) return undefined;
  const base = (JSON.parse(text(row, 1)) as {freeBase?: Partial<MusicBase> & {name?: unknown}}).freeBase;
  // A session admitted before #1614 kept only a named scene's name and brightness.
  const restores = base?.kind === undefined ? (typeof base?.name === 'string' ? 'scene' : 'nothing') : restoresOf(base as MusicBase);
  return {generation: text(row, 0), restores};
}

export function musicSession(db: Db, device: string): MusicSessionRow | undefined {
  const row = first(db, 'SELECT generation,status,start_id,ended FROM nanoleaf_music_sessions WHERE device=?', device);
  if (row === undefined) return undefined;
  const status = text(row, 1);
  return {device, generation: text(row, 0), status: status === 'starting' || status === 'playing' ? status : 'ended', startId: text(row, 2),
    ended: typeof row[3] === 'string' ? JSON.parse(row[3]) as LightingEnded : null};
}

/** Whether a session, or the session of `generation`, is starting or playing on the device. */
export function liveSession(db: Db, device: string, generation?: string): boolean {
  const session = musicSession(db, device);
  return session !== undefined && session.status !== 'ended' && (generation === undefined || session.generation === generation);
}

/** Replaces the device's record with a new starting session; `detail` is what it was admitted with. */
export function saveStarting(db: Db, device: string, generation: string, startId: string, detail: object, report: Report): void {
  execute(db, 'INSERT OR REPLACE INTO nanoleaf_music_sessions VALUES (?,?,?,?,?,NULL)', device, generation, 'starting', startId, JSON.stringify(detail));
  report({type: 'music', device});
}

export function markPlaying(db: Db, device: string, generation: string, report: Report): void {
  if (execute(db, "UPDATE nanoleaf_music_sessions SET status='playing' WHERE device=? AND generation=? AND status='starting'", device, generation) > 0) {
    report({type: 'music', device});
  }
}

/** The reasons whose ending names the refusal or failure behind it. */
const CODED: ReadonlySet<LightingEndReason> = new Set(['refused', 'expired', 'device']);

/**
 * Ends the session of `generation` if it is still starting or playing; false when it had already ended. A `refused`,
 * `expired` or `device` ending keeps `code`, the refusal or failure behind it.
 */
export function endSession(db: Db, device: string, generation: string, reason: LightingEndReason, restoration: LightingRestoration, atMs: number,
  report: Report, code?: ErrorCode): boolean {
  const ended: LightingEnded = {generation, reason, restoration, atMs: Math.max(0, Math.round(atMs)),
    ...(code !== undefined && CODED.has(reason) ? {code} : {})};
  const changed = execute(db, "UPDATE nanoleaf_music_sessions SET status='ended', ended=? WHERE device=? AND generation=? AND status<>'ended'",
    JSON.stringify(ended), device, generation) > 0;
  if (changed) report({type: 'music', device});
  return changed;
}

/** Why a session ends when its Start ends before the first frame, by how the Start's journal row ended, and its code. */
function startReason(end: End): {reason: LightingEndReason; code?: ErrorCode} | undefined {
  switch (end.kind) {
    case 'expired': return {reason: 'expired', code: 'expired'};
    // Only an explicit mode command retires a queued Start.
    case 'retired': return {reason: 'manual'};
    // A stored Start the module's restart ended never ran.
    case 'refused': return end.code === 'cancelled' ? {reason: 'restart'} : {reason: 'refused', code: end.code};
    case 'uncertain': return {reason: 'device', code: 'uncertain-result'};
    case 'answered': return {reason: 'device', code: end.code};
    case 'sent':
    case 'unchanged': return undefined;
  }
}

/**
 * A `music.play` row ended (from `finish`): a session still starting on it ends with no restoration, since nothing was
 * shown. The generation it ended, if any, so the caller ends the stops that waited on it.
 */
export function startEnded(db: Db, row: JournalRow, end: End, atMs: number, report: Report): string | undefined {
  const session = musicSession(db, row.device);
  const ending = startReason(end);
  if (session?.status !== 'starting' || session.startId !== row.id || ending === undefined) return undefined;
  return endSession(db, row.device, session.generation, ending.reason, 'none', atMs, report, ending.code) ? session.generation : undefined;
}

/** The device's record as `music-lighting-device` carries it, without the revision the runtime adds. */
export function musicDeviceState(db: Db, device: string): Omit<LightingDeviceState, 'revision'> {
  const session = musicSession(db, device);
  if (session === undefined) return {id: device, session: null};
  if (session.status === 'ended') return {id: device, session: session.ended === null ? null : {generation: session.generation, status: 'ended', ended: session.ended}};
  return {id: device, session: {generation: session.generation, status: session.status === 'playing' ? 'playing' : 'starting'}};
}
