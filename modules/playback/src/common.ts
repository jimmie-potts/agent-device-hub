// Small helpers the speaker sources share. Copied from the old Hub's `apps/hub/src/common.ts` at main 483d3a93
// (Hub #929): `object`, `exact`, `responseText`, `responseJson`, `privateAddress`, `privateHttpEndpoint`, `TEXT_LIMIT`
// and `text`, converted to the strict profile. `privateHttpEndpoint` returns undefined rather than throwing, since
// `configure` answers with a refusal.
import {isIPv4} from 'node:net';

export const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export const exact = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

/** The response body as UTF-8 text, read at most `maximum` bytes. Throws when there is no body, it is larger, or it is not UTF-8. */
export async function responseText(response: Response, maximum: number): Promise<string> {
  if (response.body === null) throw new Error('invalid-response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > maximum) throw new Error('response-capacity');
      chunks.push(chunk.value);
    }
    return new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks));
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export async function responseJson(response: Response, maximum: number): Promise<unknown> {
  return JSON.parse(await responseText(response, maximum)) as unknown;
}

/** RFC 1918 private or loopback IPv4 text; callers check the IPv4 shape first. */
export const privateAddress = (host: string): boolean => {
  const [a, b] = host.split('.').map(Number);
  if (a === undefined || b === undefined) return false;
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
};

/**
 * `value` when it is exactly `http://<numeric private or loopback IPv4>:<port><pathname>` with no credentials, query or
 * fragment, and undefined otherwise.
 */
export function privateHttpEndpoint(value: unknown, pathname: string): string | undefined {
  if (typeof value !== 'string' || !URL.canParse(value)) return undefined;
  const url = new URL(value);
  const plain = url.port !== '' && url.username === '' && url.password === '' && url.search === '' && url.hash === '';
  if (url.protocol !== 'http:' || !isIPv4(url.hostname) || !privateAddress(url.hostname) || !plain || url.pathname !== pathname || url.href !== value) {
    return undefined;
  }
  return value;
}

/** Bounded display text: trimmed, non-empty and at most `TEXT_LIMIT` characters, otherwise absent. */
export const TEXT_LIMIT = 256;
export const text = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : Array.from(trimmed).slice(0, TEXT_LIMIT).join('');
};
