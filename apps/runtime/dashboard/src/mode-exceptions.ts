import type {ModeState, OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {modeName} from './hub-mode.ts';

export type ModeDeviceView = {record: DeviceRecord; owner: string; live: boolean};
export type ModeException = {target: string; name: string; choice: string; evidence: string; override: boolean; linked: boolean};
const native = (kind: string, mode: string): string => kind === 'pixoo' ? mode === 'free' ? 'media' : 'monitor' : mode;

/** Desired native mode is never a physical observation or evidence of the owner's Hub-facing intent. */
export function modeExceptions(record: ModeState | undefined, devices: readonly ModeDeviceView[], operations: readonly OperationRecord[], live: boolean): ModeException[] {
  if (record === undefined) return [];
  const targets = new Set((record.overrides ?? []).map(choice => choice.target));
  for (const {record: device, live: deviceLive, owner} of devices) {
    if (live && deviceLive && ['nanoleaf', 'pixoo'].includes(device.kind) && owner === `bunny/modules/${device.kind}` && device.desired.mode.status === 'known' &&
      device.desired.mode.value !== native(device.kind, record.mode)) targets.add(device.id);
  }
  return [...targets].map(target => {
    const override = record.overrides?.find(choice => choice.target === target);
    const device = devices.find(item => item.record.id === target);
    const operation = operations.filter(item => item.target === target && item.family === 'device-mode-set')
      .sort((a, b) => a.sentAtMs === b.sentAtMs ? b.revision - a.revision : b.sentAtMs - a.sentAtMs)[0];
    const evidence = !live || device?.live !== true ? 'Device evidence is stale or unavailable.'
      : `${device.record.availability}. Requested native mode: ${device.record.desired.mode.status === 'known' ? device.record.desired.mode.value : 'unknown'}. Physical mode is not confirmed.`;
    return {target, name: device?.record.label ?? target, override: override !== undefined, linked: device !== undefined,
      choice: override === undefined ? `Following Hub ${modeName(record.mode)}; native setting differs` : `${modeName(override.mode)} · saved exception`,
      evidence: `${evidence}${operation === undefined ? '' : ` Latest request: ${operation.status}${operation.result === undefined ? '' : ` · ${operation.result}`}.`}`};
  });
}
