import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {advanceRevision, initializeRevision} from '../revision.js';
import {LIBRARY_BYTES, type ActivePreferences, type Preference, type PreferenceHistory, type PreferenceLibrary, type PreferenceView} from './model.js';
import {fail, type PreferenceInput} from './validation.js';

export type Stage<T = PreferenceInput> = {ref: string; requestId: string; input: T; expires: number};
const parsed = <T>(row: {record: string} | undefined): T | undefined => row === undefined ? undefined : JSON.parse(row.record) as T;
export class PreferenceStore<T = PreferenceInput> {
  get table(): string {return this.namespace === 'knowledge' ? 'knowledge' : 'preferences';}
  get prefix(): string {return this.namespace === 'knowledge' ? 'knowledge' : 'preference';}
  constructor(readonly database: DatabaseSync, readonly namespace: 'preferences' | 'knowledge' = 'preferences') {
    database.exec(`CREATE TABLE IF NOT EXISTS ${this.table} (id TEXT PRIMARY KEY, record TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS ${this.prefix}_meta (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL) STRICT;
      INSERT INTO ${this.prefix}_meta VALUES(1,0) ON CONFLICT(id) DO NOTHING;
      CREATE TABLE IF NOT EXISTS ${this.prefix}_inputs (ref TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, record TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS ${this.prefix}_receipts (request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL) STRICT;
      DELETE FROM ${this.prefix}_inputs;`);
    initializeRevision(database, this.revision());
  }
  revision(): number {return (this.database.prepare(`SELECT revision FROM ${this.prefix}_meta WHERE id=1`).get() as {revision: number}).revision;}
  bump(): void {this.database.prepare(`UPDATE ${this.prefix}_meta SET revision=? WHERE id=1`).run(advanceRevision(this.database));}
  entries(): Preference[] {return (this.database.prepare(`SELECT record FROM ${this.table} ORDER BY rowid`).all() as {record: string}[]).map(row => JSON.parse(row.record) as Preference);}
  library(): PreferenceLibrary {return {schema: 'preference-library/1.0', entries: this.entries()};}
  view(): PreferenceView {return {schema: 'preference-view/1.0', revision: this.revision(), entries: this.entries()};}
  active(): ActivePreferences {
    return {schema: 'preferences/1.0', revision: this.revision(), entries: this.entries().filter(entry => entry.active).map(({history: _history, ...entry}) => entry)};
  }
  apply(input: PreferenceInput, now: number): void {
    if (input.expectedRevision !== this.revision()) fail('revision-conflict');
    if (input.action === 'import') {
      const exists = this.database.prepare(`SELECT 1 FROM ${this.table} WHERE id=?`);
      const insert = this.database.prepare(`INSERT INTO ${this.table} VALUES(?,?)`);
      for (const exported of input.library.entries) {
        if (exists.get(exported.id) !== undefined) continue;
        const entry = structuredClone(exported);
        entry.active = false; entry.updatedAtMs = Math.max(now, entry.updatedAtMs);
        entry.history.push({action: 'imported', source: 'import', atMs: entry.updatedAtMs, title: entry.title, text: entry.text, active: false});
        insert.run(entry.id, JSON.stringify(entry));
      }
      this.#capacity();
      return;
    }
    const entry: Preference = input.action === 'create'
      ? {id: randomUUID(), title: input.title, text: input.text, active: true, createdAtMs: now, updatedAtMs: now, history: []}
      : parsed<Preference>(this.database.prepare(`SELECT record FROM ${this.table} WHERE id=?`).get(input.id) as {record: string} | undefined) ?? fail('not-found');
    let action: PreferenceHistory['action'] = 'created';
    if (input.action === 'edit') {entry.title = input.title; entry.text = input.text; action = 'edited';}
    if (input.action === 'set-active') {entry.active = input.active; action = input.active ? 'reactivated' : 'deactivated';}
    // A host clock correction cannot make history go backwards.
    entry.updatedAtMs = Math.max(now, entry.updatedAtMs);
    entry.history.push({action, source: 'owner', atMs: entry.updatedAtMs, title: entry.title, text: entry.text, active: entry.active});
    this.database.prepare(`INSERT INTO ${this.table} VALUES(?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record`).run(entry.id, JSON.stringify(entry));
    this.#capacity();
  }
  #capacity(): void {if (Buffer.byteLength(JSON.stringify(this.library())) > LIBRARY_BYTES) fail('capacity');}
  stage(stage: Stage<T>): void {this.database.prepare(`INSERT INTO ${this.prefix}_inputs VALUES(?,?,?)`).run(stage.ref, stage.requestId, JSON.stringify(stage));}
  input(ref: string): Stage<T> | undefined {return parsed<Stage<T>>(this.database.prepare(`SELECT record FROM ${this.prefix}_inputs WHERE ref=?`).get(ref) as {record: string} | undefined);}
  inputFor(requestId: string): Stage<T> | undefined {return parsed<Stage<T>>(this.database.prepare(`SELECT record FROM ${this.prefix}_inputs WHERE request_id=?`).get(requestId) as {record: string} | undefined);}
  discard(ref: string): void {this.database.prepare(`DELETE FROM ${this.prefix}_inputs WHERE ref=?`).run(ref);}
  expireStages(now: number): void {this.database.prepare(`DELETE FROM ${this.prefix}_inputs WHERE json_extract(record,'$.expires')<=?`).run(now);}
  stagedCount(): number {return (this.database.prepare(`SELECT COUNT(*) AS count FROM ${this.prefix}_inputs`).get() as {count: number}).count;}
  receipt(requestId: string): string | undefined {return (this.database.prepare(`SELECT fingerprint FROM ${this.prefix}_receipts WHERE request_id=?`).get(requestId) as {fingerprint: string} | undefined)?.fingerprint;}
  remember(requestId: string, fingerprint: string): void {this.database.prepare(`INSERT INTO ${this.prefix}_receipts VALUES(?,?)`).run(requestId, fingerprint);}
}
