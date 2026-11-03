// What the weather module publishes (Hub #1418): one synced `weather-state` record and a `weather-changed` occurrence.
// Neither names a place. Vendor text is reduced to the closed vocabulary below before it reaches a field, so a prompt
// built from `words` cannot carry a place name or an instruction from a vendor response.
import {SCHEMA_BASE} from '@jimmie-potts/event-contracts/v2';

export const WEATHER_ID = 'local';
export const STATE_FAMILY = 'weather-state';
export const CHANGED_FAMILY = 'weather-changed';
export const STATE_SCHEMA = `${SCHEMA_BASE}${STATE_FAMILY}/2.0`;
export const CHANGED_SCHEMA = `${SCHEMA_BASE}${CHANGED_FAMILY}/2.0`;
export const STATE_TYPE = 'org.bunny.weather-state.updated';
export const CHANGED_TYPE = 'org.bunny.weather.changed';
export const STATE_KEY = `bunny.state.${STATE_FAMILY}.${WEATHER_ID}`;
export const CHANGED_KEY = `bunny.event.${CHANGED_FAMILY}.${WEATHER_ID}`;

export const CONDITIONS = ['clear', 'clouds', 'fog', 'haze', 'rain', 'thunderstorm', 'snow', 'mixed', 'wind', 'other'] as const;
export type Condition = typeof CONDITIONS[number];
export const DAY_PARTS = ['morning', 'afternoon', 'evening', 'night'] as const;
export type DayPart = typeof DAY_PARTS[number];
export const REASONS = ['starting', 'outage', 'rate-limited', 'outside-coverage', 'malformed', 'stale'] as const;
export type UnavailableReason = typeof REASONS[number];
export const CHANGES = ['condition', 'temperature', 'alerts'] as const;
export type Change = typeof CHANGES[number];
export const SEVERITIES = ['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown'] as const;
export type Severity = typeof SEVERITIES[number];
export const FORECAST_HOURS = 12;
export const MAX_ALERTS = 16;

/** One forecast hour. `likely` is false when the forecast only gives a chance of the condition. */
export type Hour = {
  startAtMs: number;
  endAtMs: number;
  condition: Condition;
  likely: boolean;
  temperatureF: number;
  precipitationPercent: number | null;
  windMph: number | null;
  isDaytime: boolean;
  dayPart: DayPart;
};
/** One active alert: its national event name and severity, never its area, headline, sender or description. */
export type Alert = {event: string; severity: Severity; endsAtMs: number | null};
/**
 * Facts stand only in an `available` record whose `staleAtMs` has not passed; read them through `promptWords`. An
 * `unavailable` record carries no weather at all, only when the last observation was and its age when written.
 * `current` is the forecast for this hour, not a station measurement.
 */
export type WeatherState = {id: string; revision: number} & ({
  status: 'available';
  observedAtMs: number;
  staleAtMs: number;
  ageMs: number;
  forecastUpdatedAtMs: number;
  current: Hour;
  forecast: Hour[];
  alerts: Alert[];
  words: string[];
} | {
  status: 'unavailable';
  reason: UnavailableReason;
  observedAtMs: number | null;
  ageMs: number | null;
});
/** What changed since the last signal, and the words for the conditions now. */
export type WeatherChanged = {revision: number; observedAtMs: number; changes: Change[]; words: string[]};

const WORDS: Readonly<Record<Exclude<Condition, 'clear' | 'other'>, string>> = {clouds: 'cloudy', fog: 'fog', haze: 'haze', rain: 'rain', thunderstorm: 'thunderstorms', snow: 'snow', mixed: 'wintry mix', wind: 'windy'};

/** The prompt words for one hour, such as `rain, 48°F, evening`. A condition outside the vocabulary adds no word. */
export function wordsOf(hour: Hour): string[] {
  const word = hour.condition === 'clear' ? hour.isDaytime ? 'sunny' : 'clear' : hour.condition === 'other' ? undefined : WORDS[hour.condition];
  return [...(word === undefined ? [] : [hour.likely ? word : `chance of ${word}`]), `${hour.temperatureF}°F`, hour.dayPart];
}

/** The words a prompt may state as fact at `nowMs`: none for an unavailable or stale record. */
export function promptWords(state: WeatherState, nowMs: number): string[] {
  return state.status === 'available' && nowMs < state.staleAtMs ? [...state.words] : [];
}
