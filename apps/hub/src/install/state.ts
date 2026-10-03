import {DatabaseSync} from 'node:sqlite';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {lstat,realpath,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join} from 'node:path';
import {validateExport,LIMITS,type DurableState} from '@jimmie-potts/agent-state';
import {parseSettings,parseInterruptSet,parseRuleInput} from '../automation.js';
import {EVENT_LIMIT,LOG_LIMIT} from '../automation-store.js';
import {canonical,sha256} from './files.js';
import {privateRoot} from './plan.js';

const names=['automation_events','automation_log','automation_meta','automation_settings','fence','interrupt_set','rules','state'];
export type StateEvidence={format:'hub-durable-evidence/1.0';changeCounter:number;schemaSha256:string;state:DurableState;tables:Record<string,Record<string,unknown>[]>};
/** Kill the isolated reader on timeout so synchronous SQLite cannot delay owner resumption. */
export async function captureStateIsolated(directory:string):Promise<StateEvidence>{
 const {stdout}=await promisify(execFile)(process.execPath,[fileURLToPath(new URL('../../bin/install-state-inspection.mjs',import.meta.url)),directory],{timeout:5000,killSignal:'SIGKILL',maxBuffer:64*1024*1024});
 return JSON.parse(stdout) as StateEvidence;
}
/** Read a consistent SQLite snapshot in the standalone updater process. No owner lease or writes. */
export async function captureState(directory:string):Promise<StateEvidence>{
 await privateRoot(directory);const path=join(directory,'state.sqlite'),info=await lstat(path);
 if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.uid!==process.getuid!()||(info.mode&0o077)!==0||await realpath(path)!==path)throw new Error('unsafe-install-state');
 // The caller has stopped or frozen the only writer. Close this descriptor BEFORE
 // SQLite opens the inode: closing a second descriptor would release POSIX locks.
 // Rollback-journal change counter: https://www.sqlite.org/fileformat.html
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW),header=Buffer.alloc(100);
 try{if((await file.read(header,0,100,0)).bytesRead!==100)throw new Error('invalid-install-state');}finally{await file.close();}
 if(header.subarray(0,16).toString()!=='SQLite format 3\0'||header[18]!==1||header[19]!==1)throw new Error('unqualified-durable-journal');
 const changeCounter=header.readUInt32BE(24);
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
  return {format:'hub-durable-evidence/1.0',changeCounter,schemaSha256:sha256(canonical(schema)),state:checked.value,tables};
 }finally{database.close();}
}
const includes=(before:readonly unknown[],after:readonly unknown[])=>{const values=new Set(after.map(canonical));return before.every(value=>values.has(canonical(value)));};
/** Compare evidence from the qualified, single writer, including its documented mutations
 * and bounded retention. A commit counter is ordering evidence, not proof of user intent.
 * Exact stopped-state comparisons in operation.ts separately protect every binary switch. */
