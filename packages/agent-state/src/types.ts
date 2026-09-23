import type {Envelope, Identity, KnownId} from '@jimmie-potts/agent-lifecycle-contracts';

export type {Envelope, Identity, KnownId};
export const VERSION = '2.0.1';
export const FORMAT_VERSION = '1.0';
export const LIMITS = Object.freeze({eventBytes:2048, pendingEvents:128, pendingBytes:262144,
  journalEvents:10000, journalAgeMs:86400000, staleMs:300000, deadlineMs:3000,
  sessions:128, consumers:16, attention:64, notices:128, retiredTurns:256, seen:256, watermarks:256});
export type Consumer = {id:string; clearOnNewTurn:boolean};
export type Attention = {id:KnownId; kind:'question'|'input'|'approval'; turn:KnownId};
export type Notice = {id:string; kind:'turn-ended'; turn:KnownId; acknowledgedBy:string[]};
export type Unavailable = Extract<Envelope['event'],{kind:'evidence.unavailable'}>;
export type Session = {
  identity:Identity; turn:KnownId; parent:Envelope['parent']; label?:string; projectId?:string;
  activity:'unknown'|'active'|'idle'|'interrupted'|'ended'; attention:Attention[]; notices:Notice[];
  read:'unknown'|'read'|'unread'; unavailable:Unavailable[]; ordering:Envelope['ordering'];
  lastEvidenceAtMs:number; observedAtMs:number; retiredTurns:string[];
  seen:{key:string; content:string}[];
  watermarks:{dimension:string; epoch:string; sequence:number}[];
};
export type JournalEntry = {revision:number; atMs:number; sessionKey:string; kind:string; outcome:'applied'|'ambiguous'};
export type DurableState = {formatVersion:'1.0'; ownerId:string; revision:number; lastCommitAtMs:number;
  consumers:Consumer[]; sessions:Session[]; journal:JournalEntry[]};
export type Commit = {expectedRevision:number|null; revision:number; atMs:number;
  session?:Session; journal?:JournalEntry; pruneBeforeMs:number; replace?:DurableState};
/** Implementations MUST provide a cross-process exclusive lease and atomic commit.
 * Abort MUST prevent subsequent writes, or the lease must remain held until the
 * pending operation settles. Never share a live database across operating systems. */
export interface StorageLease {
  load(signal:AbortSignal):Promise<unknown>;
  commit(change:Commit, signal:AbortSignal):Promise<void>;
  release():Promise<void>;
}
export interface Storage { acquire(ownerId:string, signal:AbortSignal):Promise<StorageLease>; }
export type Outcome = {ok:true; revision:number; outcome:'applied'|'duplicate'|'stale'|'ambiguous'} |
  {ok:false; code:'invalid-event'|'invalid-operation'|'revision-conflict'|'capacity'|'unavailable'|'storage-failed'};
export type SessionSnapshot = Omit<Session,'retiredTurns'|'seen'|'watermarks'> & {
  observationAgeMs:number; freshness:'current'|'uncertain'; restartUncertain:boolean;
  children:{active:number; uncertain:number};
};
export type Snapshot = {apiVersion:'1.0'; revision:number; asOfMs:number;
  collector:'running'|'quiesced'|'faulted'|'closed'; lossCount:number; sessions:SessionSnapshot[]};
export type Change = {apiVersion:'1.0'; kind:'change'|'resync'; revision:number; dropped:number};
export interface Subscription extends AsyncIterableIterator<Change> { stats():{pending:number; bytes:number; dropped:number}; close():void; }
