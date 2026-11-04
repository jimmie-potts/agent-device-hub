import {errorBody} from '@jimmie-potts/event-contracts/v2';
import type {Configure} from '@jimmie-potts/sdk';

/** The private section. The coordinates and contact go only to the weather service, in its URLs and User-Agent. */
export type WeatherConfig = {latitude: number; longitude: number; contact: string};
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const within = (value: unknown, limit: number): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
// A fixed sentence: a refusal never quotes a coordinate.
const invalid = () => errorBody('invalid-request', {detail: 'weather needs a latitude, a longitude and a contact for the National Weather Service User-Agent'});
export const configureWeather: Configure<WeatherConfig> = section => {
  if (!object(section) || Object.keys(section).some(key => !['latitude', 'longitude', 'contact'].includes(key))) return invalid();
  const {latitude, longitude, contact} = section;
  if (!within(latitude, 90) || !within(longitude, 180) || typeof contact !== 'string' || !/^[A-Za-z0-9@._+:/-]{3,128}$/.test(contact)) return invalid();
  return {config: {latitude, longitude, contact}};
};
