// The display worker: one loop per device that places the tasks, starts comets and Locate, applies mode commands and
// pending wall edits, and keeps the lights showing them (bridge.py run_worker, update_display, play_preview). Shared input
// is the only task source, so the worker keeps running until its stop signal. Controls, holds and animation play are
// slice 3d's, and the runtime launches and restarts the worker (PORTING.md).
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {pyJsonAllowNan, pyJsonCompact} from './compat.js';
import {currentComet, pruneComets} from './comets.js';
import {followRegistry, loadConfig, registeredDevices} from './configuration.js';
import {connectState} from './database.js';
import {DEFAULT, deviceOf, lockFile, metaKey} from './devices.js';
import {dashboard, type Indication} from './line-projection.js';
import {applyPending, locateState, palette, paletteRgb, renderConfig} from './project-map.js';
import {COLORS, COMET_SECONDS, PULSE_SECONDS, RADIATING_PULSES, render, TRAVEL_SECONDS, type RenderConfig} from './renderer.js';
import {SceneRestorer, type Sender} from './scenes.js';
import {selected, sharedRenderConfig} from './shared-input.js';
import {execute, first, transaction, transactionAsync, type Db, type Row} from './sqlite.js';
import {controlState, markApplied, markDirty, overrides as overridesOf, type Overrides} from './store.js';
import {lightRequest, type LightRequest} from './transport.js';

export type {Sender} from './scenes.js';

/** Seconds a pass waits for another writer, as Python's worker connection did. */
export const WORKER_BUSY_SECONDS = 5.0;

/** The runtime's clock: epoch milliseconds (ModuleContext.clock). */
export interface WorkerClock {
  now(): number;
}

/** The runtime's timers (ModuleContext.scheduler): `after` returns a function that cancels the callback. */
export interface WorkerScheduler {
  after(delayMs: number, callback: () => void): () => void;
}

export interface WorkerOptions {
  /** The module's private state directory: the status database, its configuration, layouts, scene files and locks. */
  directory: string;
  device?: string;
  clock: WorkerClock;
  scheduler: WorkerScheduler;
  /** Stops the worker at its next wait (ModuleContext.signal). */
  signal: AbortSignal;
  /** The device transport, for layout reads, scene observation and every write. */
  request?: LightRequest;
  /** Replaces the rendered-effect sender, as Python's tests did. */
  send?: Sender;
  /** Restore the device's saved scene around the indicators (the default); false draws every state itself. */
  scenes?: boolean;
}

/** The worker's stop signal ended a wait. */
class Stopped extends Error {
  override name = 'Stopped';
}

/** A mode command or hold made a running preview stale. */
class PreviewCancelled extends Error {
  override name = 'PreviewCancelled';
}

const SQLITE_BUSY = 5;
const isBusy = (error: unknown): boolean => error instanceof Error && 'errcode' in error && error.errcode === SQLITE_BUSY;

/** The instant the newest radiating pulse of any working, question or blocked task has crossed the device. */
export function introductionEnds(snapshot: readonly Indication[]): number {
  let latest = 0;
  for (const activity of snapshot) {
    if (activity === null || activity[0] === 'unread' || activity[0] === 'idle') continue;
    latest = Math.max(latest, Number(activity[1]) + (RADIATING_PULSES - 0.5) * PULSE_SECONDS + TRAVEL_SECONDS);
  }
  return latest;
}

/**
 * Send the display unless the same looping state is already shown, and keep the device's receipt of the last fully
 * accepted send. A send that fails changes nothing.
 */
