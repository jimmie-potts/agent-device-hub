import {DatabaseSync} from 'node:sqlite';
import {lstat,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {validateExport,type DurableState} from '@jimmie-potts/agent-state';
import {canonical,sha256} from './files.js';
import {privateRoot} from './plan.js';

const names=['automation_events','automation_log','automation_meta','automation_settings','fence','interrupt_set','rules','state'];
export type StateEvidence={format:'hub-durable-evidence/1.0';schemaSha256:string;state:DurableState;tables:Record<string,Record<string,unknown>[]>};
/** Read a consistent SQLite snapshot in the standalone updater process. No owner lease or writes. */
export async function captureState(directory:string):Promise<StateEvidence>{
 await privateRoot(directory);const path=join(directory,'state.sqlite'),info=await lstat(path);
 if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.uid!==process.getuid!()||(info.mode&0o077)!==0||await realpath(path)!==path)throw new Error('unsafe-install-state');
 const database=new DatabaseSync(path,{readOnly:true});
 try{
  database.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1000; BEGIN');
  const schema=database.prepare("SELECT name,sql FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  if(canonical(schema.map(row=>row.name))!==canonical(names))throw new Error('unqualified-durable-schema');
  const tables:StateEvidence['tables']={};let bytes=0;
  for(const name of names){
   const rows=database.prepare('SELECT * FROM '+name+' LIMIT 20001').all();if(rows.length>20000)throw new Error('install-state-capacity');
   bytes+=Buffer.byteLength(canonical(rows));if(bytes>32*1024*1024)throw new Error('install-state-capacity');
   tables[name]=rows.sort((a,b)=>canonical(a)<canonical(b)?-1:1);
  }
  const row=tables.state;if(row.length!==1||typeof row[0].payload!=='string')throw new Error('invalid-install-state');
  const checked=validateExport(JSON.parse(row[0].payload));if(!checked.ok||checked.value.formatVersion!=='2.1'||row[0].revision!==checked.value.revision)throw new Error('unqualified-durable-format');
  database.exec('COMMIT');delete tables.state;
  return {format:'hub-durable-evidence/1.0',schemaSha256:sha256(canonical(schema)),state:checked.value,tables};
 }finally{database.close();}
}
const includes=(before:readonly unknown[],after:readonly unknown[])=>{const values=new Set(after.map(canonical));return before.every(value=>values.has(canonical(value)));};
/** Conservative comparison: additions are safe; missing records or changed owner data require inspection. */
export function statePreserved(before:unknown,after:unknown):boolean{
 try{
  const a=before as StateEvidence,b=after as StateEvidence;
  if(a.format!=='hub-durable-evidence/1.0'||b.format!==a.format||a.schemaSha256!==b.schemaSha256||a.state.ownerId!==b.state.ownerId||a.state.formatVersion!==b.state.formatVersion||b.state.revision<a.state.revision||canonical(a.state.consumers)!==canonical(b.state.consumers))return false;
  for(const old of a.state.sessions){
   const next=b.state.sessions.find(row=>canonical(row.identity)===canonical(old.identity));if(!next)return false;
   for(const field of ['label','labelOrigin','title','project','projectId'] as const)if(JSON.stringify(old[field])!==JSON.stringify(next[field]))return false;
   for(const notice of old.notices){const found=next.notices.find(item=>item.id===notice.id);if(!found||notice.kind!==found.kind||canonical(notice.turn)!==canonical(found.turn)||!includes(notice.acknowledgedBy,found.acknowledgedBy))return false;}
   if(!includes(old.seen,next.seen)||!includes(old.retiredTurns,next.retiredTurns)||!includes(old.attention,next.attention))return false;
   if(old.watermarks.some(mark=>!next.watermarks.some(item=>item.dimension===mark.dimension&&item.epoch===mark.epoch&&item.sequence>=mark.sequence)))return false;
  }
  if(!includes(a.state.retirements??[],b.state.retirements??[])||!includes(a.state.journal,b.state.journal))return false;
  if(canonical(Object.keys(a.tables).sort())!==canonical(Object.keys(b.tables).sort()))return false;
  return Object.entries(a.tables).every(([name,rows])=>includes(rows,b.tables[name]));
 }catch{return false;}
}
