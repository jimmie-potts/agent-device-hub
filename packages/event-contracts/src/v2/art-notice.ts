import {errorBody, type ErrorBody} from './errors.js';

/** Fixed forecast evidence from the qualified weather owner. It contains no location or free text. */
export type RainNotice = {
  kind: 'rain-forecast'; likelihood: 'chance' | 'likely';
  forecastStartAtMs: number; forecastEndAtMs: number; forecastUpdatedAtMs: number;
  observedAtMs: number; staleAtMs: number; weatherRevision: number;
};

/** Cross-field checks after the closed schema has validated every member. */
export function rainNoticeIssue(notice: RainNotice, nowMs: number): string | undefined {
  if (notice.forecastUpdatedAtMs > notice.observedAtMs || notice.observedAtMs > nowMs) return 'payload /notice observation or forecast update is in the future';
  if (notice.staleAtMs <= notice.observedAtMs || notice.staleAtMs > notice.observedAtMs + 2_700_000) return 'payload /notice freshness exceeds the weather lifetime';
  if (notice.forecastStartAtMs <= nowMs || notice.forecastStartAtMs > nowMs + 7_200_000
    || notice.forecastEndAtMs <= notice.forecastStartAtMs || notice.forecastEndAtMs > notice.forecastStartAtMs + 3_600_000)
    return 'payload /notice must name one future forecast hour within two hours';
  return undefined;
}

/** Recheck at admission and immediately before a queued first write. This is no observation of pixels. */
export function rainNoticeRefusal(notice: RainNotice | undefined, timing: {startAtMs: number; toleranceMs: number; durationMs: number}, nowMs: number): ErrorBody | undefined {
  if (notice === undefined) return undefined;
  const until = Math.min(notice.staleAtMs, notice.forecastEndAtMs);
  return nowMs >= until || Math.max(nowMs, timing.startAtMs + timing.toleranceMs) + timing.durationMs > until
    ? errorBody('invalid-state', {detail: 'rain forecast evidence cannot cover this presentation'}) : undefined;
}

/** The renderer's two fixed native-size lines, using the runtime host's existing local clock zone. */
export function rainNoticeLines(notice: RainNotice): readonly [string, string] {
  const at = new Date(notice.forecastStartAtMs), hour = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  return ['RAIN FORECAST', `${notice.likelihood === 'likely' ? 'LIKELY' : 'CHANCE'} ${hour}`];
}