export async function updateDisplay(db: Db, config: RenderConfig, snapshot: readonly Indication[], instant: number, loop: boolean,
  send?: Sender): Promise<void> {
  const device = deviceOf(config);
  const encoded = pyJsonAllowNan([snapshot, config._comet ?? null, config._locate ?? null, config._style ?? null, config._coverage ?? null,
    config._signatures ?? null, config._steady_slots ?? null, config._wave_suppressed_slots ?? null, config._wave_cutoff ?? null,
    config._palette ?? null]);
  const previous = first(db, 'SELECT snapshot,looping FROM display_v3 WHERE device=?', device);
  if (!loop || previous?.[0] !== encoded || previous[1] !== 1) {
    const output = await (send ?? render)(config, snapshot, instant, loop);
    const receipt = typeof output === 'object' && output !== null && !Array.isArray(output)
      ? output : {apiVersion: '1.0', deviceId: device, outcome: 'unknown'};
    execute(db, 'INSERT OR REPLACE INTO meta VALUES (?, ?)', metaKey('rendering_receipt', device), pyJsonCompact(receipt));
    execute(db, 'INSERT OR REPLACE INTO display_v3 (snapshot, looping, rendered, device) VALUES (?, ?, ?, ?)', encoded, loop ? 1 : 0, instant, device);
  }
}

/** Record a failed pass for this device only; false when even that cannot be written. */
export function recordFailure(directory: string, device: string = DEFAULT): boolean {
  try {
    const db = connectState(directory);
    try {
      db.exec('BEGIN IMMEDIATE');
      execute(db, 'INSERT OR REPLACE INTO meta VALUES (?, ?)', metaKey('control_error', device), 'Light update failed; retrying.');
      markDirty(db);
      db.exec('COMMIT');
    } finally {
      db.close();
    }
    return true;
  } catch {
    return false;
  }
}

/** Show one status (or every status, or a comet) on the middle element, and end on the idle base. */
export async function playPreview(config: RenderConfig, choice: string, send: Sender, sleep: (seconds: number) => Promise<void>,
  now: () => number): Promise<void> {
  const base: RenderConfig = {...config, _comet: null, _locate: null};
  const count = base.line_groups.length;
  const source = Math.floor(count / 2);
  const empty = (): Indication[] => Array.from({length: count}, () => null);
  if (choice === 'comet') {
    await send({...base, _comet: {source, started: now()}}, empty(), now(), false);
    await sleep(COMET_SECONDS);
    return;
  }
  for (const status of choice === 'all' ? Object.keys(COLORS) : [choice]) {
    const snapshot = empty();
    snapshot[source] = [status, now()];
    for (let pulse = 0; pulse < RADIATING_PULSES; pulse += 1) {
      const started = now();
      await send(base, snapshot, started, false);
      await sleep(Math.max(0, started + PULSE_SECONDS - now()));
    }
    await send(base, snapshot, now(), true);
    await sleep(PULSE_SECONDS);
  }
  await send(base, empty(), now(), true);
  await sleep(2);
}

/**
 * Run the device's worker until `signal` stops it. False when another instance holds the device's lock; true when it
 * stopped, or its device was removed. A failed pass rejects; the runtime records it and restarts the worker.
 */
