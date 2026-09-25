import {randomUUID} from 'node:crypto';
import {HttpError} from './common.js';

type Replay = {body:string; result:Promise<unknown>; pending:boolean; bytes:number};
type Ledger = {epoch:string; sequence:number; results:Map<string,Replay>; retired:boolean};
type Retained = {ledger:Ledger; key:string; replay:Replay};
export type ReplayLimits = {entries:number; bytes:number};

/**
 * Owns each principal's command tickets and the shared bounded replay store. Callers authorize a principal before
 * asking for a ticket or submitting, so a retired principal never gets a new ledger through this owner.
 * Retirement is idempotent: it drops the principal's ledger and settled entries at once. An entry whose operation
 * is still pending stays charged, and can't be evicted, until it settles; then it is released exactly once.
 */
export function createReplayLedgers(limits:ReplayLimits = {entries:256,bytes:262144}) {
  const ledgers = new Map<string,Ledger>();
  const retained: Retained[] = [];
  let bytes = 0;
  const release = (item:Retained) => {
    const index = retained.indexOf(item);if (index < 0) return;
    retained.splice(index,1);item.ledger.results.delete(item.key);bytes -= item.replay.bytes;
  };
  const ledger = (principal:string) => {
    let value = ledgers.get(principal);
    if (!value) { value = {epoch:randomUUID(),sequence:0,results:new Map(),retired:false};ledgers.set(principal,value); }
    return value;
  };
  const ticket = (entry:Ledger) => `${entry.epoch}:${entry.sequence}`;
  return {
    ticket:(principal:string) => ticket(ledger(principal)),
    /** Runs the operation once for the principal's current ticket. The same ticket and body return the retained result. */
    submit(principal:string, requestId:string, body:string, run:()=>unknown):Promise<unknown> {
      const entry = ledger(principal), old = entry.results.get(requestId);
      if (old) { if (old.body !== body) throw new HttpError('request-conflict',409);return old.result; }
      if (requestId !== ticket(entry)) {
        const suffix = requestId.slice(entry.epoch.length + 1);
        const future = requestId.startsWith(entry.epoch + ':') && /^[0-9]+$/.test(suffix) && Number(suffix) > entry.sequence;
        throw new HttpError(future ? 'request-order' : 'request-expired',future ? 409 : 410);
      }
      if (entry.sequence >= Number.MAX_SAFE_INTEGER) throw new HttpError('capacity',429);
      const size = Buffer.byteLength(body);
      while (retained.length >= limits.entries || bytes + size > limits.bytes) {
        // Pending work is never evicted to admit more work.
        const settled = retained.find(item => !item.replay.pending);
        if (!settled) throw new HttpError('capacity',429);
        release(settled);
      }
      entry.sequence++;
      const result = Promise.resolve().then(run);
      const replay = {body,result,pending:true,bytes:size}, item = {ledger:entry,key:requestId,replay};
      entry.results.set(requestId,replay);retained.push(item);bytes += size;
      const settle = () => {replay.pending = false;if (entry.retired) release(item);};
      void result.then(settle,settle);
      return result;
    },
    retire(principal:string) {
      const entry = ledgers.get(principal);if (!entry) return;
      ledgers.delete(principal);entry.retired = true;
      for (const item of retained.filter(item => item.ledger === entry && !item.replay.pending)) release(item);
    },
    principals:() => [...ledgers.keys()],
    counts:() => ({ledgers:ledgers.size,replayEntries:retained.length,replayBytes:bytes,pendingReplays:retained.filter(item => item.replay.pending).length}),
  };
}
