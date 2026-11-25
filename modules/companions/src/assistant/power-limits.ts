import type {PowerLimitRecord} from '@jimmie-potts/event-contracts/v2/families';
import {followCopy, Outcome, recordLog, type ModuleContext, type SyncedCopy} from '@jimmie-potts/sdk';

const CORE = 'bunny/core';
const FAMILY = 'power-limit';

/** Undefined means the copy is unavailable. Null means a complete copy has no limit for this plug. */
export function followPowerLimits(context: ModuleContext) {
  let current: SyncedCopy<PowerLimitRecord> | undefined;
  let fresh = false;
  let reportedUnavailable = false;
  const unavailable = (): void => {
    fresh = false;
    if (reportedUnavailable) return;
    reportedUnavailable = true;
    recordLog(context.log, 'message.received', {'bunny.operation': 'status', 'bunny.outcome': Outcome.rejected, 'bunny.code': 'unavailable'});
  };
  const stop = followCopy<PowerLimitRecord>(
    (changed, {onRestarted}) => context.sdk.sync([FAMILY], changed, {owner: CORE, timeoutMs: 5000, onRestarted}),
    {
      changed: change => {
        if (change.type === 'synced') {
          fresh = true;
          reportedUnavailable = false;
        }
      },
      restarted: unavailable,
      current: copy => {current = copy;},
      refused: () => {current = undefined; unavailable();},
    }, context.scheduler,
  );
  return {
    stop: () => {current = undefined; stop();},
    forPlug: (id: string): PowerLimitRecord | null | undefined =>
      fresh && current !== undefined ? current.get({family: FAMILY, id})?.data ?? null : undefined,
  };
}

export function localInstant(timeZone: string): (ms: number) => string {
  const clock = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short',
  });
  return ms => {
    const instant = new Date(ms);
    return `${clock.format(instant)} (${instant.toISOString()})`;
  };
}

const units = [[3_600_000, 'hour'], [60_000, 'minute'], [1000, 'second']] as const;
function duration(ms: number): string {
  const parts: string[] = [];
  let remaining = ms;
  for (const [size, unit] of units) {
    const count = unit === 'second' ? remaining / size : Math.floor(remaining / size);
    if (count > 0) parts.push(`${String(count)} ${unit}${count === 1 ? '' : 's'}`);
    remaining %= size;
  }
  return parts.join(' ');
}

const statusText = {
  disabled: 'The limit is disabled.',
  unavailable: 'The limit is unavailable because the Hub has no usable plug observation.',
  off: 'The core recorded the plug off, so no limit is counting down.',
  armed: 'The core reports the limit as armed.',
  'elapsed-unknown': 'The plug’s elapsed on-time is unknown.',
  due: 'The shutoff deadline is already due.',
  attempted: 'The core recorded a shutoff attempt.',
  blocked: 'The shutoff was blocked.',
} satisfies Record<PowerLimitRecord['status'], string>;

const attemptText = {
  intent: 'The Hub recorded its intent to attempt shutoff.',
  receipt: 'The Hub received a shutoff attempt receipt. The receipt alone gives no observed plug power.',
  'not-sent': 'The last shutoff attempt was not sent.',
  uncertain: 'The last shutoff attempt had an uncertain outcome.',
} satisfies Record<NonNullable<PowerLimitRecord['lastAttempt']>['outcome'], string>;

export function describePowerLimit(record: PowerLimitRecord | null | undefined, nowMs: number, instant: (ms: number) => string): string {
  if (record === undefined) return 'The maximum-on limit is unknown while the core limit copy is unsynced.';
  if (record === null) return 'No maximum-on limit has been set for this plug.';
  const lines = [
    `The maximum-on limit is ${record.enabled ? 'enabled' : 'disabled'}, with a duration of ${duration(record.durationMs)}.`,
  ];
  if (record.status !== 'disabled') lines.push(statusText[record.status]);
  if (record.status === 'armed' && record.startedAtMs !== null && record.deadlineMs !== null) {
    const leftMs = record.deadlineMs - nowMs;
    lines.push(`This run started at ${instant(record.startedAtMs)}. Shutoff is due at ${instant(record.deadlineMs)}.`,
      leftMs > 0 ? `Time remaining at this read: about ${duration(Math.ceil(leftMs / 1000) * 1000)}.` : statusText.due);
  }
  if (record.lastAttempt !== null) lines.push(attemptText[record.lastAttempt.outcome]);
  lines.push('Enforcement depends on the Hub running and the plug being reachable.');
  return lines.join(' ');
}
