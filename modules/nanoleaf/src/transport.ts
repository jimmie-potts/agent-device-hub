// Requests to a Nanoleaf controller's local API (transport.py). Callers decide what a request means.
// Every request carries its own timeout and goes straight to the device, never through a configured proxy.
import {request as httpRequest} from 'node:http';
import {isIPv6} from 'node:net';
import {parseJson, pyJson} from './compat.js';
import {ValueError} from './errors.js';

/** The Nanoleaf local API's port. */
export const PORT = 16021;
/** Seconds a light request may take, as the Python client's 1.2-second socket timeout. */
export const LIGHT_TIMEOUT_SECONDS = 1.2;

export interface LightAddress {
  ip: string;
  token: string;
}

/**
 * A Nanoleaf controller request: the device address and credential, an HTTP method, an endpoint and an optional body.
 * It must settle within its own timeout, as the Python client's did: registry operations for the same state directory
 * take turns in this process, and a worker pass holds its device's lock, so one request that never settles holds every
 * later one. `lightRequest` gives up after LIGHT_TIMEOUT_SECONDS.
 */
export type LightRequest = (address: LightAddress, method: string, endpoint?: string, payload?: unknown) => Promise<unknown>;

/** One HTTP exchange with a device. `timeoutSeconds` bounds the whole exchange, from connecting to the last byte. */
export interface HttpRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | null;
  readonly timeoutSeconds: number;
}

export interface HttpResponse {
  readonly status: number;
  readonly body: string;
}

/** Sends one request and settles within its timeout. Network failures reject with an error that has a `code`. */
export type HttpTransport = (request: HttpRequest) => Promise<HttpResponse>;

/** urllib's HTTPError: the device answered with a status outside 2xx. Like Python's, it is an OS-level failure. */
export class HttpError extends Error {
  override name = 'HttpError';
  readonly code = 'EHTTP';
  constructor(readonly status: number) {
    super(`HTTP Error ${status}`);
  }
}

// ipaddress.IPv4Address.is_private in Python 3.12.4 and later.
const PRIVATE: readonly (readonly [string, number])[] = [['0.0.0.0', 8], ['10.0.0.0', 8], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.0.170', 31], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['240.0.0.0', 4], ['255.255.255.255', 32]];
const GLOBAL_EXCEPTIONS: readonly (readonly [string, number])[] = [['192.0.0.9', 32], ['192.0.0.10', 32]];

/** Python's IPv4 parser: four decimal octets without leading zeros. */
function ipv4(text: string): number | null {
  const octets = text.split('.');
  if (octets.length !== 4) return null;
  let value = 0;
  for (const octet of octets) {
    if (!/^[0-9]{1,3}$/.test(octet) || (octet !== '0' && octet.startsWith('0')) || Number(octet) > 255) return null;
    value = value * 256 + Number(octet);
  }
  return value;
}

const within = (address: number, [network, prefix]: readonly [string, number]): boolean => {
  const base = ipv4(network) ?? 0;
  const size = 2 ** (32 - prefix);
  return Math.floor(address / size) === Math.floor(base / size);
};

/** A private IPv4 address in its canonical spelling; anything else is refused (enrollment.private_address). */
export function privateAddress(ip: string): string {
  const address = ipv4(ip);
  if (address === null && !isIPv6(ip)) throw new ValueError(`'${ip}' does not appear to be an IPv4 or IPv6 address`);
  if (address === null || !PRIVATE.some(network => within(address, network)) || GLOBAL_EXCEPTIONS.some(network => within(address, network))) {
    throw new ValueError('Use a private IPv4 address for the lights.');
  }
  return ip;
}

const METHODS_WITH_BODY: ReadonlySet<string> = new Set(['PATCH', 'POST', 'PUT']);

/**
 * HTTP over node:http. The deadline covers the whole exchange, from connecting to the reply's last byte, so a device that
 * accepts the connection and never answers fails with ETIMEDOUT. `agent: false` keeps device traffic off any proxy that
 * Node would otherwise take from the environment (NODE_USE_ENV_PROXY).
 */
export const nodeTransport: HttpTransport = request => new Promise((resolve, reject) => {
  const headers: Record<string, string> = {...request.headers};
  // As Python's http.client: a body's length, and a zero length for a body-carrying method without one.
  if (request.body !== null) headers['Content-Length'] = String(Buffer.byteLength(request.body, 'utf8'));
  else if (METHODS_WITH_BODY.has(request.method.toUpperCase())) headers['Content-Length'] = '0';
  let settled = false;
  const finish = (outcome: () => void): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    outcome();
  };
  const exchange = httpRequest(request.url, {method: request.method, headers, agent: false}, response => {
    const chunks: Buffer[] = [];
    response.on('data', (chunk: Buffer) => chunks.push(chunk));
    response.on('error', (error: Error) => finish(() => reject(error)));
    response.on('end', () => finish(() => resolve({status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8')})));
  });
  const timer = setTimeout(() => {
    const error = Object.assign(new Error(`The device did not answer within ${request.timeoutSeconds} seconds.`), {code: 'ETIMEDOUT'});
    finish(() => reject(error));
    exchange.destroy(error);
  }, request.timeoutSeconds * 1000);
  exchange.on('error', (error: Error) => finish(() => reject(error)));
  exchange.end(request.body ?? undefined);
});

/** transport.light_request: one request to the device's local API; its JSON reply, or null for an empty one. */
export async function lightRequest(address: LightAddress, method: string, endpoint = '', payload: unknown = null,
  transport: HttpTransport = nodeTransport): Promise<unknown> {
  const ip = privateAddress(address.ip);
  if (!/^[A-Za-z0-9]+$/.test(address.token)) throw new ValueError('The token must contain only letters and numbers.');
  const response = await transport({url: `http://${ip}:${PORT}/api/v1/${address.token}${endpoint}`, method,
    headers: {'Content-Type': 'application/json'}, body: payload === null || payload === undefined ? null : pyJson(payload),
    timeoutSeconds: LIGHT_TIMEOUT_SECONDS});
  if (response.status < 200 || response.status > 299) throw new HttpError(response.status);
  return response.body === '' ? null : parseJson(response.body);
}
