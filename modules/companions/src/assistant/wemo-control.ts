import {ASSISTANT_WEMO_OWNER, type AssistantDeviceAction} from '@jimmie-potts/event-contracts/v2/assistant';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {deviceLabel} from './devices.js';
import {parseControlSelection, resolveModelControl, type ControlReference, type ModelControlScope} from './model-control.js';

const MAX_PLUGS = 2;

export function wemoControlReference(device: DeviceRecord, allowed: boolean): ControlReference {
  return {id: device.id, label: deviceLabel(device), allowed, binding: JSON.stringify([device.configurationRevision,
    device.generation.epoch, device.generation.sequence, device.capabilities.power.supported])};
}

export function resolveWemoControl(scope: ModelControlScope, input: Readonly<Record<string, unknown>>) {
  const selection = parseControlSelection(input, MAX_PLUGS);
  if (selection === undefined || typeof input.on !== 'boolean' || Object.keys(input).length !== 3) {
    return {kind: 'refused', code: 'invalid-request'} as const;
  }
  return resolveModelControl(scope, {requestId: scope.request.id, selection, settings: input.on}, true, MAX_PLUGS);
}

export function planWemoPower(device: DeviceRecord, on: boolean): AssistantDeviceAction {
  return {family: 'power-set', owner: ASSISTANT_WEMO_OWNER, target: device.id, data: {on,
    expectedConfigurationRevision: device.configurationRevision, expectedGeneration: device.generation}};
}
