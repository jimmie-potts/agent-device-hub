import type {CatalogBinding} from '@jimmie-potts/event-contracts/v2/assistant-actions';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import {Outcome, type ModuleContext, type SyncedCopy, type TraceContext} from '@jimmie-potts/sdk';

export const IN_TURN_CONFIRMATION_MS = 1000;
export const CONFIRMATION_LIFETIME_MS = 86_400_000;

export type Confirmation = {
  requestId: string; taskId: string; questionId: string; binding: Extract<CatalogBinding, {kind: 'device'}>;
  percent: number; label: string; acceptedAtMs: number; expiresAtMs: number; traceparent: string;
  sent?: true; result?: string; follows?: string;
};

export function unavailable(watch: Confirmation): string {
  return watch.sent === true ? `Brightness command sent. I couldn’t confirm ${watch.label}’s brightness.`
    : `I couldn’t confirm the brightness request for ${watch.label}.`;
}

export function pending(watch: Confirmation): string {
  const sent = watch.sent === true ? 'Brightness command sent.' : 'Brightness request accepted.';
  return `${sent} I’ll update this reply when confirmation for ${watch.label} is available.`;
}

/** Combines the core's decision about a tracked operation with the exact owner's reading. */
export function confirmationEvidence(watch: Confirmation, operation: OperationRecord | undefined, device: DeviceRecord | undefined,
  requestedBy: string): {sent?: true; result?: string} {
  if (operation?.requestId !== watch.requestId || operation.requestedBy !== requestedBy ||
      operation.target !== watch.binding.target || operation.family !== 'brightness-set') return {};
  if (operation.status === 'rejected') return {result: 'The brightness request was refused.'};
  if (operation.status === 'expired') return {result: 'The brightness request expired.'};
  if (operation.status === 'conflict') return {result: 'The brightness request has conflicting results.'};
  if (operation.status === 'completed' && operation.result === Outcome.uncertain) {
    return {result: 'I couldn’t tell whether the brightness command took effect.'};
  }
  if (operation.result === Outcome.failed) return {result: 'The brightness request failed.'};
  if (operation.status !== 'completed' || operation.result !== Outcome.succeeded || operation.evidence !== Outcome.transmitted) return {};
  const readback = device?.id === watch.binding.target ? device.brightnessReadbacks?.find(value =>
    value.requestId === watch.requestId && value.transmittedAtMs >= operation.sentAtMs &&
    value.configurationRevision === watch.binding.configurationRevision && value.generation.epoch === watch.binding.generation.epoch &&
    value.generation.sequence === watch.binding.generation.sequence && value.requestedPercent === watch.percent) : undefined;
  if (readback?.reading.status === 'known') {
    return {sent: true, result: `${watch.label} reports ${readback.reading.percent}% brightness.`};
  }
  if (readback?.reading.status === 'unavailable') return {sent: true, result: unavailable({...watch, sent: true})};
  return {sent: true};
}

/** A bounded lifetime of read-only SDK copies. Later sync replaces state after a gap. */
export async function followConfirmation(context: ModuleContext, watch: Confirmation, signal: AbortSignal,
  save: (evidence: {sent?: true; result?: string}) => Promise<boolean>): Promise<void> {
  const parent: TraceContext = {traceparent: watch.traceparent};
  let retryMs = 1000;
  while (!signal.aborted && context.clock.now() < watch.expiresAtMs) {
    let operation: SyncedCopy<OperationRecord> | undefined;
    let device: SyncedCopy<DeviceRecord> | undefined;
    let ready: boolean;
    let lost = false, changed: boolean;
    let operationCurrent = true, deviceCurrent = true;
    let wake: (() => void) | undefined;
    const notify = () => {changed = true; wake?.();};
    const fail = () => {lost = true; notify();};
    const remaining = () => Math.max(0, watch.expiresAtMs - context.clock.now());
    const wait = (ms: number) => new Promise<void>(resolve => {
      const done = () => {
        cancel();
        signal.removeEventListener('abort', done);
        wake = undefined;
        resolve();
      };
      const cancel = context.scheduler.after(ms, done);
      signal.addEventListener('abort', done, {once: true});
      wake = done;
      if (signal.aborted) done();
    });
    try {
      const timeoutMs = Math.max(1, Math.min(1200, remaining()));
      const [tracked, reported] = await Promise.all([
        context.sdk.sync<OperationRecord>(['operation'], change => {
          if (change.type === 'failed') fail();
          if (change.type === 'synced') operationCurrent = true;
          notify();
        }, {owner: 'bunny/core', timeoutMs, parent, onRestarted: () => {operationCurrent = false; notify();}}),
        context.sdk.sync<DeviceRecord>(['device'], change => {
          if (change.type === 'failed') fail();
          if (change.type === 'synced') deviceCurrent = true;
          notify();
        }, {owner: watch.binding.owner, timeoutMs, parent, onRestarted: () => {deviceCurrent = false; notify();}}),
      ]);
      operation = tracked.status === 'synced' ? tracked.copy : undefined;
      device = reported.status === 'synced' ? reported.copy : undefined;
      ready = operation !== undefined && device !== undefined;
      while (!signal.aborted && ready && !lost && remaining() > 0) {
        changed = false;
        const tracked = operationCurrent ? operation?.states().find(message => message.data.requestId === watch.requestId)?.data : undefined;
        const owner = deviceCurrent ? device?.get({family: 'device', id: watch.binding.target})?.data : undefined;
        const evidence = confirmationEvidence(watch, tracked, owner, context.sdk.source);
        if (evidence.sent === true) watch.sent = true;
        if (await save(evidence)) return;
        if (!changed) await wait(remaining());
      }
    } finally {
      await Promise.all([operation?.close(), device?.close()]);
    }
    if (!signal.aborted && remaining() > 0) {
      await wait(Math.min(retryMs, remaining()));
      retryMs = ready ? 1000 : Math.min(60_000, retryMs * 2);
    }
  }
  if (!signal.aborted) await save({result: unavailable(watch)});
}
