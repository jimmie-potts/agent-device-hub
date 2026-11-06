// Audio-page Music lighting presentation (#722 over #1272, first-trial policy in #40). Pure text and eligibility only:
// the card sends nothing on its own, and every reason here only explains a disabled control.
import type {Message} from '@jimmie-potts/event-contracts/v2';
import type {CaptureState} from '@jimmie-potts/event-contracts/v2/music-capture-data';
import {LIGHTING_END_REASONS, LIGHTING_RESTORATIONS, LIGHTING_STATUSES, type LightingCapture, type LightingEnded,
  type LightingState} from '@jimmie-potts/event-contracts/v2/music-lighting-data';
import type {ReactiveCatalogView} from '@jimmie-potts/nanoleaf/reactive-presets';

export const LIGHTING_STATE_SCHEMA = 'https://bunny.invalid/events/music-lighting-state/2.0';
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value !== '';
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const capture = (value: unknown): value is LightingCapture => object(value) && text(value.endpointId) && text(value.generation);
function ended(value: unknown): value is LightingEnded {
  return object(value) && text(value.generation) && count(value.atMs) && (LIGHTING_END_REASONS as readonly unknown[]).includes(value.reason) &&
    (LIGHTING_RESTORATIONS as readonly unknown[]).includes(value.restoration) && (value.code === undefined || text(value.code));
}

/** The core's own record for one light, checked once at the browser boundary; anything else is not shown. */
export function lightingRecord(message: Message<unknown>): LightingState | undefined {
  const data = message.data;
  if (message.kind !== 'state' || message.type !== 'org.bunny.music-lighting.updated' || message.source !== 'bunny/core' ||
    message.dataschema !== LIGHTING_STATE_SCHEMA || !object(data) || !text(data.id) || message.subject !== data.id || !count(data.revision) ||
    !object(data.session) || !(data.last === null || ended(data.last))) return undefined;
  const session = data.session;
  if (session.status !== 'idle' && (!(LIGHTING_STATUSES as readonly unknown[]).includes(session.status) || !text(session.generation) ||
    !text(session.operationId) || !capture(session.capture) || !text(session.presetId) || !count(session.startedAtMs))) return undefined;
  return data as LightingState;
}

/** The capture a Start binds to: the core's current active Music.app session only, never a microphone. */
export function startCapture(state: CaptureState | undefined, live: boolean): LightingCapture | undefined {
  return live && state?.availability === 'available' && state.endpointId !== null && state.session.status === 'active' && state.session.input === 'music'
    ? {endpointId: state.endpointId, generation: state.session.generation} : undefined;
}

export type LightingControls = {
  record: LightingState; recordsLive: boolean; control: boolean; operationsLive: boolean;
  capture: CaptureState | undefined; captureLive: boolean; presets: ReactiveCatalogView; presetId: string | undefined;
  startLocked: boolean; stopLocked: boolean;
};
function common(controls: LightingControls): string | undefined {
  if (!controls.recordsLive) return 'Lighting status is stale or unavailable. Refresh lighting status first.';
  if (!controls.control) return 'Read-only access. Lighting controls are disabled.';
  if (!controls.operationsLive) return 'Command records are unavailable. Lighting controls are disabled.';
  return undefined;
}
/** Why Start is unavailable for this light now, or undefined when an explicit Start may be sent. */
export function startBlocked(controls: LightingControls): string | undefined {
  const reason = common(controls);
  if (reason !== undefined) return reason;
  if (controls.record.session.status !== 'idle') return 'A session is under way on this light. Stop it before starting another.';
  const state = controls.capture;
  if (!controls.captureLive || state === undefined) return 'Music capture status is unavailable. Refresh capture status first.';
  if (state.session.status !== 'idle' && state.session.input === 'microphone') {
    return 'Lights use Music.app input only, never a microphone. Stop the microphone measurement and start measuring Music.app.';
  }
  if (state.availability !== 'available' || state.endpointId === null) return 'Music input is unavailable.';
  if (startCapture(state, controls.captureLive) === undefined) return 'Start measuring Music.app first. Lights need active Music measurement.';
  const presets = controls.presets;
  if (!presets.live || presets.value === undefined) return presets.failed ? 'The saved preset library is unavailable.' : 'The saved preset library is stale or still loading.';
  if (presets.value.presets.length === 0) return 'No saved reactive presets. Save one in the Music effect preview first.';
  if (!presets.value.presets.some(preset => preset.presetId === controls.presetId)) return 'Choose a saved reactive preset.';
  if (controls.startLocked || controls.stopLocked) return 'Waiting for the previous lighting request. It is not sent again.';
  return undefined;
}
/** Stop is offered for every session that is not idle, including uncertain and stopping ones. */
export function stopBlocked(controls: LightingControls): string | undefined {
  const reason = common(controls);
  if (reason !== undefined) return reason;
  if (controls.record.session.status === 'idle') return 'No session is running on this light.';
  if (controls.stopLocked) return 'Waiting for the previous Stop. It is not sent again.';
  return undefined;
}

