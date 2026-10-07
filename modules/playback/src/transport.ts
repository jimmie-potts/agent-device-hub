// How the playback module reaches its speakers: one call at a time, over HTTP on the home network for the real ones, or
// to `SimulatedSpeakers` in tests and disposable runs. The calls are copied from the old Hub's `apps/hub/src/sony.ts`
// and `apps/hub/src/sonos.ts` at main 483d3a93 (Hub #175, #233; copied for Hub #929); their deadlines move to the module,
// which aborts `signal` at each call's deadline and when the module stops. No trace context reaches a speaker.
import {object, responseJson, responseText} from './common.js';

/** A Sony Audio Control API reply: the JSON-RPC result, or its error. */
export type SonyReply = {result: unknown[]} | {error: unknown};
/** A Sonos AVTransport reply: the HTTP status and the body as text. */
export type SonosReply = {status: number; body: string};

/** The two speaker protocols, one call each. A call rejects when there is no usable reply, as when `signal` aborts it. */
export interface SpeakerTransport {
  /** One JSON-RPC call to the Sony receiver's `avContent` service at `endpoint`. */
  sony(endpoint: string, method: string, version: string, signal: AbortSignal): Promise<SonyReply>;
  /** One SOAP action on instance 0 of the Sonos AVTransport control URL `endpoint`, with `args` after the instance ID. */
  sonos(endpoint: string, action: string, args: string, signal: AbortSignal): Promise<SonosReply>;
}

const MAX_BYTES = 65_536;
export const SONOS_SERVICE = 'urn:schemas-upnp-org:service:AVTransport:1';

/** The real speakers, over HTTP. Each reply is read up to 64 KiB, and a redirect is refused. */
export function httpSpeakers(): SpeakerTransport {
  let sequence = 0;
  return {
    async sony(endpoint, method, version, signal) {
      sequence = sequence % 1_000_000 + 1;
      const requestId = sequence;
      const response = await fetch(`${endpoint}/avContent`, {
        method: 'POST', redirect: 'error', signal, headers: {'content-type': 'application/json'},
        body: JSON.stringify({method, id: requestId, params: [{output: ''}], version}),
      });
      const value = await responseJson(response, MAX_BYTES);
      if (!response.ok || !object(value) || value.id !== requestId) throw new Error('invalid-response');
      if (Array.isArray(value.result)) return {result: value.result as unknown[]};
      if (Object.hasOwn(value, 'error')) return {error: value.error};
      throw new Error('invalid-response');
    },
    async sonos(endpoint, action, args, signal) {
      const response = await fetch(endpoint, {
        method: 'POST', redirect: 'error', signal,
        headers: {'content-type': 'text/xml; charset="utf-8"', soapaction: `"${SONOS_SERVICE}#${action}"`},
        body: `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${SONOS_SERVICE}"><InstanceID>0</InstanceID>${args}</u:${action}></s:Body></s:Envelope>`,
      });
      return {status: response.status, body: await responseText(response, MAX_BYTES)};
    },
  };
}
