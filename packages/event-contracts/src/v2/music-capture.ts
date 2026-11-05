import type {ErrorDetail, Message, MessageValidator} from './index.js';
import {defineFamily, registerFamilies, routedSubject} from './registry.js';

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

const endpointSubject = routedSubject('routing');
const musicSubject = (message: Message): string | undefined => message.subject === 'music' ? undefined : 'envelope /subject must be music';
function checkFeatures(message: Message): string | undefined {
  const subject = endpointSubject(message);
  if (subject !== undefined) return subject;
  // The family registry invokes this check only after its closed JSON schema passes.
  const frame = message.data as CaptureFeatures;
  if (frame.frameCount * 1000 !== frame.sampleRateHz * CAPTURE_WINDOW_MS)
    return 'payload /frameCount must cover one hundred milliseconds';
  if (Math.abs(frame.endMonotonicMs - frame.startMonotonicMs - CAPTURE_WINDOW_MS) > 0.01)
    return 'payload source window must cover one hundred milliseconds';
  if (frame.emittedMonotonicMs < frame.endMonotonicMs)
    return 'payload emission must follow the source window';
  if (frame.validUntilMs - frame.observedAtMs !== CAPTURE_VALIDITY_MS)
    return 'payload validity must reserve the declared clock-skew bound';
  if (frame.rms > frame.peak + 1e-12) return 'payload RMS must not exceed peak';
  return undefined;
}

export const musicCaptureFamilies = [
  defineFamily('music-capture-endpoint', 'command', 'org.bunny.music-capture.endpoint.requested', endpointSubject),
  defineFamily('music-capture-work', 'command', 'org.bunny.music-capture.work.requested', endpointSubject),
  defineFamily('music-capture-progress', 'occurrence', 'org.bunny.music-capture.progress.observed', endpointSubject),
  defineFamily('music-capture-features', 'occurrence', 'org.bunny.music-capture.features.observed', checkFeatures),
  defineFamily('music-capture-lost', 'occurrence', 'org.bunny.music-capture.endpoint-lost', message =>
    message.subject === (message.data as CaptureLost).id ? undefined : 'envelope /subject must name the lost endpoint'),
  defineFamily('music-capture-control', 'command', 'org.bunny.music-capture.control.requested', musicSubject),
  defineFamily('music-capture-state', 'state', 'org.bunny.music-capture.updated', musicSubject),
] as const;
export function registerMusicCaptureFamilies(validator: MessageValidator): void {registerFamilies(validator, musicCaptureFamilies);}
