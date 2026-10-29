// The Codex Desktop collector (Hub #567): a host-local process that reads Codex Desktop's three metadata inputs (the read
// marker, the archived rollout filenames and the `session_index.jsonl` tail) from a local Codex home with the module's own
// readers, and publishes one bounded `desktop-metadata` snapshot per cycle to the runtime's SDK edge with `publishOnce`,
// as a private producer's credential. It runs where Codex Desktop runs, on the PC (WSL, with the home on /mnt/c) and on
// the Mac, so the core never reads another host's files. It writes no file, retries no publication and reports only
// fixed-shape records that carry registry codes and trace IDs: no path, token, thread ID, title or exception text.
// `bin/codex-desktop-collector.mjs` runs it and owns the process's streams, signals and exit.
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {open, type FileHandle} from 'node:fs/promises';
import {isAbsolute, normalize} from 'node:path';
import {readDesktopMetadata, readMarker, type DesktopMetadata} from '@jimmie-potts/codex-desktop';
import type {ErrorCode, Message} from '@jimmie-potts/event-contracts/v2';
import {desktopFeedId, type DesktopFeed, type DesktopMetadataSnapshot, type Title} from '@jimmie-potts/event-contracts/v2/families';
import {prepareMessage, publishOnce, type PublishOnceResult} from '@jimmie-potts/sdk';
import {readProducer, type Producer} from '../hook/producer.js';

export const DESKTOP_METADATA_TYPE = 'org.bunny.desktop-metadata.observed';
export const DESKTOP_METADATA_SCHEMA = 'https://bunny.invalid/events/desktop-metadata/2.0';
/** The most distinct unread IDs a snapshot carries; more makes `unread` unavailable (null), never truncated. */
export const MAX_UNREAD = 4096;
/** The most distinct archived IDs a snapshot carries; more makes `archived` unavailable (null), never truncated. */
export const MAX_ARCHIVED = 2048;
/** The most titles a snapshot carries: the newest, as the index tail lists them. */
export const MAX_TITLES = 512;
/** The serialized message's budget, under the profile's `MAX_MESSAGE_BYTES`, before titles and then archives are dropped. */
export const MESSAGE_BUDGET_BYTES = 224 * 1024;
/** How long one cycle's reads may take before the cycle counts as a stall and publishes nothing. */
export const READ_DEADLINE_MS = 5000;
/** The longest gap between publications of an unchanged snapshot, so the receiving module can judge freshness. */
export const HEARTBEAT_MS = 5000;
/** How long one publication call may take. */
export const PUBLISH_TIMEOUT_MS = 4000;
export const DEFAULT_INTERVAL_MS = 2000;
export const MIN_INTERVAL_MS = 1000;
export const MAX_INTERVAL_MS = 30000;
/** The largest collector file read. */
export const MAX_COLLECTOR_BYTES = 8192;
/** How often a lasting failure is summarized after its first record. */
export const SUMMARY_MS = 60_000;
const MAX_PATH = 1024;
const ID = /^[A-Za-z0-9_.-]{1,128}$/;
const FEED_MEMBERS = 'client,feed,hostId,provider,sourceId';
const TITLE_STEPS = [MAX_TITLES, 256, 128, 0] as const;

/** What `collector.json` selects: the producer file, the Codex home and the cycle's interval. */
export type CollectorConfig = {producer: string; home: string; intervalMs: number};
/** What one cycle observed, before its bounds. */
export type Observed = {unread: readonly string[] | null; archived: readonly string[] | null; titles: DesktopMetadata['titles']};
/** One record, as one JSON line: only these fields, ever. */
export type CollectorRecord = {
  time: string; level: 'DEBUG' | 'INFO' | 'WARN'; event: string; 'bunny.code'?: ErrorCode; trace_id?: string;
};

