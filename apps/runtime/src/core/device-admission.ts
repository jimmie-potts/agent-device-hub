import {LIFX_COLOR_PARAMETERS, observationBasis, type ObservationBasis} from '@jimmie-potts/event-contracts/v2/assistant-actions';
import type {ErrorCode, Message} from '@jimmie-potts/event-contracts/v2';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {currentObservationBasis, supportsDeviceAction, type LifxDeviceFacts} from '@jimmie-potts/sdk';

import type {AutomationDevice} from './automation-devices.js';

const within = (value: unknown, {minimum, maximum}: {minimum: number; maximum: number}): boolean =>
  typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;

export type DeviceAdmission = {kind: 'mcp'; live: () => boolean} | {kind: 'conversation'; owner: string; expiresAt: string | undefined};

function generationMatches(value: unknown, generation: DeviceRecord['generation']): boolean {
  return typeof value === 'object' && value !== null && 'epoch' in value && value.epoch === generation.epoch &&
    'sequence' in value && value.sequence === generation.sequence;
}

export function deviceRefusal({admission, current, registered, family, data, lifx}: {
  admission: DeviceAdmission; current: Message<DeviceRecord> | undefined; registered: AutomationDevice | undefined;
  family: string; data: Record<string, unknown>; lifx: LifxDeviceFacts | undefined;
}): {code: ErrorCode; detail: string} | undefined {
  if (current === undefined) return registered !== undefined
    ? {code: 'unavailable', detail: 'the current device record is unavailable'}
    : {code: 'not-found', detail: 'the runtime has no registered target with that ID'};
  if (admission.kind === 'conversation' && current.source !== admission.owner) {
    return {code: 'forbidden', detail: 'the device belongs to a different owner'};
  }
  const {configurationRevision, generation, held, availability, capabilities} = current.data;
  if (data.expectedConfigurationRevision !== undefined && data.expectedConfigurationRevision !== configurationRevision ||
    data.expectedGeneration !== undefined && !generationMatches(data.expectedGeneration, generation)) {
    return {code: 'revision-conflict', detail: 'the selected device revision or generation changed'};
  }
  if (family === 'wemo-hold-release' && (held === undefined || data.heldRequestId !== held.requestId)) {
    return {code: 'revision-conflict', detail: 'the selected device hold changed'};
  }
  const ownerAdmits = registered?.owner === current.source && registered.commandAvailability?.[family] === 'owner-admission';
  if (family !== 'wemo-hold-release' && (held !== undefined || !ownerAdmits && availability !== 'available')) {
    return {code: 'unavailable', detail: 'the selected device is held or unavailable'};
  }
  const supported = supportsDeviceAction({owner: current.source, device: current.data}, family);
  if (!supported) return {code: 'unsupported-capability', detail: 'the device does not advertise the command'};
  if (family === 'brightness-set' && capabilities.brightness.supported && !within(data.percent, capabilities.brightness)) {
    return {code: 'invalid-request', detail: 'brightness is outside the advertised percent range'};
  }
  if (family === 'power-set' && typeof data.on !== 'boolean') {
    return {code: 'invalid-request', detail: 'power must be a Boolean'};
  }
  if (family === 'lifx-color-set' || family === 'lifx-temperature-set') {
    if (lifx === undefined) return {code: 'unavailable', detail: 'the current light controls are unavailable'};
    const {color, temperature} = lifx.capabilities;
    if (family === 'lifx-color-set' && !color.supported || family === 'lifx-temperature-set' && !temperature.supported) {
      return {code: 'unsupported-capability', detail: 'the light does not advertise the command'};
    }
    if (family === 'lifx-color-set' && (!within(data.hue, LIFX_COLOR_PARAMETERS.hue) ||
      !within(data.saturation, LIFX_COLOR_PARAMETERS.saturation))) {
      return {code: 'invalid-request', detail: 'color is outside the advertised hue or saturation range'};
    }
    if (family === 'lifx-temperature-set' && temperature.supported && !within(data.kelvin, temperature)) {
      return {code: 'invalid-request', detail: 'temperature is outside the advertised kelvin range'};
    }
  }
  return choiceSupported(capabilities, family, data, current.source) ? undefined
    : {code: 'unsupported-capability', detail: 'the requested value is outside the advertised choices'};
}

function choiceSupported({modes, zones, scenes, media, moments}: DeviceRecord['capabilities'], family: string,
  data: Record<string, unknown>, owner: string): boolean {
  switch (family) {
    case 'device-mode-set': return modes.supported && modes.values.some(mode => mode === data.mode);
    case 'zone-power-set': return zones.supported && zones.zoneIds.some(id => id === data.zoneId);
    case 'scene-activate': return scenes.supported && scenes.sceneIds.some(id => id === data.sceneId);
    case 'media-start':
      // Pixoo advertises a preview. Its writer checks the exact ID against the whole library.
      return media.supported && (owner === 'bunny/modules/pixoo' || media.playlistIds.some(id => id === data.playlistId));
    case 'media-control': return media.supported && media.actions.some(action => action === data.action);
    case 'moment-play': return moments.supported && moments.moods.some(mood => mood === data.mood) &&
      typeof data.durationMs === 'number' && data.durationMs <= moments.maxDurationMs;
    default: return true;
  }
}

export function observationRefusal({current, family, data, basis, lifx, now, changed}: {
  current: Message<DeviceRecord>; family: string; data: Record<string, unknown>; basis: ObservationBasis; lifx: LifxDeviceFacts | undefined;
  now: number; changed: boolean;
}): {code: ErrorCode; detail: string} | undefined {
  if (observationBasis(basis) === undefined || (basis.kind === 'brightness' ? family !== 'brightness-set' : family !== 'lifx-temperature-set') ||
    data.expectedConfigurationRevision === undefined || data.expectedGeneration === undefined) {
    return {code: 'invalid-request', detail: 'a relative command requires matching observation and device guards'};
  }
  const reading = currentObservationBasis({owner: current.source, device: current.data}, basis.kind, now, lifx);
  if (reading === undefined || reading.observedAtMs !== basis.observedAtMs || reading.value !== basis.value ||
    current.data.pending > 0 || changed) {
    return {code: 'revision-conflict', detail: 'the observation no longer supports this relative command'};
  }
  return undefined;
}
