// Private presentation metadata; this part has no device dispatch path (Hub #1164).
import type {DatabaseSync, StatementSync} from 'node:sqlite';
import {MessageValidator, errorBody} from '@jimmie-potts/event-contracts/v2';
import {registerCoreFamilies, type PlaybackLayoutRecord, type PlaybackLayoutSetRequest} from '@jimmie-potts/event-contracts/v2/families';
import {fullDisk, type Command, type Reply, type StateDraft} from '@jimmie-potts/sdk';
import type {CoreHandle, CorePart} from './core.js';
import type {CoreTransaction} from './store.js';
import type {CompletedOutcome} from './tracker.js';

const ID = 'playback';
const stateDraft = (record: PlaybackLayoutRecord): StateDraft => ({type: 'org.bunny.playback-layout.updated', subject: ID,
  dataschema: 'https://bunny.invalid/events/playback-layout/2.0', data: record});
export type PlaybackLayoutAdmission = {
  admit(command: Command<PlaybackLayoutSetRequest>): boolean;
  complete(tx: CoreTransaction, command: Command<PlaybackLayoutSetRequest>, result: Omit<CompletedOutcome, 'requestId'>): () => void;
  end(command: Command<PlaybackLayoutSetRequest>): void;
};

export class PlaybackLayoutPart implements CorePart {
  readonly families = ['playback-layout'] as const;
  readonly #admission: PlaybackLayoutAdmission;
  readonly #validator = new MessageValidator();
  #core: CoreHandle | undefined;
  #read: StatementSync | undefined;
  #save: StatementSync | undefined;

  constructor(admission: PlaybackLayoutAdmission) {this.#admission = admission;registerCoreFamilies(this.#validator);}

  readonly open = (database: DatabaseSync): void => {
    database.exec("CREATE TABLE IF NOT EXISTS playback_layout (id TEXT PRIMARY KEY CHECK (id = 'playback'), record TEXT NOT NULL) STRICT");
    this.#read = database.prepare('SELECT record FROM playback_layout WHERE id = ?');
    this.#save = database.prepare('UPDATE playback_layout SET record = ? WHERE id = ?');
    const initial: PlaybackLayoutRecord = {id: ID, revision: 0, assignments: []};
    database.prepare('INSERT INTO playback_layout VALUES (?, ?) ON CONFLICT (id) DO NOTHING').run(ID, JSON.stringify(initial));
  };
  readonly states = (families: readonly string[]): StateDraft[] => {
    const record = this.#record();return families.includes('playback-layout') && record !== undefined ? [stateDraft(record)] : [];
  };
  readonly start = (core: CoreHandle): Promise<unknown> => {
    this.#core = core;return core.sdk.respond<PlaybackLayoutSetRequest>('bunny.cmd.playback-layout-set.playback', command => this.#replace(command));
  };
  #record(): PlaybackLayoutRecord | undefined {
    const row = this.#read?.get(ID) as {record: string} | undefined;return row === undefined ? undefined : JSON.parse(row.record) as PlaybackLayoutRecord;
  }
  async #replace(command: Command<PlaybackLayoutSetRequest>): Promise<Reply> {
    const checked = this.#validator.validate(command);
    if (!checked.ok) return errorBody(checked.error.code, {detail: 'the playback layout command is invalid'});
    if (!this.#admission.admit(command)) return errorBody('forbidden', {detail: 'the layout command has no operator admission'});
    command = {...command, data: structuredClone(command.data)};
    try {
      const core = this.#core;if (core === undefined) return errorBody('unavailable', {detail: 'the layout owner has not started'});
      await core.ready;
      let committed: (() => void) | undefined;
      const result = await core.transaction(tx => {
        const current = this.#record();
        if (current === undefined || this.#save === undefined) return errorBody('unavailable', {detail: 'the playback layout store is not open'});
        if (Date.parse(command.expiresat ?? '') <= tx.atMs) return errorBody('expired', {detail: 'the playback layout command expired before saving'});
        if (current.revision !== command.data.expectedRevision) return errorBody('revision-conflict', {detail: 'the playback layout changed; refresh before saving'});
        const record: PlaybackLayoutRecord = {id: ID, revision: tx.revision(), assignments: command.data.assignments};
        this.#save.run(JSON.stringify(record), ID);
        tx.add('bunny.state.playback-layout.playback', {kind: 'state', ...stateDraft(record)}, {parent: command});tx.take(command);
        committed = this.#admission.complete(tx, command, {result: 'succeeded', evidence: 'observed'});
        return {status: 'accepted'} as const;
      });
      if ('error' in result) return result;
      committed?.();return {status: 'accepted'};
    } catch (error) {
      return errorBody(fullDisk(error) ? 'capacity' : 'internal', {detail: 'the playback layout could not be saved; no device command was sent'});
    } finally {this.#admission.end(command);}
  }
}
