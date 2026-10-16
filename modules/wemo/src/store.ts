import type {DatabaseSync} from 'node:sqlite';
import type {CompletedOutcome,DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
export type Row={requestId:string;target:string;family:string;digest:string;traceparent:string;state:'accepted'|'started'|'done';outcome?:CompletedOutcome};
export const canonical=(v:unknown):string=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:typeof v==='object'&&v!==null?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical((v as Record<string,unknown>)[k])}`).join(',')}}`:JSON.stringify(v);
export class WemoStore {
  constructor(readonly db:DatabaseSync){db.exec(`CREATE TABLE IF NOT EXISTS wemo_requests(request_id TEXT PRIMARY KEY,record TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS wemo_devices(id TEXT PRIMARY KEY,record TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS wemo_meta(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL) STRICT;
    INSERT OR IGNORE INTO wemo_meta VALUES(1,0);`);}
  get(id:string):Row|undefined{const v=this.db.prepare('SELECT record FROM wemo_requests WHERE request_id=?').get(id) as {record:string}|undefined;return v===undefined?undefined:JSON.parse(v.record) as Row;}
  save(row:Row):void{this.db.prepare('INSERT INTO wemo_requests VALUES(?,?) ON CONFLICT(request_id) DO UPDATE SET record=excluded.record').run(row.requestId,JSON.stringify(row));}
  unfinished():Row[]{return (this.db.prepare("SELECT record FROM wemo_requests WHERE json_extract(record,'$.state')<>'done'").all() as {record:string}[]).map(v=>JSON.parse(v.record) as Row);}
  device(id:string):DeviceRecord|undefined{const v=this.db.prepare('SELECT record FROM wemo_devices WHERE id=?').get(id) as {record:string}|undefined;return v===undefined?undefined:JSON.parse(v.record) as DeviceRecord;}
  deviceSave(record:DeviceRecord):void{this.db.prepare('INSERT INTO wemo_devices VALUES(?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record').run(record.id,JSON.stringify(record));}
  revision():number{return Number(this.db.prepare('SELECT revision FROM wemo_meta WHERE id=1').get()?.revision);}
  next():number{const n=this.revision()+1;this.db.prepare('UPDATE wemo_meta SET revision=? WHERE id=1').run(n);return n;}
}
