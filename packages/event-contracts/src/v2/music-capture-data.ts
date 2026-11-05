// Browser-safe Music capture data; server family registration stays in music-capture.ts.
import type {ErrorDetail} from './errors.js';

export const MUSIC_PRODUCER_SOURCE = 'bunny/parts/music-producer';
export const CAPTURE_WINDOW_MS = 100;
export const CAPTURE_MAX_SOURCE_AGE_MS = 250;
export const CAPTURE_MAX_CLOCK_SKEW_MS = 100;
export const CAPTURE_REGISTRATION_SKEW_MS = 50;
export const CAPTURE_CLOCK_DRIFT_MS = 25;
export const CAPTURE_VALIDITY_MS = 400;
export type CaptureInput = 'music';
export type CaptureEndpointControl = {requestId: string} & ({action: 'enable'; input: CaptureInput} | {action: 'disable'});
export type CaptureWork = {requestId: string; operationId: string; generation: string} &
  ({action: 'start'; input: CaptureInput} | {action: 'stop'});
export type CaptureProgress = {operationId: string; generation: string} &
  ({status: 'started' | 'stopped'} | {status: 'failed' | 'uncertain'; error: Pick<ErrorDetail, 'code' | 'retryable'>});
export type CaptureFeatures = {
  generation: string; input: CaptureInput; sequence: number; sampleRateHz: number; channels: 1 | 2; frameCount: number;
  startMonotonicMs: number; endMonotonicMs: number; emittedMonotonicMs: number;
  observedAtMs: number; validUntilMs: number; rms: number; peak: number; clippedFraction: number;
  bands: {bass: number; mid: number; treble: number}; onset: {strength: number; confidence: number}; discontinuity: boolean;
};
export type CaptureLost = {id: string};
export type CaptureControl = {requestId: string; expectedRevision: number} &
  ({action: 'start'; endpointId: string; input: CaptureInput} | {action: 'stop'});
export type CaptureState = {
  id: 'music'; revision: number; endpointId: string | null; availability: 'off' | 'available' | 'unavailable';
  session: {status: 'idle'} | {status: 'starting' | 'active' | 'stale' | 'stopping' | 'unavailable' | 'uncertain';
    generation: string; operationId: string; input: CaptureInput};
};
