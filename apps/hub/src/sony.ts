import {exact,object,privateHttpEndpoint,responseJson,text} from './common.js';
import type {PlaybackAction,PlaybackObservation,PlaybackSource,PlaybackStatus} from './playback.js';

// Sony HT-A9 Audio Control API source for #175, qualified in
// docs/iphone-apple-music-qualification.md. The endpoint and raw replies stay in this module.
export type SonyConfiguration = {kind:'sony'; endpoint:string};

const AIRPLAY = 'extInput:airPlay', MAX_BYTES = 65536;
const STATES:Record<string,PlaybackStatus> = {PLAYING:'playing',PAUSED:'paused',STOPPED:'stopped'};
const METHODS:Partial<Record<PlaybackAction,[string,string]>> = {pause:['pausePlayingContent','1.1'],next:['setPlayNextContent','1.0'],previous:['setPlayPreviousContent','1.0']};

/** `{kind: "sony", endpoint: "http://<private IPv4>:<port>/sony"}`; the Audio Control API listens on port 10000. */
export function sonyConfiguration(value:unknown):SonyConfiguration {
  if (!object(value) || !exact(value,['kind','endpoint']) || value.kind !== 'sony') throw new Error('invalid-playback');
  return {kind:'sony',endpoint:privateHttpEndpoint(value.endpoint,'/sony','invalid-playback')};
}

/** Normalizes a getPlayingContentInfo result: a list of per-output entries, possibly wrapped in one more list. */
function sonyObservation(result:unknown[]):PlaybackObservation {
  const entry = result.flat().find(item => object(item) && item.source === AIRPLAY) as Record<string,unknown>|undefined;
  if (!entry) return {status:'inactive',controls:[]};
  const state = object(entry.stateInfo) ? entry.stateInfo.state : undefined;
  const status = typeof state === 'string' && Object.hasOwn(STATES,state) ? STATES[state] : 'unknown';
  const title = text(entry.title), artist = text(entry.artist), album = text(entry.albumName);
  // Pause, next and previous were qualified while playing (#158). The owner's 2026-09-25 live check (#37) qualified next and previous
  // while paused: the phone changes track without resuming, but the receiver keeps reporting the old title. Play/resume is not qualified.
  const controls:PlaybackAction[] = status === 'playing' ? ['pause','next','previous'] : status === 'paused' ? ['next','previous'] : [];
  return {status,...(title ? {title} : {}),...(artist ? {artist} : {}),...(album ? {album} : {}),controls};
}

export function createSonySource(config:SonyConfiguration,options:{pollMs?:number; timeoutMs?:number} = {}) {
  const {pollMs = 2000,timeoutMs = 1500} = options;
  const pending = new Set<AbortController>();
  let sequence = 0, closed = false, timer:NodeJS.Timeout|undefined, reading:Promise<void>|undefined;
  let report:((observation:PlaybackObservation)=>void)|undefined;
  /** One JSON-RPC call with its own deadline. Resolves the result or error; throws when the reply is unusable. */
  async function call(method:string,version:string):Promise<{result:unknown[]}|{error:unknown}> {
    if (closed) throw new Error('closed');
    const abort = new AbortController(), deadline = setTimeout(() => abort.abort(),timeoutMs);
    pending.add(abort);
    try {
      const requestId = sequence = sequence % 1_000_000 + 1;
      const response = await fetch(config.endpoint + '/avContent',{method:'POST',redirect:'error',signal:abort.signal,headers:{'content-type':'application/json'},
        body:JSON.stringify({method,id:requestId,params:[{output:''}],version})});
      const value = await responseJson(response,MAX_BYTES);
      if (!response.ok || !object(value) || value.id !== requestId) throw new Error('invalid-response');
      if (Array.isArray(value.result)) return {result:value.result};
      if (Object.hasOwn(value,'error')) return {error:value.error};
      throw new Error('invalid-response');
    } finally {clearTimeout(deadline);pending.delete(abort);}
  }
  /** Reads once, reusing a read already in progress so reads never overlap. */
  function refresh():Promise<void> {
    return reading ??= (async () => {
      try {
        const reply = await call('getPlayingContentInfo','1.2');
        if ('result' in reply && !closed) report?.(sonyObservation(reply.result));
      } catch {/* A failed read reports nothing, so the observation ages. */}
    })().finally(() => {reading = undefined;});
  }
  const source:PlaybackSource & {refresh():Promise<void>} = {
    refresh,
    start(callback) {
      report = callback;void refresh();
      timer = setInterval(() => void refresh(),pollMs);timer.unref();
    },
    async command(action) {
      const method = METHODS[action];
      if (!method) return 'failed';
      const reply = await call(...method);
      return 'result' in reply ? 'sent' : 'failed';
    },
    async close() {
      closed = true;clearInterval(timer);
      for (const abort of pending) abort.abort();
      await reading;
    }
  };
  return source;
}
