import type {DatabaseSync} from 'node:sqlite';
import type {LinkRequest, LinkResult} from '@jimmie-potts/bb8/link';
export type ReceiptRow = {id: string; parent_id: string; helper_epoch: string; generation: number; deadline: number; traceparent: string; effect: number; completed: number; consumed: number; result: string | null};
/** Private history is retained; only the unconsumed sync projection is capped. No row is an executable command. */
export class Receipts {
  constructor(readonly database: DatabaseSync) {
    database.exec(`CREATE TABLE IF NOT EXISTS bb8_meta (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, generation INTEGER NOT NULL) STRICT;
      INSERT OR IGNORE INTO bb8_meta VALUES(1,0,0);
      CREATE TABLE IF NOT EXISTS bb8_receipts (
        id TEXT PRIMARY KEY, parent_id TEXT NOT NULL, helper_epoch TEXT NOT NULL, generation INTEGER NOT NULL,
        deadline INTEGER NOT NULL, traceparent TEXT NOT NULL, effect INTEGER NOT NULL DEFAULT 0, completed INTEGER NOT NULL DEFAULT 0,
        consumed INTEGER NOT NULL DEFAULT 0, result TEXT
      ) STRICT`);
  }
  bind(id: string): void {
    this.database.exec('CREATE TABLE IF NOT EXISTS bb8_target (id INTEGER PRIMARY KEY CHECK(id=1), robot_id TEXT NOT NULL) STRICT');
    const saved = this.database.prepare('SELECT robot_id FROM bb8_target WHERE id=1').get();
    if (saved !== undefined && saved.robot_id !== id) throw new Error('BB-8 receipt store belongs to another target');
    this.database.prepare('INSERT OR IGNORE INTO bb8_target VALUES(1,?)').run(id);
  }
  row(id: string): ReceiptRow | undefined {return this.database.prepare('SELECT * FROM bb8_receipts WHERE id=?').get(id) as ReceiptRow | undefined;}
  pending(): ReceiptRow[] {return this.database.prepare('SELECT * FROM bb8_receipts WHERE completed=0').all() as ReceiptRow[];}
  count(): number {return Number(this.database.prepare('SELECT COUNT(*) AS count FROM bb8_receipts WHERE consumed=0').get()?.count);}
  results(): LinkResult[] {return (this.database.prepare('SELECT result FROM bb8_receipts WHERE completed=1 AND consumed=0').all() as {result: string}[]).map(row => JSON.parse(row.result) as LinkResult);}
  revision(): number {return Number(this.database.prepare('SELECT revision FROM bb8_meta WHERE id=1').get()?.revision);}
  generation(): number {return Number(this.database.prepare('SELECT generation FROM bb8_meta WHERE id=1').get()?.generation);}
  nextRevision(): number {this.database.exec('UPDATE bb8_meta SET revision=revision+1 WHERE id=1'); return this.revision();}
  nextGeneration(): number {this.database.exec('UPDATE bb8_meta SET generation=generation+1 WHERE id=1'); return this.generation();}
  admit(request: LinkRequest, traceparent: string): void {
    this.database.prepare('INSERT INTO bb8_receipts(id,parent_id,helper_epoch,generation,deadline,traceparent) VALUES(?,?,?,?,?,?)').run(request.operationId, request.parentRequestId, request.expectedHelperEpoch, request.expectedConnectionGeneration, request.operationExpiresAtMs, traceparent);
  }
  effect(id: string, generation: number): void {this.database.prepare('UPDATE bb8_receipts SET effect=1,generation=? WHERE id=? AND completed=0').run(generation, id);}
  complete(result: LinkResult): void {this.database.prepare('UPDATE bb8_receipts SET completed=1,result=? WHERE id=?').run(JSON.stringify(result), result.id);}
  consume(id: string): void {this.database.prepare('UPDATE bb8_receipts SET consumed=1 WHERE id=? AND completed=1').run(id);}
}
