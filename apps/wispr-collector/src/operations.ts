import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { emptySnapshot } from '@jimmie-potts/wispr-contracts';
import { sourceIdentity,type CollectorConfig } from './config.js';
import { NumericStore } from './store.js';
import { publishSnapshot,recordFailure,readStatus,atomicJson,atomicText,type FailureCode } from './publication.js';
import { scanNumeric } from './reader-engine.js';
import { SOURCE_LIMITS,type SourceRow } from './reader-types.js';
import { initializeControl,writeControl } from './control.js';
import { safeCode } from './supervisor.js';

export type Operation = {command:'collect'|'status'|'clear'|'clear-text'|'zone'} | {command:'reset';historicalReimport:true} | {command:'backup';name:string} | {command:'restore';name:string;historicalReimport?:boolean} | {command:'rebind';confirmSameSource:true} | {command:'export';format:'json'|'csv';output:string};
export type OperationHooks = {maxMemoryBytes?:number;phase:(phase:'reading'|'processing')=>void;memory?:(rss:number)=>void;checkpoint?:(phase:'before-read'|'before-commit'|'committed'|'published')=>void};
const failureCodes=new Set<FailureCode>(['source-unavailable','source-schema','source-busy','source-capacity','source-deadline','source-read','store-capacity','aggregate-capacity','publication-capacity','publication-failed','run-deadline','binding-mismatch','source-changed','run-cancelled']);
/** Internal core: caller qualifies paths and holds both supervisor and worker ownership. */
export async function executeOperation(config:CollectorConfig,operation:Operation,hooks:OperationHooks):Promise<unknown> {
  if(operation.command==='collect'&&!config.collectionEnabled)throw new Error('collection-disabled');
  const paths={aggregate:join(config.stateDirectory,'aggregate.json'),status:join(config.stateDirectory,'status.json')};
  let identity=NumericStore.savedIdentity(config.stateDirectory)??'unbound';
  if(operation.command==='restore'&&!existsSync(join(config.stateDirectory,'analytics.sqlite'))){
    if(!operation.historicalReimport)throw new Error('backup-before-clear');
    const binding=NumericStore.backupBinding(config.stateDirectory,operation.name);
    if(binding.namespace!==config.namespace)throw new Error('binding-mismatch');
    identity=binding.sourceIdentity;
    const control=initializeControl(config.stateDirectory,config.namespace);
    // Recovery in a fresh directory approves backup records, not blanket source history.
    writeControl(config.stateDirectory,{...control,captureAfter:control.captureAfter??Date.now()});
  }
  const timezone=operation.command==='zone'?(NumericStore.savedTimezone(config.stateDirectory)??config.timezone):config.timezone;
  const store=new NumericStore({directory:config.stateDirectory,namespace:config.namespace,sourceIdentity:identity,timezone,maxMemoryBytes:hooks.maxMemoryBytes});
  const publish=()=>{const pending=store.pending();if(pending){publishSnapshot(paths,pending);hooks.checkpoint?.('published');store.markPublished(pending.revision);}};
  const now=()=>new Date().toISOString();
  try{
    hooks.phase('processing');
    // Clear must never republish the generation it is about to revoke.
    if(!['clear','clear-text','reset'].includes(operation.command))publish();
    switch(operation.command){
      case 'collect': {
        if(!existsSync(config.sourcePath))throw new Error('source-unavailable');
        const before=sourceIdentity(config.sourcePath);store.bindSource(before);
        const priorAttempt=readStatus(paths.status,store.snapshot());
        const rows:SourceRow[]=[];hooks.checkpoint?.('before-read');hooks.phase('reading');
        try{
          await scanNumeric(config.sourcePath,SOURCE_LIMITS,async batch=>{rows.push(...batch);hooks.memory?.(process.memoryUsage().rss);});
        }catch(error){const code=(error as {errcode?:number}).errcode;if(code===5||code===6)throw new Error('source-busy');if(code===14)throw new Error('source-unavailable');throw new Error(safeCode(error)==='run-failed'?'source-read':safeCode(error));}
        hooks.phase('processing');
        if(sourceIdentity(config.sourcePath)!==before)throw new Error('source-changed');
        hooks.checkpoint?.('before-commit');store.ingest(rows,now(),{failedAttempt:priorAttempt!==null&&failureCodes.has(priorAttempt.health as FailureCode)});hooks.checkpoint?.('committed');publish();
        break;
      }
      case 'clear': {const receipt=store.clearAll(now());publish();return {generation:receipt.snapshot.generation,revision:receipt.snapshot.revision,removedManagedBackups:receipt.removedManagedBackups,unmanagedCopiesRecallable:false};}
      case 'reset': {const receipt=store.clearAll(now(),{historicalReimport:true});publish();return {generation:receipt.snapshot.generation,revision:receipt.snapshot.revision,removedManagedBackups:receipt.removedManagedBackups,unmanagedCopiesRecallable:false};}
      case 'clear-text': {const receipt=store.clearText(now());publish();return {generation:receipt.snapshot.generation,revision:receipt.snapshot.revision,removedManagedBackups:receipt.removedManagedBackups,unmanagedCopiesRecallable:false};}
      case 'backup': await store.backup(operation.name);return {ok:true};
      case 'restore': store.restore(operation.name,now(),{historicalReimport:operation.historicalReimport});publish();break;
      case 'zone': store.rebuildZone(config.timezone,now());publish();break;
      case 'rebind': if(!existsSync(config.sourcePath))throw new Error('source-unavailable');store.bindSource(sourceIdentity(config.sourcePath),true);break;
      case 'export': {
        const snapshot=store.snapshot(),empty=emptySnapshot({namespace:snapshot.namespace,generation:snapshot.generation,timezone:snapshot.timezone,now:snapshot.generatedAt});
        if(operation.format==='json')atomicJson(operation.output,{...snapshot,language:empty.language,dictionary:empty.dictionary});
        else {
          const metrics=Object.keys(snapshot.numeric.totals),columns=['date','hour','weekday','app','category','archived',...metrics];
          const lines=[columns.join(','),...snapshot.numeric.cells.map(cell=>[cell.date,cell.hour,cell.weekday,cell.app,cell.category,cell.archived,...metrics.map(key=>cell[key as keyof typeof snapshot.numeric.totals])].join(','))];
          atomicText(operation.output,lines.join('\r\n')+'\r\n');
        }
        return {ok:true,revision:snapshot.revision};
      }
      case 'status': break;
    }
    const snapshot=store.snapshot(),attempt=readStatus(paths.status,snapshot);return {lastAttemptAt:attempt?.lastAttemptAt??null,namespace:snapshot.namespace,generation:snapshot.generation,revision:snapshot.revision,lastSuccessAt:snapshot.lastSuccessAt,latestSourceDate:snapshot.latestSourceDate,health:attempt?.health??snapshot.health,pendingPublication:store.pending()!==null,capacity:store.capacity()};
  }catch(error){
    const code=safeCode(error);if(failureCodes.has(code as FailureCode)){try{recordFailure(paths,store.snapshot(),code as FailureCode,now());}catch{}}
    throw new Error(code);
  }finally{store.close();}
}

/** Called after a terminated worker exits, while the parent still owns the run lease. */
export function recordInterruptedAttempt(config:CollectorConfig,code:string):void {
  if(!failureCodes.has(code as FailureCode))return;
  let store:NumericStore|undefined;
  try{
    const identity=NumericStore.savedIdentity(config.stateDirectory);if(identity===null)return;
    store=new NumericStore({directory:config.stateDirectory,namespace:config.namespace,sourceIdentity:identity,timezone:config.timezone});
    recordFailure({aggregate:join(config.stateDirectory,'aggregate.json'),status:join(config.stateDirectory,'status.json')},store.snapshot(),code as FailureCode,new Date().toISOString());
  }catch{/* Preserve the original failure; never expose a private SQLite error. */}finally{store?.close();}
}
