// The module's observed state and its device record. Unavailable never reads as off: a stale feed or a link that is not
// connected makes every live value unknown, and only the display unit, which says nothing about use, stays known.
import {SCHEMA_BASE} from '@jimmie-potts/event-contracts/v2';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {StateDraft} from '@jimmie-potts/sdk';
import {STALE_MS, type LinkFact} from './facts.js';
import {STATUS_SCHEMA, STATUS_TYPE} from './families.js';
import type {Meta} from './store.js';
import type {VolcanoConfig} from './configuration.js';

export type VolcanoStatus = {
  schema: 'volcano-status/2.0'; id: string; revision: number; configurationRevision: number;
  availability: 'available' | 'unavailable'; link: LinkFact | 'unknown';
  observedAtMs: number | null; receivedAtMs: number | null; heater: 'on' | 'off' | 'unknown'; pump: 'on' | 'off' | 'unknown';
  status1: number | null; currentDeciC: number | null; targetDeciC: number | null; heatingCounterMinutes: number | null; displayFahrenheit: boolean | null;
  gapMinutes: number; recording: 'ok' | 'refused';
};

/**
 * The status now. `freshSinceMs` is when this process last took a snapshot, or undefined: a store's last snapshot from an
 * earlier run proves nothing until the next one arrives.
 */
export function statusOf(config: VolcanoConfig, {continuity: state, settings, revision}: Meta, freshSinceMs: number | undefined, nowMs: number, recording: VolcanoStatus['recording']): VolcanoStatus {
  const live = freshSinceMs !== undefined && nowMs - freshSinceMs < STALE_MS && state.link === 'connected' && state.heater !== null && state.lastReadingAtMs === state.latestMs;
  const onOff = (value: boolean | null): 'on' | 'off' | 'unknown' => (!live || value === null ? 'unknown' : value ? 'on' : 'off');
  const link = state.link !== null && state.link !== 'connected' ? state.link : freshSinceMs === undefined ? 'unknown' : nowMs - freshSinceMs >= STALE_MS ? 'stale' : state.link ?? 'unknown';
  return {
    schema: 'volcano-status/2.0', id: config.id, revision, configurationRevision: settings.configurationRevision,
    availability: live ? 'available' : 'unavailable', link,
    observedAtMs: state.latestMs, receivedAtMs: state.takenAtMs, heater: onOff(state.heater), pump: onOff(state.pump),
    status1: live ? state.status1 : null, currentDeciC: live ? state.currentDeciC : null, targetDeciC: live ? state.targetDeciC : null,
    heatingCounterMinutes: live ? state.counter : null, displayFahrenheit: state.displayFahrenheit, gapMinutes: settings.gapMinutes, recording,
  };
}

const UNKNOWN = {status: 'unknown'} as const;
const UNSUPPORTED = {supported: false} as const;

/** The shared device record: nothing here is controllable, and what the device does stays in the Volcano's own family. */
export function deviceRecord(config: VolcanoConfig, status: VolcanoStatus, generation: DeviceRecord['generation']): DeviceRecord {
  return {
    id: config.id, ...(config.label === undefined ? {} : {label: config.label}), revision: status.revision, kind: 'volcano', configurationRevision: status.configurationRevision, generation,
    availability: status.availability,
    capabilities: {power: UNSUPPORTED, brightness: UNSUPPORTED, modes: UNSUPPORTED, moments: UNSUPPORTED, media: UNSUPPORTED, scenes: UNSUPPORTED, zones: UNSUPPORTED, preview: UNSUPPORTED},
    desired: {power: UNKNOWN, brightness: UNKNOWN, mode: UNKNOWN}, observed: UNKNOWN, pending: 0, pendingKinds: [], lastOutcome: UNKNOWN, lastTransmission: UNKNOWN, externalControl: UNKNOWN,
  };
}

export function stateDrafts(config: VolcanoConfig, status: VolcanoStatus, generation: DeviceRecord['generation']): [StateDraft<VolcanoStatus> & {kind: 'state'}, StateDraft<DeviceRecord> & {kind: 'state'}] {
  return [
    {kind: 'state', type: STATUS_TYPE, subject: config.id, dataschema: STATUS_SCHEMA, data: status},
    {kind: 'state', type: 'org.bunny.device.updated', subject: config.id, dataschema: `${SCHEMA_BASE}device/2.1`, data: deviceRecord(config, status, generation)},
  ];
}
