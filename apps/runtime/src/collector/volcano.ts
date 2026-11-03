// The VOLCANO HYBRID collector (Hub #615): a host-local process that holds the one Bluetooth connection to the enrolled
// device and publishes bounded `volcano-observation` snapshots to the runtime's SDK edge, as a private producer's
// credential. The runtime's container has no radio, so the core never reaches the device. It keeps no history.
//
// The transport below has no write method, and every characteristic it may touch is on a fixed read and notify allowlist,
// so nothing here can start a heater or pump or change a setting. Subscribing to a notification is the only write the
// Bluetooth stack makes on its behalf. The serial is compared with a private hash and goes no further: it is not published,
// logged or kept. Records carry registry codes and nothing of the device or its use.
//
// `bin/volcano-collector.mjs` runs it and owns the process's streams, signals and exit; the real binding lives in
// `apps/volcano-collector`, outside the root lockfile and the container image.
import {createHash, randomUUID} from 'node:crypto';
import {isAbsolute, normalize} from 'node:path';
import {errorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import {
  VOLCANO_OBSERVATION_SCHEMA, VOLCANO_OBSERVATION_TYPE, volcanoFeedId, volcanoObservationKey, type VolcanoFeed, type VolcanoLink, type VolcanoObservation, type VolcanoReading,
} from '@jimmie-potts/event-contracts/v2/families';
import {DeviceAvailability, Outcome, prepareMessage, publishOnce, type Logger, type PublishOnceResult} from '@jimmie-potts/sdk';
import {readPrivateJson, readProducer, type Producer} from '../hook/producer.js';
import {PublicationFailures} from './publication.js';

const BASE = '-5354-4f52-5a26-4249434b454c';
/** The two services the allowlisted characteristics live in, which is all a transport needs to discover. */
export const VOLCANO_SERVICES = [`10100000${BASE}`, `10110000${BASE}`] as const;
/** The registers a collector reads and subscribes to. */
export const VOLCANO_REGISTERS = {
  status1: `1010000c${BASE}`, status2: `1010000d${BASE}`, current: `10110001${BASE}`, target: `10110003${BASE}`, hours: `10110015${BASE}`, minutes: `10110016${BASE}`,
} as const;
/** The one characteristic read and never subscribed to: compared with the private hash, and gone. */
export const VOLCANO_SERIAL = `10100008${BASE}`;

export type SubscribeUuid = typeof VOLCANO_REGISTERS[keyof typeof VOLCANO_REGISTERS];
export type ReadUuid = SubscribeUuid | typeof VOLCANO_SERIAL;
export const SUBSCRIBABLE: readonly string[] = Object.freeze(Object.values(VOLCANO_REGISTERS));
export const READABLE: readonly string[] = Object.freeze([...SUBSCRIBABLE, VOLCANO_SERIAL]);

/**
 * What a collector asks of a Bluetooth binding, and all it can ask: find the advertiser, connect, read an allowlisted
 * characteristic, subscribe to one and disconnect. There is no write, on purpose.
 */
export type VolcanoTransport = {
  /** Finds an advertiser of exactly this name; false when none appeared before the signal ended. */
  scan(advertisedName: string, signal: AbortSignal): Promise<boolean>;
  /** Connects to the advertiser `scan` found. `lost` is told once if the link ends by itself. */
  connect(lost: () => void, signal: AbortSignal): Promise<void>;
  read(uuid: ReadUuid, signal: AbortSignal): Promise<Uint8Array>;
  subscribe(uuid: SubscribeUuid, listener: (bytes: Uint8Array) => void, signal: AbortSignal): Promise<void>;
  disconnect(): Promise<void>;
};

/** How often the registers are read while connected: one counter tick in the live trial arrived only this way. */
export const POLL_MS = 5000;
/** The longest time between publications, so the module can judge freshness. */
export const HEARTBEAT_MS = 5000;
/** A change publishes at most this often. */
export const MIN_PUBLISH_MS = 1000;
export const SCAN_MS = 30_000;
export const CONNECT_MS = 20_000;
export const READ_DEADLINE_MS = 5000;
export const PUBLISH_TIMEOUT_MS = 4000;
export const BACKOFF_FIRST_MS = 2000;
export const BACKOFF_MAX_MS = 60_000;
/** How long a counter that does not move forward must hold before it is believed. One poll is enough, and one notification is not. */
export const COUNTER_CONFIRM_MS = 4000;
export const MAX_COLLECTOR_BYTES = 8192;
/** Status register 2's bit that flips by itself every 10 to 15 s. It is never a change. */
const SELF_FLIPPING_BIT = 0x2000;
const MAX_PATH = 1024;
const ID = /^[A-Za-z0-9_.-]{1,128}$/;
const FEED_MEMBERS = 'client,feed,hostId,provider,sourceId';
/** The device name the collector's availability records carry: its link, never anything from the device. */
const LINK_DEVICE = 'volcano-link';

export type CollectorConfig = {producer: string; advertisedName: string; serialSha256: string};
export type Collector = CollectorConfig & {publisher: Producer; feed: VolcanoFeed};
export type Refusal = 'collector' | 'producer' | 'binding';

/** The fixed diagnostic line for each refusal: no value from either file. */
export const REFUSAL_TEXT: Readonly<Record<Refusal, string>> = {
  collector: 'volcano-collector: the collector file is missing, not private or not the collector shape',
  producer: 'volcano-collector: the producer file is missing, not private, not enabled and qualified, or not a Volcano producer',
  binding: 'volcano-collector: the Bluetooth binding is not installed; run npm ci in apps/volcano-collector',
};

type Fields = Record<string, unknown>;
const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);
const isPath = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= MAX_PATH && !value.includes('\0') &&
  isAbsolute(value) && normalize(value) === value && !value.endsWith('/');
