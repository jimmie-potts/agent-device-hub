// Saved choice and application evidence are separate. Reading this helper never submits or retries a command.
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {InboxItem, Mode, ModeState, OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import {modeChildRequestId} from '../../src/core/mode-participants.ts';
import type {BrowserAction} from './actions.ts';

export const modeName = (mode: Mode): string => ({work: 'Work', free: 'Free', quiet: 'Quiet'})[mode];
export type ModeInboxIssue = {id: string; association: 'matched' | 'unavailable'};
/** Retired projections cannot prove resolution; unknown native-mode links stay reviewable. */
export async function modeInboxIssues(operations: readonly OperationRecord[], items: readonly InboxItem[]): Promise<ModeInboxIssue[]> {
  const parents = operations.filter(item => (item.family === 'mode-set' && item.target === 'hub' || item.family === 'mode-override-set'))
    .sort((a, b) => {const time = b.sentAtMs - a.sentAtMs; return time === 0 ? b.revision - a.revision : time;});
  const targets = [...new Set(items.map(item => item.item.target))];
  const identities = new Map<string, Map<string, string>>();
  await Promise.all(parents.map(async parent => {
    identities.set(parent.requestId, new Map(await Promise.all(targets.map(async target => [target, await modeChildRequestId(parent.requestId, target)] as const))));
  }));
  const sorted = [...items].sort((a, b) => {const time = b.createdAtMs - a.createdAtMs; return time === 0 ? b.revision - a.revision : time;});
  return sorted.flatMap(entry => {
    const global = entry.item.target === 'hub' && entry.item.command === 'org.bunny.mode.set.requested';
    const direct = global || entry.item.command === 'org.bunny.mode-override.set.requested';
    const native = entry.item.command === 'org.bunny.device-mode.set.requested';
    if (!direct && !native) return [];
    const parent = parents.find(item => direct ? item.requestId === entry.item.requestId
      : identities.get(item.requestId)?.get(entry.item.target) === entry.item.requestId);
    const operation = operations.find(item => item.requestId === entry.item.requestId && item.target === entry.item.target && item.family === 'device-mode-set');
    // Current evidence can exclude an independent native request. Its absent copy cannot.
    if (!direct && parent === undefined && operation !== undefined && operation.requestedBy !== 'bunny/core') return [];
    const newer = parent === undefined ? parents.filter(item => item.sentAtMs > entry.createdAtMs) : parents.slice(0, parents.indexOf(parent));
    const resolved = newer.some(next => (next.family === 'mode-set' || !global && next.target === entry.item.target) && next.status === 'completed' && next.result === 'succeeded' && (direct || operations.some(child =>
      child.family === 'device-mode-set' && child.requestedBy === 'bunny/core' && child.target === entry.item.target
      && child.requestId === identities.get(next.requestId)?.get(entry.item.target)
      && child.status === 'completed' && child.result === 'succeeded')));
    return resolved ? [] : [{id: entry.id, association: direct || parent !== undefined ? 'matched' as const : 'unavailable' as const}];
  });
}
export function modeAction(current: ModeState, selected: Mode, requestId: string): BrowserAction {
  return {family: 'mode-set', target: current.id, requestId, data: {mode: selected, expectedRevision: current.revision}};
}
/** A recent completed selection request, without inferring that it describes the current saved record. */
export function modeApplication(operations: readonly OperationRecord[]): OperationRecord | undefined {
  return operations.filter(item => item.family === 'mode-set' && item.target === 'hub' && item.status === 'completed' && item.result === 'succeeded')
    .sort((a, b) => {const byTime = b.sentAtMs - a.sentAtMs; return byTime === 0 ? b.revision - a.revision : byTime;})[0];
}
export type ModeDeviceResult = {target: string; status: string; result?: string; evidence?: string; code?: string};
/** Match deterministic children to their parent. Missing or stale records never count as success. */
export async function modeDeviceResults(parent: OperationRecord, operations: readonly OperationRecord[], devices: readonly DeviceRecord[], synced: boolean): Promise<ModeDeviceResult[]> {
  const targets = [...new Set([...devices.filter(device => device.kind === 'nanoleaf' || device.kind === 'pixoo').map(device => device.id),
    ...operations.filter(item => item.family === 'device-mode-set' && item.requestedBy === 'bunny/core').map(item => item.target)])];
  const candidates = await Promise.all(targets.map(async (target): Promise<ModeDeviceResult | undefined> => {
    const requestId = await modeChildRequestId(parent.requestId, target);
    const operation = operations.find(item => item.requestId === requestId && item.family === 'device-mode-set' && item.target === target && item.requestedBy === 'bunny/core');
    if (operation === undefined && !devices.some(device => device.id === target && (device.kind === 'nanoleaf' || device.kind === 'pixoo'))) return undefined;
    return {target, status: synced ? operation?.status ?? 'not observed' : 'not synced',
      ...!synced || operation?.result === undefined ? {} : {result: operation.result},
      ...!synced || operation?.evidence === undefined ? {} : {evidence: operation.evidence},
      ...!synced || operation?.error === undefined ? {} : {code: operation.error.code}};
  }));
  return candidates.filter((item): item is ModeDeviceResult => item !== undefined).sort((a, b) => a.target.localeCompare(b.target));
}
