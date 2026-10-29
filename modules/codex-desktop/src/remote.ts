// A remote Codex Desktop source (Hub #567): a host-local collector on the computer that holds the Codex home reads the
// same three inputs the module's own reader does and publishes bounded `desktop-metadata` snapshots over the SDK edge,
// which the module takes as the reads of that source. A snapshot stands in for one answer of the folder reader, so the
// module's read loop, deadlines and evidence rules stay the same: a feed whose snapshots stop makes the marker
// unavailable, as a folder that stalls does, and the next snapshot is its recovery. Only the configured feed's snapshots
// count, and the edge binds a snapshot's feed to the credential that published it, so another producer cannot speak for
// a source.
import type {Message} from '@jimmie-potts/event-contracts/v2';
import {DESKTOP_METADATA_KEY_PREFIX, DESKTOP_METADATA_SCHEMA, DESKTOP_METADATA_TYPE, desktopFeedId, type DesktopFeed, type DesktopMetadataSnapshot, type Title} from '@jimmie-potts/event-contracts/v2/families';
import {metadataOf} from './metadata.js';
import type {MarkerRead, MarkerTransport} from './transport.js';

export {DESKTOP_METADATA_SCHEMA, DESKTOP_METADATA_TYPE};
/** The routing key pattern the module follows for its remote sources. */
export const DESKTOP_METADATA_KEYS = `${DESKTOP_METADATA_KEY_PREFIX}*`;
/**
 * How long a snapshot stands as the source's current read. A collector publishes a snapshot on every change and at
 * least every 5 s, so a source without one for twice that is unavailable: a read waits for the next snapshot, and the
 * module's own deadline reports the marker unavailable meanwhile.
 */
export const FEED_FRESH_MS = 10_000;
/** The prefix of every remote part's source, as the edge names a credential's: never the core's or a module's. */
const PART_SOURCE = /^bunny\/parts\/[a-z0-9][a-z0-9-]*$/;
const ID = /^[A-Za-z0-9_.-]{1,128}$/;

type Waiting = {stamp: string; resolve: (read: MarkerRead) => void};

/** The feed one remote source is read from: the latest fresh snapshot answers a read, and a read without one waits. */
export class RemoteFeed implements MarkerTransport {
  readonly feedId: string;
  readonly #now: () => number;
  #latest: {read: {stamp: string; unread: readonly string[] | null; archived: readonly string[] | null; titles: readonly {id: string; title: Title}[]; parent: {traceparent: string}}; atMs: number; observedAtMs: number} | undefined;
  #waiting: Waiting[] = [];
  #closed = false;

  constructor(feed: DesktopFeed, now: () => number) {
    this.feedId = desktopFeedId(feed);
    this.#now = now;
  }

  /**
   * Takes a snapshot of this feed, with the trace of the message that carried it: the next reads answer from it, and a
   * read that waits answers at once. Evidence drawn from the snapshot continues its trace. One collector reads one
   * clock, so while the feed is fresh a snapshot whose `observedAtMs` is not newer than the last one taken arrived late
   * or out of order: it is ignored, and neither renews the feed's freshness nor reorders evidence. Once the feed has gone
   * stale the next snapshot is the collector's current view whatever its clock says, so a clock that stepped back on the
   * collector's host, or a snapshot stamped in the future, holds the feed for one freshness window, never for good.
   * Returns whether the snapshot was taken.
   */
  take(snapshot: DesktopMetadataSnapshot, parent: {traceparent: string}): boolean {
    if (this.#closed) return false;
    const latest = this.#latest;
    if (latest !== undefined && this.#now() - latest.atMs < FEED_FRESH_MS && snapshot.observedAtMs <= latest.observedAtMs) return false;
    const metadata = metadataOf({archived: snapshot.archived, titles: snapshot.titles});
    const unread = snapshot.unread === null ? null : snapshot.unread.filter(id => ID.test(id));
    this.#latest = {read: {stamp: snapshot.stamp, unread, archived: metadata.archived ?? null, titles: metadata.titles ?? [], parent: {traceparent: parent.traceparent}}, atMs: this.#now(), observedAtMs: snapshot.observedAtMs};
    const waiting = this.#waiting;
    this.#waiting = [];
    for (const {stamp, resolve} of waiting) resolve(this.#answer(stamp));
    return true;
  }

  /** The source's read: its latest fresh snapshot, unchanged when its stamp is `stamp`, or the next one when none is fresh. */
  read(_home: string, stamp: string): Promise<MarkerRead> {
    if (this.#closed) return Promise.reject(new Error('the remote feed is closed'));
    const latest = this.#latest;
    if (latest !== undefined && this.#now() - latest.atMs < FEED_FRESH_MS) return Promise.resolve(this.#answer(stamp));
    return new Promise(resolve => { this.#waiting.push({stamp, resolve}); });
  }

  /** Reads still waiting never settle, as the module's stop expects of a stalled read. */
  close(): void {
    this.#closed = true;
    this.#waiting = [];
  }

  #answer(stamp: string): MarkerRead {
    const latest = this.#latest;
    if (latest === undefined) return {status: 'read', stamp: '', unread: null};
    const {read, atMs} = latest;
    // The facts were current when the snapshot arrived, not when the module reads it: the settle rule measures from there.
    return read.stamp === stamp ? {status: 'unchanged', archived: read.archived, titles: read.titles, parent: read.parent, readAtMs: atMs}
      : {status: 'read', stamp: read.stamp, unread: read.unread, archived: read.archived, titles: read.titles, parent: read.parent, readAtMs: atMs};
  }
}

/** Why a `desktop-metadata` message was not taken for any configured source: `stale` is one not newer than the feed's last. */
export type FeedRefusal = 'source' | 'feed' | 'unknown' | 'stale';

/** The module's remote feeds, by feed ID, and which message each takes. */
export class RemoteFeeds {
  readonly #feeds = new Map<string, RemoteFeed>();

  /** The feed for one configured source, made once. */
  open(source: {hostId: string; sourceId: string}, now: () => number): RemoteFeed {
    const feed: DesktopFeed = {provider: 'codex', client: 'desktop', hostId: source.hostId, sourceId: source.sourceId};
    const opened = new RemoteFeed(feed, now);
    this.#feeds.set(opened.feedId, opened);
    return opened;
  }

  get size(): number {
    return this.#feeds.size;
  }

  /**
   * Hands a message on the module's feed keys to the source it names, when it is a `desktop-metadata` snapshot from a
   * remote part whose feed is the key's and a configured one; otherwise says why not.
   */
  deliver(message: Message): FeedRefusal | undefined {
    if (message.dataschema !== DESKTOP_METADATA_SCHEMA || message.type !== DESKTOP_METADATA_TYPE || message.kind !== 'occurrence' || !PART_SOURCE.test(message.source)) return 'source';
    const snapshot = message.data as unknown as DesktopMetadataSnapshot;
    const {feed} = snapshot;
    if (feed.provider !== 'codex' || feed.client !== 'desktop' || desktopFeedId(feed) !== message.subject) return 'feed';
    const opened = this.#feeds.get(message.subject);
    if (opened === undefined) return 'unknown';
    return opened.take(snapshot, message) ? undefined : 'stale';
  }

  close(): void {
    for (const feed of this.#feeds.values()) feed.close();
  }
}
