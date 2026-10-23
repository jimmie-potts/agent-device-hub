// One durable Hub selection (#924). Saving completes the core action; native commands have independent outcomes.
// Starts, syncs and participant assignment never apply or replay a selection.
import type {DatabaseSync, StatementSync} from 'node:sqlite';
import {MessageValidator, errorBody} from '@jimmie-potts/event-contracts/v2';
import {nativeMode} from '@jimmie-potts/event-contracts/v2/devices';
import {MAX_MODE_OVERRIDES, normalizeModeState} from '@jimmie-potts/event-contracts/v2/mode';
import {registerCoreFamilies, type ModeSetRequest, type ModeState} from '@jimmie-potts/event-contracts/v2/families';
import {fullDisk, type Command, type Reply, type StateDraft} from '@jimmie-potts/sdk';
import type {CoreHandle, CorePart} from './core.js';
import type {CoreTransaction} from './store.js';
import type {CompletedOutcome} from './tracker.js';
import {checkModeParticipants, modeChildRequestId, type ModeParticipant} from './mode-participants.js';
import {DEADLINES, pending} from './operations.js';

export const MODE_ID = 'hub';
export const MODE_SCHEMA = 'https://bunny.invalid/events/mode/2.1';
const stateDraft = (record: ModeState): StateDraft => ({type: 'org.bunny.mode.updated', subject: MODE_ID, dataschema: MODE_SCHEMA, data: record});

/** Private constructor authority, bound by core.ts to its tracker; never a public CoreHandle member. */
export type ModeAdmission = {
  admit(command: Command<ModeSetRequest>): boolean;
  complete(tx: CoreTransaction, command: Command<ModeSetRequest>, result: Omit<CompletedOutcome, 'requestId'>): () => void;
  end(command: Command<ModeSetRequest>): void;
};
const noAdmission: ModeAdmission = {admit: () => false, complete: () => {throw new Error('mode-admission');}, end: () => {}};

export class ModePart implements CorePart {
  readonly families = ['mode'] as const;
  readonly #admission: ModeAdmission;
  readonly #validator = new MessageValidator();
  #core: CoreHandle | undefined;
  #read: StatementSync | undefined;
  #save: StatementSync | undefined;
  #participants: readonly ModeParticipant[] = [];
  #assigned = false;
  #selecting = false;
  readonly #children = new Map<string, number>();

