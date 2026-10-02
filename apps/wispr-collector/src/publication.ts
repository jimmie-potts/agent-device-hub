import { closeSync, fsyncSync, lstatSync, readFileSync, statSync, existsSync, openSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { MAX_SNAPSHOT_BYTES, validateSnapshot, validateStatus, type CollectorStatus, type FailureCode, type Snapshot } from '@jimmie-potts/wispr-contracts';

export type PublicationPaths = { aggregate: string; status: string };
export type { CollectorStatus, FailureCode } from '@jimmie-potts/wispr-contracts';

/** Caller must qualify owner paths/ACLs and hold the single collector lease. */
export function atomicJson(path: string, value: unknown, maxBytes = MAX_SNAPSHOT_BYTES): void {
  atomicText(path,JSON.stringify(value)+'\n',maxBytes);
}
export function atomicText(path:string,encoded:string,maxBytes=MAX_SNAPSHOT_BYTES):void {
  if(Buffer.byteLength(encoded)>maxBytes)throw new Error('publication-capacity');
  const temporary=join(dirname(path),`.${basename(path)}.${randomUUID()}.pending`);
  let descriptor:number|undefined;
  let created=false;
  try{
    try{if(lstatSync(path).isSymbolicLink()||!lstatSync(path).isFile())throw new Error('unsafe-destination');}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    descriptor=openSync(temporary,'wx',0o600);created=true;
    writeFileSync(descriptor,encoded,'utf8');fsyncSync(descriptor);closeSync(descriptor);descriptor=undefined;
    renameSync(temporary,path);created=false;
    if(process.platform!=='win32'){
      const directory=openSync(dirname(path),'r');
      try{fsyncSync(directory);}finally{closeSync(directory);}
    }
  }catch{throw new Error('publication-failed');}
  finally{
    if(descriptor!==undefined)closeSync(descriptor);
    if(created){try{unlinkSync(temporary);}catch{/* The pending generation remains recoverable; do not remove unrelated files. */}}
  }
}

function status(snapshot: Snapshot, health: CollectorStatus['health'], lastAttemptAt: string): CollectorStatus {
  return {schemaVersion:'1.0',namespace:snapshot.namespace,generation:snapshot.generation,revision:snapshot.revision,
    lastAttemptAt,lastSuccessAt:snapshot.lastSuccessAt,latestSourceDate:snapshot.latestSourceDate,
    health,languageEnabled:snapshot.language.availability==='available'};
}

export function publishSnapshot(paths: PublicationPaths, input: unknown): void {
  const result=validateSnapshot(input);
  if(!result.ok)throw new Error('invalid-snapshot');
  atomicJson(paths.aggregate,result.value);
  atomicJson(paths.status,status(result.value,result.value.health,result.value.generatedAt),4096);
}

export function recordFailure(paths: PublicationPaths, snapshot: Snapshot, code: FailureCode, attemptedAt: string): void {
  atomicJson(paths.status,status(snapshot,code,attemptedAt),4096);
}

export function readStatus(path:string,snapshot:Snapshot):CollectorStatus|null {
  if(!existsSync(path))return null;
  if(statSync(path).size>4096)throw new Error('invalid-status');
  const result=validateStatus(JSON.parse(readFileSync(path,'utf8')));
  if(!result.ok)throw new Error('invalid-status');
  const value=result.value;
  if(value.namespace!==snapshot.namespace||value.generation!==snapshot.generation||value.revision!==snapshot.revision||value.lastSuccessAt!==snapshot.lastSuccessAt||value.latestSourceDate!==snapshot.latestSourceDate)throw new Error('invalid-status');
  return value;
}
