// Lighting modes: the explicit mode command for one device and its status (modes.py). Each runs inside the caller's
// transaction. Python also advanced the device's controller ledger and retired requested animations; the ledger and the
// integration API are not ported (PORTING.md), and the runtime launches the worker.
import {floatText} from './compat.js';
import {DEFAULT, metaKey} from './devices.js';
import {ValueError} from './errors.js';
import {execute, type Db} from './sqlite.js';
import {controlState, markDirty, overrides} from './store.js';

export const MODES = ['work', 'free', 'quiet'] as const;
export type Mode = typeof MODES[number];
export const isMode = (value: unknown): value is Mode => MODES.some(mode => mode === value);

/**
 * Apply an explicit mode command; true when a worker pass is needed. Any mode command, the current mode included, ends
 * the device's power and brightness overrides and counts as a new revision. A new mode also clears the device's preview,
 * comets and Locate, and a return to Work starts a new wave cutoff.
 */
export function changeMode(db: Db, mode: string, instant: number, device: string = DEFAULT): boolean {
  const key = (name: string): string => metaKey(name, device);
  const state = controlState(db, device);
  const current = overrides(db, device);
  const overridden = current.power !== null || current.brightness !== null;
  if (overridden) execute(db, 'DELETE FROM meta WHERE key IN (?, ?)', key('controller_power'), key('controller_brightness'));
  if (state.mode === mode && overridden) {
    execute(db, 'INSERT OR REPLACE INTO meta VALUES (?, ?)', key('mode_revision'), String(state.revision + 1));
    markDirty(db);
    return true;
  }
  if (state.mode !== mode) {
    execute(db, 'INSERT OR REPLACE INTO meta VALUES (?, ?)', key('mode'), mode);
    execute(db, 'INSERT OR REPLACE INTO meta VALUES (?, ?)', key('mode_revision'), String(state.revision + 1));
    if (mode === 'work') execute(db, 'INSERT OR REPLACE INTO meta VALUES (?, ?)', key('wave_cutoff'), floatText(instant));
    execute(db, 'DELETE FROM meta WHERE key=?', key('preview'));
    execute(db, 'DELETE FROM comets WHERE device=?', device);
    execute(db, 'DELETE FROM locate WHERE device=?', device);
    markDirty(db);
    return true;
  }
  return state.revision !== state.applied || (state.error !== null && state.error !== '');
}

/** modes.set_mode without the worker launch: refuse an unknown mode, then apply the command. */
export function setMode(db: Db, mode: unknown, instant: number, device: string = DEFAULT): boolean {
  if (!isMode(mode)) throw new ValueError('Unknown lighting mode.');
  return changeMode(db, mode, instant, device);
}

export interface ModeStatus {
  mode: string;
  pending: boolean;
  error: string | null;
}

/** modes.get_status: the device's mode, whether its worker has yet to apply it, and the last failure. */
export function modeStatus(db: Db, device: string = DEFAULT): ModeStatus {
  const state = controlState(db, device);
  return {mode: state.mode, pending: state.revision !== state.applied, error: state.error};
}