/** The core's record, which follows the light's own reports: only `active` means the light reported playing. */
export function sessionText(session: LightingState['session']): string {
  switch (session.status) {
    case 'idle': return 'Idle. No Music lighting session is running.';
    case 'starting': return 'Starting. The core saved the session and is waiting for the light to report playing.';
    case 'active': return 'Active. The light reported that it is playing this session.';
    case 'stopping': return 'Stopping. Waiting for the light to report how the session ended.';
    case 'uncertain': return 'Uncertain. An answer was lost or the runtime restarted. The light\'s next report decides; nothing is sent again.';
  }
}
const REASONS: Record<LightingEnded['reason'], string> = {
  stopped: 'stopped on request', alert: 'an agent alert interrupted it', manual: 'a manual change on the light took over',
  'source-lost': 'the Music input was lost or went stale', device: 'a light write or read failed', restart: 'the light module or runtime restarted',
  expired: 'the start expired before the light took it', refused: 'the light refused the start',
};
const RESTORATIONS: Record<LightingEnded['restoration'], string> = {
  restored: 'The current base scene and brightness were restored.',
  skipped: 'Restoration was skipped because the light had changed.',
  none: 'No restoration was attempted.',
  uncertain: 'Restoration is uncertain: a restoration write\'s answer was lost, so it may have landed.',
};
const CODE_HINTS: Partial<Record<string, string>> = {
  'invalid-state': 'The light must be on, already in Free mode on a named scene, and free of another session.',
  'unsupported-capability': 'Only the Lines render live Music, with a preset their renderer accepts.',
  unavailable: 'The light was held or could not be read.',
  'not-found': 'The saved preset no longer exists.',
  capacity: 'Other light content was waiting.',
  'revision-conflict': 'The light changed while the start was checked.',
};
/** The last ending as recorded, with its restoration and code; it never implies a restart. */
export function endingText(last: LightingEnded): string {
  const hint = last.code === undefined ? undefined : CODE_HINTS[last.code];
  return `Last session ended: ${REASONS[last.reason]}${last.code === undefined ? '' : ` (${last.code})`}. ${RESTORATIONS[last.restoration]}` +
    `${hint === undefined ? '' : ` ${hint}`} Nothing restarts automatically.`;
}

const CONTROL_HINTS: Partial<Record<string, string>> = {
  unavailable: 'Music capture is not active, or this is not a qualified light.',
  'revision-conflict': 'The light\'s session or the Music capture changed. Review the current state before trying again.',
  'invalid-state': 'A session is already under way, or there is none to stop.',
  'unsupported-capability': 'Only Music.app capture can drive lights.',
};
/** The operator command's outcome: the core saving the request, which is not the light's result. */
export function controlText(text: string): string {
  const refused = /^Refused \(([^)]+)\)/.exec(text)?.[1];
  const hint = refused === undefined ? undefined : CONTROL_HINTS[refused];
  return text.replace('The module observed the result.', 'The core saved it; the light reports separately.')
    .replace('Nothing was sent to the device.', 'No lighting work was sent.').replace('No evidence of a device effect.', 'No light evidence.') +
    (hint === undefined ? '' : ` ${hint}`);
}
/** The light module's answer to the core's work command, which is still not proof of a physical effect. */
export function workText(text: string): string {
  return text.replace('The module observed the result.', 'The light module observed the result.')
    .replace('Transmitted; physical effect was not observed.', 'Written to the light; the physical effect was not observed.');
}

/** The core's work request ID for one operator command and light, as `lightingWorkRequestId` derives it in the core. */
export async function lightingWorkId(requestId: string, target: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(['music-lighting-work', requestId, target])));
  return `lighting-${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}
