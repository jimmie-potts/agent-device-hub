// Saved choice and application evidence are separate. Reading this helper never submits or retries a command.
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {Mode, ModeState, OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import {modeChildRequestId} from '../../src/core/mode-participants.ts';
import type {BrowserAction} from './actions.ts';

export const modeName = (mode: Mode): string => ({work: 'Work', free: 'Free', quiet: 'Quiet'})[mode];
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
