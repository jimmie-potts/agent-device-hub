import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {StateDraft} from '@jimmie-potts/sdk';

/** Contract-only stand-in declarations, with no physical observation or device transport. */
export const artDevice = (kind: 'pixoo' | 'tidbyt', id: string, revision = 1): DeviceRecord => ({
  id, kind, revision, availability: 'unknown', configurationRevision: 1, generation: {epoch: '12345678-1234-4234-8234-123456789abc', sequence: 0},
  capabilities: {power: {supported: false}, brightness: {supported: false}, modes: {supported: false},
    moments: {supported: true, moods: ['celebrate'], maxDurationMs: 10_000, coversStatus: true, art: {formats: ['png', 'gif'], maxBytes: 163_840}},
    media: {supported: false}, scenes: {supported: false}, zones: {supported: false}, preview: {supported: false}},
  desired: {power: {status: 'unknown'}, brightness: {status: 'unknown'}, mode: {status: 'unknown'}},
  observed: {status: 'unknown'}, pending: 0, pendingKinds: [], lastOutcome: {status: 'unknown'}, lastTransmission: {status: 'unknown'}, externalControl: {status: 'unknown'},
});
export const deviceDraft = (data: DeviceRecord): StateDraft<DeviceRecord> => ({type: 'org.bunny.device.updated', subject: data.id, dataschema: 'https://bunny.invalid/events/device/2.2', data});
