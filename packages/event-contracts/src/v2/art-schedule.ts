import type {ErrorCode} from './errors.js';
import type {RainNotice} from './art-notice.js';

export const ART_SCHEDULE_SCHEMA = 'https://bunny.invalid/events/art-schedule/2.0';

/** One core-owned policy; all times use the runtime's existing host-local zone. */
export type ArtSchedulePolicy = {
  enabled: boolean; wakingStartMinute: number; wakingEndMinute: number; appearances: 6 | 7 | 8;
  targets: string[]; browser: boolean; ambient: boolean; generation: boolean; weather: boolean; coversStatus: boolean;
};
export type ArtScheduleWrite = {expectedSettingsRevision: number; policy: ArtSchedulePolicy};
export type ArtSuppression = 'disabled' | 'quiet-hours' | 'attention' | 'no-flourishes' | 'spacing' | 'budget'
  | 'no-art' | 'expired' | 'policy-changed' | 'source-unavailable' | 'no-surfaces' | 'unavailable';
export type ArtOpportunity = {id: string; kind: 'appearance' | 'ambient'; startAtMs: number; toleranceMs: number};
export type ArtScheduleAttempt = ArtOpportunity & {
  artworkId: string | null; reason: ArtSuppression | null; generationRequestId: string | null;
  browserRequestId: string | null;
  displays: {target: string; prepareRequestId: string | null; momentRequestId: string | null; error: ErrorCode | null}[];
};
/** The matching selection outcome and actual decoded-visible image are both required before showing this label. */
export type ArtScheduleNotice = {
  opportunityId: string; artworkId: string; compositionId: string; browserRequestId: string;
  startAtMs: number; expiresAtMs: number; forecast: RainNotice;
};
/** Bounded projection on bunny.state.art-schedule.art. Operation records remain the outcome authority. */
export type ArtScheduleRecord = {
  id: 'art'; revision: number; settingsRevision: number; policy: ArtSchedulePolicy; timeZone: string;
  status: 'disabled' | 'idle' | 'waiting' | 'preparing' | 'presenting' | 'unavailable';
  weather: 'disabled' | 'unavailable' | 'fresh' | 'stale';
  nextOpportunity: ArtOpportunity | null; lastOpportunity: ArtScheduleAttempt | null; notice: ArtScheduleNotice | null;
};
