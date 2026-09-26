import {HttpError,canonical,exact,id,object} from './common.js';

// Shared playback for #175 and #233. Sources own their protocols; this module owns the per-source
// observations, the presented source and the command results. See the hub-playback specification.
export type PlaybackAction = 'play'|'pause'|'next'|'previous';
export type PlaybackStatus = 'playing'|'paused'|'stopped'|'inactive'|'unknown';
export type PlaybackObservation = {status:PlaybackStatus; title?:string; artist?:string; album?:string; controls:PlaybackAction[]};
/** A source reports every successful observation, including unchanged ones, and never a failed read. It has no ID of its own: clients see only the playback ID. */
export type PlaybackSource = {
  start(report:(observation:PlaybackObservation)=>void):void;
  /** Resolves 'failed' only when the source refused before any effect; a rejection is an uncertain result. */
  command(action:PlaybackAction):Promise<'sent'|'failed'>;
  close():Promise<void>;
};
export type PlaybackReceipt = {requestId:string; sourceId:string; action:PlaybackAction; outcome:'sent'|'failed'|'uncertain'};

const ACTIONS:readonly string[] = ['play','pause','next','previous'];
// About two missed two-second reads make a source stale; old metadata is withheld once unavailable.
const STALE_MS = 5000, UNAVAILABLE_MS = 30000;
const FRESHNESS = {available:2,stale:1,unavailable:0} as const;
const STATUS = {sent:200,failed:502,uncertain:503} as const;
const RETAINED = 64;

type Observed = {atMs:number; mark:number; value:PlaybackObservation};

/**
 * Serves one playback ID from the sources in preference order. Age is the larger of the monotonic and wall-clock ages,
 * so neither a clock step back nor a suspend makes old data look fresh.
 */
export function createPlayback(sourceId:string,sources:readonly PlaybackSource[],clock:()=>number,monotonic:()=>number = clock) {
  const observed:(Observed|undefined)[] = sources.map(() => undefined);
  let busy = false;
  // Admitted commands by principal and request ID. Only the newest can be pending, because one command runs at a time.
  const receipts = new Map<string,{body:string; result:Promise<{status:number; body:PlaybackReceipt}>}>();
  sources.forEach((source,index) => source.start(value => {observed[index] = {atMs:clock(),mark:monotonic(),value:structuredClone(value)};}));
  const age = (record:Observed|undefined) => record ? Math.max(0,monotonic() - record.mark,clock() - record.atMs) : null;
  const availability = (ms:number|null) => ms === null || ms >= UNAVAILABLE_MS ? 'unavailable' : ms >= STALE_MS ? 'stale' : 'available';
  /** The presented source: the first in configured order with a session (playing or paused), then the freshest. */
  function presented():number {
    let best = 0, bestRank = -1;
    observed.forEach((record,index) => {
      const state = availability(age(record));
      const session = state !== 'unavailable' && (record!.value.status === 'playing' || record!.value.status === 'paused') ? 1 : 0;
      const rank = session * 3 + FRESHNESS[state];
      if (rank > bestRank) {best = index;bestRank = rank;}
    });
    return best;
  }
  return {
    sourceId,
    snapshot() {
      const record = observed[presented()], ageMs = age(record), state = availability(ageMs);
      return {apiVersion:'1.0',sourceId,availability:state,observedAtMs:record?.atMs ?? null,ageMs,playback:state === 'unavailable' ? null : record!.value};
    },
    async command(input:unknown,principal:{id:string; devices:readonly string[]}):Promise<{status:number; body:PlaybackReceipt}> {
      if (!object(input) || !exact(input,['requestId','sourceId','action']) || !id(input.requestId) || !id(input.sourceId) ||
          !ACTIONS.includes(input.action as string)) throw new HttpError('invalid-input',400);
      if (!principal.devices.includes(input.sourceId)) throw new HttpError('forbidden',403);
      if (input.sourceId !== sourceId) throw new HttpError('unknown-source',404);
      const key = principal.id + '\n' + input.requestId, body = canonical(input), prior = receipts.get(key);
      if (prior) {if (prior.body !== body) throw new HttpError('request-conflict',409);return prior.result;}
      // The presented source is fixed here; a source that took over meanwhile is never a redirect target.
      const index = presented(), record = observed[index];
      if (availability(age(record)) !== 'available') throw new HttpError('source-unavailable',503);
      const action = input.action as PlaybackAction, requestId = input.requestId;
      if (!record!.value.controls.includes(action)) throw new HttpError('unsupported-control',422);
      if (busy) throw new HttpError('capacity',429);
      busy = true;
      // Send once. A rejection or timeout is uncertain and is never retried.
      const result = Promise.resolve().then(() => sources[index].command(action)).catch(() => 'uncertain' as const)
        .then(outcome => ({status:STATUS[outcome],body:{requestId,sourceId,action,outcome}})).finally(() => {busy = false;});
      receipts.set(key,{body,result});
      if (receipts.size > RETAINED) receipts.delete(receipts.keys().next().value!);
      return result;
    },
    /** Closes every source, then reports the first failure. */
    async close() {
      const failed = (await Promise.allSettled(sources.map(source => source.close()))).find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
    }
  };
}