type Fields = Record<string, unknown>;
const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Canonical JSON: object keys sorted at every depth, arrays as given. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isFields(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

/** A snapshot's content stamp: the first 32 hex digits of the SHA-256 of its bounded sets' canonical JSON. */
export function snapshotStamp(content: Pick<DesktopMetadataSnapshot, 'unread' | 'archived' | 'titles'>): string {
  const {unread, archived, titles} = content;
  return createHash('sha256').update(canonicalJson({unread, archived, titles}), 'utf8').digest('hex').slice(0, 32);
}

/** The distinct IDs, sorted so the stamp does not depend on directory or marker order, or null past `limit`. */
function boundedSet(ids: readonly string[] | null, limit: number): string[] | null {
  if (ids === null) return null;
  const distinct = [...new Set(ids)].sort();
  return distinct.length > limit ? null : distinct;
}

const routingKey = (feed: DesktopFeed): string => `bunny.event.desktop-metadata.${desktopFeedId(feed)}`;

/**
 * The bounded snapshot and its prepared message from `source`. Counts are bounded first: over-limit unread or archived
 * sets become null, and titles keep the newest `MAX_TITLES`. A serialized message over `MESSAGE_BUDGET_BYTES` then keeps
 * the newest 256, 128 and finally no titles, then drops the archive, and as a last resort the unread set, so the message
 * always stays under the profile's cap. The stamp is computed after bounding.
 */
export function snapshotMessage(source: string, feed: DesktopFeed, observed: Observed, observedAtMs: number): {
  key: string; snapshot: DesktopMetadataSnapshot; message: Message<DesktopMetadataSnapshot>;
} {
  const subject = desktopFeedId(feed);
  const key = routingKey(feed);
  let unread = boundedSet(observed.unread, MAX_UNREAD);
  let archived = boundedSet(observed.archived, MAX_ARCHIVED);
  const allTitles: {id: string; title: Title}[] = observed.titles.map(({id, title}) => ({id, title: {value: title.value, source: title.source}}));
  const build = (titleCount: number) => {
    const titles = titleCount === 0 ? [] : allTitles.slice(-titleCount);
    const snapshot: DesktopMetadataSnapshot = {feed: {...feed}, observedAtMs, stamp: snapshotStamp({unread, archived, titles}), unread, archived, titles};
    const message = prepareMessage(source, {kind: 'occurrence', type: DESKTOP_METADATA_TYPE, subject, dataschema: DESKTOP_METADATA_SCHEMA, data: snapshot},
      {now: () => observedAtMs});
    return {snapshot, message, size: Buffer.byteLength(JSON.stringify(message), 'utf8')};
  };
  for (const step of TITLE_STEPS) {
    const built = build(step);
    if (built.size <= MESSAGE_BUDGET_BYTES) return {key, snapshot: built.snapshot, message: built.message};
  }
  archived = null;
  const withoutArchive = build(0);
  if (withoutArchive.size <= MESSAGE_BUDGET_BYTES) return {key, snapshot: withoutArchive.snapshot, message: withoutArchive.message};
  // Unreachable with UUID-length IDs, but an ID may be 128 characters: the unread set is then unavailable too.
  unread = null;
  const empty = build(0);
  return {key, snapshot: empty.snapshot, message: empty.message};
}

/** The Desktop feed a producer's source configuration names, or undefined unless it is exactly the five-member shape. */
export function desktopFeedOf(configuration: Readonly<Record<string, unknown>>): DesktopFeed | undefined {
  if (Object.keys(configuration).sort().join(',') !== FEED_MEMBERS) return undefined;
  const {provider, client, hostId, sourceId, feed} = configuration;
  if (provider !== 'codex' || client !== 'desktop' || feed !== 'desktop-metadata') return undefined;
  if (typeof hostId !== 'string' || !ID.test(hostId) || typeof sourceId !== 'string' || !ID.test(sourceId)) return undefined;
  return {provider, client, hostId, sourceId};
}

/** Reads a private JSON file of at most `limit` bytes, as `readPrivateJson` in hook/producer.ts does, or undefined. */
async function readPrivateJson(path: string, limit: number): Promise<unknown> {
  let file: FileHandle;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    return undefined;
  }
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0 || info.size > limit) return undefined;
    const buffer = Buffer.alloc(limit + 1);
    let size = 0;
    for (;;) {
      const {bytesRead} = await file.read(buffer, size, buffer.length - size, null);
      if (bytesRead === 0) break;
      size += bytesRead;
      if (size > limit) return undefined;
    }
    return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(buffer.subarray(0, size))) as unknown;
  } catch {
    return undefined;
  } finally {
    await file.close().catch(() => {});
  }
}

const isPath = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= MAX_PATH && !value.includes('\0') &&
  isAbsolute(value) && normalize(value) === value && (value === '/' || !value.endsWith('/'));

