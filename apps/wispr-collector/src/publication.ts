import { closeSync, fsyncSync, lstatSync, openSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { MAX_SNAPSHOT_BYTES, validateSnapshot, type Snapshot } from '@jimmie-potts/wispr-contracts';

export type PublicationPaths = { aggregate: string; status: string };
export type FailureCode = 'source-unavailable' | 'source-schema' | 'source-busy' | 'source-capacity' | 'source-deadline' | 'source-read' | 'store-capacity' | 'publication-failed' | 'run-deadline' | 'binding-mismatch';
export type CollectorStatus = {
  schemaVersion: '1.0'; namespace: string; generation: string; revision: number;
  lastAttemptAt: string; lastSuccessAt: string | null; latestSourceDate: string | null;
  health: Snapshot['health'] | FailureCode; languageEnabled: boolean;
};

/** Caller must qualify owner paths/ACLs and hold the single collector lease. */
export function atomicJson(path: string, value: unknown, maxBytes = MAX_SNAPSHOT_BYTES): void {
  const encoded=JSON.stringify(value)+'\n';
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
