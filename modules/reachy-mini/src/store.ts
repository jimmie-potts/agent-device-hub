import type {DatabaseSync} from 'node:sqlite';
import {Ajv2020} from 'ajv/dist/2020.js';
import type {CompletedOutcome} from '@jimmie-potts/event-contracts/v2/devices';
import type {Family, ReachyState} from './contracts.js';
import {families} from './contracts.js';
import {validState, outcomeSchema} from './families.js';
export type Row = {requestId: string; digest: string; family: Family; traceparent: string; started: boolean; moveId: string | null; recoveryOf?: string; outcome?: CompletedOutcome};
const validRow = new Ajv2020({strict: false}).compile<Row>({
  type: 'object', additionalProperties: false, required: ['requestId', 'digest', 'family', 'traceparent', 'started', 'moveId'],
  properties: {requestId: {type: 'string'}, digest: {type: 'string'}, family: {enum: families}, traceparent: {type: 'string'},
    recoveryOf: {type:'string'}, started: {type: 'boolean'}, moveId: {type: ['string', 'null']}, outcome: outcomeSchema},
});
function document(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || !('record' in value) || typeof value.record !== 'string') throw new Error('invalid Reachy stored record');
  return JSON.parse(value.record);
}
export class ReachyStore {
  constructor(readonly db: DatabaseSync) {
    db.exec('CREATE TABLE IF NOT EXISTS reachy_state (id INTEGER PRIMARY KEY CHECK(id=1),record TEXT NOT NULL) STRICT; CREATE TABLE IF NOT EXISTS reachy_requests (id TEXT PRIMARY KEY,record TEXT NOT NULL) STRICT; CREATE TABLE IF NOT EXISTS reachy_origins (id TEXT PRIMARY KEY) STRICT; CREATE TABLE IF NOT EXISTS reachy_policy (id INTEGER PRIMARY KEY CHECK(id=1),last_auto_ms INTEGER NOT NULL) STRICT;');
  }
  state(): ReachyState | undefined {
    const row = this.db.prepare('SELECT record FROM reachy_state WHERE id=1').get(); if (row === undefined) return undefined;
    const value = document(row); if (!validState(value)) throw new Error('invalid Reachy state'); return value;
  }
  saveState(state: ReachyState): void {this.db.prepare('INSERT INTO reachy_state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record').run(JSON.stringify(state));}
  row(id: string): Row | undefined {
    const row = this.db.prepare('SELECT record FROM reachy_requests WHERE id=?').get(id); if (row === undefined) return undefined;
    const value = document(row); if (!validRow(value)) throw new Error('invalid Reachy responsibility'); return value;
  }
  save(row: Row): void {this.db.prepare('INSERT INTO reachy_requests VALUES(?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record').run(row.requestId, JSON.stringify(row));}
  unfinished(): Row[] {
    return this.db.prepare("SELECT record FROM reachy_requests WHERE json_extract(record,'$.outcome') IS NULL").all().map(row => {
      const value = document(row); if (!validRow(value)) throw new Error('invalid Reachy responsibility'); return value;
    });
  }
  lastAutomaticAt():number|undefined {const row=this.db.prepare('SELECT last_auto_ms FROM reachy_policy WHERE id=1').get();if(row===undefined)return undefined;if(typeof row.last_auto_ms!=='number'||!Number.isSafeInteger(row.last_auto_ms)||row.last_auto_ms<0)throw new Error('invalid Reachy rate evidence');return row.last_auto_ms;}
  automaticAt(at:number):void {this.db.prepare('INSERT INTO reachy_policy VALUES(1,?) ON CONFLICT(id) DO UPDATE SET last_auto_ms=excluded.last_auto_ms').run(at);}
  consume(id: string): boolean {return this.db.prepare('INSERT OR IGNORE INTO reachy_origins VALUES(?)').run(id).changes === 1;}
}
