// The weather owner (Hub #1418, ADR 0012: a vendor adapter that must poll publishes what it observes). One bounded loop
// reads the National Weather Service and publishes one `weather-state` record, plus one `weather-changed` occurrence
// when the conditions really changed. It takes no command. A vendor fault is `unavailable` state, never a module failure.
import type {ErrorCode} from '@jimmie-potts/event-contracts/v2';
import {DeviceAvailability, Outbox, Outcome, recordLog, type BunnyModule, type Cancel, type Clock, type ModuleContext} from '@jimmie-potts/sdk';
import {NwsClient, WeatherFault, type FetchLike, type Observation} from './client.js';
import {configureWeather, type WeatherConfig} from './configuration.js';
import {CHANGED_KEY, CHANGED_SCHEMA, CHANGED_TYPE, STATE_FAMILY, STATE_KEY, STATE_SCHEMA, STATE_TYPE, WEATHER_ID, type Change, type UnavailableReason, type WeatherChanged, type WeatherState} from './contracts.js';
import {weatherValidator} from './families.js';
import {WeatherStore, type Baseline} from './store.js';

export const POLL_MS = 15 * 60_000;
/** Three missed polls: a record older than this is no claim about now, whatever its status says. */
export const STALE_MS = 3 * POLL_MS;
export const READ_LIMIT_MS = 30_000;
export const BACKOFF_BASE_MS = 60_000;
export const BACKOFF_MAX_MS = 60 * 60_000;
/** A temperature move this large since the last signal is a real change. */
export const TEMPERATURE_CHANGE_F = 10;
const LOG_ID = 'national-weather-service';
const CODES: Readonly<Record<UnavailableReason, ErrorCode>> = {starting: 'unavailable', outage: 'unavailable', 'rate-limited': 'capacity', 'outside-coverage': 'not-found', malformed: 'invalid-message', stale: 'unavailable'};

export type WeatherOptions = {
  /** The HTTP call, given the module's clock. Defaults to the global `fetch`. */
  fetch?: (clock: Clock) => FetchLike;
};
const baselineOf = ({current, alerts}: Observation): Baseline => ({condition: current.condition, likely: current.likely, temperatureF: current.temperatureF, alerts: [...new Set(alerts.map(alert => alert.event))].sort()});
/** What differs enough from the baseline to deserve one signal. */
export function changesFrom(before: Baseline, after: Baseline): Change[] {
  return [
    // Wording outside the vocabulary says nothing about the sky, so it is no change on its own.
    ...(after.condition !== 'other' && (before.condition !== after.condition || before.likely !== after.likely) ? ['condition' as const] : []),
    ...(Math.abs(before.temperatureF - after.temperatureF) >= TEMPERATURE_CHANGE_F ? ['temperature' as const] : []),
    ...(before.alerts.join('\n') !== after.alerts.join('\n') ? ['alerts' as const] : []),
  ];
}

export function createWeatherModule(options: WeatherOptions = {}): BunnyModule<WeatherConfig> {
  let owner: Owner | undefined;
  return {manifest: {name: 'weather', apiVersion: '1.3', configure: configureWeather},
    start: async context => { owner = new Owner(context, options); await owner.start(); },
    stop: () => owner?.stop()};
}

class Owner {
  readonly #context: ModuleContext<WeatherConfig>;
  readonly #store: WeatherStore;
  readonly #outbox: Outbox;
  readonly #client: NwsClient;
  readonly #availability: DeviceAvailability;
  readonly #stop = new AbortController();
  #state: WeatherState;
  #baseline: Baseline | null;
  #failures = 0;
  #storageDown = false;
  #stopped = false;
  #timer: Cancel | undefined;
  #running: Promise<void> | undefined;

  constructor(context: ModuleContext<WeatherConfig>, options: WeatherOptions) {
    if (context.config === undefined) throw new Error('weather needs configuration');
    this.#context = context;
    this.#store = new WeatherStore(context.database());
    this.#outbox = new Outbox({...context, database: context.database(), validator: weatherValidator()});
    const fetchLike: FetchLike = options.fetch?.(context.clock) ?? ((url, init) => fetch(url, init));
    this.#client = new NwsClient(context.config, fetchLike);
    this.#availability = new DeviceAvailability(context);
    const {revision, observedAtMs, baseline} = this.#store.read();
    this.#baseline = baseline;
    // A new revision, so a copy that outlives this restart takes `starting` over its last `available` record.
    this.#state = {id: WEATHER_ID, revision: revision + 1, status: 'unavailable', reason: 'starting', observedAtMs, ageMs: this.#age(observedAtMs)};
  }

  async start(): Promise<void> {
    await this.#context.sdk.serveSync([STATE_FAMILY], () => ({revision: this.#state.revision, states: [{type: STATE_TYPE, subject: WEATHER_ID, dataschema: STATE_SCHEMA, data: this.#current()}]}));
    await this.#outbox.republish();
    await this.#publish(this.#state, this.#baseline);
    this.#schedule(0);
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    this.#stop.abort();
    this.#timer?.();
    await this.#running;
  }

