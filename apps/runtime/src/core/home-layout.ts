// Private presentation metadata; this part has no device dispatch path (Hub #366).
import type {DatabaseSync, StatementSync} from 'node:sqlite';
import {MessageValidator, errorBody} from '@jimmie-potts/event-contracts/v2';
import {registerCoreFamilies, type HomeLayoutRecord, type HomeLayoutSetRequest, type LightingLayout, type LightingLayoutSetRequest} from '@jimmie-potts/event-contracts/v2/families';
import {Outcome, fullDisk, type Command, type Reply, type StateDraft} from '@jimmie-potts/sdk';
import type {CoreHandle, CorePart} from './core.js';
import type {CoreTransaction} from './store.js';
import type {CompletedOutcome} from './tracker.js';

const ID = 'home';
const stateDraft = (record: HomeLayoutRecord): StateDraft => ({type: 'org.bunny.home-layout.updated', subject: ID,
  dataschema: 'https://bunny.invalid/events/home-layout/2.0', data: record});
export type HomeLayoutAdmission = {
  admit(command: Command<HomeLayoutSetRequest>): boolean;
  complete(tx: CoreTransaction, command: Command<HomeLayoutSetRequest>, result: Omit<CompletedOutcome, 'requestId'>): () => void;
  end(command: Command<HomeLayoutSetRequest>): void;
};

export class HomeLayoutPart implements CorePart {
  readonly families = ['home-layout'] as const;
  readonly #admission: HomeLayoutAdmission;
  readonly #validator = new MessageValidator();
  #core: CoreHandle | undefined;
  #read: StatementSync | undefined;
  #save: StatementSync | undefined;

  constructor(admission: HomeLayoutAdmission) {this.#admission = admission;registerCoreFamilies(this.#validator);}

  readonly open = (database: DatabaseSync): void => {
    database.exec("CREATE TABLE IF NOT EXISTS home_layout (id TEXT PRIMARY KEY CHECK (id = 'home'), record TEXT NOT NULL) STRICT");
    this.#read = database.prepare('SELECT record FROM home_layout WHERE id = ?');
    this.#save = database.prepare('UPDATE home_layout SET record = ? WHERE id = ?');
    const initial: HomeLayoutRecord = {id: ID, revision: 0, version: 1, layouts: null};
    database.prepare('INSERT INTO home_layout VALUES (?, ?) ON CONFLICT (id) DO NOTHING').run(ID, JSON.stringify(initial));
  };
  readonly states = (families: readonly string[]): StateDraft[] => {
    const record = this.#record();return families.includes('home-layout') && record !== undefined ? [stateDraft(record)] : [];
  };
  readonly start = (core: CoreHandle): Promise<unknown> => {
    this.#core = core;return core.sdk.respond<HomeLayoutSetRequest>('bunny.cmd.home-layout-set.home', command => this.#replace(command));
  };
  #record(): HomeLayoutRecord | undefined {
    const row = this.#read?.get(ID) as {record: string} | undefined;return row === undefined ? undefined : JSON.parse(row.record) as HomeLayoutRecord;
  }
  /** Existing group/room actions update placement in their original core transaction. */
  reconcileLighting(tx: CoreTransaction, command: Command<LightingLayoutSetRequest>, before: LightingLayout, after: LightingLayout): void {
    const current = this.#record();if (current?.layouts === null || current === undefined || this.#save === undefined) return;
    const layouts = structuredClone(current.layouts);
    const key = (value: {kind: string; id: string}): string => `light:${value.kind}:${value.id}`;
    for (const breakpoint of ['desktop', 'phone'] as const) {
      let entries = layouts[breakpoint].flatMap(entry => {
        const removed = before.groups.find(group => group.scope === 'home' && key({kind: 'group', id: group.id}) === entry.widget && !after.groups.some(next => next.id === group.id));
        return removed === undefined ? [entry] : removed.devices.map(id => ({...entry, widget: key({kind: 'device', id})}));
      });
      for (const group of after.groups.filter(group => group.scope === 'home')) {
        if (before.groups.some(previous => previous.id === group.id && JSON.stringify(previous.devices) === JSON.stringify(group.devices))) continue;
        const members = new Set(group.devices.map(id => key({kind: 'device', id}))), indexes = entries.flatMap((entry, index) => members.has(entry.widget) ? [index] : []);
        const first = indexes[0];if (first === undefined) continue;
        const base = entries[first];if (base === undefined) continue;
        const replacement = {...base, widget: key({kind: 'group', id: group.id}), hidden: indexes.every(index => entries[index]?.hidden === true)};
        entries = entries.flatMap((entry, index) => index === first ? [replacement] : members.has(entry.widget) ? [] : [entry]);
      }
      if (after.home !== null) {
        const old = new Set(before.home?.map(key) ?? []), next = new Set(after.home.map(key));
        entries = entries.filter(entry => !old.has(entry.widget) || next.has(entry.widget));
        for (const selection of after.home) if ((before.home !== null || selection.kind !== 'device') && !old.has(key(selection)) && !entries.some(entry => entry.widget === key(selection))) entries.push({widget: key(selection), size: 'medium', hidden: false});
      }
      const seen = new Set<string>();entries = entries.filter(entry => {if (seen.has(entry.widget)) return false;seen.add(entry.widget);return true;});
      if (entries.length > 128) throw new Error('home-layout-capacity');layouts[breakpoint] = entries;
    }
    if (JSON.stringify(layouts) === JSON.stringify(current.layouts)) return;
    const record: HomeLayoutRecord = {...current, revision: tx.revision(), layouts};
    this.#save.run(JSON.stringify(record), ID);tx.add('bunny.state.home-layout.home', {kind: 'state', ...stateDraft(record)}, {parent: command});
  }
  async #replace(command: Command<HomeLayoutSetRequest>): Promise<Reply> {
    const checked = this.#validator.validate(command);
    if (!checked.ok) return errorBody(checked.error.code, {detail: 'the Home layout command is invalid'});
    if (!this.#admission.admit(command)) return errorBody('forbidden', {detail: 'the layout command has no operator admission'});
    command = {...command, data: structuredClone(command.data)};
    try {
      const core = this.#core;if (core === undefined) return errorBody('unavailable', {detail: 'the layout owner has not started'});
      await core.ready;
      let committed: (() => void) | undefined;
      const result = await core.transaction(tx => {
        const current = this.#record();
        if (current === undefined || this.#save === undefined) return errorBody('unavailable', {detail: 'the Home layout store is not open'});
        if (Date.parse(command.expiresat ?? '') <= tx.atMs) return errorBody('expired', {detail: 'the Home layout command expired before saving'});
        if (current.revision !== command.data.expectedRevision) return errorBody('revision-conflict', {detail: 'the Home layout changed; refresh before saving'});
        const record: HomeLayoutRecord = {id: ID, revision: tx.revision(), version: 1, layouts: command.data.layouts};
        this.#save.run(JSON.stringify(record), ID);
        tx.add('bunny.state.home-layout.home', {kind: 'state', ...stateDraft(record)}, {parent: command});tx.take(command);
        committed = this.#admission.complete(tx, command, {result: Outcome.succeeded, evidence: Outcome.observed});
        return {status: 'accepted'} as const;
      });
      if ('error' in result) return result;
      committed?.();return {status: 'accepted'};
    } catch (error) {
      return errorBody(fullDisk(error) ? 'capacity' : 'internal', {detail: 'the Home layout could not be saved; no device command was sent'});
    } finally {this.#admission.end(command);}
  }
}