const isName = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 64 && [...value].every(c => (c.codePointAt(0) ?? 0) >= 32);

/** The feed a producer's source configuration names, or undefined unless it is exactly the five-member shape. */
export function volcanoFeedOf(configuration: Readonly<Record<string, unknown>>): VolcanoFeed | undefined {
  if (Object.keys(configuration).sort().join(',') !== FEED_MEMBERS) return undefined;
  const {provider, client, hostId, sourceId, feed} = configuration;
  if (provider !== 'storz-bickel' || client !== 'volcano' || feed !== 'volcano-observation') return undefined;
  if (typeof hostId !== 'string' || !ID.test(hostId) || typeof sourceId !== 'string' || !ID.test(sourceId)) return undefined;
  return {provider, client, hostId, sourceId};
}

/**
 * The collector file at `path`, or undefined unless it is private (an owner-only regular file with one link, opened
 * without following a link, of at most 8 KiB) and exactly `{producer, advertisedName, serialSha256}`.
 */
export async function readCollectorConfig(path: string): Promise<CollectorConfig | undefined> {
  const value = await readPrivateJson(path, MAX_COLLECTOR_BYTES);
  if (!isFields(value) || Object.keys(value).sort().join(',') !== 'advertisedName,producer,serialSha256') return undefined;
  const {producer, advertisedName, serialSha256} = value;
  if (!isPath(producer) || !isName(advertisedName) || typeof serialSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(serialSha256)) return undefined;
  return {producer, advertisedName, serialSha256};
}

/** The collector `path` selects, or why it cannot run. Both files are read once, here. */
export async function loadCollector(path: string): Promise<Collector | Refusal> {
  const config = await readCollectorConfig(path);
  if (config === undefined) return 'collector';
  const producer = await readProducer(config.producer);
  const feed = producer === undefined ? undefined : volcanoFeedOf(producer.configuration);
  if (producer === undefined || feed === undefined) return 'producer';
  return {...config, publisher: producer, feed};
}

const uint16 = (bytes: Uint8Array | undefined): number | null => (bytes === undefined || bytes.length < 2 ? null : (bytes[0] ?? 0) + ((bytes[1] ?? 0) << 8));

/** The hex SHA-256 of a serial as the device reports it, without trailing NUL padding or spaces. */
export function serialDigest(bytes: Uint8Array): string {
  const serial = new TextDecoder('utf-8').decode(bytes).replace(/[\0\s]+$/u, '');
  return createHash('sha256').update(serial, 'utf8').digest('hex');
}

/** The prepared message of one snapshot. Its only device values are the registers. */
export function observationMessage(source: string, snapshot: VolcanoObservation): {key: string; message: Message<VolcanoObservation>} {
  return {
    key: volcanoObservationKey(snapshot.feed),
    message: prepareMessage(source, {kind: 'occurrence', type: VOLCANO_OBSERVATION_TYPE, subject: volcanoFeedId(snapshot.feed), dataschema: VOLCANO_OBSERVATION_SCHEMA, data: snapshot}, {now: () => snapshot.observedAtMs}),
  };
}

