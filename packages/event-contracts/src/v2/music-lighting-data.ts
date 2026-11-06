// Browser-safe Music lighting session data (#1272, #722, first-trial policy in #40); server registration is in music-lighting.ts.
import type {ErrorCode} from './errors.js';

/** The capture session a lighting session renders from: the core's current Music endpoint and generation. */
export type LightingCapture = {endpointId: string; generation: string};
/** Why a lighting session ended. None of these resumes automatically; a new session needs an explicit Start. */
export const LIGHTING_END_REASONS = ['stopped', 'alert', 'manual', 'source-lost', 'device', 'restart', 'expired', 'refused'] as const;
export type LightingEndReason = typeof LIGHTING_END_REASONS[number];
/** What happened to the current base presentation as the session ended, evaluated at that moment; `uncertain` when a restoration write's answer was lost. */
export const LIGHTING_RESTORATIONS = ['restored', 'skipped', 'none', 'uncertain'] as const;
export type LightingRestoration = typeof LIGHTING_RESTORATIONS[number];
/** `code` names the refusal or failure behind a `refused`, `expired` or `device` ending when one was reported. */
export type LightingEnded = {generation: string; reason: LightingEndReason; restoration: LightingRestoration; atMs: number; code?: ErrorCode};

/** Operator to core, subject the target light. Start never changes the light's mode. */
export type LightingControl = {requestId: string; expectedRevision: number} &
  ({action: 'start'; capture: LightingCapture; presetId: string} | {action: 'stop'});

/** Core to the light's own module, subject the target light. `generation` is the core's session generation. */
export type LightingWork = {requestId: string; generation: string} &
  ({action: 'start'; capture: LightingCapture; presetId: string} | {action: 'stop'});

export const LIGHTING_STATUSES = ['starting', 'active', 'stopping', 'uncertain'] as const;
export type LightingStatus = typeof LIGHTING_STATUSES[number];
/** The core's record per target light: the session it last authorized and the last ending it observed. */
export type LightingState = {
  id: string; revision: number;
  session: {status: 'idle'} | {status: LightingStatus; generation: string; operationId: string; capture: LightingCapture; presetId: string; startedAtMs: number};
  last: LightingEnded | null;
};

/** The device module's own record per light: what its single writer is doing for the latest session it admitted. */
export type LightingDeviceState = {
  id: string; revision: number;
  session: null | {generation: string; status: 'starting' | 'playing'} | {generation: string; status: 'ended'; ended: LightingEnded};
};