export function statePreserved(before:unknown,after:unknown):boolean{
 try{
  const a=before as StateEvidence,b=after as StateEvidence;
  if(a.format!=='hub-durable-evidence/1.0'||b.format!==a.format||a.schemaSha256!==b.schemaSha256||a.state.ownerId!==b.state.ownerId||a.state.formatVersion!==b.state.formatVersion||b.state.revision<a.state.revision||b.state.lastCommitAtMs<a.state.lastCommitAtMs||canonical(a.state.consumers)!==canonical(b.state.consumers))return false;
  if(![a.changeCounter,b.changeCounter].every(value=>Number.isInteger(value)&&value>=0&&value<=0xffffffff))return false;
  const commits=(b.changeCounter-a.changeCounter)>>>0;
  if(commits===0)return canonical(a)===canonical(b);
  if(commits>=0x80000000)return false;
  const revisions=b.state.revision-a.state.revision,at=b.state.lastCommitAtMs;
  if(revisions===0&&canonical(a.state)!==canonical(b.state))return false;
  const bounded=(old:readonly unknown[],next:readonly unknown[],limit:number,writes=revisions)=>includes(old.slice(Math.max(0,old.length+writes-limit)),next);
  const same=(left:unknown,right:unknown)=>canonical(left)===canonical(right);
  for(const old of a.state.sessions){
   const next=b.state.sessions.find(row=>same(row.identity,old.identity));
   if(!next||(next.generation??0)>(old.generation??0)){
    if(old.lastEvidenceAtMs<=at-LIMITS.sessionAgeMs)continue;
    const retired=b.state.retirements?.find(row=>same(row.identity,old.identity));
    if(!retired||retired.atMs<a.state.lastCommitAtMs||!bounded(old.seen.map(row=>row.key),retired.keys,LIMITS.seen)||!bounded(old.retiredTurns,retired.turns,LIMITS.retiredTurns))return false;
    continue;
   }
   // Provider observation timestamps may move backward on accepted ordered events.
   if(next.lastEvidenceAtMs<old.lastEvidenceAtMs||(next.generation??0)<(old.generation??0)||(next.metadataObservedAtMs??0)<(old.metadataObservedAtMs??0))return false;
   // Labels, metadata, activity and resolved attention can change through owner APIs.
   // Notices and acknowledgments cannot disappear from an extant session.
   for(const notice of old.notices){const found=next.notices.find(item=>item.id===notice.id);if(!found||notice.kind!==found.kind||!same(notice.turn,found.turn)||!includes(notice.acknowledgedBy,found.acknowledgedBy))return false;}
   if(!bounded(old.seen,next.seen,LIMITS.seen)||!bounded(old.retiredTurns,next.retiredTurns,LIMITS.retiredTurns))return false;
   if(old.watermarks.some(mark=>!next.watermarks.some(item=>item.dimension===mark.dimension&&item.epoch===mark.epoch&&item.sequence>=mark.sequence)))return false;
  }
  const oldJournal=a.state.journal.filter(row=>row.atMs>at-LIMITS.journalAgeMs);
  if(!bounded(oldJournal,b.state.journal,LIMITS.journalEvents))return false;
  for(const old of a.state.retirements??[]){
   if(old.atMs<=at-LIMITS.sessionAgeMs)continue;
   const next=b.state.retirements?.find(row=>same(row.identity,old.identity));
   // A replacement retirement can add guards; capacity evicts the oldest rows.
   if(!next){if(b.state.retirements?.length===LIMITS.retirements&&b.state.retirements.every(row=>row.atMs>=old.atMs))continue;return false;}
   if(next.atMs<old.atMs||!bounded(old.keys,next.keys,LIMITS.seen)||!bounded(old.turns,next.turns,LIMITS.retiredTurns))return false;
   if(old.ordering.some(mark=>!next.ordering.some(item=>item.epoch===mark.epoch&&item.sequence>=mark.sequence)))return false;
  }
  if(!same(Object.keys(a.tables).sort(),Object.keys(b.tables).sort())||!same(a.tables.automation_meta,b.tables.automation_meta))return false;
  for(const [name,limit] of [['automation_events',EVENT_LIMIT],['automation_log',LOG_LIMIT]] as const){
   const rows=b.tables[name],maximum=Math.max(0,...rows.map(row=>Number(row.seq))),oldMaximum=Math.max(0,...a.tables[name].map(row=>Number(row.seq)));
   if(maximum<oldMaximum||!includes(a.tables[name].filter(row=>Number(row.seq)>maximum-limit),rows))return false;
  }
  if(b.tables.automation_settings.length!==1||b.tables.automation_settings[0].id!==1)return false;
  parseSettings(JSON.parse(String(b.tables.automation_settings[0].payload)));
  parseInterruptSet({kinds:b.tables.interrupt_set.map(row=>row.kind)});
  // An untouched store represents an open fence with no row. Once written, the
  // adapter updates that row and never deletes it.
  if(b.tables.fence.length===0){if(a.tables.fence.length!==0)return false;}
  else if(b.tables.fence.length!==1||b.tables.fence[0].id!==1||![0,1].includes(Number(b.tables.fence[0].active)))return false;
  for(const row of b.tables.rules){
   parseRuleInput({name:row.name,kind:row.kind,enabled:row.enabled===1,trigger:JSON.parse(String(row.trigger)),action:JSON.parse(String(row.action))},null,true);
   const old=a.tables.rules.find(item=>item.id===row.id);
   if(old&&(old.created_at_ms!==row.created_at_ms||Number(row.updated_at_ms)<Number(old.updated_at_ms)))return false;
  }
  return true;
 }catch{return false;}
}
