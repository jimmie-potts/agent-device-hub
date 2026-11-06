// Browser-safe Music capture data; server family registration stays in music-capture.ts.
import type {ErrorDetail} from './errors.js';

export const MUSIC_PRODUCER_SOURCE = 'bunny/parts/music-producer';
export const CAPTURE_WINDOW_MS = 100;
export const CAPTURE_MAX_SOURCE_AGE_MS = 250;
export const CAPTURE_MAX_CLOCK_SKEW_MS = 100;
export const CAPTURE_REGISTRATION_SKEW_MS = 50;
export const CAPTURE_CLOCK_DRIFT_MS = 25;
export const CAPTURE_VALIDITY_MS = 400;
export type CaptureInput = 'music' | 'microphone';
export type CaptureSelection = {input: 'music'} | {input: 'microphone'; microphoneId: string};
export type CaptureMicrophone = {id: string};
export const CAPTURE_MICROPHONE_ID = /^[A-Za-z0-9_.-]{1,64}$/;
export type CaptureEndpointControl = {requestId: string} & ({action: 'enable'; input: 'music'; microphone?: CaptureMicrophone} | {action: 'disable'});
export type CaptureWork = {requestId: string; operationId: string; generation: string} &
  ({action: 'start'} & CaptureSelection | {action: 'stop'});
export type CaptureProgress = {operationId: string; generation: string} &
  ({status: 'started' | 'stopped'} | {status: 'failed' | 'uncertain'; error: Pick<ErrorDetail, 'code' | 'retryable'>});
export type CaptureFeatures = CaptureSelection & {
  generation: string; sequence: number; sampleRateHz: number; channels: 1 | 2; frameCount: number;
  startMonotonicMs: number; endMonotonicMs: number; emittedMonotonicMs: number;
  observedAtMs: number; validUntilMs: number; rms: number; peak: number; clippedFraction: number;
  bands: {bass: number; mid: number; treble: number}; onset: {strength: number; confidence: number}; discontinuity: boolean;
};
export type CaptureLost = {id: string};
export type CaptureControl = {requestId: string; expectedRevision: number} &
  ({action: 'start'; endpointId: string} & CaptureSelection | {action: 'stop'} |
  {action: 'calibrate'; binding: CaptureResponseBinding} |
  {action: 'cancel-calibration'; binding: CaptureResponseBinding; operationId: string} |
  {action: 'apply-tuning'; expectedSettingsRevision: number; binding: CaptureResponseBinding; settings: CaptureResponseSettings});
export type CaptureState = {
  id: 'music'; revision: number; endpointId: string | null; availability: 'off' | 'available' | 'unavailable';
  microphone?: CaptureMicrophone; response?: CaptureResponseState;
  session: {status: 'idle'} | CaptureSelection & {status: 'starting' | 'active' | 'stale' | 'stopping' | 'unavailable' | 'uncertain';
    generation: string; operationId: string};
};

export type CaptureResponseBinding = {endpointId: string; generation: string; microphoneId: string; sampleRateHz: number; channels: 1 | 2};
export type CaptureResponseSettings = {
  sensitivity: number; smoothingMs: number; emphasis: {bass: number; mid: number; treble: number};
  gate: {mode: 'off'} | {mode: 'manual'; threshold: number} | {mode: 'calibrated'; threshold: number; calibrationId: string};
};
export type CaptureCalibrationReason = 'cancelled' | 'stopped' | 'stale' | 'discontinuity' | 'source-lost' | 'clock' | 'format' | 'clipping' | 'deadline' | 'restart';
export type CaptureCalibration = {status: 'idle'} |
  {status: 'measuring'; operationId: string; binding: CaptureResponseBinding; startedAtMs: number; deadlineAtMs: number} |
  {status: 'ready'; operationId: string} | {status: 'ended'; operationId: string; reason: CaptureCalibrationReason};
export type CaptureCalibrationEvidence = {id: string; binding: CaptureResponseBinding; windowCount: 50;
  startedAtMs: number; endedAtMs: number; sourceDurationMs: 5000; percentileRms: number; maximumRms: number; suggestedThreshold: number};
export type CaptureResponseState = {settingsRevision: number; settings: CaptureResponseSettings; appliedTo: CaptureResponseBinding | null;
  calibration: CaptureCalibration; evidence: CaptureCalibrationEvidence | null};
