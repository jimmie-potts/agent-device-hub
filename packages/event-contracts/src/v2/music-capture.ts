import type {Message, MessageValidator} from './index.js';
import {defineFamily, registerFamilies, routedSubject} from './registry.js';

export * from './music-capture-data.js';
import {CAPTURE_WINDOW_MS, CAPTURE_VALIDITY_MS, type CaptureFeatures, type CaptureLost} from './music-capture-data.js';

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
  defineFamily('music-capture-endpoint', 'command', 'org.bunny.music-capture.endpoint.requested', endpointSubject, '2.1'),
  defineFamily('music-capture-work', 'command', 'org.bunny.music-capture.work.requested', endpointSubject, '2.1'),
  defineFamily('music-capture-features', 'occurrence', 'org.bunny.music-capture.features.observed', checkFeatures, '2.1'),
  defineFamily('music-capture-control', 'command', 'org.bunny.music-capture.control.requested', musicSubject, '2.1'),
  defineFamily('music-capture-state', 'state', 'org.bunny.music-capture.updated', musicSubject, '2.1'),
] as const;
export function registerMusicCaptureFamilies(validator: MessageValidator): void {registerFamilies(validator, musicCaptureFamilies);}