/**
 * The collector file at `path`, or undefined unless it is private (an owner-only regular file with one link, opened
 * without following a link, of at most 8 KiB) and exactly `{producer, home}` with an optional integer `intervalMs`
 * from 1000 to 30000.
 */
export async function readCollectorConfig(path: string): Promise<CollectorConfig | undefined> {
  const value = await readPrivateJson(path, MAX_COLLECTOR_BYTES);
  if (!isFields(value)) return undefined;
  const members = Object.keys(value).filter(key => key !== 'intervalMs').sort().join(',');
  if (members !== 'home,producer') return undefined;
  const {producer, home, intervalMs = DEFAULT_INTERVAL_MS} = value;
  if (!isPath(producer) || !isPath(home)) return undefined;
  if (typeof intervalMs !== 'number' || !Number.isSafeInteger(intervalMs) || intervalMs < MIN_INTERVAL_MS || intervalMs > MAX_INTERVAL_MS) return undefined;
  return {producer, home, intervalMs};
}

/** A selected collector: its configuration, its producer and the feed that producer's source names. */
export type Collector = CollectorConfig & {publisher: Producer; feed: DesktopFeed};
/** Why a collector cannot run: its collector file, or its producer file. */
export type Refusal = 'collector' | 'producer';

/** The collector `path` selects, or why it cannot run. Both files are read once, here. */
export async function loadCollector(path: string): Promise<Collector | Refusal> {
  const config = await readCollectorConfig(path);
  if (config === undefined) return 'collector';
  const producer = await readProducer(config.producer);
  const feed = producer === undefined ? undefined : desktopFeedOf(producer.configuration);
  if (producer === undefined || feed === undefined) return 'producer';
  return {...config, publisher: producer, feed};
}

/** The fixed diagnostic line for each refusal: no value from either file. */
export const REFUSAL_TEXT: Readonly<Record<Refusal, string>> = {
  collector: 'codex-desktop-collector: the collector file is missing, not private or not the collector shape',
  producer: 'codex-desktop-collector: the producer file is missing, not private, not enabled and qualified, or not a Codex Desktop metadata producer',
};

/** A condition that logs its transition, a summary per minute while it lasts, and its recovery (ADR 0012, "Repetition"). */
class Transition {
  #since: number | undefined;
  #summarized = 0;
  readonly #failed: string;
  readonly #recovered: string;
  readonly #emit: (record: Omit<CollectorRecord, 'time'>) => void;
  constructor(failed: string, recovered: string, emit: (record: Omit<CollectorRecord, 'time'>) => void) {
    this.#failed = failed;
    this.#recovered = recovered;
    this.#emit = emit;
  }
  fail(at: number, code: ErrorCode, traceId?: string): void {
    const fields = {'bunny.code': code, ...(traceId === undefined ? {} : {trace_id: traceId})};
    if (this.#since === undefined) {
      this.#since = at;
      this.#summarized = at;
      this.#emit({level: 'WARN', event: this.#failed, ...fields});
    } else if (at - this.#summarized >= SUMMARY_MS) {
      this.#summarized = at;
      this.#emit({level: 'WARN', event: this.#failed, ...fields});
    }
  }
  succeed(): void {
    if (this.#since === undefined) return;
    this.#since = undefined;
    this.#emit({level: 'INFO', event: this.#recovered});
  }
}

export type RunOptions = {
  /** Writes one record line; the entry point sends it to stderr. */
  write: (line: string) => void;
  /** Ends the loop: the collector resolves promptly, without waiting for a stuck read or a publication. */
  signal: AbortSignal;
  /** The wall clock for `observedAtMs`, the message's `time` and records. Defaults to `Date.now`. */
  now?: () => number;
  /** The publication call. Defaults to the SDK's `publishOnce`. */
  publish?: typeof publishOnce;
  /** The reads. Default to the module's `readMarker` and `readDesktopMetadata`. */
  readMarker?: typeof readMarker;
  readMetadata?: typeof readDesktopMetadata;
};

const ABORTED = Symbol('aborted');
const LATE = Symbol('late');

/** Resolves after `ms`, or at once when `signal` ends. */
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) { resolve(); return; }
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, Math.max(0, ms));
    signal.addEventListener('abort', done, {once: true});
  });
}

