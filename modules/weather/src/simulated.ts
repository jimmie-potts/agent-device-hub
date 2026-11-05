// Synthetic National Weather Service responses in the service's own shape. A simulated run and the tests read these and
// reach no network. Every place below is invented, so a test can assert that none of it leaves the client.
import type {Clock} from '@jimmie-potts/sdk';
import type {FetchLike} from './client.js';

export const SYNTHETIC_SECTION = Object.freeze({latitude: 12.3456, longitude: -65.4321, contact: 'operator@example.invalid'});
export const SYNTHETIC_HOURLY_PATH = '/gridpoints/XXX/12,34/forecast/hourly';
export const SYNTHETIC_PLACES = Object.freeze(['Synthville', 'XXX/12,34', 'Fictional County', 'NWS Fictional Office']);
const HOUR_MS = 3_600_000;
const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, '-00:00');

export type SyntheticHour = {shortForecast?: string; temperature?: number; precipitation?: number | null};
export const pointsBody = (): object => ({type: 'Feature', properties: {cwa: 'XXX', gridId: 'XXX', gridX: 12, gridY: 34,
  forecastHourly: `https://api.weather.gov${SYNTHETIC_HOURLY_PATH}`, timeZone: 'Etc/Fictional',
  relativeLocation: {properties: {city: 'Synthville', state: 'XX'}}}});
export function hourlyBody(nowMs: number, hours: readonly SyntheticHour[] = [{}], updatedAtMs = nowMs - HOUR_MS): object {
  const start = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
  return {type: 'Feature', properties: {units: 'us', updateTime: iso(updatedAtMs), periods: Array.from({length: Math.max(14, hours.length)}, (_, index) => {
    const {shortForecast = 'Mostly Sunny', temperature = 48, precipitation = 5} = hours[Math.min(index, hours.length - 1)] ?? {};
    return {number: index + 1, name: '', startTime: iso(start + index * HOUR_MS), endTime: iso(start + (index + 1) * HOUR_MS), isDaytime: true,
      temperature, temperatureUnit: 'F', probabilityOfPrecipitation: {unitCode: 'wmoUnit:percent', value: precipitation}, windSpeed: '5 to 10 mph', windDirection: 'NW', shortForecast};
  })}};
}
export const alertsBody = (events: readonly string[] = []): object => ({type: 'FeatureCollection', features: events.map(event => ({properties: {
  event, status: 'Actual', severity: 'Moderate', ends: null, expires: '2099-01-01T00:00:00-00:00',
  areaDesc: 'Fictional County', headline: `${event} issued by NWS Fictional Office for Synthville`, senderName: 'NWS Fictional Office', description: 'Synthville should take note.',
}}))});
export const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response => new Response(JSON.stringify(body), {status, headers});

/** Answers the service's three reads with a mild synthetic forecast at the module's clock. */
export const simulatedFetch = (clock: Clock): FetchLike => url => Promise.resolve(
  url.includes('/points/') ? json(pointsBody()) : url.includes('/alerts/') ? json(alertsBody()) : json(hourlyBody(clock.now())));