  constructor(admission: ModeAdmission = noAdmission) {
    this.#admission = admission;
    registerCoreFamilies(this.#validator);
  }

  /** Assigned once after qualified host startup, before the gateway serves; sends nothing. */
  setParticipants(participants: readonly ModeParticipant[]): void {
    if (this.#assigned) throw new Error('mode-participants-already-assigned');
    this.#participants = checkModeParticipants(participants);
    this.#assigned = true;
  }

  readonly open = (database: DatabaseSync): void => {
    database.exec('CREATE TABLE IF NOT EXISTS core_mode (id TEXT PRIMARY KEY CHECK (id = \'hub\'), record TEXT NOT NULL) STRICT');
    this.#read = database.prepare('SELECT record FROM core_mode WHERE id = ?');
    this.#save = database.prepare('UPDATE core_mode SET record = ? WHERE id = ?');
    const initial: ModeState = {id: MODE_ID, revision: 0, mode: 'free', selectedAtMs: this.#core?.clock.now() ?? 0, overrides: []};
    database.prepare('INSERT INTO core_mode VALUES (?, ?) ON CONFLICT (id) DO NOTHING').run(MODE_ID, JSON.stringify(initial));
    this.#record();
  };

  readonly states = (families: readonly string[]): StateDraft[] => {
    const record = this.#record();
    return families.includes('mode') && record !== undefined ? [stateDraft(record)] : [];
  };

  /** Register before the core's first await; waiting for ready here would deadlock startup. */
  readonly start = (core: CoreHandle): Promise<unknown> => {
    this.#core = core;
    return Promise.all([
      core.sdk.respond<ModeSetRequest>(`bunny.cmd.mode-set.${MODE_ID}`, command => this.#select(command, false)),
      core.sdk.respond<ModeSetRequest>('bunny.cmd.mode-override-set.*', command => this.#select(command, true)),
    ]);
  };

  #record(): ModeState | undefined {
    const row = this.#read?.get(MODE_ID) as {record: string} | undefined;
    if (row === undefined) return undefined;
    const record = normalizeModeState(JSON.parse(row.record) as unknown);
    if (record === undefined || record.id !== MODE_ID) throw new Error('invalid-mode-store');
    return record;
  }

  #busy(core: CoreHandle): boolean {
    for (const [id, deadline] of this.#children) {
      const operation = core.operation(id);
      if (operation !== undefined && !pending(operation) || core.clock.now() >= (operation?.deadlineAtMs ?? deadline)) this.#children.delete(id);
    }
    return this.#selecting || this.#children.size > 0;
  }

  async #select(command: Command<ModeSetRequest>, individual: boolean): Promise<Reply> {
    const checked = this.#validator.validate(command);
    if (!checked.ok) return errorBody(checked.error.code, {detail: 'the selection is not a valid mode-set command'});
    if (!individual && command.subject !== MODE_ID) return errorBody('not-found', {detail: 'no such Hub mode'});
    if (!this.#admission.admit(command)) return errorBody('forbidden', {detail: 'this mode command has no dispatcher admission'});
    command = {...command, data: structuredClone(command.data)};
    let selected = false;
    try {
      const core = this.#core;
      if (core === undefined) return errorBody('unavailable', {detail: 'the core mode has not started'});
      const participants = individual ? this.#participants.filter(participant => participant.id === command.subject) : this.#participants;
      if (individual && participants.length !== 1) return errorBody('unavailable', {detail: 'the target is not a qualified mode participant'});
      if (this.#busy(core)) return errorBody('capacity', {detail: 'a mode selection is still pending; read its results before a new request'});
      this.#selecting = true; selected = true;
      await core.ready;
      const children = await Promise.all(participants.map(async participant => ({...participant,
        requestId: await modeChildRequestId(command.data.requestId, participant.id), mode: nativeMode(participant.kind, command.data.mode)})));
      let committed: (() => void) | undefined;
      try {
        const answer = await core.transaction(tx => {
          const current = this.#record();
          if (current === undefined || this.#save === undefined) return errorBody('unavailable', {detail: 'the Hub mode store is not open'});
          if (command.data.expectedRevision !== undefined && command.data.expectedRevision !== current.revision) {
            return errorBody('revision-conflict', {detail: 'the Hub mode changed; read it again'});
          }
          const overrides = individual ? (current.overrides ?? []).filter(choice => choice.target !== command.subject) : [];
          if (individual && command.data.mode !== current.mode) overrides.push({target: command.subject, mode: command.data.mode, selectedAtMs: tx.atMs});
          if (overrides.length > MAX_MODE_OVERRIDES) return errorBody('capacity', {detail: 'the saved mode exception limit was reached'});
          const record: ModeState = {id: MODE_ID, revision: tx.revision(), mode: individual ? current.mode : command.data.mode,
            selectedAtMs: individual ? current.selectedAtMs : tx.atMs, overrides};
          this.#save.run(JSON.stringify(record), MODE_ID);
          tx.add(`bunny.state.mode.${MODE_ID}`, {kind: 'state', ...stateDraft(record)}, {parent: command});
          tx.take(command);
          committed = this.#admission.complete(tx, command, {result: 'succeeded', evidence: 'observed'});
          return {status: 'accepted'} as const;
        });
        if ('error' in answer) return answer;
      } catch (error) {
        return errorBody(fullDisk(error) ? 'capacity' : 'internal', {detail: 'the Hub mode could not be saved; no device command was sent'});
      }
      committed?.();
      // Each action is independently tracked; a refusal or lost outcome cannot cancel another target.
      for (const child of children) {
        if (child.mode === undefined) continue;
        this.#children.set(child.requestId, core.clock.now() + DEADLINES.device.outcomeMs);
        void core.dispatch({key: `bunny.cmd.device-mode-set.${child.id}`, requestedBy: core.sdk.source, requestId: child.requestId, parent: command,
          draft: {type: 'org.bunny.device-mode.set.requested', subject: child.id,
            dataschema: 'https://bunny.invalid/events/device-mode-set/2.0', data: {mode: child.mode}}}).then(answer => {
          if ('error' in answer) this.#children.delete(child.requestId);
        }).catch(() => { /* Tracker evidence or its existing deadline bounds this uncertain request. */ });
      }
      return {status: 'accepted'};
    } finally {
      if (selected) this.#selecting = false;
      this.#admission.end(command);
    }
  }
}
