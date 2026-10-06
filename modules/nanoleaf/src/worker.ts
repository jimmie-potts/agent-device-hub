// The display worker: one loop per device that places the tasks, starts comets and Locate, applies mode commands and
// pending wall edits, and keeps the lights showing them (bridge.py run_worker, update_display, play_preview). Shared input
// is the only task source, so the worker keeps running until its stop signal. It also makes the device writes of
// accepted controls and requested animations, journaled with their outcomes (controls.ts); the runtime launches and
// restarts the worker (PORTING.md).
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
import {animationPayload, Cancelled, controlPayload, discovered, Execution, playAnimation, queuedContent, queuedMode, Refused} from './controls.js';
import type {AnimationCommand, Display} from './effects.js';
import {ANIMATION, expireQueued, finish, held, journalRow, recoverAttempts, type ErrorCode, type Transact} from './journal.js';
import {SceneRestorer, type Sender} from './scenes.js';
import {selected, sharedRenderConfig} from './shared-input.js';
import {execute, first, transaction, type Db, type Row} from './sqlite.js';
import {controlState, markApplied, markDirty, overrides as overridesOf, type Overrides} from './store.js';
import {lightRequest, type LightAddress, type LightRequest} from './transport.js';

export type {Sender} from './scenes.js';

/** The runtime's clock: epoch milliseconds (ModuleContext.clock). */
export interface WorkerClock {
  now(): number;
}

/** The runtime's timers (ModuleContext.scheduler): `after` returns a function that cancels the callback. */
export interface WorkerScheduler {
  after(delayMs: number, callback: () => void): () => void;
}

