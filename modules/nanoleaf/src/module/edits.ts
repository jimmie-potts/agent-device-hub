// Map edits as commands (Hub #844; ADR 0007, the wall map is the editor). The wall editor's edits apply at once, or wait
// as the device's pending wall edit while a comet would move. A machine's edits (an integration or MCP) keep the wall
// editor's ownership, through the device's configuration revision, which the module carries in its state and a machine
// edit names as `expectedConfigurationRevision`:
//   1. a machine edit is refused while a wall edit is pending on that device (`refusePendingWallEdit`);
//   2. a queued machine edit fails when a later wall, mode or association edit lands first, and never overwrites the
//      newer choice (`processMachineEdits`, the revision check);
//   3. machine edits wait for the device's comet to end (`processMachineEdits`, the comet check), or fail when they
//      expire waiting.
// Python detected all three through the controller ledger's configuration revision, which is not ported.
import type {ErrorCode} from '@jimmie-potts/event-contracts/v2';
import {isObject, type JsonObject} from '../compat.js';
import type {DeviceProjection} from '../devices.js';
import * as edits from '../edits.js';
import {ValueError} from '../errors.js';
import {pending} from '../project-map.js';
import {selected, type SharedCopy} from '../shared-input.js';
import {execute, first, rows, text, type Db} from '../sqlite.js';
import {controlState} from '../store.js';
import {SETTING_OF} from './schemas.js';

/** A refusal decided inside a transaction: the transaction rolls back, so the command had no effect. */
export class CommandRefused extends Error {
  override name = 'CommandRefused';
  constructor(readonly code: ErrorCode, readonly detail: string) {
    super(detail);
  }
}

export type MapEdit =
  | {kind: 'settings'; settings: Record<string, unknown>}
  | {kind: 'assign'; elements: {id: string; project?: string | null; signature?: number}[]}
  | {kind: 'task-project'; task: string; project: string | null}
  | {kind: 'project-color'; project: string; color: string}
  | {kind: 'locate'; element: string}
  | {kind: 'evict'; task: string; evictionToken: string};

/** Moves the configuration revision of each device: a later machine edit that expected an earlier one fails. */
export function bumpRevision(db: Db, devices: readonly string[]): void {
  for (const device of devices) execute(db, 'UPDATE nanoleaf_devices SET configuration_revision=configuration_revision+1 WHERE device=?', device);
}

/** Rule 1: a machine edit is refused while a wall edit is pending on the device, with an actionable refusal. */
export function refusePendingWallEdit(db: Db, device: string): void {
  if (pending(db, device) !== null) {
    throw new CommandRefused('revision-conflict', 'a wall edit is pending on this device; read its state again once the comet ends and the edit applies');
  }
}

const known = (db: Db, sql: string, value: string): boolean => first(db, sql, value) !== undefined;

/**
 * Applies one edit inside the caller's transaction, as the wall's edit routes did, and returns the devices whose
 * configuration revision it moves: an element's project or half, a setting other than the palette, a task's project and
 * a project's color are configuration; Locate, an eviction and the palette are not. A project, task or element the
 * store no longer has is a stale read (`revision-conflict`); a value the edit refuses is `invalid-request`.
 */
export function applyEdit(db: Db, copy: SharedCopy, layout: DeviceProjection | undefined, device: string, edit: MapEdit,
  devices: readonly string[]): string[] {
  const needLayout = (): DeviceProjection => {
    if (layout === undefined) throw new CommandRefused('invalid-state', 'the device has no saved layout yet; it is read once the device answers');
    return layout;
  };
  const project = (value: string | null | undefined): void => {
    if (typeof value === 'string' && !known(db, 'SELECT 1 FROM projects WHERE id=?', value)) {
      throw new CommandRefused('revision-conflict', 'the project is no longer known; read the wall again');
    }
  };
  try {
    switch (edit.kind) {
      case 'settings': {
        const changes: JsonObject = {};
        for (const [key, value] of Object.entries(edit.settings)) {
          const name = key === 'palette' ? 'palette' : SETTING_OF[key];
          if (name === undefined) throw new CommandRefused('invalid-request', 'the edit names a setting the wall does not take');
          changes[name] = value as JsonObject[string];
        }
        const configuration = Object.keys(changes).some(key => key !== 'palette');
        edits.settings(db, configuration ? needLayout() : layout ?? {device, kind: 'lines', elements: [], line_groups: []}, changes);
        return configuration ? [device] : [];
      }
      case 'assign': {
        const config = needLayout();
        const ids = new Set(config.elements.map(element => element.id));
        const lines: Record<string, JsonObject> = {};
        for (const element of edit.elements) {
          if (!ids.has(element.id)) throw new CommandRefused('unsupported-capability', 'the device has no such element');
          project(element.project);
          const value: JsonObject = {};
          if (element.project !== undefined) value.project = element.project;
          if (element.signature !== undefined) value.signature = element.signature;
          lines[element.id] = value;
        }
        edits.assign(db, config, lines);
        return [device];
      }
      case 'task-project':
        if (!known(db, 'SELECT 1 FROM task_info WHERE session=?', edit.task)) {
          throw new CommandRefused('revision-conflict', 'the task is no longer on the wall; read the wall again');
        }
        project(edit.project);
        edits.taskProject(db, needLayout(), edit.task, edit.project);
        // A task's project is the association every device shows it by.
        return [...devices];
      case 'project-color':
        project(edit.project);
        edits.projectColor(db, edit.project, edit.color);
        return [...devices];
      case 'locate':
        if (controlState(db, device).mode === 'free') throw new CommandRefused('invalid-state', 'choose Work or Quiet to locate an element');
        edits.locate(db, needLayout(), edit.element);
        return [];
      case 'evict':
        if (!selected(db)) throw new CommandRefused('invalid-state', 'shared input is paused');
        try {
          edits.evict(db, copy, {device}, {id: edit.task, evictionToken: edit.evictionToken});
        } catch (error) {
          if (error instanceof ValueError) throw new CommandRefused('revision-conflict', 'the task changed; read the wall again before evicting it');
          throw error;
        }
        return [];
    }
  } catch (error) {
    if (error instanceof ValueError) throw new CommandRefused('invalid-request', 'the wall does not take this edit');
    throw error;
  }
}

