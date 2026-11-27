// General device controls copied onto the 2.0 contracts (Hub #922). No device transport lives in the browser.
import type {DeviceCommand, DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import {frontendCommandView, type FrontendCommandView} from '@jimmie-potts/sdk/frontend';
import type {BrowserAction} from './actions.ts';

type Intent<C> = C extends {family: infer F; data: infer D} ? {family: F; data: Omit<D, 'requestId' | 'expectedConfigurationRevision' | 'expectedGeneration'>} : never;
export type DeviceIntent = Intent<Exclude<DeviceCommand, {family: 'moment-play'}>>;

/** A stale copy or read-only caller never offers writes; module policies still make the final admission decision. */
export function deviceBlocked(record: DeviceRecord, live: boolean, control: boolean): string | undefined {
  if (!control) return 'Your session is read-only';
  if (!live) return 'Device records are stale';
  if (record.externalControl.status === 'known' && record.externalControl.owner === 'external') return 'Device is externally controlled';
  return undefined;
}

// The device contract's capability admission, without importing its Node schema registry into the browser bundle.
function supported({capabilities: cap}: DeviceRecord, intent: DeviceIntent): boolean {
  switch (intent.family) {
    case 'power-set': return cap.power.supported;
    case 'brightness-set': return cap.brightness.supported;
    case 'device-mode-set': return cap.modes.supported && cap.modes.values.includes(intent.data.mode);
    case 'scene-activate': return cap.scenes.supported && cap.scenes.sceneIds.includes(intent.data.sceneId);
    case 'zone-power-set': return cap.zones.supported && cap.zones.zoneIds.includes(intent.data.zoneId);
    case 'media-start': return cap.media.supported && cap.media.playlistIds.includes(intent.data.playlistId);
    case 'media-control': return cap.media.supported && cap.media.actions.includes(intent.data.action);
  }
}

/** A local refusal is text, never a request. Every admitted intent carries both guards from the current copy. */
export function deviceAction(record: DeviceRecord, intent: DeviceIntent, requestId: string): BrowserAction | string {
  if (intent.family === 'brightness-set' && (!Number.isInteger(intent.data.percent) || intent.data.percent < 0 || intent.data.percent > 100)) {
    return 'Brightness must be a whole number from 0 to 100';
  }
  if (!supported(record, intent)) return 'This device does not support that control or value';
  if (['scene-activate', 'media-start', 'media-control'].includes(intent.family)) {
    const reason = contentBlocked(record);
    if (reason !== undefined) return reason;
  }
  return {family: intent.family, target: record.id, requestId,
    data: {...intent.data, expectedConfigurationRevision: record.configurationRevision, expectedGeneration: record.generation}};
}

/** A tracked outcome is distinct from desired state and transport acceptance. A late definitive outcome unlocks it. */
export function operationView(operation: OperationRecord): FrontendCommandView {
  const code = operation.error?.code;
  switch (operation.status) {
    case 'sent': return frontendCommandView({kind: 'requested'});
    case 'accepted': return frontendCommandView({kind: 'accepted'});
    case 'rejected': return frontendCommandView({kind: 'refused', code});
    case 'expired': return frontendCommandView({kind: 'expired'});
    case 'conflict': return frontendCommandView({kind: 'conflict'});
    case 'uncertain': return frontendCommandView({kind: 'uncertain'});
    case 'completed':
      if (operation.result === 'uncertain' || operation.result === 'conflict') return frontendCommandView({kind: 'uncertain'});
      return frontendCommandView({kind: 'completed', result: operation.result, family: operation.family, code, evidence: operation.evidence});
  }
}

/**
 * Why content controls are off, or undefined. The Nanoleaf shows content only in Free; the Pixoo refuses playback starts
 * in Work and admits them in Free and Quiet (ADR 0014). An unknown or pending mode blocks both.
 */
export function contentBlocked(record: DeviceRecord): string | undefined {
  if (record.kind !== 'pixoo' && record.kind !== 'nanoleaf') return undefined;
  const mode = record.desired.mode.status === 'known' && !record.pendingKinds.includes('device-mode-set') ? record.desired.mode.value : undefined;
  if (record.kind === 'pixoo') return mode === 'free' || mode === 'quiet' ? undefined : 'Content controls are off in Work; select Free or Quiet explicitly first';
  return mode === 'free' ? undefined : 'Content controls need Free mode; select that mode explicitly first';
}
