// The session-to-Line projection: visible tasks placed on a device's elements (bridge.py `dashboard`).
import {deviceOf, type DeviceConfig} from './devices.js';
import {allocate} from './project-map.js';
import {visibleTasks} from './shared-input.js';
import {execute, rows, type Db, type SqlValue} from './sqlite.js';

/** One element's indication: its task's status and that status's wave epoch, or null for an unused element. */
export type Indication = readonly [SqlValue, SqlValue] | null;

/**
 * Place the device's visible tasks and return one indication per element. A task whose status phase
 * has no epoch yet gets one at `instant`; reserved comet sources keep their task.
 */
export function dashboard(db: Db, config: DeviceConfig & {line_groups: readonly unknown[]}, instant: number): Indication[] {
  const device = deviceOf(config);
  const tasks = visibleTasks(db, device);
  execute(db, 'DELETE FROM slots WHERE session NOT IN (SELECT id FROM sessions)');
  const count = config.line_groups.length;
  const reserved = new Set(rows(db, 'SELECT source FROM comets WHERE started IS NOT NULL AND device=?', device).map(row => row[0] ?? null));
  const assigned = allocate(db, config, tasks, reserved);
  const epochs = new Map(rows(db, 'SELECT * FROM activity').map(([session = null, turn = null, status = null, epoch = null]) =>
    [session, [turn, status, epoch] as const]));
  const snapshot: Indication[] = Array.from({length: count}, () => null);
  for (const [session, turn, status] of tasks) {
    const slot = assigned.get(session);
    if (slot === undefined || slot >= count) continue;
    let old = epochs.get(session);
    if (old === undefined || old[0] !== turn || old[1] !== status) {
      old = [turn, status, instant];
      execute(db, 'INSERT OR REPLACE INTO activity VALUES (?, ?, ?, ?)', session, ...old);
    }
    snapshot[slot] = [status, old[2]];
  }
  return snapshot;
}
