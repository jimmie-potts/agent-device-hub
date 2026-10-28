// The temporary home-Wi-Fi entry (Hub #1111). Forwarded headers alone confer no authority.
import type {IncomingMessage} from 'node:http';
import {tokenMatches} from '../credentials.js';
import type {EdgeConfig} from '../state.js';

export const WIFI_PROXY_HEADER = 'bunny-wifi-proxy';
export const PRIVATE_PROXY_HEADER = 'bunny-private-proxy';

/** The authenticated proxy's exact origin, without trusting or rewriting browser metadata. */
export function wifiProxyOrigin(request: IncomingMessage, config: EdgeConfig['wifiProxy']): string | undefined {
  if (request.headers.authorization !== undefined || request.headers[PRIVATE_PROXY_HEADER] !== undefined) return undefined;
  return proxyOrigin(request, config, WIFI_PROXY_HEADER);
}

/** A private entry admits scoped machine callers too; the gateway still checks their credentials and browser metadata. */
export function privateProxyOrigin(request: IncomingMessage, config: EdgeConfig['privateProxy']): string | undefined {
  if (request.headers[WIFI_PROXY_HEADER] !== undefined) return undefined;
  return proxyOrigin(request, config, PRIVATE_PROXY_HEADER);
}

function proxyOrigin(request: IncomingMessage, config: EdgeConfig['wifiProxy'], header: string): string | undefined {
  if (config === undefined) return undefined;
  const proof = request.headers[header];
  if (typeof proof !== 'string' || !/^[A-Za-z0-9_-]{32,512}$/.test(proof)) return undefined;
  if ((request.headers.host ?? '').toLowerCase() !== new URL(config.origin).host) return undefined;
  return tokenMatches(proof, config.tokenDigest) ? config.origin : undefined;
}
