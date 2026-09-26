import {exact,object,privateHttpEndpoint,responseText,text} from './common.js';
import type {PlaybackAction,PlaybackObservation,PlaybackSource,PlaybackStatus} from './playback.js';

// Sonos Move UPnP AVTransport source for #233, qualified in docs/iphone-apple-music-qualification.md
// (Sonos Move check and play and resume check). The endpoint and raw SOAP replies stay in this module.
export type SonosConfiguration = {kind:'sonos'; endpoint:string};

const CONTROL_PATH = '/MediaRenderer/AVTransport/Control', SERVICE = 'urn:schemas-upnp-org:service:AVTransport:1', MAX_BYTES = 65536;
// The Move labels the AirPlay session's track with this URI scheme; any other URI is another input.
const AIRPLAY_SCHEME = 'x-sonos-vli:';
const STATES:Record<string,PlaybackStatus> = {PLAYING:'playing',PAUSED_PLAYBACK:'paused',STOPPED:'stopped'};
const ACTIONS:Record<PlaybackAction,string> = {play:'Play',pause:'Pause',next:'Next',previous:'Previous'};
// Pause, next and previous were qualified while playing (#158); play while paused (#242). Next and previous while paused follow
// the Move's own action list and the HT-A9 precedent until the #233 live check confirms them.
const BY_STATUS:Partial<Record<PlaybackStatus,PlaybackAction[]>> = {playing:['pause','next','previous'],paused:['play','next','previous']};

/** `{kind: "sonos", endpoint: "http://<private IPv4>:1400/MediaRenderer/AVTransport/Control"}`, the exact control URL. */
export function sonosConfiguration(value:unknown):SonosConfiguration {
  if (!object(value) || !exact(value,['kind','endpoint']) || value.kind !== 'sonos') throw new Error('invalid-playback');
  return {kind:'sonos',endpoint:privateHttpEndpoint(value.endpoint,CONTROL_PATH,'invalid-playback')};
}

const ENTITIES:Record<string,string> = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
/** Decodes the XML character references one layer deep; the SOAP body and the DIDL-Lite metadata inside it are each decoded once. */
const decode = (value:string) => value.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos);/g,(match,reference:string) => {
  if (reference[0] !== '#') return ENTITIES[reference];
  const code = reference[1] === 'x' ? parseInt(reference.slice(2),16) : parseInt(reference.slice(1),10);
  return code > 0x10FFFF || (code >= 0xD800 && code <= 0xDFFF) ? match : String.fromCodePoint(code);
});
const NAME = '(?:[A-Za-z_][\\w.-]*:)?';
/** The decoded text of the first element with this local name. Every element read here holds text only, so nested markup never matches. */
function element(xml:string,name:string):string|undefined {
  const match = new RegExp(`<${NAME}${name}(?:\\s[^>]*)?>([^<]*)</${NAME}${name}>`).exec(xml);
  return match ? decode(match[1]) : undefined;
}
const hasElement = (xml:string,name:string) => new RegExp(`<${NAME}${name}[\\s>]`).test(xml);

/** Normalizes one complete read: the transport state, the track URI and metadata, and the advertised actions. */
function sonosObservation(transport:string,position:string,actions:string):PlaybackObservation {
  const state = element(transport,'CurrentTransportState');
  if (state === undefined || !hasElement(position,'GetPositionInfoResponse') || !hasElement(actions,'GetCurrentTransportActionsResponse')) throw new Error('invalid-response');
  if (!(element(position,'TrackURI') ?? '').startsWith(AIRPLAY_SCHEME)) return {status:'inactive',controls:[]};
  const status = Object.hasOwn(STATES,state) ? STATES[state] : 'unknown';
  // TrackMetaData is DIDL-Lite XML, or NOT_IMPLEMENTED. Only its title, artist and album are read; artwork URIs, position and duration are not copied.
  const metadata = element(position,'TrackMetaData') ?? '';
  const didl = metadata.startsWith('<') ? metadata : '';
  const title = text(didl && element(didl,'title')), artist = text(didl && element(didl,'creator')), album = text(didl && element(didl,'album'));
  const advertised = new Set((element(actions,'Actions') ?? '').split(',').map(item => item.trim()));
  const controls = (BY_STATUS[status] ?? []).filter(action => advertised.has(ACTIONS[action]));
  return {status,...(title ? {title} : {}),...(artist ? {artist} : {}),...(album ? {album} : {}),controls};
}

export function createSonosSource(config:SonosConfiguration,options:{pollMs?:number; timeoutMs?:number} = {}) {
  const {pollMs = 2000,timeoutMs = 1500} = options;
  const pending = new Set<AbortController>();
  let closed = false, timer:NodeJS.Timeout|undefined, reading:Promise<void>|undefined;
  let report:((observation:PlaybackObservation)=>void)|undefined;
  /** One SOAP action on instance 0 with its own deadline. Resolves the HTTP status and body; throws when there is no usable reply. */
  async function call(action:string,args = ''):Promise<{status:number; body:string}> {
    if (closed) throw new Error('closed');
    const abort = new AbortController(), deadline = setTimeout(() => abort.abort(),timeoutMs);
    pending.add(abort);
    try {
      const response = await fetch(config.endpoint,{method:'POST',redirect:'error',signal:abort.signal,
        headers:{'content-type':'text/xml; charset="utf-8"',soapaction:`"${SERVICE}#${action}"`},
        body:`<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${SERVICE}"><InstanceID>0</InstanceID>${args}</u:${action}></s:Body></s:Envelope>`});
      return {status:response.status,body:await responseText(response,MAX_BYTES)};
    } finally {clearTimeout(deadline);pending.delete(abort);}
  }
  /** A read action's body, which must be a 200 carrying that action's response element. */
  async function read(action:string):Promise<string> {
    const reply = await call(action);
    if (reply.status !== 200 || !hasElement(reply.body,action + 'Response')) throw new Error('invalid-response');
    return reply.body;
  }
  /** Reads once, in sequence, reusing a read already in progress so calls never overlap. Any failed call fails the whole read. */
  function refresh():Promise<void> {
    return reading ??= (async () => {
      try {
        const transport = await read('GetTransportInfo'), position = await read('GetPositionInfo'), actions = await read('GetCurrentTransportActions');
        const observation = sonosObservation(transport,position,actions);
        if (!closed) report?.(observation);
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
      const reply = await call(ACTIONS[action],action === 'play' ? '<Speed>1</Speed>' : '');
      if (reply.status === 200) return 'sent';
      // A SOAP fault is the Move refusing before any effect; any other reply leaves the result uncertain.
      if (reply.status === 500 && hasElement(reply.body,'Fault')) return 'failed';
      throw new Error('invalid-response');
    },
    async close() {
      closed = true;clearInterval(timer);
      for (const abort of pending) abort.abort();
      await reading;
    }
  };
  return source;
}
