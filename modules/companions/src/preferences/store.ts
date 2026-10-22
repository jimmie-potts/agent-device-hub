import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {advanceRevision, initializeRevision} from '../revision.js';
import {LIBRARY_BYTES, type ActivePreferences, type Preference, type PreferenceHistory, type PreferenceLibrary, type PreferenceView} from './model.js';
import {fail, type PreferenceInput} from './validation.js';

export type Stage = {ref: string; requestId: string; input: PreferenceInput; expires: number};
const parsed = <T>(row: {record: string} | undefined): T | undefined => row === undefined ? undefined : JSON.parse(row.record) as T;
export class PreferenceStore {
  constructor(readonly database: DatabaseSync) {
    database.exec(`CREATE TABLE IF NOT EXISTS preferences (id TEXT PRIMARY KEY, record TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS preference_meta (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL) STRICT;
      INSERT INTO preference_meta VALUES(1,0) ON CONFLICT(id) DO NOTHING;
      CREATE TABLE IF NOT EXISTS preference_inputs (ref TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, record TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS preference_receipts (request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL) STRICT;
      DELETE FROM preference_inputs;`);
    initializeRevision(database, this.revision());
  }
  revision(): number {return (this.database.prepare('SELECT revision FROM preference_meta WHERE id=1').get() as {revision: number}).revision;}
  bump(): void {this.database.prepare('UPDATE preference_meta SET revision=? WHERE id=1').run(advanceRevision(this.database));}
  entries(): Preference[] {return (this.database.prepare('SELECT record FROM preferences ORDER BY rowid').all() as {record: string}[]).map(row => JSON.parse(row.record) as Preference);}
  library(): PreferenceLibrary {return {schema: 'preference-library/1.0', entries: this.entries()};}
  view(): PreferenceView {return {schema: 'preference-view/1.0', revision: this.revision(), entries: this.entries()};}
  active(): ActivePreferences {
    return {schema: 'preferences/1.0', revision: this.revision(), entries: this.entries().filter(entry => entry.active).map(({history: _history, ...entry}) => entry)};
  }
  apply(input: PreferenceInput, now: number): void {
    if (input.expectedRevision !== this.revision()) fail('revision-conflict');
    if (input.action === 'import') {
      const exists = this.database.prepare('SELECT 1 FROM preferences WHERE id=?');
      const insert = this.database.prepare('INSERT INTO preferences VALUES(?,?)');
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
      : parsed<Preference>(this.database.prepare('SELECT record FROM preferences WHERE id=?').get(input.id) as {record: string} | undefined) ?? fail('not-found');
    let action: PreferenceHistory['action'] = 'created';
    if (input.action === 'edit') {entry.title = input.title; entry.text = input.text; action = 'edited';}
    if (input.action === 'set-active') {entry.active = input.active; action = input.active ? 'reactivated' : 'deactivated';}
    // A host clock correction cannot make history go backwards.
    entry.updatedAtMs = Math.max(now, entry.updatedAtMs);
    entry.history.push({action, source: 'owner', atMs: entry.updatedAtMs, title: entry.title, text: entry.text, active: entry.active});
    this.database.prepare('INSERT INTO preferences VALUES(?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record').run(entry.id, JSON.stringify(entry));
    this.#capacity();
  }
  #capacity(): void {if (Buffer.byteLength(JSON.stringify(this.library())) > LIBRARY_BYTES) fail('capacity');}
  stage(stage: Stage): void {this.database.prepare('INSERT INTO preference_inputs VALUES(?,?,?)').run(stage.ref, stage.requestId, JSON.stringify(stage));}
  input(ref: string): Stage | undefined {return parsed<Stage>(this.database.prepare('SELECT record FROM preference_inputs WHERE ref=?').get(ref) as {record: string} | undefined);}
  inputFor(requestId: string): Stage | undefined {return parsed<Stage>(this.database.prepare('SELECT record FROM preference_inputs WHERE request_id=?').get(requestId) as {record: string} | undefined);}
  discard(ref: string): void {this.database.prepare('DELETE FROM preference_inputs WHERE ref=?').run(ref);}
  expireStages(now: number): void {this.database.prepare("DELETE FROM preference_inputs WHERE json_extract(record,'$.expires')<=?").run(now);}
  stagedCount(): number {return (this.database.prepare('SELECT COUNT(*) AS count FROM preference_inputs').get() as {count: number}).count;}
  receipt(requestId: string): string | undefined {return (this.database.prepare('SELECT fingerprint FROM preference_receipts WHERE request_id=?').get(requestId) as {fingerprint: string} | undefined)?.fingerprint;}
  remember(requestId: string, fingerprint: string): void {this.database.prepare('INSERT INTO preference_receipts VALUES(?,?)').run(requestId, fingerprint);}
}
