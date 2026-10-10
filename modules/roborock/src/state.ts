import { SCHEMA_BASE } from '@jimmie-potts/event-contracts/v2';
import type { DeviceRecord } from '@jimmie-potts/event-contracts/v2/devices';
import type { StateDraft } from '@jimmie-potts/sdk';
import { STATUS_SCHEMA, UNKNOWN, type VacuumStatus } from './contracts.js';
const UNSUPPORTED = { supported: false } as const;
export function deviceRecord(status: VacuumStatus, generation = 0): DeviceRecord {
    return { id: status.id, revision: status.revision, kind: 'roborock', configurationRevision: 0, generation: { epoch: 'collector', sequence: generation }, availability: status.availability,
        capabilities: { power: UNSUPPORTED, brightness: UNSUPPORTED, modes: UNSUPPORTED, moments: UNSUPPORTED, media: UNSUPPORTED, scenes: UNSUPPORTED, zones: UNSUPPORTED, preview: UNSUPPORTED },
        desired: { power: UNKNOWN, brightness: UNKNOWN, mode: UNKNOWN }, observed: UNKNOWN, pending: 0, pendingKinds: [], lastOutcome: UNKNOWN, lastTransmission: UNKNOWN, externalControl: UNKNOWN };
}
export function stateDrafts(status: VacuumStatus, generation = 0): [
    StateDraft<VacuumStatus> & {
        kind: 'state';
    },
    StateDraft<DeviceRecord> & {
        kind: 'state';
    }
] {
    return [{ kind: 'state', type: 'org.bunny.roborock-vacuum.updated', subject: status.id, dataschema: STATUS_SCHEMA, data: status },
        { kind: 'state', type: 'org.bunny.device.updated', subject: status.id, dataschema: `${SCHEMA_BASE}device/2.1`, data: deviceRecord(status, generation) }];
}
