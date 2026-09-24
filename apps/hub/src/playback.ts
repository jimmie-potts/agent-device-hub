import {HttpError,canonical,exact,id,object} from './common.js';

// Shared playback for #175. Sources own their protocols; this module owns the
// normalized snapshot and command results. See the hub-playback specification.
export type PlaybackAction = 'play'|'pause'|'next'|'previous';
export type PlaybackStatus = 'playing'|'paused'|'stopped'|'inactive'|'unknown';
export type PlaybackObservation = {status:PlaybackStatus; title?:string; artist?:string; album?:string; controls:PlaybackAction[]};
/** A source reports every successful observation, including unchanged ones, and never a failed read. */
export type PlaybackSource = {
  readonly id:string;
  start(report:(observation:PlaybackObservation)=>void):void;
  /** Resolves 'failed' only when the source refused before any effect; a rejection is an uncertain result. */
  command(action:PlaybackAction):Promise<'sent'|'failed'>;
  close():Promise<void>;
};
export type PlaybackReceipt = {requestId:string; sourceId:string; action:PlaybackAction; outcome:'sent'|'failed'|'uncertain'};

const ACTIONS:readonly string[] = ['play','pause','next','previous'];
// About two missed two-second reads make a source stale; old metadata is withheld once unavailable.
const STALE_MS = 5000, UNAVAILABLE_MS = 30000;
const STATUS = {sent:200,failed:502,uncertain:503} as const;
const RETAINED = 64;

/** Age is the larger of the monotonic and wall-clock ages, so neither a clock step back nor a suspend makes old data look fresh. */
export function createPlayback(source:PlaybackSource,clock:()=>number,monotonic:()=>number = clock) {
  let observed:{atMs:number; mark:number; value:PlaybackObservation}|undefined;
  let busy = false;
  // Admitted commands by principal and request ID. Only the newest can be pending, because one command runs at a time.
  const receipts = new Map<string,{body:string; result:Promise<{status:number; body:PlaybackReceipt}>}>();
  source.start(value => {observed = {atMs:clock(),mark:monotonic(),value:structuredClone(value)};});
  const age = () => observed ? Math.max(0,monotonic() - observed.mark,clock() - observed.atMs) : null;
  const availability = (ms:number|null) => ms === null || ms >= UNAVAILABLE_MS ? 'unavailable' : ms >= STALE_MS ? 'stale' : 'available';
  return {
    sourceId:source.id,
    snapshot() {
      const ageMs = age(), state = availability(ageMs);
      return {apiVersion:'1.0',sourceId:source.id,availability:state,observedAtMs:observed?.atMs ?? null,ageMs,playback:state === 'unavailable' ? null : observed!.value};
    },
    async command(input:unknown,principal:{id:string; devices:readonly string[]}):Promise<{status:number; body:PlaybackReceipt}> {
      if (!object(input) || !exact(input,['requestId','sourceId','action']) || !id(input.requestId) || !id(input.sourceId) ||
          !ACTIONS.includes(input.action as string)) throw new HttpError('invalid-input',400);
      if (!principal.devices.includes(input.sourceId)) throw new HttpError('forbidden',403);
      if (input.sourceId !== source.id) throw new HttpError('unknown-source',404);
      const key = principal.id + '\n' + input.requestId, body = canonical(input), prior = receipts.get(key);
      if (prior) {if (prior.body !== body) throw new HttpError('request-conflict',409);return prior.result;}
      if (availability(age()) !== 'available') throw new HttpError('source-unavailable',503);
      const action = input.action as PlaybackAction, requestId = input.requestId;
      if (!observed!.value.controls.includes(action)) throw new HttpError('unsupported-control',422);
      if (busy) throw new HttpError('capacity',429);
      busy = true;
      // Send once. A rejection or timeout is uncertain and is never retried.
      const result = Promise.resolve().then(() => source.command(action)).catch(() => 'uncertain' as const)
        .then(outcome => ({status:STATUS[outcome],body:{requestId,sourceId:source.id,action,outcome}})).finally(() => {busy = false;});
      receipts.set(key,{body,result});
      if (receipts.size > RETAINED) receipts.delete(receipts.keys().next().value!);
      return result;
    },
    close:() => source.close()
  };
}
