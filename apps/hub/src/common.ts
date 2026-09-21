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
export async function responseJson(response: Response, maximum: number): Promise<unknown> {
  if (!response.body) throw new Error('invalid-response');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.length;
      if (size > maximum) throw new Error('response-capacity');
      chunks.push(chunk.value);
    }
    return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(Buffer.concat(chunks)));
  } finally { await reader.cancel().catch(() => {}); }
}
