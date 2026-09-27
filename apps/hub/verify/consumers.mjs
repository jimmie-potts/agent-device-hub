// How the Hub's composition (Hub #495) reads a paired consumer run's own
// verification state: its view of the Hub feed and what reached its writer.
// Each consumer adapter serves one unauthenticated, loopback-only JSON route
// for verification runs; nothing here reads a device or a credential.

/** A consumer's verification state, normalized. */
/**
 * @typedef {{
 *   format: string,
 *   feed: {connection: 'current' | 'stale' | 'unavailable', revision: number | null, ownerId: string | null, error: string | null},
 *   writer: Record<string, number>,
 *   raw: unknown,
 * }} ConsumerState
 */

/** Per consumer: its state route under the run's preview URL and how to read it. */
export const CONSUMER_STATE = {
  // codex-nanoleaf#194: GET <wall url>verify/state, Host exactly 127.0.0.1:<port>.
  nanoleaf: {
    route: 'verify/state',
    /** @param {any} value @returns {ConsumerState} */
    parse: value => {
      if (value?.apiVersion !== 'wall-verify/1' || typeof value.feed !== 'object' || typeof value.integration !== 'object') throw new Error('the wall state route answered an unknown shape');
      return {
        format: value.apiVersion,
        feed: {connection: value.feed.connection, revision: value.feed.revision ?? null, ownerId: value.feed.ownerId ?? null, error: value.feed.error ?? null},
        writer: {'integration.applied': value.integration.applied, 'integration.queued': value.integration.queued, 'integration.failed': value.integration.failed},
        raw: value,
      };
    },
  },
  // divoom-app-upgrade#120: the Pixoo run's state route.
  pixoo: {
    route: 'api/verify/state',
    /** @param {any} value @returns {ConsumerState} */
    parse: value => {
      if (value?.apiVersion !== 'pixoo-verify/1' || typeof value.feed !== 'object' || typeof value.writer !== 'object') throw new Error('the Pixoo state route answered an unknown shape');
      return {
        format: value.apiVersion,
        feed: {connection: value.feed.connection, revision: value.feed.revision ?? null, ownerId: value.feed.ownerId ?? null, error: value.feed.error ?? null},
        writer: Object.fromEntries(Object.entries(value.writer).filter(([, count]) => Number.isInteger(count))),
        raw: value,
      };
    },
  },
};

/**
 * Read one consumer run's verification state.
 * @param {string} consumer `nanoleaf` or `pixoo`
 * @param {string} preview the run's preview URL, http://127.0.0.1:<port>/
 * @param {AbortSignal} [signal]
 * @returns {Promise<ConsumerState>}
 */
export async function consumerState(consumer, preview, signal = AbortSignal.timeout(3000)) {
  const reader = CONSUMER_STATE[/** @type {keyof typeof CONSUMER_STATE} */ (consumer)];
  if (!reader) throw new Error(`no state reader for consumer ${consumer}`);
  const response = await fetch(new URL(reader.route, preview), {signal, redirect: 'error', headers: {accept: 'application/json'}});
  if (!response.ok) throw new Error(`the ${consumer} state route answered ${response.status}`);
  return reader.parse(await response.json());
}
