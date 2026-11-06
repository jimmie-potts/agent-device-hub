import type {ArtScheduleNotice, ArtScheduleRecord} from '@jimmie-potts/event-contracts/v2/art-schedule';
import type {OperationRecord} from '@jimmie-potts/event-contracts/v2/families';

export function noticeExpiry(notice: ArtScheduleNotice): number {
  return Math.min(notice.expiresAtMs, notice.startAtMs + 30_000, notice.forecast.staleAtMs, notice.forecast.forecastEndAtMs);
}
/** A new opportunity using the same image still needs its own successful selection. */
export function scheduledArtNotice(record: ArtScheduleRecord | undefined, live: boolean, operations: readonly OperationRecord[], operationsLive: boolean, nowMs: number): ArtScheduleNotice | undefined {
  const notice = record?.notice;
  if (!live || !operationsLive || record === undefined || !record.policy.enabled || !record.policy.browser || !record.policy.weather || record.weather !== 'fresh'
    || record.status === 'unavailable' || notice == null || nowMs < notice.startAtMs || nowMs >= noticeExpiry(notice)
    || notice.forecast.observedAtMs > nowMs || notice.forecast.forecastUpdatedAtMs > notice.forecast.observedAtMs) return undefined;
  const last = record.lastOpportunity;
  if (last?.id !== notice.opportunityId || last.artworkId !== notice.artworkId || last.browserRequestId !== notice.browserRequestId) return undefined;
  const operation = operations.find(value => value.requestId === notice.browserRequestId && value.family === 'art-auto' && value.target === 'art' && value.requestedBy === 'bunny/core');
  return operation?.status === 'completed' && operation.result === 'succeeded' ? notice : undefined;
}
export function noticeMatchesImage(notice: ArtScheduleNotice | undefined, image: {artworkId: string; compositionId: string} | undefined, visibleAndReady: boolean, nowMs: number): notice is ArtScheduleNotice {
  return visibleAndReady && notice !== undefined && image?.artworkId === notice.artworkId && image.compositionId === notice.compositionId
    && nowMs >= notice.startAtMs && nowMs < noticeExpiry(notice);
}
export function forecastTime(notice: ArtScheduleNotice, timeZone: string): string {
  try {return new Intl.DateTimeFormat(undefined, {timeZone, hour: 'numeric', minute: '2-digit'}).format(notice.forecast.forecastStartAtMs);}
  catch {return 'Time unavailable';}
}