export async function runWorker(options: WorkerOptions): Promise<boolean> {
  const {directory, clock, scheduler, signal} = options;
  const device = options.device ?? DEFAULT;
  const primary = device === DEFAULT;
  const key = (name: string): string => metaKey(name, device);
  const now = (): number => clock.now() / 1000;
  const connect = (): Db => connectState(directory, {timeout: WORKER_BUSY_SECONDS});
  const sleep = (seconds: number): Promise<void> => new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Stopped());
      return;
    }
    const onAbort = (): void => {
      cancel();
      reject(new Stopped());
    };
    const cancel = scheduler.after(seconds * 1000, () => {
      signal.removeEventListener('abort', onAbort);
      if (signal.aborted) reject(new Stopped());
      else resolve();
    });
    signal.addEventListener('abort', onAbort, {once: true});
  });
  // One locked instance per device; the lock file lives in the module's private state directory.
  const guard = new DatabaseSync(join(directory, lockFile(device)), {timeout: 0});
  try {
    guard.exec('BEGIN EXCLUSIVE');
  } catch (error) {
    guard.close();
    if (isBusy(error)) return false;
    throw error;
  }
  try {
    const request = options.request ?? lightRequest;
    const config: RenderConfig = await loadConfig(directory, device, request);
    config._now = now;
    config._controller_request = request;
    const scenes = options.scenes === false ? null : new SceneRestorer(directory, config, request);
    const sender: Sender = options.send ?? (scenes !== null
      ? (value, snapshot, instant, loop) => scenes.send(value, snapshot, instant, loop)
      : (value, snapshot, instant, loop) => render(value, snapshot, instant, loop));
    for (;;) {
      if (signal.aborted) return true;
      // The device was removed; its instance stops without another request.
      if (!primary && !registeredDevices(directory).includes(device)) return true;
      followRegistry(directory, config, device);
      const [shared, control, overrides] = read(connect, db => [selected(db), controlState(db, device), overridesOf(db, device)] as const);
      const mode = control.mode;
      const pendingMode = control.revision !== control.applied;
      config._mode = mode;
      config._wave_cutoff = control.wave_cutoff;
      config._brightness = overrides.brightness;
      // Desired power off silences indicator, restoration and preview writes; a pending mode command still applies its
      // own policy (it cleared any override).
      const dark = overrides.power === false && !pendingMode;
      // Free mode does not even poll the light controller after handoff.
      const observing = scenes !== null && (mode !== 'free' || pendingMode);
      const externalScene = observing ? await scenes.observe() : false;
      const changed = (db: Db): boolean => controlState(db, device).revision !== control.revision;
      const restart = (db: Db): boolean => changed(db) || !sameOverrides(overridesOf(db, device), overrides);
      const preview = pass(connect, db => {
        if (restart(db)) return undefined;
        const value = first(db, 'SELECT value FROM meta WHERE key=?', key('preview'));
        if (value !== undefined) {
          execute(db, 'DELETE FROM meta WHERE key=?', key('preview'));
          // Previews show the chosen colors.
          config._palette = paletteRgb(palette(db));
        }
        return value ?? null;
      });
      if (preview === undefined) continue;
      if (preview !== null && mode !== 'free' && !dark) {
        const previewSend: Sender = async (value, snapshot, instant, loop) => {
          const check = connect();
          try {
            await transactionAsync(check, async () => {
              if (changed(check)) throw new PreviewCancelled();
              await sender(value, snapshot, instant, loop);
            });
          } finally {
            check.close();
          }
        };
        const previewSleep = async (seconds: number): Promise<void> => {
          const deadline = now() + seconds;
          while (now() < deadline) {
            await sleep(Math.min(0.25, deadline - now()));
            if (read(connect, changed)) throw new PreviewCancelled();
          }
        };
        try {
          await playPreview(config, String(preview[0]), previewSend, previewSleep, now);
        } catch (error) {
          if (!(error instanceof PreviewCancelled)) throw error;
        }
        pass(connect, db => execute(db, 'DELETE FROM display_v3 WHERE device=?', device));
        continue;
      }
      const started = now();
      const outcome = await passAsync(connect, async db => {
        if (changed(db)) return 'restart';
        pruneComets(db, started, mode, device);
        if (applyPending(db, device)) markDirty(db);
        config._locate = locateState(db, config, started, mode);
        const snapshot = dashboard(db, config, started);
        config._comet = mode === 'work' && config._locate === null ? currentComet(db, started, device) : null;
        renderConfig(db, config, snapshot);
        sharedRenderConfig(db, config);
        const generation = eventRevision(db);
        db.exec('COMMIT');
        db.exec('BEGIN IMMEDIATE');
        if (changed(db) || !sameRow(eventRevision(db), generation)) return 'restart';
        // Overrides and queued controls must come from one locked read.
        if (!sameOverrides(overridesOf(db, device), overrides)) return 'restart';
        const waves = snapshot.map(item => (item !== null && Number(item[1]) > control.wave_cutoff ? item : null));
        const loop = config._locate === null && (mode !== 'work' || (config._comet === null && started >= introductionEnds(waves)));
        const shown = snapshot.some(item => item !== null) || config._comet !== null || config._locate !== null;
        if (pendingMode || (scenes !== null && mode !== 'free' && (externalScene || (shown || mode === 'quiet') !== scenes.state.owned))) {
          execute(db, 'DELETE FROM display_v3 WHERE device=?', device);
        }
        if (mode === 'free') {
          if (pendingMode) await sender(config, snapshot.map(() => null), started, true);
          execute(db, 'DELETE FROM display_v3 WHERE device=?', device);
        } else if (!dark) {
          await updateDisplay(db, config, snapshot, started, loop, sender);
        }
        // A concurrent decision can commit between journaled sends.
        if (changed(db) || !sameOverrides(overridesOf(db, device), overrides)) return 'restart';
        markApplied(db, control.revision, device);
        execute(db, 'DELETE FROM meta WHERE key IN (?, ?)', 'dirty', key('control_error'));
        const watching = selected(db) || first(db, 'SELECT 1 FROM receipts LIMIT 1') !== undefined
          || (scenes !== null && mode !== 'free' && (shown || mode === 'quiet'));
        if (loop && !watching) {
          execute(db, 'DELETE FROM meta WHERE key=?', key('rendering'));
          return 'idle';
        }
        execute(db, 'INSERT OR REPLACE INTO meta VALUES (?, ?)', key('rendering'), '1');
        return {loop, generation};
      });
      if (outcome === 'restart') continue;
      if (outcome === 'idle') return true;
      let deadline = started + (outcome.loop ? 1.0 : PULSE_SECONDS);
      if (shared) deadline = Math.min(deadline, started + 1);
      if (config._locate !== null) deadline = Math.min(deadline, (config._locate?.started ?? started) + 1);
      if (config._comet !== null) deadline = Math.min(deadline, (config._comet?.started ?? started) + COMET_SECONDS);
      while (now() < deadline) {
        await sleep(Math.min(0.25, deadline - now()));
        // Another device's instance may already have cleared the global dirty flag; any change since this pass's
        // rendered revision still wakes this device.
        if (woken(directory, outcome.generation, key('preview'))) break;
      }
    }
  } catch (error) {
    if (error instanceof Stopped) return true;
    throw error;
  } finally {
    guard.close();
  }
}