/** Checks a machine edit as it would apply now, inside the caller's transaction, and leaves nothing changed. */
export function checkEdit(db: Db, copy: SharedCopy, layout: DeviceProjection | undefined, device: string, edit: MapEdit,
  devices: readonly string[]): void {
  db.exec('SAVEPOINT nanoleaf_check');
  try {
    applyEdit(db, copy, layout, device, edit, devices);
  } finally {
    db.exec('ROLLBACK TO nanoleaf_check');
    db.exec('RELEASE nanoleaf_check');
  }
}

export type QueuedEdit = {seq: number; id: string; device: string; edit: MapEdit; revision: number; expiresMs: number};

export function queuedEdits(db: Db, device: string): QueuedEdit[] {
  return rows(db, 'SELECT seq,id,device,edit,revision,expires_ms FROM nanoleaf_machine_edits WHERE device=? ORDER BY seq', device).map(row => ({
    seq: Number(row[0]), id: text(row, 1), device: text(row, 2), edit: JSON.parse(text(row, 3)) as MapEdit, revision: Number(row[4]),
    expiresMs: Number(row[5]),
  }));
}

/** How a queued machine edit ended. */
export type EditEnd = {edit: QueuedEdit; result: 'applied'} | {edit: QueuedEdit; result: 'refused'; code: ErrorCode};

/**
 * Processes the device's queued machine edits in admission order, inside the caller's transaction: an edit past its
 * expiry fails `expired`; one whose device's configuration revision moved since its admission fails `revision-conflict`
 * without applying (rule 2); while a comet runs or a wall edit is pending on the device, it and every later edit wait
 * (rule 3); otherwise it applies and moves the revision. Returns how each edit that ended ended.
 */
export function processMachineEdits(db: Db, copy: SharedCopy, layout: DeviceProjection | undefined, device: string, nowMs: number,
  devices: readonly string[], revisionOf: (device: string) => number): EditEnd[] {
  const ended: EditEnd[] = [];
  for (const queued of queuedEdits(db, device)) {
    let end: EditEnd;
    if (queued.expiresMs <= nowMs) {
      end = {edit: queued, result: 'refused', code: 'expired'};
    } else if (revisionOf(device) !== queued.revision) {
      end = {edit: queued, result: 'refused', code: 'revision-conflict'};
    } else if (first(db, 'SELECT 1 FROM comets WHERE started IS NOT NULL AND device=?', device) !== undefined || pending(db, device) !== null) {
      break;
    } else {
      try {
        db.exec('SAVEPOINT nanoleaf_edit');
        try {
          bumpRevision(db, applyEdit(db, copy, layout, device, queued.edit, devices));
          db.exec('RELEASE nanoleaf_edit');
        } catch (error) {
          db.exec('ROLLBACK TO nanoleaf_edit');
          db.exec('RELEASE nanoleaf_edit');
          throw error;
        }
        end = {edit: queued, result: 'applied'};
      } catch (error) {
        if (!(error instanceof CommandRefused)) throw error;
        end = {edit: queued, result: 'refused', code: error.code};
      }
    }
    execute(db, 'DELETE FROM nanoleaf_machine_edits WHERE seq=?', queued.seq);
    ended.push(end);
  }
  return ended;
}

/** A command's map edit in the port's terms, from its validated payload. */
export const editOf = (value: unknown): MapEdit => {
  if (!isObject(value)) throw new CommandRefused('invalid-request', 'the edit is malformed');
  return value as unknown as MapEdit;
};
