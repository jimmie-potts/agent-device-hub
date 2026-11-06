// The device's own record of its live Music session (#1272, design D4): the latest session its single writer admitted,
// as `music-lighting-device` publishes it. Every function runs inside the caller's synchronous transaction and reports a
// change through `report`, so the record commits with the change it describes. It imports only the journal's types, so
// the journal can end a session whose start ends before its first frame.
import type {LightingDeviceState, LightingEnded, LightingEndReason, LightingRestoration} from '@jimmie-potts/event-contracts/v2/music-lighting-data';
import type {End, JournalRow, Report} from './journal.js';
import {execute, first, text, type Db} from './sqlite.js';

export const MUSIC_PLAY = 'music.play';
export const MUSIC_STOP = 'music.stop';

export type MusicSessionRow = {device: string; generation: string; status: 'starting' | 'playing' | 'ended'; startId: string; ended: LightingEnded | null};

/** One row per light: `status` is starting, playing or ended; a row read with another ends as ended. */
export function initMusicSessions(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS nanoleaf_music_sessions (device TEXT PRIMARY KEY, generation TEXT NOT NULL,
    status TEXT NOT NULL, start_id TEXT NOT NULL, detail TEXT NOT NULL, ended TEXT) STRICT`);
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

/** Ends the session of `generation` if it is still starting or playing; false when it had already ended. */
export function endSession(db: Db, device: string, generation: string, reason: LightingEndReason, restoration: LightingRestoration, atMs: number,
  report: Report): boolean {
  const ended: LightingEnded = {generation, reason, restoration, atMs: Math.max(0, Math.round(atMs))};
  const changed = execute(db, "UPDATE nanoleaf_music_sessions SET status='ended', ended=? WHERE device=? AND generation=? AND status<>'ended'",
    JSON.stringify(ended), device, generation) > 0;
  if (changed) report({type: 'music', device});
  return changed;
}

/** Why a session ends when its Start ends before the first frame, by how the Start's journal row ended. */
function startReason(end: End): LightingEndReason | undefined {
  switch (end.kind) {
    case 'expired': return 'expired';
    // Only an explicit mode command retires a queued Start.
    case 'retired': return 'manual';
    // A stored Start the module's restart ended never ran.
    case 'refused': return end.code === 'cancelled' ? 'restart' : 'refused';
    case 'uncertain':
    case 'answered': return 'device';
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
  const reason = startReason(end);
  if (session?.status !== 'starting' || session.startId !== row.id || reason === undefined) return undefined;
  return endSession(db, row.device, session.generation, reason, 'none', atMs, report) ? session.generation : undefined;
}

/** The device's record as `music-lighting-device` carries it, without the revision the runtime adds. */
export function musicDeviceState(db: Db, device: string): Omit<LightingDeviceState, 'revision'> {
  const session = musicSession(db, device);
  if (session === undefined) return {id: device, session: null};
  if (session.status === 'ended') return {id: device, session: session.ended === null ? null : {generation: session.generation, status: 'ended', ended: session.ended}};
  return {id: device, session: {generation: session.generation, status: session.status === 'playing' ? 'playing' : 'starting'}};
}