export type RunOptions = {
  /** The diagnostic contract's logger: the entry point's runtime `LogWriter` over stderr. */
  log: Logger;
  /** Ends the loop: the collector resolves promptly, without waiting for the device or a publication. */
  signal: AbortSignal;
  transport: VolcanoTransport;
  /** The wall clock for `observedAtMs` and the message's `time`. Defaults to `Date.now`. */
  now?: () => number;
  /** The publication call. Defaults to the SDK's `publishOnce`. */
  publish?: typeof publishOnce;
  /** Waits between attempts. Defaults to a timer. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Shorter times for a test, in place of this file's constants. */
  timing?: Partial<{pollMs: number; heartbeatMs: number; minPublishMs: number; scanMs: number; connectMs: number; readMs: number; counterConfirmMs: number}>;
};

/** Resolves after `ms`, or at once when `signal` ends. */
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) { resolve(); return; }
    const done = (): void => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, Math.max(0, ms));
    signal.addEventListener('abort', done, {once: true});
  });
}

const FAILED = Symbol('failed');

/** The device's registers as last known. */
type Registers = {status1: number; status2: number; current: number | null; target: number | null; hours: number | null; minutes: number | null};
type Pair = {hours: number | null; minutes: number | null};

/**
 * Keeps a torn counter out of what is published. The device notifies hours and minutes separately, so at an hour boundary
 * the registers can read 12:59, 13:59, 13:00 or 12:59, 12:00, 13:00. A pair is taken when it moves forward by no more than the
 * time allows. Any other pair is held back, published as unread, until a later read at least `confirmMs` on still says the
 * same: then it is a real reset, for the module to record as a discontinuity. Publishing the last good pair instead would
 * tell the module the counter had not moved, and it would store that as a gain of zero across any gap that had just ended.
 */
export class CounterGate {
  readonly #confirmMs: number;
  #taken: {hours: number; minutes: number; atMs: number} | undefined;
  #suspect: {hours: number; minutes: number; atMs: number} | undefined;

  constructor(confirmMs: number) {
    this.#confirmMs = confirmMs;
  }

