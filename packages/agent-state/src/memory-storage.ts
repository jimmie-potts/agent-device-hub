import type {Commit, DurableState, Storage, StorageLease} from './types.js';
import {LIMITS} from './types.js';

export function identityKey(value:DurableState['sessions'][number]['identity']):string {
  return JSON.stringify([value.provider,value.client,value.hostId,value.sourceId,value.sessionId]);
}

/** Reference adapter for tests and host conformance. This is NOT disk persistence. */
export class MemoryStorage implements Storage {
  #state:DurableState|null=null;
  #leased=false;
  async acquire(_ownerId:string, signal:AbortSignal):Promise<StorageLease> {
    if (signal.aborted || this.#leased) throw new Error('storage-unavailable');
    this.#leased=true;
    let released=false;
    const check=(abort?:AbortSignal)=>{if(released||abort?.aborted)throw new Error('storage-unavailable');};
    return {
      load:async abort=>{check(abort);return structuredClone(this.#state);},
      commit:async(change:Commit,abort)=>{
        check(abort);
        if ((this.#state?.revision??null)!==change.expectedRevision) throw new Error('revision-conflict');
        // Clone before touching shared records: a failed preparation leaves the old state.
        const replace=change.replace===undefined?undefined:structuredClone(change.replace);
        const session=change.session===undefined?undefined:structuredClone(change.session);
        const journal=change.journal===undefined?undefined:structuredClone(change.journal);
        if (!replace&&!this.#state) throw new Error('uninitialized-store');
        if (replace) this.#state=replace;
        const state=this.#state!;
        if(session){
          const key=identityKey(session.identity), index=state.sessions.findIndex(item=>identityKey(item.identity)===key);
          if(index<0)state.sessions.push(session);else state.sessions[index]=session;
        }
        if(journal)state.journal.push(journal);
        state.journal=state.journal.filter(item=>item.atMs>change.pruneBeforeMs).slice(-LIMITS.journalEvents);
        state.revision=change.revision;state.lastCommitAtMs=change.atMs;
      },
      release:async()=>{if(!released){released=true;this.#leased=false;}}
    };
  }
}
