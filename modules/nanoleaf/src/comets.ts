// Completion comets on each device: pruning ended and stale ones, and starting the next (bridge.py prune_comets and
// current_comet). Each runs inside the caller's transaction.
import {DEFAULT} from './devices.js';
import {COMET_SECONDS, type Flash} from './renderer.js';
import {execute, first, type Db, type SqlValue} from './sqlite.js';

/**
 * Outside Work a device plays no comet. In Work a started comet ends after COMET_SECONDS, and a queued one is dropped
 * once its task is no longer unread in the turn that completed.
 */
export function pruneComets(db: Db, instant: number, mode: string, device: string = DEFAULT): void {
  if (mode !== 'work') {
    execute(db, 'DELETE FROM comets WHERE device=?', device);
    return;
  }
  execute(db, 'DELETE FROM comets WHERE device=? AND started IS NOT NULL AND started + ? <= ?', device, COMET_SECONDS, instant);
  execute(db, 'DELETE FROM comets WHERE device=? AND started IS NULL AND NOT EXISTS '
    + "(SELECT 1 FROM sessions s WHERE s.id=comets.session AND s.turn=comets.turn AND s.status='unread')", device);
}

function flash(source: SqlValue | undefined, started: SqlValue | undefined): Flash {
  if (typeof source !== 'number' || typeof started !== 'number') throw new TypeError('A started comet needs a source element and a start.');
  return {source, started};
}

/** The device's running comet; with none, the first queued comet whose task holds an element starts there at `instant`. */
export function currentComet(db: Db, instant: number, device: string = DEFAULT): Flash | null {
  const running = first(db, 'SELECT source,started FROM comets WHERE started IS NOT NULL AND device=?', device);
  if (running !== undefined) return flash(running[0], running[1]);
  const candidate = first(db, 'SELECT c.session,s.slot FROM comets c JOIN slots s ON s.session=c.session AND s.device=c.device '
    + 'WHERE c.device=? AND c.started IS NULL ORDER BY c.queued,c.rowid LIMIT 1', device);
  if (candidate === undefined) return null;
  const [session = null, source = null] = candidate;
  execute(db, 'UPDATE comets SET source=?,started=? WHERE session=? AND device=?', source, instant, session, device);
  return flash(source, instant);
}
