import {advanceRevision, initializeRevision} from './revision.js';
import type {DatabaseSync} from 'node:sqlite';
import type {CompanionState} from '@jimmie-potts/event-contracts/v2/companions';
import {defaultSettings, type Admission, type Allowance} from './rules.js';

export type Saved = {state: CompanionState; received: string[]; admissions: Admission[]; allowances: {live: Allowance; scenario: Allowance}};
/** Only this module's settings and bounded admission/presentation facts; core sessions and candidates are never stored. */
export class CompanionStore {
  readonly #db: DatabaseSync;
  constructor(database: DatabaseSync) {
    this.#db = database;
    database.exec('CREATE TABLE IF NOT EXISTS companion_state (id INTEGER PRIMARY KEY CHECK(id=1), record TEXT NOT NULL) STRICT');
    const empty = (): Allowance => ({day: '', count: 0, lastAtMs: null});
    const initial: Saved = {state: {id: 'reachy', revision: 0, settings: defaultSettings(), presentation: null, decision: 'disabled', availability: 'available'},
      received: [], admissions: [], allowances: {live: empty(), scenario: empty()}};
    database.prepare('INSERT INTO companion_state VALUES(1,?) ON CONFLICT(id) DO NOTHING').run(JSON.stringify(initial));
    initializeRevision(database, this.read().state.revision);
  }
  read(): Saved {
    const row = this.#db.prepare('SELECT record FROM companion_state WHERE id=1').get() as {record: string};
    return JSON.parse(row.record) as Saved;
  }
  save(value: Saved, stateChanged = true): void {
    if (stateChanged) value.state.revision = advanceRevision(this.#db);
    value.received = value.received.slice(-4096);
    value.admissions = value.admissions.slice(-128);
    this.#db.prepare('UPDATE companion_state SET record=? WHERE id=1').run(JSON.stringify(value));
  }
}
