// The National Weather Service read (Hub #1418): `/points` once, then the hourly forecast and active alerts. Requests go
// only to the fixed origin, never follow a redirect and carry no trace context. A response is reduced to the published
// vocabulary here, so a place name in `relativeLocation`, `areaDesc`, a headline or a grid path stops at this file.
import {
  FORECAST_HOURS, MAX_ALERTS, SEVERITIES, wordsOf,
  type Alert, type Condition, type DayPart, type Hour, type Severity, type UnavailableReason,
} from './contracts.js';
import type {WeatherConfig} from './configuration.js';

export type FetchLike = (url: string, init: {headers: Record<string, string>; redirect: 'error'; signal: AbortSignal}) => Promise<Response>;
export type Observation = {forecastUpdatedAtMs: number; current: Hour; forecast: Hour[]; alerts: Alert[]; words: string[]};
export const ORIGIN = 'https://api.weather.gov';
const MAX_BYTES = 2 * 1024 * 1024;
/** How old the service's own forecast may be before it is no longer a claim about today. */
export const STALE_FORECAST_MS = 24 * 3_600_000;
const HOURLY_PATH = /^\/gridpoints\/[A-Z]{3}\/\d{1,4},\d{1,4}\/forecast\/hourly$/;
const LOCAL_TIME = /^\d{4}-\d{2}-\d{2}T(\d{2}):\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const EVENT = /^[A-Za-z][A-Za-z -]{0,63}$/;

