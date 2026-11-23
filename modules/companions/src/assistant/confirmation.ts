import type {CatalogBinding} from '@jimmie-potts/event-contracts/v2/assistant-actions';
import {ASSISTANT_WEMO_OWNER} from '@jimmie-potts/event-contracts/v2/assistant';
import type {DeviceRecord, ReadbackIdentity} from '@jimmie-potts/event-contracts/v2/devices';
import type {OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {Proposal} from './history-contract.js';
import {Outcome, type ModuleContext, type SyncedCopy, type TraceContext} from '@jimmie-potts/sdk';

export const IN_TURN_CONFIRMATION_MS = 1000;
export const CONFIRMATION_LIFETIME_MS = 86_400_000;

type DeviceBinding = Extract<CatalogBinding, {kind: 'device'}>;
type SettingTarget = {binding: DeviceBinding; label: string} & ({percent: number} | {on: boolean});
type ArtworkTarget = {artwork: {target: string; prepareRequestId: string; momentRequestId: string}; label: string};
type ConfirmationTarget = SettingTarget | ArtworkTarget;
export type Confirmation = ConfirmationTarget & {
  requestId: string; taskId: string; questionId: string; acceptedAtMs: number; expiresAtMs: number; traceparent: string;
  sent?: true; prepared?: true; result?: string; follows?: string;
};

export function confirmationTarget(proposal: Proposal, question: string): ConfirmationTarget | undefined {
  if (proposal.family === 'catalog-action' && proposal.command === 'brightness-set' &&
    proposal.binding.kind === 'device' && proposal.binding.owner === 'bunny/modules/pixoo' && typeof proposal.data.percent === 'number') {
    const percent = proposal.data.percent, suffix = ` brightness to ${percent}%?`;
    const label = question.startsWith('Set ') && question.endsWith(suffix) ? question.slice(4, -suffix.length) : proposal.target;
    return {binding: proposal.binding, percent, label};
  }
  if (proposal.family === 'power-set' && 'owner' in proposal && proposal.owner === ASSISTANT_WEMO_OWNER) {
    const {target, owner, data: {on, expectedConfigurationRevision, expectedGeneration}} = proposal;
    const prefix = `Turn ${on ? 'on' : 'off'} `;
    const label = question.startsWith(prefix) && question.endsWith('?') ? question.slice(prefix.length, -1) : target;
    return {binding: {kind: 'device', target, owner, configurationRevision: expectedConfigurationRevision, generation: expectedGeneration}, on, label};
  }
  return undefined;
}

export function unavailable(watch: Confirmation): string {
  if ('artwork' in watch) {
    const prior = watch.sent === true ? `The artwork was sent to ${watch.label}. `
      : watch.prepared === true ? `The artwork was prepared for ${watch.label}. ` : '';
    return `${prior}I couldn’t confirm whether ${watch.label} presented the artwork.`;
  }
  const power = 'on' in watch;
  const setting = power ? 'power' : 'brightness';
  const command = power ? 'Power' : 'Brightness';
  return watch.sent === true ? `${command} command sent. I couldn’t confirm ${watch.label}’s ${setting}.`
    : `I couldn’t confirm the ${setting} request for ${watch.label}.`;
}

export function pending(watch: Confirmation): string {
  if ('artwork' in watch) return `Playback confirmation for ${watch.label} is pending. I’ll update this reply when evidence arrives.`;
  const setting = 'on' in watch ? 'Power' : 'Brightness';
  const sent = watch.sent === true ? `${setting} command sent.` : `${setting} request accepted.`;
  return `${sent} I’ll update this reply when confirmation for ${watch.label} is available.`;
}

function matchesReading(readback: ReadbackIdentity, watch: Confirmation & SettingTarget, sentAtMs: number): boolean {
  const {configurationRevision, generation} = watch.binding;
  return readback.requestId === watch.requestId && readback.transmittedAtMs >= sentAtMs &&
    readback.configurationRevision === configurationRevision && readback.generation.epoch === generation.epoch &&
    readback.generation.sequence === generation.sequence;
}

/** Combines the core's decision about a tracked operation with the exact owner's reading. */
type ConfirmationEvidence = {sent?: true; prepared?: true; result?: string};

export function confirmationEvidence(watch: Confirmation, operation: OperationRecord | undefined, device: DeviceRecord | undefined,
  requestedBy: string, moment?: OperationRecord, preparation?: OperationRecord): ConfirmationEvidence {
  if ('artwork' in watch) {
    if (operation?.requestId !== watch.requestId || operation.requestedBy !== requestedBy ||
        operation.target !== 'hub' || operation.family !== 'art-show') return {};
    const prepared = watch.prepared === true || preparation?.requestId === watch.artwork.prepareRequestId &&
      preparation.family === 'art-auto' && preparation.target === 'art' && preparation.requestedBy === 'bunny/core' &&
      preparation.status === 'completed' && preparation.result === Outcome.succeeded && preparation.evidence === Outcome.observed;
    const preparationEvidence = prepared ? {prepared: true as const} : {};
    if (moment?.requestId === watch.artwork.momentRequestId && moment.family === 'moment-play' &&
        moment.target === watch.artwork.target && moment.requestedBy === 'bunny/core') {
      if (moment.status === 'completed' && moment.result === Outcome.succeeded) {
        if (moment.evidence === Outcome.observed) return {sent: true, result: `${watch.label} reported presenting the artwork.`};
        if (moment.evidence === Outcome.transmitted) return {sent: true, result: `Sent the artwork to ${watch.label}.`};
      }
      if (moment.status === 'rejected' || moment.status === 'expired' || moment.result === Outcome.failed) {
        const prior = moment.evidence === Outcome.transmitted || moment.evidence === Outcome.observed
          ? ' The display received the request.' : prepared ? ' The artwork was prepared.' : '';
        return {result: `Playback on ${watch.label} failed${moment.error === undefined ? '.' : ` (${moment.error.code}).`}${prior}`};
      }
      if (moment.status === 'uncertain' || moment.status === 'conflict' || moment.result === Outcome.uncertain) {
        return {result: unavailable({...watch, ...preparationEvidence,
          ...(moment.evidence === Outcome.transmitted || moment.evidence === Outcome.observed ? {sent: true as const} : {})})};
      }
    }
    if (operation.status === 'rejected' || operation.status === 'expired' || operation.result === Outcome.failed) {
      const prior = prepared ? ' The artwork was prepared.' : '';
      return {result: `Playback on ${watch.label} could not start${operation.error === undefined ? '.' : ` (${operation.error.code}).`}${prior}`};
    }
    return preparationEvidence;
  }
  const power = 'on' in watch;
  const setting = power ? 'power' : 'brightness';
  if (operation?.requestId !== watch.requestId || operation.requestedBy !== requestedBy ||
      operation.target !== watch.binding.target || operation.family !== `${setting}-set`) return {};
  if (operation.status === 'rejected') return {result: `The ${setting} request was refused.`};
  if (operation.status === 'expired') return {result: `The ${setting} request expired.`};
  if (operation.status === 'conflict') return {result: `The ${setting} request has conflicting results.`};
  if (operation.status === 'completed' && operation.result === Outcome.uncertain) {
    return {result: power ? `I couldn’t tell whether ${watch.label} switched ${watch.on ? 'on' : 'off'}. The plug entered a hold after the unanswered write.`
      : 'I couldn’t tell whether the brightness command took effect.'};
  }
  if (operation.result === Outcome.failed) return {result: operation.error?.code === 'expired'
    ? `The ${setting} request expired.` : `The ${setting} request failed.`};
  if (operation.status !== 'completed' || operation.result !== Outcome.succeeded || operation.evidence !== Outcome.transmitted) return {};
  if (device?.id !== watch.binding.target) return {sent: true};
  const readback = power
    ? device.powerReadbacks?.find(value => matchesReading(value, watch, operation.sentAtMs) && value.requestedOn === watch.on)
    : device.brightnessReadbacks?.find(value => matchesReading(value, watch, operation.sentAtMs) && value.requestedPercent === watch.percent);
  const reading = readback?.reading;
  if (reading?.status === 'known') {
    const state = 'on' in reading ? reading.on ? 'power on' : 'power off' : `${reading.percent}% brightness`;
    return {sent: true, result: `${watch.label} reports ${state}.`};
  }
  if (reading?.status === 'unavailable') return {sent: true, result: unavailable({...watch, sent: true})};
  return {sent: true};
}

/** A bounded lifetime of read-only SDK copies. Later sync replaces state after a gap. */
export async function followConfirmation(context: ModuleContext, watch: Confirmation, signal: AbortSignal,
  save: (evidence: ConfirmationEvidence) => Promise<boolean>): Promise<void> {
  const parent: TraceContext = {traceparent: watch.traceparent};
  let retryMs = 1000;
  while (!signal.aborted && context.clock.now() < watch.expiresAtMs) {
    let operation: SyncedCopy<OperationRecord> | undefined;
    let device: SyncedCopy<DeviceRecord> | undefined;
    let failed = false, changed: boolean;
    let operationCurrent = true, deviceCurrent = true;
    let wake: (() => void) | undefined;
    const notify = () => {changed = true; wake?.();};
    const fail = () => {failed = true; notify();};
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
    const timeoutMs = Math.max(1, Math.min(1200, remaining()));
    const openOperation = context.sdk.sync<OperationRecord>(['operation'], change => {
      if (change.type === 'failed') {operationCurrent = false; fail();}
      if (change.type === 'synced') operationCurrent = true;
      notify();
    }, {owner: 'bunny/core', timeoutMs, parent, onRestarted: () => {operationCurrent = false; notify();}})
      .then(result => {if (result.status === 'synced') {operation = result.copy; notify();} else fail();}, fail);
    const openDevice = 'artwork' in watch ? Promise.resolve() : context.sdk.sync<DeviceRecord>(['device'], change => {
      if (change.type === 'failed') {deviceCurrent = false; fail();}
      if (change.type === 'synced') deviceCurrent = true;
      notify();
    }, {owner: watch.binding.owner, timeoutMs, parent, onRestarted: () => {deviceCurrent = false; notify();}})
      .then(result => {if (result.status === 'synced') {device = result.copy; notify();} else fail();}, fail);
    try {
      while (!signal.aborted && remaining() > 0) {
        changed = false;
        const tracked = operationCurrent ? operation?.states().find(message => message.data.requestId === watch.requestId)?.data : undefined;
        const owner = deviceCurrent && 'binding' in watch ? device?.get({family: 'device', id: watch.binding.target})?.data : undefined;
        const records = operationCurrent ? operation?.states() : undefined;
        const phase = (id: string) => records?.find(message => message.data.requestId === id)?.data;
        const artwork = 'artwork' in watch ? watch.artwork : undefined;
        const evidence = confirmationEvidence(watch, tracked, owner, context.sdk.source,
          artwork === undefined ? undefined : phase(artwork.momentRequestId), artwork === undefined ? undefined : phase(artwork.prepareRequestId));
        if (evidence.sent === true) watch.sent = true;
        if (evidence.prepared === true) watch.prepared = true;
        if (await save(evidence)) return;
        if (failed) break;
        if (!changed) await wait(remaining());
      }
      // A refused device sync does not erase evidence from a core sync still in flight.
      if (failed && !signal.aborted) {
        await openOperation;
        const tracked = operationCurrent ? operation?.states().find(message => message.data.requestId === watch.requestId)?.data : undefined;
        const evidence = confirmationEvidence(watch, tracked, undefined, context.sdk.source);
        if (evidence.sent === true) watch.sent = true;
        if (await save(evidence)) return;
      }
    } finally {
      await Promise.all([openOperation, openDevice]);
      await Promise.all([operation?.close(), device?.close()]);
    }
    if (!signal.aborted && remaining() > 0) {
      await wait(Math.min(retryMs, remaining()));
      retryMs = operation !== undefined && device !== undefined ? 1000 : Math.min(60_000, retryMs * 2);
    }
  }
  if (!signal.aborted) await save({result: unavailable(watch)});
}
