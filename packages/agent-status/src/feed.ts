import { validateSnapshot, type Snapshot } from '@jimmie-potts/agent-state';

/**
 * A bounded feed a publisher reads on its own cadence. `snapshot()` must settle within a
 * bounded time; a read that outlives a caller's timeout blocks further reads until it
 * settles, so an adapter must enforce its own deadline. `subscribe()` yields revision
 * pointers or resync notices and is optional.
 */
export type Feed<T> = {
  snapshot(): T | Promise<T>;
  subscribe?(): AsyncIterable<unknown> & { close?(): void };
};

const fail = (code: string): never => { throw new Error(code); };
export const HUB_ID = /^[A-Za-z0-9_.-]{1,128}$/;
const MAX_FEED = 1024 * 1024;

/** No redirect, remote host, URL credentials, query, fragment or alternate route. */
export function hubOrigin(value: unknown): string {
  if (typeof value !== 'string' || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/?$/.test(value)) return fail('invalid-runner-config');
  try { return new URL(value).origin; } catch { return fail('invalid-runner-config'); }
}

export function hubToken(value: unknown): string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : fail('invalid-runner-config');
}

/** One authenticated GET within 2.5 s and `limit` bytes; anything else is `feed-unavailable`. */
export async function hubJson(url: string, token: string, limit: number): Promise<unknown> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 2500);
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: abort.signal });
    if (!response.ok || !response.body) return fail('feed-unavailable');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > limit) return fail('feed-unavailable');
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { return fail('feed-unavailable'); }
  finally { clearTimeout(timer); abort.abort(); }
}

/** The selected shared agent-state owner's feed, read through the hub's read-only monitor route. */
export class HubStatusFeed implements Feed<Snapshot> {
  readonly #url: string;
  readonly #owner: string;
  readonly #token: string;
  readonly #snapshotVersion: '1.2' | undefined;
  constructor(options: { hubUrl: string; ownerId: string; token: string; snapshotVersion?: '1.2' }) {
    if (options.snapshotVersion !== undefined && options.snapshotVersion !== '1.2') fail('invalid-runner-config');
    this.#snapshotVersion = options.snapshotVersion;
    this.#url = hubOrigin(options.hubUrl) + '/api/monitor/v1/sessions'
      + (this.#snapshotVersion ? `?snapshotVersion=${this.#snapshotVersion}` : '');
    this.#token = hubToken(options.token);
    if (typeof options.ownerId !== 'string' || !HUB_ID.test(options.ownerId)) fail('invalid-runner-config');
    this.#owner = options.ownerId;
  }
  async snapshot(): Promise<Snapshot> {
    const value = await hubJson(this.#url, this.#token, MAX_FEED) as Record<string, unknown> | null;
    if (!value || value.apiVersion !== '1.0' || value.ownerId !== this.#owner || value.connection !== 'current') return fail('feed-unavailable');
    const valid = validateSnapshot(value.snapshot);
    return valid.ok && (!this.#snapshotVersion || valid.value.apiVersion === this.#snapshotVersion)
      ? valid.value : fail('feed-unavailable');
  }
}