/** `promise`, or `LATE` after `ms`, or `ABORTED` when `signal` ends first. */
function race<T>(promise: Promise<T>, ms: number, signal: AbortSignal): Promise<T | typeof LATE | typeof ABORTED> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let listener: (() => void) | undefined;
  const bounded = new Promise<typeof LATE | typeof ABORTED>(resolve => {
    timer = setTimeout(() => { resolve(LATE); }, ms);
    listener = () => { resolve(ABORTED); };
    if (signal.aborted) resolve(ABORTED);
    else signal.addEventListener('abort', listener, {once: true});
  });
  return Promise.race([promise, bounded]).finally(() => {
    clearTimeout(timer);
    if (listener !== undefined) signal.removeEventListener('abort', listener);
  });
}

/**
 * Runs `collector` until `signal` ends. Each cycle reads the three inputs concurrently within `READ_DEADLINE_MS`, builds
 * the bounded snapshot and publishes it when its stamp changed or `HEARTBEAT_MS` passed since the last publication. A read
 * past its deadline publishes nothing and starts no other read until it returns. Nothing is retried.
 */
export async function runCollector(collector: Collector, options: RunOptions): Promise<void> {
  const {write, signal, now = Date.now, publish = publishOnce, readMarker: marker = readMarker, readMetadata = readDesktopMetadata} = options;
  const emit = (record: Omit<CollectorRecord, 'time'>): void => { write(JSON.stringify({time: new Date(now()).toISOString(), ...record})); };
  const publication = new Transition('operation.failed', 'operation.completed', emit);
  const reading = new Transition('device.unavailable', 'device.available', emit);
  const {home, intervalMs, feed, publisher} = collector;
  let markerStamp = '';
  let unread: readonly string[] | null = null;
  let stuck: Promise<unknown> | undefined;
  let lastStamp: string | undefined;
  let lastPublishedAt = Number.NEGATIVE_INFINITY;

  const cycle = async (): Promise<void> => {
    if (stuck !== undefined) {
      reading.fail(now(), 'unavailable');
      return;
    }
    const reads = Promise.all([marker(home, markerStamp), readMetadata(home)]);
    let result: Awaited<typeof reads> | typeof LATE | typeof ABORTED;
    try {
      result = await race(reads, READ_DEADLINE_MS, signal);
    } catch {
      reading.fail(now(), 'internal');
      return;
    }
    if (result === ABORTED) return;
    if (result === LATE) {
      const pending = reads.then(() => {}, () => {}).finally(() => { if (stuck === pending) stuck = undefined; });
      stuck = pending;
      reading.fail(now(), 'unavailable');
      return;
    }
    reading.succeed();
    const [read, metadata] = result;
    if (read.status === 'retry') return;
    if (read.status === 'read') {
      markerStamp = read.stamp;
      unread = read.unread;
    }
    const observedAtMs = now();
    const {key, snapshot, message} = snapshotMessage(publisher.source, feed, {unread, archived: metadata.archived, titles: metadata.titles}, observedAtMs);
    // The heartbeat runs on the monotonic clock, so a wall-clock step never delays or hastens it.
    if (snapshot.stamp === lastStamp && performance.now() - lastPublishedAt < HEARTBEAT_MS) return;
    lastStamp = snapshot.stamp;
    lastPublishedAt = performance.now();
    let outcome: PublishOnceResult | typeof LATE | typeof ABORTED;
    try {
      outcome = await race(publish({url: publisher.edge, source: publisher.source, token: publisher.token, timeoutMs: PUBLISH_TIMEOUT_MS}, key, message), PUBLISH_TIMEOUT_MS + 1000, signal);
    } catch {
      publication.fail(now(), 'invalid-request');
      return;
    }
    if (outcome === ABORTED) return;
    if (outcome === LATE) {
      publication.fail(now(), 'uncertain-result');
      return;
    }
    if (outcome.status === 'published') {
      emit({level: 'DEBUG', event: 'collector.published'});
      publication.succeed();
      return;
    }
    publication.fail(now(), outcome.error.error.code, outcome.error.error.traceId);
  };

  while (!signal.aborted) {
    const started = performance.now();
    await cycle();
    await wait(intervalMs - (performance.now() - started), signal);
  }
}