/** Why a read gave no observation. `retryAfterMs` is the service's own request to wait. */
export class WeatherFault extends Error {
  constructor(readonly reason: UnavailableReason, readonly retryAfterMs?: number) {
    super(`weather read: ${reason}`);
    this.name = 'WeatherFault';
  }
}
const malformed = (): WeatherFault => new WeatherFault('malformed');
const record = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw malformed();
  return value as Record<string, unknown>;
};
const instant = (value: unknown): number => {
  const parsed = typeof value === 'string' && LOCAL_TIME.test(value) ? Date.parse(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw malformed();
  return parsed;
};

/** Sorts one NWS short forecast into the closed vocabulary, most consequential first. Unknown text is `other`, not a guess. */
export function conditionOf(text: string): Condition {
  const value = text.toLowerCase();
  return /thunder|t-storm/.test(value) ? 'thunderstorm'
    : /freezing|sleet|wintry|\bmix\b|rain and snow|snow and rain/.test(value) ? 'mixed'
    : /snow|flurr|blizzard/.test(value) ? 'snow'
    : /rain|shower|drizzle/.test(value) ? 'rain'
    : /fog/.test(value) ? 'fog'
    : /haze|smoke|dust|ash\b/.test(value) ? 'haze'
    : /wind|breez|blust/.test(value) ? 'wind'
    : /cloud|overcast|partly sunny/.test(value) ? 'clouds'
    : /sunny|clear|fair/.test(value) ? 'clear'
    : 'other';
}
const PRECIPITATION: readonly Condition[] = ['rain', 'thunderstorm', 'snow', 'mixed'];
const tentative = (text: string): boolean => /\b(?:slight chance|chance|isolated|scattered|possible)\b/i.test(text);
function dayPartOf(startTime: string): DayPart {
  const hour = Number(LOCAL_TIME.exec(startTime)?.[1]);
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  return hour >= 17 && hour < 21 ? 'evening' : 'night';
}
function hourOf(value: Record<string, unknown>, startAtMs: number, endAtMs: number): Hour {
  const {shortForecast: text, temperature, temperatureUnit, isDaytime, startTime, probabilityOfPrecipitation, windSpeed} = value;
  if (typeof text !== 'string' || typeof temperature !== 'number' || !Number.isInteger(temperature) || temperature < -130 || temperature > 150 || temperatureUnit !== 'F' || typeof isDaytime !== 'boolean') throw malformed();
  const condition = conditionOf(text);
  const chance = probabilityOfPrecipitation === undefined || probabilityOfPrecipitation === null ? null : record(probabilityOfPrecipitation).value ?? null;
  if (chance !== null && (typeof chance !== 'number' || !Number.isInteger(chance) || chance < 0 || chance > 100)) throw malformed();
  const wind = typeof windSpeed === 'string' ? /^(?:\d{1,3} to )?(\d{1,3}) mph$/.exec(windSpeed)?.[1] : undefined;
  return {startAtMs, endAtMs, condition, likely: !(PRECIPITATION.includes(condition) && tentative(text)), temperatureF: temperature,
    precipitationPercent: chance, windMph: wind === undefined ? null : Math.min(300, Number(wind)), isDaytime, dayPart: dayPartOf(startTime as string)};
}
const severityOf = (value: unknown): Severity => SEVERITIES.find(severity => severity === value) ?? 'Unknown';

export function parseHourly(body: unknown, nowMs: number): Omit<Observation, 'alerts'> {
  const properties = record(record(body).properties);
  if (!Array.isArray(properties.periods)) throw malformed();
  const forecastUpdatedAtMs = instant(properties.updateTime);
  const hours: Hour[] = [];
  for (const item of properties.periods as unknown[]) {
    const period = record(item), startAtMs = instant(period.startTime), endAtMs = instant(period.endTime);
    if (endAtMs <= startAtMs) throw malformed();
    if (endAtMs <= nowMs) continue;
    hours.push(hourOf(period, startAtMs, endAtMs));
    if (hours.length > FORECAST_HOURS) break;
  }
  const [current, ...forecast] = hours;
  if (current === undefined || current.startAtMs > nowMs || nowMs - forecastUpdatedAtMs > STALE_FORECAST_MS) throw new WeatherFault('stale');
  return {forecastUpdatedAtMs, current, forecast, words: wordsOf(current)};
}
export function parseAlerts(body: unknown): Alert[] {
  const {features} = record(body);
  if (!Array.isArray(features)) throw malformed();
  const alerts = (features as unknown[]).map(feature => {
    const {event, severity, ends, expires, status} = record(record(feature).properties);
    if (typeof event !== 'string' || !EVENT.test(event)) throw malformed();
    const end = ends ?? expires;
    return {status, alert: {event, severity: severityOf(severity), endsAtMs: end === undefined || end === null ? null : instant(end)}};
  }).filter(({status}) => status === undefined || status === 'Actual').map(({alert}) => alert);
  const rank = (alert: Alert): number => SEVERITIES.indexOf(alert.severity);
  return alerts.sort((a, b) => rank(a) !== rank(b) ? rank(a) - rank(b) : a.event < b.event ? -1 : a.event > b.event ? 1 : 0).slice(0, MAX_ALERTS);
}

export class NwsClient {
  readonly #point: string;
  readonly #headers: Record<string, string>;
  readonly #fetch: FetchLike;
  /** The hourly forecast path `/points` named. The service asks clients to keep it; a 404 forgets it. */
  #hourly: string | undefined;

  constructor(config: WeatherConfig, fetchLike: FetchLike) {
    // The service redirects a coordinate with more than four decimals, and this client follows no redirect.
    this.#point = `${config.latitude.toFixed(4)},${config.longitude.toFixed(4)}`;
    this.#headers = {'User-Agent': `bunny-weather/0.1 (${config.contact})`, Accept: 'application/geo+json'};
    this.#fetch = fetchLike;
  }

  async read(nowMs: number, signal: AbortSignal): Promise<Observation> {
    this.#hourly ??= await this.#points(signal);
    let hourly: unknown;
    try {
      hourly = await this.#json(`${ORIGIN}${this.#hourly}?units=us`, signal);
    } catch (error) {
      if (error instanceof NotFound) {
        this.#hourly = undefined;
        throw new WeatherFault('outage');
      }
      throw error;
    }
    const forecast = parseHourly(hourly, nowMs);
    let alerts: unknown;
    try {
      alerts = await this.#json(`${ORIGIN}/alerts/active?point=${this.#point}&status=actual`, signal);
    } catch (error) {
      if (error instanceof NotFound) throw new WeatherFault('outage');
      throw error;
    }
    return {...forecast, alerts: parseAlerts(alerts)};
  }

  async #points(signal: AbortSignal): Promise<string> {
    let body: unknown;
    try {
      body = await this.#json(`${ORIGIN}/points/${this.#point}`, signal);
    } catch (error) {
      if (error instanceof NotFound) throw new WeatherFault('outside-coverage');
      throw error;
    }
    const {forecastHourly} = record(record(body).properties);
    // A point the service knows but does not forecast, such as one offshore.
    if (forecastHourly === null) throw new WeatherFault('outside-coverage');
    if (typeof forecastHourly !== 'string') throw malformed();
    let url: URL;
    try {
      url = new URL(forecastHourly);
    } catch {
      throw malformed();
    }
    if (url.origin !== ORIGIN || url.search !== '' || url.username !== '' || url.password !== '' || !HOURLY_PATH.test(url.pathname)) throw malformed();
    return url.pathname;
  }

  async #json(url: string, signal: AbortSignal): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#fetch(url, {headers: this.#headers, redirect: 'error', signal});
    } catch {
      // An error from fetch may quote the URL, so it goes no further.
      throw new WeatherFault('outage');
    }
    if (response.status === 429) {
      const after = response.headers.get('retry-after');
      throw new WeatherFault('rate-limited', after !== null && /^\d{1,6}$/.test(after) ? Number(after) * 1000 : undefined);
    }
    if (response.status === 404) throw new NotFound();
    if (response.status !== 200) throw new WeatherFault('outage');
    const text = await bounded(response);
    try {
      return JSON.parse(text);
    } catch {
      throw malformed();
    }
  }
}
class NotFound extends Error {}

async function bounded(response: Response): Promise<string> {
  if (response.body === null) throw malformed();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      let next: Awaited<ReturnType<typeof reader.read>>;
      try {
        next = await reader.read();
      } catch {
        throw new WeatherFault('outage');
      }
      if (next.done) break;
      size += next.value.length;
      if (size > MAX_BYTES) throw malformed();
      chunks.push(next.value);
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
  try {
    return new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks));
  } catch {
    throw malformed();
  }
}
