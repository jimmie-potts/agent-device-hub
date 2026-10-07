// The control journal: each device's accepted commands until they end, the hold that stops device writes after an
// uncertain one, and the outcome each command ends with (controller_state.py's request rows, hold, release and finish,
// and integration_api.py's animation queue, in the module's own database). Every function runs inside the caller's
// synchronous transaction; none waits or contacts a device. A row is deleted when its command ends: its outcome then
// lives in the runtime's outbox until the core acknowledges it.
import {DEFAULT, metaKey} from './devices.js';
import {execute, first, number, rows, text, transaction, type Db, type Row, type Synchronous} from './sqlite.js';

/** The meta key, per device, that holds the mode revision an uncertain or unsent command held (controller_state.HOLD). */
export const HOLD = 'controller_hold_revision';
/** One-shot native controls, journaled with their device's mode revision (controller_state.CONTROLS). */
export const CONTROLS = ['power.set', 'brightness.set', 'scene.activate'] as const;
export const ANIMATION = 'animation.play';
export const MODE = 'mode.set';

/** The profile 2.0 error codes the module's outcomes and refusals use (event-contracts errors.json). */
export type ErrorCode = 'invalid-request' | 'unsupported-capability' | 'not-found' | 'capacity' | 'cancelled' | 'expired' | 'uncertain-result';
export type Result = 'succeeded' | 'failed' | 'uncertain';
export type Evidence = 'transmitted' | 'observed' | 'none';

/** A command's outcome (ADR 0012): the runtime publishes it with the device as subject and `requestId` from the command. */
export interface Outcome {
  type: 'outcome';
  device: string;
  requestId: string;
  result: Result;
  evidence: Evidence;
  error?: {code: ErrorCode};
}

/** The device's discovered scene list changed; the runtime publishes the device's state again. */
export interface ScenesChanged {
  type: 'scenes';
  device: string;
}

/** Called inside the transaction whose change it reports, so the message commits with that change. */
export type Report = (message: Outcome | ScenesChanged) => void;

/**
 * Runs `work` in one synchronous transaction on the module's database, with a `report` that stores each message in that
 * transaction; resolves once the transaction has committed and its messages are handed on. The runtime backs it with its
 * outbox (`Outbox.transaction`). The work's type refuses a promise, which would commit before the awaited work ran.
 */
export type Transact = <R>(work: (report: Report) => Synchronous<R>) => Promise<R>;

export interface JournalRow {
  seq: number;
  id: string;
  device: string;
  kind: string;
  command: unknown;
  revision: number;
  phase: 'queued' | 'attempting';
  completed: number;
  uncertain: number;
  expires: number;
}

/** How a command ended, before its evidence: the port's names for the points where Python finished a request. */
export type End =
  | {kind: 'sent'}
  | {kind: 'unchanged'}
  | {kind: 'uncertain'}
  | {kind: 'retired'}
  | {kind: 'expired'}
  | {kind: 'refused'; code: ErrorCode};

