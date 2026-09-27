// How the Hub's composition (Hub #495) reads a paired consumer run's own
// verification state: its view of the Hub feed and what reached its writer.
// Each consumer adapter serves one unauthenticated, loopback-only JSON route
// for verification runs; nothing here reads a device or a credential.

/** A consumer's verification state, normalized. */
/**
 * @typedef {{
 *   format: string,
 *   feed: {connection: 'current' | 'stale' | 'unavailable', revision: number | null, ownerId: string | null, error: string | null,
 *     source: string | null, sessions: string[] | null},
 *   writer: Record<string, number>,
 *   raw: unknown,
 * }} ConsumerState
 */

import {PAIRING} from './integrated.mjs';

/**
 * Whether a consumer follows the Hub: its feed is current, names the owner, has applied the Hub's revision and,
 * where the consumer lists them, exactly the Hub's sessions; the wall also says it reads the shared feed. Before its
 * first accepted snapshot a consumer reports no owner or revision, which never follows. The owner name alone proves
 * nothing: Pixoo's embedded owner uses it too.
 * @param {ConsumerState} state @param {{revision: number, sessions: string[]}} owner
 */
export const follows = (state, owner) => state.feed.connection === 'current' && state.feed.ownerId === PAIRING.ownerId && state.feed.revision !== null && state.feed.revision === owner.revision &&
  (state.feed.sessions === null || JSON.stringify(state.feed.sessions) === JSON.stringify(owner.sessions)) && (state.feed.source === null || state.feed.source === 'shared');

/**
 * A session's identity as one comparable key. The Hub and every consumer name a session by the same five fields.
 * @param {{provider: string, client: string, hostId: string, sourceId: string, sessionId: string}} identity
 */
export const sessionKey = identity => JSON.stringify([identity.provider, identity.client, identity.hostId, identity.sourceId, identity.sessionId]);

/** @param {string} preview @param {string} route @param {AbortSignal} signal */
async function json(preview, route, signal) {
  const response = await fetch(new URL(route, preview), {signal, redirect: 'error', headers: {accept: 'application/json'}});
  if (!response.ok) throw new Error(`${new URL(route, preview).href} answered ${response.status}`);
  return response.json();
}

/**
 * Per consumer: how to read its verification state from the run's preview URL.
 * @type {Record<string, (preview: string, signal: AbortSignal) => Promise<ConsumerState>>}
 */
export const CONSUMER_STATE = {
  // codex-nanoleaf#194: GET <wall url>verify/state, served only by verification runs; Host must be 127.0.0.1:<port>.
  nanoleaf: async (preview, signal) => {
    const value = await json(preview, 'verify/state', signal);
    if (value?.apiVersion !== 'wall-verify/1' || typeof value.feed !== 'object' || typeof value.integration !== 'object') throw new Error('the wall state route answered an unknown shape');
    return {
      format: value.apiVersion,
      // The wall reports whether it follows the shared feed; it does not list the sessions it read.
      feed: {connection: value.feed.connection, revision: value.feed.revision ?? null, ownerId: value.feed.ownerId ?? null, error: value.feed.error ?? null, source: value.feed.source ?? null, sessions: null},
      writer: {'integration.applied': value.integration.applied, 'integration.queued': value.integration.queued, 'integration.failed': value.integration.failed},
      raw: value,
    };
  },
  // divoom-app-upgrade#120: Pixoo's own view of its remote feed, GET <pixoo url>api/integration/v1/sessions, which
  // refreshes from the Hub first as the Monitor tab does; and what reached the simulator's serialized writer,
  // GET <pixoo url>api/device/simulator, whose `admitted` counts each operation the writer queued once.
  pixoo: async (preview, signal) => {
    const [view, simulator] = await Promise.all([json(preview, 'api/integration/v1/sessions', signal), json(preview, 'api/device/simulator', signal)]);
    if (typeof view !== 'object' || view === null || !('connection' in view)) throw new Error('the Pixoo feed view answered an unknown shape');
    if (simulator?.mode !== 'simulator' || typeof simulator.writer?.setBrightness?.admitted !== 'number') throw new Error('the Pixoo simulator writer answered an unknown shape');
    /** @type {Record<string, {admitted: number, succeeded: number}>} */
    const writer = simulator.writer;
    return {
      format: 'pixoo-feed-view+simulator-writer',
      // Pixoo's embedded owner also reports `verify-owner` and `current`, so its session list is what tells the Hub's feed apart.
      feed: {connection: view.connection, revision: view.snapshot?.revision ?? null, ownerId: view.ownerId ?? null, error: null, source: null,
        sessions: Array.isArray(view.snapshot?.sessions) ? view.snapshot.sessions.map((/** @type {any} */ s) => sessionKey(s.identity)).sort() : null},
      // The controller command kinds the Hub sends, by the writer operation that carries them.
      writer: {
        'brightness.set': writer.setBrightness?.admitted ?? 0,
        'power.set': writer.setScreen?.admitted ?? 0,
        'media.upload': writer.uploadAnimation?.admitted ?? 0,
        ...Object.fromEntries(Object.entries(writer).flatMap(([kind, counts]) => [[`${kind}.admitted`, counts.admitted], [`${kind}.succeeded`, counts.succeeded]])),
      },
      raw: {view, simulator},
    };
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
  const read = CONSUMER_STATE[consumer];
  if (!read) throw new Error(`no state reader for consumer ${consumer}`);
  return read(preview, signal);
}
