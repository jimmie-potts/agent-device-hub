import type {DatabaseSync} from 'node:sqlite';
import type {PublicFamily, RobotState} from './contracts.js';
export type Responsibility = {source: string; request_id: string; digest: string; family: PublicFamily; operation_id: string; helper_epoch: string; generation: number; deadline: number; traceparent: string; stage: 'accepted' | 'started' | 'done'; outcome: string | null};
/** Accepted responsibility and own state; commands are never saved or replayed. */
export class Bb8Store {
  constructor(readonly database: DatabaseSync) {
    database.exec(`CREATE TABLE IF NOT EXISTS bb8_state (id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS bb8_responsibility (
        source TEXT NOT NULL, request_id TEXT NOT NULL, digest TEXT NOT NULL, family TEXT NOT NULL,
        operation_id TEXT NOT NULL UNIQUE, helper_epoch TEXT NOT NULL, generation INTEGER NOT NULL, deadline INTEGER NOT NULL, traceparent TEXT NOT NULL,
        stage TEXT NOT NULL CHECK(stage IN ('accepted','started','done')), outcome TEXT,
        PRIMARY KEY(source,request_id)
      ) STRICT`);
  }
  state(): RobotState | undefined {const row = this.database.prepare('SELECT state FROM bb8_state WHERE id=1').get() as {state: string} | undefined; return row === undefined ? undefined : JSON.parse(row.state) as RobotState;}
  setState(state: RobotState): void {this.database.prepare('INSERT INTO bb8_state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state').run(JSON.stringify(state));}
  row(source: string, id: string): Responsibility | undefined {return this.database.prepare('SELECT * FROM bb8_responsibility WHERE source=? AND request_id=?').get(source, id) as Responsibility | undefined;}
  operation(id: string): Responsibility | undefined {return this.database.prepare('SELECT * FROM bb8_responsibility WHERE operation_id=?').get(id) as Responsibility | undefined;}
  pending(): Responsibility[] {return this.database.prepare("SELECT * FROM bb8_responsibility WHERE stage!='done'").all() as Responsibility[];}
  accept(row: Omit<Responsibility, 'stage' | 'outcome'>): void {this.database.prepare("INSERT INTO bb8_responsibility(source,request_id,digest,family,operation_id,helper_epoch,generation,deadline,traceparent,stage) VALUES(?,?,?,?,?,?,?,?,?,'accepted')").run(row.source, row.request_id, row.digest, row.family, row.operation_id, row.helper_epoch, row.generation, row.deadline, row.traceparent);}
  started(id: string): void {this.database.prepare("UPDATE bb8_responsibility SET stage='started' WHERE operation_id=? AND stage='accepted'").run(id);}
  complete(id: string, outcome: object): void {this.database.prepare("UPDATE bb8_responsibility SET stage='done',outcome=? WHERE operation_id=?").run(JSON.stringify(outcome), id);}
}
