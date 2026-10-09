// Native controls and requested animations: admission, the one device write each makes, the device's discovered
// scenes, and the journal around each write (controller_server.admit's domain checks, controller_state.py's execution
// half and integration_api.py's animation admission). Admission and discovery run inside the caller's synchronous
// transaction. An Execution makes a write between transactions: it records the attempt, sends, then records the result.
import {createHmac, randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {isObject, parseJson} from './compat.js';
import {registeredDevices} from './configuration.js';
import {DEFAULT, ID, layoutDevices, metaKey} from './devices.js';
import {Rejected, render, valid, type AnimationCommand, type Display} from './effects.js';
import {ValueError} from './errors.js';
import {resolveAnimation} from './favorites.js';
import {ANIMATION, CONTROLS, MODE, answerCode, finish, hold, held, journal, journalRow, outcomeOf, release, type ErrorCode, type JournalRow,
  type Report, type Transact} from './journal.js';
import {changeMode, isMode, type Mode} from './modes.js';
import {execute, first, text, transaction, type Db} from './sqlite.js';
import {controlState, markDirty} from './store.js';
import {HttpError} from './transport.js';

/** Unfinished native commands one device may hold (the controller's maxPending). */
export const MAX_QUEUED = 32;
/** Scenes kept from one device's list (controller_state.MAX_SCENES). */
export const MAX_SCENES = 256;
/** The longest scene name the scene list shows; a longer one keeps only its ID (controller_state.MAX_LABEL). */
export const MAX_LABEL = 80;
export const MAX_LAYOUT_BYTES = 1048576;

export type NativeCommand =
  | {kind: 'mode.set'; mode: Mode}
  | {kind: 'power.set'; on: boolean}
  | {kind: 'brightness.set'; percent: number}
  | {kind: 'scene.activate'; sceneId: string};
export type ControlCommand = NativeCommand | AnimationCommand;

/** The command is refused; the reply carries `code`, and nothing changed. */
export class Refused extends Error {
  override name = 'Refused';
  constructor(readonly code: ErrorCode, message: string) {
    super(message);
  }
}

/** A hold, a mode command or the end of its command overtook a journaled write before it was sent (controller_state.Cancelled). */
export class Cancelled extends Error {
  override name = 'Cancelled';
}

export interface Admission {
  /** The command's request ID; its reply and outcome carry it. */
  id: string;
  device?: string;
  command: unknown;
  /** When the module takes the command, in seconds since the epoch. */
  instant: number;
  /** The command's own expiry (its envelope's `expiresat`), in seconds since the epoch. */
  expires: number;
}

const sameKeys = (value: object, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

/** The command if its shape is valid; anything else is refused as `invalid-request`. */
export function parseCommand(value: unknown): ControlCommand {
  if (isObject(value)) {
    const kind = value.kind;
    if (kind === ANIMATION && valid(value)) return value;
    if (kind === MODE && sameKeys(value, ['kind', 'mode']) && isMode(value.mode)) return {kind, mode: value.mode};
    if (kind === 'power.set' && sameKeys(value, ['kind', 'on']) && typeof value.on === 'boolean') return {kind, on: value.on};
    const percent = value.percent;
    if (kind === 'brightness.set' && sameKeys(value, ['kind', 'percent']) && typeof percent === 'number' && Number.isInteger(percent)
        && percent >= 0 && percent <= 100) {
      return {kind, percent};
    }
    if (kind === 'scene.activate' && sameKeys(value, ['kind', 'sceneId']) && typeof value.sceneId === 'string') return {kind, sceneId: value.sceneId};
  }
  throw new Refused('invalid-request', 'The command is not one the device takes.');
}

/** The saved Lines zone pairs and positions; positions are null until every Line has one (integration_api.geometry). */
export function savedGeometry(directory: string): {groups: number[][]; positions: number[][] | null} {
  // Only the saved physical mapping, never load_config's geometry discovery.
  const raw = readFileSync(join(directory, 'layout.json'));
  if (raw.length > MAX_LAYOUT_BYTES) throw new Refused('capacity', 'The saved layout is too large.');
  let entry;
  try {
    entry = layoutDevices(parseJson(raw.toString('utf8'))).get(DEFAULT);
  } catch (error) {
    if (error instanceof ValueError || error instanceof TypeError || error instanceof SyntaxError) {
      throw new Refused('unsupported-capability', 'The saved layout cannot place an animation.');
    }
    throw error;
  }
  if (entry?.kind !== 'lines') throw new Refused('unsupported-capability', 'The saved layout has no Lines.');
  const positions = entry.elements.map(element => element.position);
  return {groups: entry.elements.map(element => [...element.zones]),
    positions: positions.every(position => position !== null) ? positions : null};
}

/** The rendered write for an animation; a command these Lines cannot play is refused with Rejected's code. */
export function animationPayload(db: Db, command: AnimationCommand, groups: readonly (readonly number[])[],
  positions: readonly (readonly number[] | null)[] | null): Display {
  try {
    return render(resolveAnimation(db, command), groups, positions);
  } catch (error) {
    if (error instanceof Rejected) throw new Refused(error.code, 'The Lines cannot play this animation.');
    throw error;
  }
}

/**
 * Take a command or refuse it, inside the caller's transaction (controller_server.admit's domain half and
 * integration_api.admit's animation half). An accepted command is journaled for the device's worker, which the runtime
 * starts if it is not running. A mode command applies at once: it ends the device's queued work and hold, and one the
 * device's mode already satisfies ends here, succeeded with observed evidence.
 */
export function admitCommand(db: Db, directory: string, admission: Admission, report: Report): void {
  const device = admission.device ?? DEFAULT;
  if (!ID.test(device)) throw new Refused('invalid-request', 'A device ID is letters, digits, dots, hyphens and underscores.');
  if (device !== DEFAULT && !registeredDevices(directory).includes(device)) throw new Refused('not-found', 'No such device.');
  const command = parseCommand(admission.command);
  const control = controlState(db, device);
  if (command.kind === ANIMATION) {
    // In integration_api.admit's order: the Lines alone play requested animations, one waits at a time, the saved
    // layout must place it, and only in Free, since Work and Quiet present agent status (hub ADR 0005).
    if (device !== DEFAULT) throw new Refused('unsupported-capability', 'Animations play only on the Lines.');
    if (journal(db, device, 'AND kind=?', ANIMATION).length > 0) throw new Refused('capacity', 'Another animation is waiting.');
    const {groups, positions} = savedGeometry(directory);
    if (control.mode !== 'free') throw new Refused('unsupported-capability', 'Animations play only in Free.');
    animationPayload(db, command, groups, positions);
    // Like a fresh native control, a requested animation authorizes another attempt.
    release(db, device);
    insert(db, admission, device, command, control.revision);
    return;
  }
  if (journal(db, device, 'AND kind<>?', ANIMATION).length >= MAX_QUEUED) throw new Refused('capacity', 'The device has too many waiting commands.');
  switch (command.kind) {
    case 'mode.set': {
      changeMode(db, command.mode, admission.instant, report, device);
      const state = controlState(db, device);
      if (state.revision === state.applied && (state.error ?? '') === '') {
        // Nothing to apply: the module's own mode already is the one asked for.
        report(outcomeOf({device, id: admission.id, completed: 0, uncertain: 0}, {kind: 'unchanged'}));
        return;
      }
      insert(db, admission, device, command, state.revision);
      return;
    }
    case 'scene.activate':
      if (sceneName(db, device, command.sceneId) === undefined) throw new Refused('unsupported-capability', 'The device has no such scene.');
      // Scenes are content controls; Work and Quiet present agent status.
      if (control.mode !== 'free') throw new Refused('unsupported-capability', 'Scenes play only in Free.');
      break;
    case 'power.set':
      execute(db, 'INSERT OR REPLACE INTO meta VALUES (?, ?)', metaKey('controller_power', device), command.on ? '1' : '0');
      break;
    case 'brightness.set':
      execute(db, 'INSERT OR REPLACE INTO meta VALUES (?, ?)', metaKey('controller_brightness', device), String(command.percent));
      break;
  }
  // A fresh native request authorizes another attempt; an override is desired state at once.
  release(db, device);
  markDirty(db);
  insert(db, admission, device, command, control.revision);
}

function insert(db: Db, admission: Admission, device: string, command: ControlCommand, revision: number): void {
  execute(db, "INSERT INTO control_journal (id, device, kind, command, mode_revision, phase, accepted, expires) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)",
    admission.id, device, command.kind, JSON.stringify(command), revision, admission.instant, admission.expires);
}

/**
 * The device's queued native controls at this revision and its queued animations, in admission order. An animation is
 * only ever queued on the Lines in Free, where Python's worker looked for one, since any mode command retires it.
 */
export function queuedContent(db: Db, device: string, revision: number): JournalRow[] {
  return journal(db, device, "AND phase='queued' AND ((kind IN (?, ?, ?, ?) AND mode_revision=?) OR kind=?)", ...CONTROLS, 'moment.play', revision, ANIMATION);
}

/** The queued mode command this revision applies, if one was admitted (Python's Execution without a sequence). */
export function queuedMode(db: Db, device: string, revision: number): string | null {
  return journal(db, device, "AND phase='queued' AND kind=? AND mode_revision=?", MODE, revision).at(-1)?.id ?? null;
}

interface Scenes {
  key: string;
  names: string[];
}

function scenesOf(db: Db, device: string): Scenes | undefined {
  const row = first(db, 'SELECT scene_key,names FROM control_scenes WHERE device=?', device);
  return row === undefined ? undefined : {key: text(row, 0), names: JSON.parse(text(row, 1)) as string[]};
}

/** A scene's opaque ID, keyed by the device's private secret (controller_state.scene_id). */
const sceneId = (key: string, name: string): string => 'scene-' + createHmac('sha256', key).update('scene\0' + name).digest('hex');

/**
 * After the worker observes the device's scene list: keep it, bounded, and report a change (controller_state.discovered).
 * True when the list changed.
 */
export function discovered(db: Db, names: readonly unknown[], device: string, report: Report): boolean {
  const clean: string[] = [];
  for (const name of names) {
    if (typeof name === 'string' && name !== '' && !clean.includes(name) && clean.length < MAX_SCENES) clean.push(name);
  }
  const saved = scenesOf(db, device);
  if (JSON.stringify(saved?.names ?? []) === JSON.stringify(clean)) return false;
  execute(db, 'INSERT OR REPLACE INTO control_scenes VALUES (?, ?, ?)', device, saved?.key ?? randomBytes(32).toString('hex'), JSON.stringify(clean));
  report({type: 'scenes', device});
  return true;
}

/** The device's scenes as the device reported them: each opaque ID, with its name when short enough to show. */
export function sceneList(db: Db, device: string = DEFAULT): {id: string; name?: string}[] {
  const saved = scenesOf(db, device);
  return saved === undefined ? []
    : saved.names.map(name => ({id: sceneId(saved.key, name), ...(name.length <= MAX_LABEL ? {name} : {})}));
}

function sceneName(db: Db, device: string, id: string): string | undefined {
  const saved = scenesOf(db, device);
  return saved?.names.find(name => sceneId(saved.key, name) === id);
}

/** The single device write for a native control, or null when its scene is no longer listed (controller_state.control_payload). */
export function controlPayload(db: Db, device: string, command: unknown): [string, unknown] | null {
  const control = parseCommand(command);
  switch (control.kind) {
    case 'power.set': return ['/state', {on: {value: control.on}}];
    case 'brightness.set': return ['/state', {brightness: {value: control.percent, duration: 0}}];
    case 'scene.activate': {
      const name = sceneName(db, device, control.sceneId);
      return name === undefined ? null : ['/effects', {select: name}];
    }
    case 'mode.set':
    case 'animation.play': throw new ValueError('Not a one-shot control.');
  }
}

/**
 * Journal each device write of one command for one worker pass (controller_state.Execution). Each write is refused once
 * a hold or a mode command has overtaken the pass. With a command, the attempt is recorded before the write and its
 * result after: a write without an answer ends the command uncertain and holds the device, since it may have reached
 * the device, naming the command and `nowMs()` as the hold's start. A device that answers with an HTTP error heard the
 * write and refused it: the command fails with that evidence and the mapped code, nothing holds, and the pass starts
 * again without it (`Cancelled`).
 */
export class Execution {
  #count = 0;

  constructor(private readonly db: Db, readonly revision: number, readonly id: string | null, readonly device: string,
    private readonly transact: Transact, private readonly nowMs: () => number) {}

  async call<T>(send: () => Promise<T> | T): Promise<T> {
    const db = this.db;
    const seq = transaction(db, () => {
      if (held(db, this.revision, this.device) || controlState(db, this.device).revision !== this.revision) throw new Cancelled();
      if (this.id === null) return null;
      const row = journalRow(db, this.id);
      if (row === undefined) throw new Cancelled();
      this.#count += 1;
      execute(db, "UPDATE control_journal SET phase='attempting', uncertain=uncertain+1 WHERE seq=?", row.seq);
      return row.seq;
    });
    if (seq === null) return send();
    let result: T;
    try {
      result = await send();
    } catch (error) {
      const answered = error instanceof HttpError ? answerCode(error.status) : undefined;
      await this.transact(report => {
        const row = this.id === null ? undefined : journalRow(db, this.id);
        if (row === undefined) return;
        if (answered !== undefined) {
          finish(db, row, {kind: 'answered', code: answered}, report);
          return;
        }
        finish(db, row, {kind: 'uncertain'}, report);
        hold(db, this.device, row.revision, {requestId: row.id, heldAtMs: this.nowMs()});
      });
      if (answered !== undefined) throw new Cancelled('The device refused the write.', {cause: error});
      throw error;
    }
    transaction(db, () => execute(db, 'UPDATE control_journal SET uncertain=uncertain-1, completed=completed+1 WHERE seq=?', seq));
    return result;
  }

  /** End the command after its writes: sent, or with none needed, unchanged. */
  async complete(): Promise<void> {
    const id = this.id;
    if (id === null) return;
    await this.transact(report => {
      const row = journalRow(this.db, id);
      if (row !== undefined) finish(this.db, row, {kind: this.#count > 0 ? 'sent' : 'unchanged'}, report);
    });
  }
}

/**
 * Play a queued animation as one write (integration_api.attempt and play): record the attempt, send, then end it sent,
 * uncertain if the write had no answer, or failed with its code if the device answered with an HTTP error. False when a
 * mode command retired it first.
 */
export async function playAnimation(db: Db, id: string, send: () => Promise<unknown>, transact: Transact): Promise<boolean> {
  const started = transaction(db, () => execute(db, "UPDATE control_journal SET phase='attempting', uncertain=1 WHERE id=? AND phase='queued'", id) > 0);
  if (!started) return false;
  try {
    await send();
  } catch (error) {
    const answered = error instanceof HttpError ? answerCode(error.status) : undefined;
    await transact(report => {
      const row = journalRow(db, id);
      if (row !== undefined) finish(db, row, answered === undefined ? {kind: 'uncertain'} : {kind: 'answered', code: answered}, report);
    });
    if (answered !== undefined) return true;
    throw error;
  }
  await transact(report => {
    const row = journalRow(db, id);
    if (row !== undefined) finish(db, row, {kind: 'sent'}, report);
  });
  return true;
}