  #age(observedAtMs: number | null): number | null {
    return observedAtMs === null ? null : Math.max(0, this.#context.clock.now() - observedAtMs);
  }

  /** The record as a sync serves it: its age is as of now, while the rest stands as of its revision. */
  #current(): WeatherState {
    const {observedAtMs} = this.#state;
    return observedAtMs === null ? this.#state : {...this.#state, ageMs: this.#age(observedAtMs) as number};
  }

  #schedule(delayMs: number): void {
    if (this.#stopped) return;
    this.#timer = this.#context.scheduler.after(delayMs, () => {
      if (this.#stopped) return;
      this.#running = this.#poll();
      return this.#running;
    });
  }

  async #poll(): Promise<void> {
    const nowMs = this.#context.clock.now();
    let delayMs = POLL_MS;
    try {
      const observation = await this.#bounded(signal => this.#client.read(nowMs, signal));
      if (this.#stopped) return;
      this.#failures = 0;
      this.#availability.reached(LOG_ID);
      await this.#observed(observation);
    } catch (error) {
      if (this.#stopped) return;
      const fault = error instanceof WeatherFault ? error : new WeatherFault('outage');
      this.#failures += 1;
      delayMs = Math.min(BACKOFF_MAX_MS, Math.max(BACKOFF_BASE_MS * 2 ** Math.min(this.#failures - 1, 16), fault.retryAfterMs ?? 0));
      this.#availability.unreachable(LOG_ID, CODES[fault.reason]);
      await this.#unavailable(fault.reason);
    }
    this.#schedule(delayMs);
  }

  #bounded<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const limit = new AbortController();
    const cancel = this.#context.scheduler.after(READ_LIMIT_MS, () => { limit.abort(); });
    const signal = AbortSignal.any([limit.signal, this.#stop.signal, this.#context.signal]);
    let abort: () => void = () => {};
    const aborted = new Promise<never>((_, reject) => {
      abort = () => { reject(new WeatherFault('outage')); };
      signal.addEventListener('abort', abort, {once: true});
      if (signal.aborted) abort();
    });
    return Promise.race([work(signal), aborted]).finally(() => { signal.removeEventListener('abort', abort); cancel(); limit.abort(); });
  }

  async #observed(observation: Observation): Promise<void> {
    const observedAtMs = this.#context.clock.now();
    const next: WeatherState = {id: WEATHER_ID, revision: this.#state.revision + 1, status: 'available', observedAtMs, staleAtMs: observedAtMs + STALE_MS, ageMs: 0, ...observation};
    const after = baselineOf(observation);
    // The first observation sets the baseline: nothing has changed yet. An outage in between changes nothing either.
    const changes = this.#baseline === null ? [] : changesFrom(this.#baseline, after);
    const baseline = this.#baseline === null || changes.length > 0 ? after : this.#baseline;
    const changed: WeatherChanged | undefined = changes.length === 0 ? undefined : {revision: next.revision, observedAtMs, changes, words: observation.words};
    await this.#publish(next, baseline, changed);
  }

  async #unavailable(reason: UnavailableReason): Promise<void> {
    // A repeated fault publishes nothing: a record that only ages changed nothing, and a sync still reports its age.
    if (this.#state.status === 'unavailable' && this.#state.reason === reason) return;
    const {observedAtMs} = this.#state;
    await this.#publish({id: WEATHER_ID, revision: this.#state.revision + 1, status: 'unavailable', reason, observedAtMs, ageMs: this.#age(observedAtMs)}, this.#baseline);
  }

  async #publish(state: WeatherState, baseline: Baseline | null, changed?: WeatherChanged): Promise<void> {
    try {
      await this.#outbox.transaction(add => {
        this.#store.save(state, baseline);
        add(STATE_KEY, {kind: 'state', type: STATE_TYPE, subject: WEATHER_ID, dataschema: STATE_SCHEMA, data: state});
        if (changed !== undefined) add(CHANGED_KEY, {kind: 'occurrence', type: CHANGED_TYPE, subject: WEATHER_ID, dataschema: CHANGED_SCHEMA, data: changed});
      });
      this.#state = state;
      this.#baseline = baseline;
      if (this.#storageDown) {
        this.#storageDown = false;
        recordLog(this.#context.log, 'operation.completed', {'bunny.operation': 'storage', 'bunny.outcome': Outcome.succeeded});
      }
    } catch {
      // The transaction rolled back, so the published copy stands until the next poll tries again.
      if (this.#storageDown) return;
      this.#storageDown = true;
      recordLog(this.#context.log, 'operation.failed', {'bunny.operation': 'storage', 'bunny.outcome': Outcome.failed, 'bunny.code': 'internal'});
    }
  }
}
