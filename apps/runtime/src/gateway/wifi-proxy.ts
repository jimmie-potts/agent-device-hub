// The temporary home-Wi-Fi entry (Hub #1111). Forwarded headers alone confer no authority.
import type {IncomingMessage} from 'node:http';
import {tokenMatches} from '../credentials.js';
import type {EdgeConfig} from '../state.js';

export const WIFI_PROXY_HEADER = 'bunny-wifi-proxy';

/** The authenticated proxy's exact origin, without trusting or rewriting browser metadata. */
export function wifiProxyOrigin(request: IncomingMessage, config: EdgeConfig['wifiProxy']): string | undefined {
  if (config === undefined || request.headers.authorization !== undefined) return undefined;
  const proof = request.headers[WIFI_PROXY_HEADER];
  if (typeof proof !== 'string' || !/^[A-Za-z0-9_-]{32,512}$/.test(proof)) return undefined;
  if ((request.headers.host ?? '').toLowerCase() !== new URL(config.origin).host) return undefined;
  return tokenMatches(proof, config.tokenDigest) ? config.origin : undefined;
}