  take({hours, minutes}: Pair, atMs: number): Pair {
    if (hours === null || minutes === null) return {hours, minutes};
    const take = (): Pair => {
      this.#taken = {hours, minutes, atMs};
      this.#suspect = undefined;
      return {hours, minutes};
    };
    if (this.#taken === undefined) return take();
    const gain = hours * 60 + minutes - (this.#taken.hours * 60 + this.#taken.minutes);
    if (gain >= 0 && gain <= Math.ceil((atMs - this.#taken.atMs) / 60_000) + 1) return take();
    if (this.#suspect?.hours === hours && this.#suspect.minutes === minutes) {
      if (atMs - this.#suspect.atMs >= this.#confirmMs) return take();
    } else {
      this.#suspect = {hours, minutes, atMs};
    }
    return {hours: null, minutes: null};
  }
}

/** One bounded transport call: its answer, or `FAILED` when it threw, outlasted `ms` or `signal` ended. Its own signal aborts then. */
async function bounded<T>(work: (signal: AbortSignal) => Promise<T>, ms: number, signal: AbortSignal): Promise<T | typeof FAILED> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(ms)]);
  if (deadline.aborted) return FAILED;
  let listener: (() => void) | undefined;
  const ended = new Promise<typeof FAILED>(resolve => {
    listener = () => { resolve(FAILED); };
    deadline.addEventListener('abort', listener, {once: true});
  });
  try {
    return await Promise.race([work(deadline), ended]);
  } catch {
    return FAILED;
  } finally {
    if (listener !== undefined) deadline.removeEventListener('abort', listener);
  }
}

/**
 * What the collector last knows, and when to say it: on a change at most once a second, and at the heartbeat when there is
 * newer evidence. A reading's `observedAtMs` is the time of the evidence for it, never the time it was sent, so a heartbeat
 * with nothing newer sends nothing and the module's freshness runs out honestly.
 */
class Publisher {
  readonly #collector: Collector;
  readonly #options: RunOptions;
  readonly #now: () => number;
  readonly #publish: typeof publishOnce;
  readonly #failures: PublicationFailures;
  readonly #minMs: number;
  readonly #heartbeatMs: number;
  readonly #epoch = randomUUID();
  #sequence = 0;
  #link: VolcanoLink = 'unavailable';
  #reading: VolcanoReading | null = null;
  #readingAtMs = 0;
  #sentReadingAtMs = 0;
  #said: string | undefined;
  #lastAt = Number.NEGATIVE_INFINITY;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #sending = false;

  constructor(collector: Collector, options: RunOptions) {
    this.#collector = collector;
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#publish = options.publish ?? publishOnce;
    this.#failures = new PublicationFailures(options.log, 'feed');
    this.#minMs = options.timing?.minPublishMs ?? MIN_PUBLISH_MS;
    this.#heartbeatMs = options.timing?.heartbeatMs ?? HEARTBEAT_MS;
  }

  /** What the snapshot says, without the bit that flips by itself. */
  #signature(): string {
    return JSON.stringify([this.#link, this.#reading === null ? null : {...this.#reading, status2: this.#reading.status2 & ~SELF_FLIPPING_BIT}]);
  }

  /** Takes what is known now, with the time of the evidence for a reading, and schedules the next publication. */
  update(link: VolcanoLink, reading: VolcanoReading | null, readingAtMs = 0): void {
    this.#link = link;
    this.#reading = link === 'connected' ? reading : null;
    this.#readingAtMs = readingAtMs;
    this.#schedule();
  }

  #schedule(): void {
    if (this.#options.signal.aborted) return;
    clearTimeout(this.#timer);
    // The heartbeat runs on the monotonic clock, so a wall-clock step never delays or hastens it.
    const since = performance.now() - this.#lastAt;
    const delay = this.#signature() !== this.#said ? Math.max(0, this.#minMs - since) : Math.max(0, this.#heartbeatMs - since);
    this.#timer = setTimeout(() => { void this.#send(); }, delay);
  }

  async #send(): Promise<void> {
    if (this.#options.signal.aborted) return;
    if (this.#sending) return;
    // Nothing newer to say of a connected device: the next evidence schedules the next publication.
    const reading = this.#link === 'connected' && this.#reading !== null;
    if (reading && this.#readingAtMs <= this.#sentReadingAtMs) return;
    if (reading) this.#sentReadingAtMs = this.#readingAtMs;
    this.#sending = true;
    this.#said = this.#signature();
    this.#lastAt = performance.now();
    this.#sequence += 1;
    const snapshot: VolcanoObservation = {
      feed: {...this.#collector.feed}, observedAtMs: reading ? this.#readingAtMs : this.#now(), collectorEpoch: this.#epoch, sequence: this.#sequence, link: this.#link,
      reading: this.#reading === null ? null : {...this.#reading},
    };
    const {key, message} = observationMessage(this.#collector.publisher.source, snapshot);
    const {publisher} = this.#collector;
    const {log, signal} = this.#options;
    let outcome: PublishOnceResult | typeof FAILED;
    try {
      outcome = await bounded(() => this.#publish({url: publisher.edge, source: publisher.source, token: publisher.token, timeoutMs: PUBLISH_TIMEOUT_MS}, key, message), PUBLISH_TIMEOUT_MS + 1000, signal);
      if (outcome === FAILED) {
        if (!signal.aborted) this.#failures.failed(this.#now(), 'late', message);
      } else if (outcome.status === 'published') {
        log.debug('operation.completed', {'bunny.operation': 'feed', 'bunny.outcome': Outcome.succeeded, 'bunny.message.id': message.id, 'bunny.message.kind': message.kind}, message);
        this.#failures.succeeded();
      } else {
        this.#failures.failed(this.#now(), outcome, message);
      }
    } catch {
      // Only a malformed deadline or edge URL rejects, before anything is sent.
      this.#failures.failed(this.#now(), {status: 'rejected', error: errorBody('invalid-request')}, message);
    } finally {
      this.#sending = false;
    }
    this.#schedule();
  }

  stop(): void {
    clearTimeout(this.#timer);
  }
}

/**
 * Runs `collector` until `signal` ends: finds the device, checks its serial against the private hash, then stays connected
 * on notifications plus a poll until the link ends, and tries again with bounded backoff. Nothing is ever written, and no
 * publication is retried: the next snapshot says what is true then.
 */
export async function runCollector(collector: Collector, options: RunOptions): Promise<void> {
  const {log, signal, transport, now = Date.now, sleep = wait, timing = {}} = options;
  const {pollMs = POLL_MS, scanMs = SCAN_MS, connectMs = CONNECT_MS, readMs = READ_DEADLINE_MS, counterConfirmMs = COUNTER_CONFIRM_MS} = timing;
  // It outlives a connection, because a torn pair can be the first read of the next one.
  const counter = new CounterGate(counterConfirmMs);
  const availability = new DeviceAvailability({log, clock: {now}});
  const publisher = new Publisher(collector, options);
  publisher.update('unavailable', null);

  /** The registers once, each bounded, or undefined when one failed or the link ended meanwhile. */
  const readRegisters = async (live: AbortSignal): Promise<Registers | undefined> => {
    const values = await Promise.all(SUBSCRIBABLE.map(uuid => bounded(deadline => transport.read(uuid as SubscribeUuid, deadline), readMs, live)));
    if (values.includes(FAILED) || live.aborted) return undefined;
    const [status1, status2, current, target, hours, minutes] = (values as Uint8Array[]).map(uint16);
    if (status1 === null || status1 === undefined || status2 === null || status2 === undefined) return undefined;
    return {status1, status2, current: current ?? null, target: target ?? null, hours: hours ?? null, minutes: minutes ?? null};
  };

  let readingAtMs = 0;

  /** One connection, until its link ends. True when it reached the point of reading the device. */
  const session = async (): Promise<boolean> => {
    const found = await bounded(deadline => transport.scan(collector.advertisedName, deadline), scanMs, signal);
    if (found !== true) {
      // A device that does not advertise may simply have its Bluetooth off: unavailable is unknown, never off.
      publisher.update('unavailable', null);
      availability.unreachable(LINK_DEVICE, 'unavailable');
      return false;
    }
    // Everything of this connection ends with its link or the process, so nothing waits on a promise that outlives a wait.
    const link = new AbortController();
    const live = AbortSignal.any([signal, link.signal]);
    const connected = await bounded(deadline => transport.connect(() => { link.abort(); }, deadline), connectMs, signal);
    if (connected === FAILED) {
      publisher.update('unavailable', null);
      availability.unreachable(LINK_DEVICE, 'unavailable');
      await bounded(() => transport.disconnect(), readMs, new AbortController().signal);
      return false;
    }
    let open = true;
    try {
      const serial = await bounded(deadline => transport.read(VOLCANO_SERIAL, deadline), readMs, live);
      if (serial === FAILED) {
        publisher.update('disconnected', null);
        availability.unreachable(LINK_DEVICE, 'unavailable');
        return false;
      }
      if (serialDigest(serial) !== collector.serialSha256) {
        publisher.update('identity-mismatch', null);
        availability.unreachable(LINK_DEVICE, 'forbidden');
        return false;
      }
      const started = now();
      const first = await readRegisters(live);
      if (first === undefined) {
        publisher.update('disconnected', null);
        availability.unreachable(LINK_DEVICE, 'unavailable');
        return false;
      }
      const registers: Registers = first;
      let duringPoll: Set<keyof Registers> | undefined;
      // Evidence moves forward even when the wall clock does not, so a change at one millisecond is never lost to the last.
      const evidence = (atMs: number): void => {
        readingAtMs = Math.max(atMs, readingAtMs + 1);
        const {hours, minutes} = counter.take(registers, now());
        if (open) publisher.update('connected', {status1: registers.status1, status2: registers.status2, currentDeciC: registers.current, targetDeciC: registers.target, heatingHours: hours, heatingMinutes: minutes}, readingAtMs);
      };
      evidence(started);
      availability.reached(LINK_DEVICE);
      const listener = (name: keyof Registers) => (bytes: Uint8Array): void => {
        const value = uint16(bytes);
        if (value === null && (name === 'status1' || name === 'status2')) return;
        (registers as Record<keyof Registers, number | null>)[name] = value;
        duringPoll?.add(name);
        evidence(now());
      };
      for (const name of Object.keys(VOLCANO_REGISTERS) as (keyof typeof VOLCANO_REGISTERS)[]) {
        const subscribed = await bounded(deadline => transport.subscribe(VOLCANO_REGISTERS[name], listener(name), deadline), readMs, live);
        if (subscribed === FAILED) {
          publisher.update('disconnected', null);
          availability.unreachable(LINK_DEVICE, 'unavailable');
          return true;
        }
      }
      for (;;) {
        await wait(pollMs, live);
        if (live.aborted) break;
        const polledAt = now();
        const heard = new Set<keyof Registers>();
        duringPoll = heard;
        const polled = await readRegisters(live);
        duringPoll = undefined;
        if (polled === undefined) break;
        // A notification during the poll is newer than what the poll read.
        for (const name of Object.keys(polled) as (keyof Registers)[]) if (!heard.has(name)) (registers as Record<keyof Registers, number | null>)[name] = polled[name];
        evidence(polledAt);
      }
      if (!signal.aborted) {
        publisher.update('disconnected', null);
        availability.unreachable(LINK_DEVICE, 'unavailable');
      }
      return true;
    } finally {
      open = false;
      await bounded(() => transport.disconnect(), readMs, new AbortController().signal);
    }
  };

  let backoff = BACKOFF_FIRST_MS;
  try {
    while (!signal.aborted) {
      if (await session()) backoff = BACKOFF_FIRST_MS;
      if (signal.aborted) break;
      await sleep(backoff, signal);
      backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
    }
  } finally {
    publisher.stop();
  }
}
