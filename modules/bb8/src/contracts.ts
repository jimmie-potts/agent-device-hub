/** Pure BB-8 link contract shared with the Windows owner. Never contains native handles or an address. */
import {SCHEMA_BASE} from '@jimmie-potts/event-contracts/v2/errors';
import type {ErrorDetail} from '@jimmie-potts/event-contracts/v2';
export const MODULE_SOURCE = 'bunny/modules/bb8';
export const HELPER_SOURCE = 'bunny/parts/bb8-windows';
export const PUBLIC_FAMILIES = ['bb8-connect', 'bb8-disconnect', 'bb8-wake', 'bb8-led-set', 'bb8-power-refresh', 'bb8-aim', 'bb8-step', 'bb8-stop'] as const;
export type PublicFamily = typeof PUBLIC_FAMILIES[number];
export type Led = {target: 'main'; rgb: [number, number, number]} | {target: 'tail'; brightness: number};
export type Direction = 'forward' | 'right' | 'back' | 'left';
export type Step = {direction: Direction; speed: number; durationMs: number; forwardReference: string};
export const MOTION = {maxSpeed: 32, minDurationMs: 100, maxDurationMs: 500, uiSpeed: 20, uiDurationMs: 300} as const;
export const HEADINGS: Readonly<Record<Direction, number>> = {forward: 0, right: 90, back: 180, left: 270};
export type Operation = {kind: 'connect'} | {kind: 'disconnect'} | {kind: 'wake'} | {kind: 'power-refresh'} | {kind: 'led-set'; led: Led} | {kind: 'aim'; action: 'set' | 'clear'} | ({kind: 'step'} & Step) | {kind: 'stop'};
export type Guards = {expectedConfigurationRevision: number; expectedHelperEpoch: string; expectedConnectionGeneration: number};
export type PublicRequest = Guards & {requestId: string; led?: Led; action?: 'set' | 'clear'; step?: Step};
export type LinkRequest = Guards & {requestId: string; operationId: string; parentRequestId: string; operationExpiresAtMs: number; operation: Operation};
export type RecordedRequest = {requestId: string; operationId: string};
export type Power = {recordVersion: 1; category: 1 | 2 | 3 | 4; voltageHundredths: number; rechargeCount: number; secondsAwakeSinceRecharge: number; observedAtMs: number};
export type Version = {bytes: [number, number, number, number, number, number, number, number]; observedAtMs: number};
export type LinkState = {id: string; revision: number; configurationRevision: number; helperEpoch: string; connectionGeneration: number; connection: 'disconnected' | 'connected' | 'unavailable'; changedAtMs: number; forwardReference?: string};
export type LinkResult = {
  id: string; revision: number; robotId: string; parentRequestId: string; helperEpoch: string; connectionGeneration: number;
  requestId: string; result: 'succeeded' | 'failed' | 'uncertain'; evidence: 'none' | 'transmitted' | 'observed';
  completedAtMs: number; error?: ErrorDetail; power?: Power; version?: Version;
};
export type Unknown = {status: 'unknown'};
export type Known<T> = {status: 'known'; value: T};
export type LinkProjection = Pick<LinkState, 'helperEpoch' | 'connectionGeneration' | 'connection' | 'changedAtMs' | 'forwardReference'>;
export type RobotState = {
  id: string; revision: number; configurationRevision: number; link: Unknown | Known<LinkProjection>; linkLive: boolean;
  desiredLed: Unknown | Known<Led>; physicalLed: Unknown; power: Unknown | Known<Power>;
  held?: {requestId: string; heldAtMs: number};
  lastResult: Unknown | Known<Pick<LinkResult, 'result' | 'evidence' | 'completedAtMs'>>;
};
export const BOUNDS = {maxPending: 8, maxResults: 64, maxCollectorBytes: 1024, writeBytes: 20, spacingMs: 60, connectMs: 15_000, responseMs: 2000, operationMs: 5000} as const;
export const schemaOf = (family: string): string => `${SCHEMA_BASE}${family}/2.0`;
/** SDK last-verb mapping. */
export function commandType(family: string): string {
  const at = family.lastIndexOf('-');
  return `org.bunny.${family.slice(0, at)}.${family.slice(at + 1)}.requested`;
}
export const completedType = (family: string): string => commandType(family).replace(/\.requested$/, '.completed');