const sameOverrides = (left: Overrides, right: Overrides): boolean => left.power === right.power && left.brightness === right.brightness;

const sameRow = (left: Row | undefined, right: Row | undefined): boolean =>
  left === undefined || right === undefined ? left === right : left.length === right.length && left.every((value, i) => value === right[i]);

const eventRevision = (db: Db): Row | undefined => first(db, "SELECT value FROM meta WHERE key='event_revision'");

/** A read on its own connection. */
function read<T>(connect: () => Db, body: (db: Db) => T): T {
  const db = connect();
  try {
    return body(db);
  } finally {
    db.close();
  }
}

/** One immediate transaction on its own connection, as Python's `with connect() as db, db:` with BEGIN IMMEDIATE. */
function pass<T>(connect: () => Db, body: (db: Db) => T): T {
  const db = connect();
  try {
    return transaction(db, () => body(db));
  } finally {
    db.close();
  }
}

/** pass() for a body that sends to the device while it holds the write lock. */
async function passAsync<T>(connect: () => Db, body: (db: Db) => Promise<T>): Promise<T> {
  const db = connect();
  try {
    return await transactionAsync(db, () => body(db));
  } finally {
    db.close();
  }
}

/** Whether the shared state changed since `generation`, or a preview waits; read without initializing the database. */
function woken(directory: string, generation: Row | undefined, preview: string): boolean {
  const db = new DatabaseSync(join(directory, 'status.sqlite'), {timeout: 2500});
  try {
    return first(db, "SELECT 1 FROM meta WHERE (key='event_revision' AND value IS NOT ?) OR key=? LIMIT 1",
      generation?.[0] ?? null, preview) !== undefined;
  } finally {
    db.close();
  }
}
