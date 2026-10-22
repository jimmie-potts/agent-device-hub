// Private presentation metadata; this part has no device dispatch path (Hub #1135).
import type {DatabaseSync, StatementSync} from 'node:sqlite';
import {MessageValidator, errorBody} from '@jimmie-potts/event-contracts/v2';
import {registerCoreFamilies, type LightingLayout, type LightingLayoutRecord, type LightingLayoutSetRequest} from '@jimmie-potts/event-contracts/v2/families';
import {fullDisk, type Command, type Reply, type StateDraft} from '@jimmie-potts/sdk';
import type {CoreHandle, CorePart} from './core.js';
import type {CoreTransaction} from './store.js';
import type {CompletedOutcome} from './tracker.js';

const ID = 'lighting';
const stateDraft = (record: LightingLayoutRecord): StateDraft => ({type: 'org.bunny.lighting-layout.updated', subject: ID,
  dataschema: 'https://bunny.invalid/events/lighting-layout/2.0', data: record});
export type LightingLayoutAdmission = {
  admit(command: Command<LightingLayoutSetRequest>): boolean;
  complete(tx: CoreTransaction, command: Command<LightingLayoutSetRequest>, result: Omit<CompletedOutcome, 'requestId'>): () => void;
  end(command: Command<LightingLayoutSetRequest>): void;
  changed?(tx: CoreTransaction, command: Command<LightingLayoutSetRequest>, before: LightingLayout, after: LightingLayout): void;
};

export class LightingLayoutPart implements CorePart {
  readonly families = ['lighting-layout'] as const;
  readonly #admission: LightingLayoutAdmission;
  readonly #validator = new MessageValidator();
  #core: CoreHandle | undefined;
  #read: StatementSync | undefined;
  #save: StatementSync | undefined;

  constructor(admission: LightingLayoutAdmission) {this.#admission = admission;registerCoreFamilies(this.#validator);}

  readonly open = (database: DatabaseSync): void => {
    database.exec("CREATE TABLE IF NOT EXISTS lighting_layout (id TEXT PRIMARY KEY CHECK (id = 'lighting'), record TEXT NOT NULL) STRICT");
    this.#read = database.prepare('SELECT record FROM lighting_layout WHERE id = ?');
    this.#save = database.prepare('UPDATE lighting_layout SET record = ? WHERE id = ?');
    const initial: LightingLayoutRecord = {id: ID, revision: 0, layout: {rooms: [], assignments: [], groups: [], home: null}};
    database.prepare('INSERT INTO lighting_layout VALUES (?, ?) ON CONFLICT (id) DO NOTHING').run(ID, JSON.stringify(initial));
  };
  readonly states = (families: readonly string[]): StateDraft[] => {
    const record = this.#record();return families.includes('lighting-layout') && record !== undefined ? [stateDraft(record)] : [];
  };
  readonly start = (core: CoreHandle): Promise<unknown> => {
    this.#core = core;return core.sdk.respond<LightingLayoutSetRequest>('bunny.cmd.lighting-layout-set.lighting', command => this.#replace(command));
  };
  #record(): LightingLayoutRecord | undefined {
    const row = this.#read?.get(ID) as {record: string} | undefined;return row === undefined ? undefined : JSON.parse(row.record) as LightingLayoutRecord;
  }
  async #replace(command: Command<LightingLayoutSetRequest>): Promise<Reply> {
    const checked = this.#validator.validate(command);
    if (!checked.ok) return errorBody(checked.error.code, {detail: 'the lighting layout command is invalid'});
    if (!this.#admission.admit(command)) return errorBody('forbidden', {detail: 'the layout command has no operator admission'});
    command = {...command, data: structuredClone(command.data)};
    try {
      const core = this.#core;if (core === undefined) return errorBody('unavailable', {detail: 'the layout owner has not started'});
      await core.ready;
      let committed: (() => void) | undefined;
      const result = await core.transaction(tx => {
        const current = this.#record();
        if (current === undefined || this.#save === undefined) return errorBody('unavailable', {detail: 'the lighting layout store is not open'});
        if (Date.parse(command.expiresat ?? '') <= tx.atMs) return errorBody('expired', {detail: 'the lighting layout command expired before saving'});
        if (current.revision !== command.data.expectedRevision) return errorBody('revision-conflict', {detail: 'the lighting layout changed; refresh before saving'});
        const record: LightingLayoutRecord = {id: ID, revision: tx.revision(), layout: command.data.layout};
        this.#save.run(JSON.stringify(record), ID);
        tx.add('bunny.state.lighting-layout.lighting', {kind: 'state', ...stateDraft(record)}, {parent: command});
        this.#admission.changed?.(tx, command, current.layout, record.layout);tx.take(command);
        committed = this.#admission.complete(tx, command, {result: 'succeeded', evidence: 'observed'});
        return {status: 'accepted'} as const;
      });
      if ('error' in result) return result;
      committed?.();return {status: 'accepted'};
    } catch (error) {
      return errorBody(fullDisk(error) ? 'capacity' : 'internal', {detail: 'the lighting layout could not be saved; no device command was sent'});
    } finally {this.#admission.end(command);}
  }
}
