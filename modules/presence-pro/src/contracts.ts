import type {Known, Unknown} from '@jimmie-potts/event-contracts/v2';
import {SCHEMA_BASE} from '@jimmie-potts/event-contracts/v2/errors';

export const FAMILY = 'presence-observation';
export const SCHEMA = `${SCHEMA_BASE}${FAMILY}/2.0`;
export const TYPE = 'org.bunny.presence-observation.updated';
export const SOURCE = 'bunny/modules/presence-pro';
export const keyOf = (id: string): string => `bunny.state.${FAMILY}.${id}`;
export type Tagged<T> = Known<T> | Unknown;
export const unknown = (): Unknown => ({status: 'unknown'});
export const known = <T>(value: T): Known<T> => ({status: 'known', value});
/** Receipt time only. Initial subscriptions can return old firmware-cached values. */
export type Report<T> = {value: T; receivedAtMs: Tagged<number>};
export type Occupancy = 'occupied' | 'vacant' | 'unknown';
export type Target = {
  slot: number;
  active: Report<Tagged<boolean>>;
  rawMm: {x: Tagged<number>; y: Tagged<number>; xReceivedAtMs: Tagged<number>; yReceivedAtMs: Tagged<number>};
  apartmentMeters: Tagged<{x: number; z: number}>;
  calibrationRevision: Tagged<number>;
};
/** Latest same-connection scalar reports, never a frame, sample-age or identity claim. */
export type PresenceObservation = {
  id: string; sensorId: string; revision: number; roomId: string; mappingRevision: number;
  connection: 'starting' | 'connected' | 'disconnected';
  reason: 'starting' | 'none' | 'unavailable' | 'unsupported-capability' | 'forbidden' | 'invalid-message';
  occupancy: Report<Occupancy>;
  zones: {id: string; roomId: string; value: Occupancy; receivedAtMs: Tagged<number>}[];
  held: Report<Tagged<boolean>>;
  targets: Target[];
};