export interface WorkerOptions {
  /** The module's private state directory: its configuration, layouts, scene files and device locks. */
  directory: string;
  /** The module's database (ModuleContext.database), opened on the first call. */
  database: () => Db;
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
  /** Runs each transaction that ends commands, so their outcomes commit with it (the runtime's outbox). */
  transact: Transact;
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

/** The display cache's text for a state: the snapshot and every render setting that changes the frames. */
function displayText(config: RenderConfig, snapshot: readonly Indication[]): string {
  return pyJsonAllowNan([snapshot, config._comet ?? null, config._locate ?? null, config._style ?? null, config._coverage ?? null,
    config._signatures ?? null, config._steady_slots ?? null, config._wave_suppressed_slots ?? null, config._wave_cutoff ?? null,
    config._palette ?? null]);
}

/**
 * Send the display unless the same looping state is already shown, and keep the device's receipt of the last fully
 * accepted send. A send that fails changes nothing. No transaction is open while it sends: the cache is read before,
 * and the receipt and cache are saved in one short transaction after.
 */
export async function updateDisplay(db: Db, config: RenderConfig, snapshot: readonly Indication[], instant: number, loop: boolean,
  send?: Sender): Promise<void> {
  const device = deviceOf(config);
  const encoded = displayText(config, snapshot);
  const previous = first(db, 'SELECT snapshot,looping FROM display_v3 WHERE device=?', device);
  if (loop && previous?.[0] === encoded && previous[1] === 1) return;
  const output = await (send ?? render)(config, snapshot, instant, loop);
  const receipt = typeof output === 'object' && output !== null && !Array.isArray(output)
    ? output : {apiVersion: '1.0', deviceId: device, outcome: 'unknown'};
  transaction(db, () => {
    execute(db, 'INSERT OR REPLACE INTO meta VALUES (?, ?)', metaKey('rendering_receipt', device), pyJsonCompact(receipt));
    execute(db, 'INSERT OR REPLACE INTO display_v3 (snapshot, looping, rendered, device) VALUES (?, ?, ?, ?)', encoded, loop ? 1 : 0, instant, device);
  });
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
 * stopped, its device was removed, or a hold stops its writes and shared input is not selected or the hold came during
 * a pass; the runtime starts it again when a command is accepted. A failed pass rejects; the runtime records it and
 * restarts the worker.
 *
 * No transaction is open across a wait or a device request: each step decides in one short transaction, sends after
 * it commits, and checks again in a new one. Python held its write lock while it sent; here a change that commits
 * during a send is seen by the checks after it. Transactions that end commands go through `transact`, so each outcome
 * commits with the change it reports.
 */
export async function runWorker(options: WorkerOptions): Promise<boolean> {
  const {directory, clock, scheduler, signal, transact} = options;
  const device = options.device ?? DEFAULT;
  const primary = device === DEFAULT;
  const key = (name: string): string => metaKey(name, device);
  const now = (): number => clock.now() / 1000;
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
    const db = options.database();
    // Only the device's locked worker ends its unfinished attempts: one without a result may have reached the device.
    // A native control unsent past its expiry fails here; an animation's expiry waits for the pass, as in Python.
    const heldAtStart = await transact(report => {
      recoverAttempts(db, device, report);
      expireQueued(db, device, now(), report, true);
      return held(db, controlState(db, device).revision, device) && !selected(db);
    });
    if (heldAtStart) return true;
    const request = options.request ?? lightRequest;
    const config: RenderConfig = await loadConfig(directory, device, request);
    config._now = now;
    let active: Execution | null = null;
    // Each write of a journaled command goes through its execution; reads never do.
    const controllerRequest: LightRequest = (target, method, endpoint, payload) => {
      const execution = active;
      return execution !== null && method !== 'GET' ? execution.call(() => request(target, method, endpoint, payload))
        : request(target, method, endpoint, payload);
    };
    config._controller_request = controllerRequest;
    const scenes = options.scenes === false ? null : new SceneRestorer(directory, config, controllerRequest);
    const sender: Sender = options.send ?? (scenes !== null
      ? (value, snapshot, instant, loop) => scenes.send(value, snapshot, instant, loop)
      : (value, snapshot, instant, loop) => render(value, snapshot, instant, loop));
    for (;;) {
      if (signal.aborted) return true;
      // The device was removed; its instance stops without another request.
      if (!primary && !registeredDevices(directory).includes(device)) return true;
      followRegistry(directory, config, device);
      const shared = selected(db);
      const control = controlState(db, device);
      const overrides = overridesOf(db, device);
      if (held(db, control.revision, device)) {
        // An uncertain or unsent command holds the device's writes until an explicit choice: a mode command, or a fresh
        // control or animation. Commands queued behind the hold still expire.
        if (!shared) return true;
        await transact(report => expireQueued(db, device, now(), report));
        await sleep(1);
        continue;
      }
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
      const changed = (): boolean => controlState(db, device).revision !== control.revision;
      const overtaken = (): boolean => held(db, control.revision, device) || changed();
      // A control admitted during the device round trip restarts the pass.
      const restart = (): boolean => changed() || !sameOverrides(overridesOf(db, device), overrides);
      const preview = await transact(report => {
        if (held(db, control.revision, device)) return HELD;
        if (changed()) return undefined;
        if (observing) discovered(db, scenes.names, device, report);
        if (!sameOverrides(overridesOf(db, device), overrides)) return undefined;
        const value = first(db, 'SELECT value FROM meta WHERE key=?', key('preview'));
        if (value !== undefined) {
          execute(db, 'DELETE FROM meta WHERE key=?', key('preview'));
          // Previews show the chosen colors.
          config._palette = paletteRgb(palette(db));
        }
        return value ?? null;
      });
      if (preview === HELD) return true;
      if (preview === undefined) continue;
      if (preview !== null && mode !== 'free' && !dark) {
        const previewSend: Sender = async (value, snapshot, instant, loop) => {
          if (overtaken()) throw new PreviewCancelled();
          await sender(value, snapshot, instant, loop);
        };
        const previewSleep = async (seconds: number): Promise<void> => {
          const deadline = now() + seconds;
          while (now() < deadline) {
            await sleep(Math.min(0.25, deadline - now()));
            if (changed()) throw new PreviewCancelled();
          }
        };
        try {
          await playPreview(config, String(preview[0]), previewSend, previewSleep, now);
        } catch (error) {
          if (!(error instanceof PreviewCancelled)) throw error;
        }
        execute(db, 'DELETE FROM display_v3 WHERE device=?', device);
        continue;
      }
      const started = now();
      const pass = await transact(report => {
        if (held(db, control.revision, device)) return HELD;
        if (changed()) return undefined;
        pruneComets(db, started, mode, device);
        // Queued commands past their expiry fail and hold the device (integration_api.process).
        expireQueued(db, device, started, report);
        if (applyPending(db, device)) markDirty(db);
        config._locate = locateState(db, config, started, mode);
        const snapshot = dashboard(db, config, started);
        config._comet = mode === 'work' && config._locate === null ? currentComet(db, started, device) : null;
        renderConfig(db, config, snapshot);
        sharedRenderConfig(db, config);
        if (held(db, control.revision, device)) return HELD;
        // Overrides and queued controls must come from one locked read.
        if (!sameOverrides(overridesOf(db, device), overrides)) return undefined;
        const waves = snapshot.map(item => (item !== null && Number(item[1]) > control.wave_cutoff ? item : null));
        const loop = config._locate === null && (mode !== 'work' || (config._comet === null && started >= introductionEnds(waves)));
        const shown = snapshot.some(item => item !== null) || config._comet !== null || config._locate !== null;
        if (pendingMode || (scenes !== null && mode !== 'free' && (externalScene || (shown || mode === 'quiet') !== scenes.state.owned))) {
          execute(db, 'DELETE FROM display_v3 WHERE device=?', device);
        }
        return {snapshot, loop, shown, generation: eventRevision(db), command: queuedMode(db, device, control.revision)};
      });
      if (pass === HELD) return true;
      if (pass === undefined) continue;
      // The pass's own mode command, if one was admitted, journals each write this pass makes for it.
      const execution = new Execution(db, control.revision, pass.command, device, transact);
      // A replaced sender is one write; the device's own sender makes each of its requests through the execution.
      const guarded: Sender = options.send === undefined ? sender
        : (value, snapshot, instant, loop) => execution.call(() => sender(value, snapshot, instant, loop));
      const applyMode = async (): Promise<void> => {
        active = execution;
        if (mode === 'free') {
          if (pendingMode) await guarded(config, pass.snapshot.map(() => null), started, true);
          execute(db, 'DELETE FROM display_v3 WHERE device=?', device);
        } else if (!dark) {
          await updateDisplay(db, config, pass.snapshot, started, pass.loop, guarded);
        }
        await execution.complete();
      };
      const end = (id: string, code: ErrorCode): Promise<void> => transact(report => {
        const row = journalRow(db, id);
        if (row !== undefined) finish(db, row, {kind: 'refused', code}, report);
      });
      const applyControls = async (): Promise<void> => {
        // Native one-shot writes and requested animations, in admission order.
        for (const row of queuedContent(db, device, control.revision)) {
          if (row.kind === ANIMATION) {
            // An animation journals its own one write, not as a native control's.
            active = null;
            let payload: Display;
            try {
              payload = animationPayload(db, row.command as AnimationCommand, config.line_groups, config.line_positions ?? null);
            } catch (error) {
              if (!(error instanceof Refused)) throw error;
              await end(row.id, error.code);
              continue;
            }
            await playAnimation(db, row.id, () => request(address(config), 'PUT', '/effects', payload), transact);
            continue;
          }
          const target = controlPayload(db, device, row.command);
          if (target === null) {
            // The scene is no longer listed: the command fails without a write.
            await end(row.id, 'unsupported-capability');
            continue;
          }
          const one = new Execution(db, control.revision, row.id, device, transact);
          active = one;
          await controllerRequest(address(config), 'PUT', target[0], target[1]);
          await one.complete();
          const command = row.command as {kind: string; percent: number};
          if (scenes !== null && command.kind === 'brightness.set' && mode !== 'free') scenes.wrote(scenes.selected, command.percent);
        }
      };
      try {
        // A pending mode applies first, so a control admitted behind it lands last.
        if (pendingMode) {
          await applyMode();
          await applyControls();
        } else {
          await applyControls();
          await applyMode();
        }
      } catch (error) {
        if (error instanceof Cancelled) continue;
        throw error;
      } finally {
        active = null;
      }
      const outcome = transaction(db, () => {
        if (held(db, control.revision, device)) return 'held';
        // A decision committed during the sends restarts the pass; a command admitted mid-apply, a repeated mode command
        // included, runs in the next one.
        if (restart() || queuedContent(db, device, control.revision).length > 0 || queuedMode(db, device, control.revision) !== null) {
          return 'restart';
        }
        markApplied(db, control.revision, device);
        execute(db, 'DELETE FROM meta WHERE key IN (?, ?)', 'dirty', key('control_error'));
        const watching = selected(db) || first(db, 'SELECT 1 FROM receipts LIMIT 1') !== undefined
          || (scenes !== null && mode !== 'free' && (pass.shown || mode === 'quiet'));
        if (pass.loop && !watching) {
          execute(db, 'DELETE FROM meta WHERE key=?', key('rendering'));
          return 'idle';
        }
        execute(db, 'INSERT OR REPLACE INTO meta VALUES (?, ?)', key('rendering'), '1');
        return 'wait';
      });
      if (outcome === 'held') return true;
      if (outcome === 'restart') continue;
      if (outcome === 'idle') return true;
      let deadline = started + (pass.loop ? 1.0 : PULSE_SECONDS);
      if (shared) deadline = Math.min(deadline, started + 1);
      if (config._locate !== null) deadline = Math.min(deadline, (config._locate?.started ?? started) + 1);
      if (config._comet !== null) deadline = Math.min(deadline, (config._comet?.started ?? started) + COMET_SECONDS);
      while (now() < deadline) {
        await sleep(Math.min(0.25, deadline - now()));
        // Another device's instance may already have cleared the global dirty flag; any change since this pass's
        // rendered revision still wakes this device.
        if (first(db, "SELECT 1 FROM meta WHERE (key='event_revision' AND value IS NOT ?) OR key=? LIMIT 1",
          pass.generation?.[0] ?? null, key('preview')) !== undefined) break;
      }
    }
  } catch (error) {
    if (error instanceof Stopped) return true;
    throw error;
  } finally {
    guard.close();
  }
}

/** A pass found its device held: Python's worker returned there. */
const HELD = 'held';

const address = (config: RenderConfig): LightAddress => ({ip: config.ip ?? '', token: config.token ?? ''});

const sameOverrides = (left: Overrides, right: Overrides): boolean => left.power === right.power && left.brightness === right.brightness;

const eventRevision = (db: Db): Row | undefined => first(db, "SELECT value FROM meta WHERE key='event_revision'");