export function initJournal(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS control_journal (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, device TEXT NOT NULL, kind TEXT NOT NULL,
    command TEXT NOT NULL, mode_revision INTEGER NOT NULL, phase TEXT NOT NULL CHECK (phase IN ('queued', 'attempting')),
    completed INTEGER NOT NULL DEFAULT 0, uncertain INTEGER NOT NULL DEFAULT 0, accepted REAL NOT NULL, expires REAL NOT NULL)`);
  db.exec('CREATE TABLE IF NOT EXISTS control_scenes (device TEXT PRIMARY KEY, scene_key TEXT NOT NULL, names TEXT NOT NULL)');
}

const COLUMNS = 'seq,id,device,kind,command,mode_revision,phase,completed,uncertain,expires';

function rowOf(row: Row): JournalRow {
  return {seq: number(row, 0), id: text(row, 1), device: text(row, 2), kind: text(row, 3), command: JSON.parse(text(row, 4)) as unknown,
    revision: number(row, 5), phase: text(row, 6) === 'attempting' ? 'attempting' : 'queued', completed: number(row, 7),
    uncertain: number(row, 8), expires: number(row, 9)};
}

/** The device's unfinished commands in admission order; `where` narrows them. */
export function journal(db: Db, device: string, where = '', ...params: (string | number)[]): JournalRow[] {
  return rows(db, `SELECT ${COLUMNS} FROM control_journal WHERE device=? ${where} ORDER BY seq`, device, ...params).map(rowOf);
}

/** One unfinished command by its request ID. */
export function journalRow(db: Db, id: string): JournalRow | undefined {
  const row = first(db, `SELECT ${COLUMNS} FROM control_journal WHERE id=?`, id);
  return row === undefined ? undefined : rowOf(row);
}

export function hold(db: Db, device: string, revision: number): void {
  execute(db, 'INSERT OR REPLACE INTO meta VALUES (?, ?)', metaKey(HOLD, device), String(revision));
}

export function release(db: Db, device: string): void {
  execute(db, 'DELETE FROM meta WHERE key=?', metaKey(HOLD, device));
}

/** Whether a hold stops the device's writes at this mode revision. */
export function held(db: Db, revision: number, device: string = DEFAULT): boolean {
  return first(db, 'SELECT value FROM meta WHERE key=?', metaKey(HOLD, device))?.[0] === String(revision);
}

/**
 * The outcome for an end, from what the command's journal saw reach the device. This is MAPPING.md's controller
 * receipt rule applied to the receipt Python would have written: an attempt with no completed write is `possible`
 * effects, so it ends uncertain with no evidence; a completed write is transmitted evidence.
 */
export function outcomeOf(row: Pick<JournalRow, 'device' | 'id' | 'completed' | 'uncertain'>, end: End): Outcome {
  const base = {type: 'outcome' as const, device: row.device, requestId: row.id};
  const evidence: Evidence = row.completed > 0 ? 'transmitted' : 'none';
  const possible = row.completed === 0 && row.uncertain > 0;
  switch (end.kind) {
    case 'sent': return {...base, result: 'succeeded', evidence: 'transmitted'};
    case 'unchanged': return {...base, result: 'succeeded', evidence: 'observed'};
    case 'uncertain': return {...base, result: 'uncertain', evidence, error: {code: 'uncertain-result'}};
    case 'retired':
      return possible ? {...base, result: 'uncertain', evidence: 'none', error: {code: 'uncertain-result'}}
        : {...base, result: 'failed', evidence, error: {code: 'cancelled'}};
    case 'expired': return {...base, result: 'failed', evidence: 'none', error: {code: 'expired'}};
    case 'refused': return {...base, result: 'failed', evidence: 'none', error: {code: end.code}};
  }
}

/** A Transact for one connection: a plain transaction whose messages go to `report`. */
export function transactWith(db: Db, report: Report): Transact {
  return <R>(work: (report: Report) => Synchronous<R>): Promise<R> => {
    try {
      return Promise.resolve(transaction<R>(db, () => work(report)));
    } catch (error) {
      // A thrown value that is not an Error is kept as the cause, never turned into text (ADR 0012, "Safe errors").
      return Promise.reject(error instanceof Error ? error : new Error('The transaction threw a value that is not an Error.', {cause: error}));
    }
  };
}

/** End a command: delete its row and report its outcome in the same transaction. */
export function finish(db: Db, row: JournalRow, end: End, report: Report): void {
  execute(db, 'DELETE FROM control_journal WHERE seq=?', row.seq);
  report(outcomeOf(row, end));
}

/**
 * Every explicit mode command ends the device's queued work: its native controls whether queued or mid-attempt, as
 * controller_state.changed did, and its queued animations, as integration_api.retire did. An animation mid-attempt
 * finishes its one write.
 */
export function retireQueued(db: Db, device: string, report: Report): void {
  for (const row of journal(db, device, "AND (phase='queued' OR kind<>?)", ANIMATION)) finish(db, row, {kind: 'retired'}, report);
}

/**
 * At a worker's start, an attempt that has no result may have reached the device. A native control holds the device
 * at its revision until an explicit choice; an animation does not (controller_state.recover with attempts,
 * integration_api.recover_attempts).
 */
export function recoverAttempts(db: Db, device: string, report: Report): void {
  for (const row of journal(db, device, "AND phase='attempting'")) {
    finish(db, row, {kind: 'uncertain'}, report);
    if (row.kind !== ANIMATION) hold(db, device, row.revision);
  }
}

/**
 * A queued command still unsent at its expiry fails, and holds the device at its revision: the admission's
 * authorization does not outlive the command (controller_state.recover, integration_api.recover). With `nativeOnly`,
 * animations wait for the pass.
 */
export function expireQueued(db: Db, device: string, now: number, report: Report, nativeOnly = false): void {
  for (const row of journal(db, device, "AND phase='queued' AND expires<=? AND (kind<>? OR ?)", now, ANIMATION, nativeOnly ? 0 : 1)) {
    finish(db, row, {kind: 'expired'}, report);
    // Python held an animation at the current revision; a queued animation's is the current one, since any mode command
    // retires it.
    hold(db, device, row.revision);
  }
}
