// The `device/2.0` record (Hub #918) as the fixture device modules serve it (Hub #967). Every device module serves the
// `device` family for its own devices, so several modules serve it at once and a consumer syncs each by name. A
// fixture device offers none of the general commands, so every capability is unsupported and nothing else is known.
import {deviceFamilies, type DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {StateDraft} from '@jimmie-potts/sdk';

export const DEVICE_FAMILY = 'device';
export const DEVICE_SCHEMA = 'https://bunny.invalid/events/device/2.0';
/** The device families' payload schemas by `dataschema`, for a kit spec. The kit registers the core families first. */
export const deviceSchemas: Readonly<Record<string, object>> = Object.fromEntries(deviceFamilies.map(family => [family.dataschema, family.schema]));

const UNSUPPORTED = {supported: false} as const;
const UNKNOWN = {status: 'unknown'} as const;

/** One fixture device's record: its kind and availability, at `revision`. */
export function deviceRecord(id: string, revision: number, kind: string, availability: DeviceRecord['availability']): DeviceRecord {
  return {
    id, revision, kind, availability, configurationRevision: 1, generation: {epoch: `${kind}-1`, sequence: revision},
    capabilities: {
      power: UNSUPPORTED, brightness: UNSUPPORTED, modes: UNSUPPORTED, moments: UNSUPPORTED, media: UNSUPPORTED, scenes: UNSUPPORTED, zones: UNSUPPORTED,
      preview: UNSUPPORTED,
    },
    desired: {power: UNKNOWN, brightness: UNKNOWN, mode: UNKNOWN}, observed: UNKNOWN, pending: 0, pendingKinds: [], lastOutcome: UNKNOWN,
    lastTransmission: UNKNOWN, externalControl: UNKNOWN,
  };
}

/** The state draft that carries a device's record, on `bunny.state.device.<id>`. */
export const deviceState = (record: DeviceRecord): StateDraft<DeviceRecord> =>
  ({type: 'org.bunny.device.updated', subject: record.id, dataschema: DEVICE_SCHEMA, data: record});
