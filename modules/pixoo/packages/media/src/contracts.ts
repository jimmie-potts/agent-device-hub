export const canvasSize = { width: 64, height: 64 } as const;
export const RENDERER_VERSION = 'rgb64-v1-sharp0.35.4-gifuct2.1.2';
export type MediaErrorCode = 'invalid-input' | 'unsupported' | 'upload-limit' | 'pixel-limit' | 'profile-limit' | 'busy' | 'timeout' | 'cancelled' | 'decode-failed' | 'cache-corrupt' | 'storage-error';
export class MediaError extends Error {
  constructor(readonly code: MediaErrorCode) { super(code); this.name = 'MediaError'; }
}
export interface Transform { fit: 'fit' | 'crop'; scaling: 'nearest' | 'smooth'; background: readonly [number, number, number] }
export const DEFAULT_TRANSFORM: Readonly<Transform> = Object.freeze({ fit: 'fit', scaling: 'nearest', background: Object.freeze([0,0,0] as const) });
export interface MediaProfile {
  name: string; evidence: 'provisional-simulator' | 'observed-device'; reference: string;
  maxFrames: number; minDelayMs: number; maxDelayMs: number; uniformTiming: boolean;
}
export const SIMULATOR_PROFILE: Readonly<MediaProfile> = Object.freeze({ name: 'simulator-v1', evidence: 'provisional-simulator', reference: 'Application safeguards; no device claim', maxFrames: 500, minDelayMs: 10, maxDelayMs: 655350, uniformTiming: false });
export const PIXOO64_SMOKE_PROFILE: Readonly<MediaProfile> = Object.freeze({ name: 'pixoo64-smoke-2026-09-06', evidence: 'observed-device', reference: 'https://github.com/jimmie-potts/divoom-app-upgrade/issues/4#issuecomment-5562714620; firmware unknown; loading screens observed', maxFrames: 2, minDelayMs: 500, maxDelayMs: 500, uniformTiming: true });
export const PIXOO64_GIF_PROFILE: Readonly<MediaProfile> = Object.freeze({ name: 'pixoo64-gif-2026-10-01', evidence: 'observed-device', reference: 'https://github.com/jimmie-potts/divoom-app-upgrade/issues/55; October 1 video: 20 frames, final requested delay acts uniformly at 100/500/800 ms; uniform 100-800 ms admission envelope; firmware unknown; transitions unresolved', maxFrames: 20, minDelayMs: 100, maxDelayMs: 800, uniformTiming: true });
export const PIXOO64_HOSTED_PROFILE: Readonly<MediaProfile> = Object.freeze({name:'pixoo64-hosted-2026-10-01',evidence:'observed-device',reference:'https://github.com/jimmie-potts/divoom-app-upgrade/issues/55; hosted observations: 20x100 ms, 100x50 ms, 500x60 ms; uniform 50-800 ms centisecond admission envelope, at most 256 global colors; firmware unknown; readiness estimated',maxFrames:500,minDelayMs:50,maxDelayMs:800,uniformTiming:true});
export const DEVICE_PROFILES: readonly Readonly<MediaProfile>[] = Object.freeze([PIXOO64_SMOKE_PROFILE,PIXOO64_GIF_PROFILE,PIXOO64_HOSTED_PROFILE]);
export interface MediaLimits { maxUploadBytes: number; maxSourcePixels: number; concurrency: number; maxQueued: number; timeoutMs: number }
export const DEFAULT_LIMITS: Readonly<MediaLimits> = Object.freeze({ maxUploadBytes: 10 * 1024 * 1024, maxSourcePixels: 50_000_000, concurrency: 1, maxQueued: 4, timeoutMs: 30_000 });
export interface MediaSource { format: 'png' | 'jpeg' | 'gif'; width: number; height: number; frameCount: number; delaysMs: (number | null)[]; durationMs: number | null }
export interface TimingWarning { frame: number; code: 'missing-delay' | 'zero-delay'; effectiveDelayMs: 100 }
export interface RenderedMedia { source: MediaSource; frames: { rgb: Buffer; preview: Buffer; delayMs: number | null }[]; warnings: TimingWarning[] }
export interface Rendition {
  id: string; sourceHash: string; renderer: string; transform: Transform; profile: MediaProfile;
  source: MediaSource; warnings: TimingWarning[]; effectiveDurationMs: number | null;
  frames: { index: number; delayMs: number | null; rgbHash: string; previewHash: string }[];
}
export function positive(value: number, max: number): boolean { return Number.isSafeInteger(value) && value > 0 && value <= max; }
export function canonicalTransform(t: Transform): Transform {
  if (!t || !['fit','crop'].includes(t.fit) || !['nearest','smooth'].includes(t.scaling) || !Array.isArray(t.background) || t.background.length !== 3 ||
    !Array.from(t.background).every(n => Number.isInteger(n) && n >= 0 && n <= 255)) throw new MediaError('invalid-input');
  return { fit: t.fit, scaling: t.scaling, background: [t.background[0], t.background[1], t.background[2]] };
}
export function canonicalProfile(p: MediaProfile): MediaProfile {
  if (!p || typeof p.name !== 'string' || !p.name.length || p.name.length > 128 || typeof p.reference !== 'string' || !p.reference.length || p.reference.length > 1024 ||
    !['provisional-simulator','observed-device'].includes(p.evidence) || !positive(p.maxFrames, 1000) || !positive(p.minDelayMs, 655350) || !positive(p.maxDelayMs, 655350) ||
    p.maxDelayMs < p.minDelayMs || typeof p.uniformTiming !== 'boolean') throw new MediaError('invalid-input');
  const result = { name: p.name, evidence: p.evidence, reference: p.reference, maxFrames: p.maxFrames, minDelayMs: p.minDelayMs, maxDelayMs: p.maxDelayMs, uniformTiming: p.uniformTiming };
  // Observed profiles must identify the exact evidence and bounds shipped by this renderer.
  if (p.evidence === 'observed-device' && !DEVICE_PROFILES.some(profile=>JSON.stringify(result)===JSON.stringify(profile))) throw new MediaError('invalid-input');
  return result;
}
export function canonicalLimits(l: Partial<MediaLimits> = {}): MediaLimits {
  const v = { ...DEFAULT_LIMITS, ...l };
  if (!positive(v.maxUploadBytes, 100 * 1024 * 1024) || !positive(v.maxSourcePixels, 100_000_000) || !positive(v.concurrency, 4) ||
    !Number.isInteger(v.maxQueued) || v.maxQueued < 0 || v.maxQueued > 16 || !positive(v.timeoutMs, 120_000)) throw new MediaError('invalid-input');
  return v;
}
