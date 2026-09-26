import {isIPv4} from 'node:net';
export class HttpError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}
export const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key));
export const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,128}(?![\s\S])/.test(value);
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
export function loopbackEndpoint(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.search || url.hash || url.origin + url.pathname !== value) throw new Error('invalid-endpoint');
  return url;
}
/** The response body as UTF-8 text, read at most `maximum` bytes. */
export async function responseText(response: Response, maximum: number): Promise<string> {
  if (!response.body) throw new Error('invalid-response');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.length;
      if (size > maximum) throw new Error('response-capacity');
      chunks.push(chunk.value);
    }
    return new TextDecoder('utf-8', {fatal:true}).decode(Buffer.concat(chunks));
  } finally { await reader.cancel().catch(() => {}); }
}
export async function responseJson(response: Response, maximum: number): Promise<unknown> {
  return JSON.parse(await responseText(response,maximum));
}
/** RFC 1918 private or loopback IPv4 text; callers check the IPv4 shape first. */
export const privateAddress = (host: string) => {
  const [a,b] = host.split('.').map(Number);
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
};
/** Exactly `http://<numeric private or loopback IPv4>:<port><pathname>` with no credentials, query or fragment; throws `error` otherwise. */
export function privateHttpEndpoint(value: unknown, pathname: string, error: string): string {
  if (typeof value !== 'string' || !URL.canParse(value)) throw new Error(error);
  const url = new URL(value);
  if (url.protocol !== 'http:' || !isIPv4(url.hostname) || !privateAddress(url.hostname) || !url.port || url.username || url.password ||
      url.search || url.hash || url.pathname !== pathname || url.href !== value) throw new Error(error);
  return value;
}
/** Bounded display text: trimmed, non-empty and at most `TEXT_LIMIT` characters, otherwise absent. */
export const TEXT_LIMIT = 256;
export const text = (value: unknown) => typeof value === 'string' && value.trim() ? Array.from(value.trim()).slice(0,TEXT_LIMIT).join('') : undefined;
