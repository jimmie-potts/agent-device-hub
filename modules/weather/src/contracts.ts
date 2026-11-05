// What the weather module publishes (Hub #1418): one synced `weather-state` record and a `weather-changed` occurrence.
// Neither names a place. Vendor text is reduced to the closed vocabularies below before it reaches a field, so no record
// or prompt can carry a place name or an instruction from a vendor response.
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
/** The National Weather Service's national event names. Anything else is published as `GENERIC_ALERT`, never quoted. */
export const ALERT_EVENTS = [
  'Administrative Message', 'Air Quality Alert', 'Air Stagnation Advisory', 'Ashfall Advisory', 'Ashfall Warning', 'Avalanche Advisory', 'Avalanche Warning', 'Avalanche Watch',
  'Beach Hazards Statement', 'Blizzard Warning', 'Blowing Dust Advisory', 'Blowing Dust Warning', 'Blue Alert', 'Brisk Wind Advisory', 'Child Abduction Emergency', 'Civil Danger Warning', 'Civil Emergency Message',
  'Coastal Flood Advisory', 'Coastal Flood Statement', 'Coastal Flood Warning', 'Coastal Flood Watch', 'Cold Weather Advisory', 'Dense Fog Advisory', 'Dense Smoke Advisory', 'Dust Advisory', 'Dust Storm Warning',
  'Earthquake Warning', 'Evacuation Immediate', 'Excessive Heat Warning', 'Excessive Heat Watch', 'Extreme Cold Warning', 'Extreme Cold Watch', 'Extreme Fire Danger', 'Extreme Heat Warning', 'Extreme Heat Watch', 'Extreme Wind Warning',
  'Fire Warning', 'Fire Weather Watch', 'Flash Flood Statement', 'Flash Flood Warning', 'Flash Flood Watch', 'Flood Advisory', 'Flood Statement', 'Flood Warning', 'Flood Watch', 'Freeze Warning', 'Freeze Watch',
  'Freezing Fog Advisory', 'Freezing Spray Advisory', 'Frost Advisory', 'Gale Warning', 'Gale Watch', 'Hard Freeze Warning', 'Hard Freeze Watch', 'Hazardous Materials Warning', 'Hazardous Seas Warning', 'Hazardous Seas Watch', 'Hazardous Weather Outlook',
  'Heat Advisory', 'Heavy Freezing Spray Warning', 'Heavy Freezing Spray Watch', 'High Surf Advisory', 'High Surf Warning', 'High Wind Warning', 'High Wind Watch', 'Hurricane Force Wind Warning', 'Hurricane Force Wind Watch', 'Hurricane Warning', 'Hurricane Watch', 'Hydrologic Outlook',
  'Ice Storm Warning', 'Lake Effect Snow Warning', 'Lake Wind Advisory', 'Lakeshore Flood Advisory', 'Lakeshore Flood Statement', 'Lakeshore Flood Warning', 'Lakeshore Flood Watch', 'Law Enforcement Warning', 'Local Area Emergency', 'Low Water Advisory',
  'Marine Weather Statement', 'Nuclear Power Plant Warning', 'Radiological Hazard Warning', 'Red Flag Warning', 'Rip Current Statement', 'Severe Thunderstorm Warning', 'Severe Thunderstorm Watch', 'Severe Weather Statement', 'Shelter In Place Warning', 'Short Term Forecast',
  'Small Craft Advisory', 'Snow Squall Warning', 'Special Marine Warning', 'Special Weather Statement', 'Storm Surge Warning', 'Storm Surge Watch', 'Storm Warning', 'Storm Watch', 'Tornado Warning', 'Tornado Watch',
  'Tropical Cyclone Local Statement', 'Tropical Storm Warning', 'Tropical Storm Watch', 'Tsunami Advisory', 'Tsunami Warning', 'Tsunami Watch', 'Typhoon Warning', 'Typhoon Watch', 'Volcano Warning',
  'Wind Advisory', 'Wind Chill Advisory', 'Wind Chill Warning', 'Wind Chill Watch', 'Winter Storm Warning', 'Winter Storm Watch', 'Winter Weather Advisory',
] as const;
export const GENERIC_ALERT = 'Weather Alert';
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
/** One active alert: its event from the closed list and its severity, never its area, headline, sender or description. */
export type Alert = {event: typeof ALERT_EVENTS[number] | typeof GENERIC_ALERT; severity: Severity; endsAtMs: number | null};
/**
 * Facts stand only in an `available` record whose `staleAtMs` has not passed; read them through `promptWords` and `forecastWords`. An
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

/** The same words for each forecast hour, so morning art can reflect the day. None for an unavailable or stale record. */
export function forecastWords(state: WeatherState, nowMs: number): {startAtMs: number; words: string[]}[] {
  return state.status === 'available' && nowMs < state.staleAtMs ? state.forecast.map(hour => ({startAtMs: hour.startAtMs, words: wordsOf(hour)})) : [];
}
