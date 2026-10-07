// The 2.0 device families (Hub #918): one device's full record, the general commands mapped from controller contract
// v1's closed command union, v1 admission's capability rule and the fixed Hub-mode table. Device-specific families,
// such as LIFX color or Pixoo media, belong to each module. `MAPPING.md` shows where each v1 field lands.
import type {ErrorDetail, Known, Message, MessageValidator, PayloadCheck, Ticket, Unknown} from './index.js';
import type {Mode, MomentPlayRequest} from './families.js';
import {defineFamily, registerFamilies, routedSubject, type PayloadFamily} from './registry.js';

/** A value that is either unknown or known. Missing evidence is unknown, never `false` or off. */
export type Tagged<T> = Unknown | Known<T>;
export type Unsupported = {supported: false};
export type MediaAction = 'pause' | 'resume' | 'stop' | 'next' | 'previous' | 'restart-with-changes' | 'clear';
/** What a device offers. Every capability is listed; a supported one carries its constraints. */
export type Capabilities = {
  power: Unsupported | {supported: true};
  brightness: Unsupported | {supported: true; minimum: 0; maximum: 100};
  /** The device's own native modes, such as Nanoleaf `work` or Pixoo `monitor`. Never the Hub's mode. */
  modes: Unsupported | {supported: true; values: string[]};
  moments: Unsupported | {supported: true; moods: string[]; maxDurationMs: number; coversStatus: boolean};
  media: Unsupported | {supported: true; actions: MediaAction[]; playlistIds: string[]; renditionIds: string[]};
  scenes: Unsupported | {supported: true; sceneIds: string[]};
  zones: Unsupported | {supported: true; zoneIds: string[]};
  preview: Unsupported | {supported: true; profiles: {profileId: string; profileVersion: string}[]};
};
/** The profile's completed outcome payload. */
export type CompletedOutcome = {
  requestId: string; result: 'succeeded' | 'failed' | 'uncertain'; evidence: 'transmitted' | 'observed' | 'none'; error?: ErrorDetail;
};
/**
 * `org.bunny.device.updated`: the full record of one device, published by the module that controls it. `unavailable`
 * means the module cannot reach the device. Desired and observed values stay separate, and only a reading from the
 * device is an observation, with its own evidence time.
 */
export type DeviceRecord = {
  id: string; revision: number; kind: string; label?: string;
  availability: 'unknown' | 'available' | 'degraded' | 'unavailable';
  configurationRevision: number; generation: Ticket;
  capabilities: Capabilities;
  desired: {power: Tagged<boolean>; brightness: Tagged<number>; mode: Tagged<string>};
  observed: Unknown | {status: 'known'; observedAtMs: number; power: Tagged<boolean>; brightness: Tagged<number>};
  /** Accepted commands not yet completed, and their command families, each once. */
  pending: number; pendingKinds: string[];
  lastOutcome: Unknown | {status: 'known'; outcome: CompletedOutcome};
  /** The last send that reached the transport, for a command (`requestId`) or a paint of the module's own. Never an observation. */
  lastTransmission: Unknown | {status: 'known'; requestId?: string; transmittedAtMs: number; operationIds: string[]};
  externalControl: Unknown | {status: 'known'; owner: 'module' | 'external'; observedAtMs: number};
};

/**
 * What every general command carries. A module refuses a stale configuration revision or generation with
 * `revision-conflict` before changing anything. The envelope subject names the device.
 */
export type CommandGuards = {requestId: string; expectedConfigurationRevision?: number; expectedGeneration?: Ticket};
export type PowerSetRequest = CommandGuards & {on: boolean};
export type BrightnessSetRequest = CommandGuards & {percent: number};
export type SceneActivateRequest = CommandGuards & {sceneId: string};
export type ZonePowerSetRequest = CommandGuards & {zoneId: string; on: boolean};
export type MediaStartRequest = CommandGuards & {playlistId: string};
export type MediaControlRequest = CommandGuards & {action: MediaAction};
/** A native mode the device advertises, never the Hub's mode: map that through `nativeMode` first. */
export type DeviceModeSetRequest = CommandGuards & {mode: string};
/** A command a device answers, named by its family. */
export type DeviceCommand =
  | {family: 'power-set'; data: PowerSetRequest}
  | {family: 'brightness-set'; data: BrightnessSetRequest}
  | {family: 'scene-activate'; data: SceneActivateRequest}
  | {family: 'zone-power-set'; data: ZonePowerSetRequest}
  | {family: 'media-start'; data: MediaStartRequest}
  | {family: 'media-control'; data: MediaControlRequest}
  | {family: 'device-mode-set'; data: DeviceModeSetRequest}
  | {family: 'moment-play'; data: MomentPlayRequest};

/**
 * Whether the device's capabilities allow a command, by controller v1 admission's rule: the capability is supported
 * and, where it lists them, the scene, zone, playlist, action, native mode or mood is among them, and a moment fits
 * the device's maximum duration. A module refuses any other command with `unsupported-capability`; whether a moment
 * may cover status is the writer's decision, not admission's.
 */
export function commandSupported(capabilities: Capabilities, command: DeviceCommand): boolean {
  const {power, brightness, scenes, zones, media, modes, moments} = capabilities;
  switch (command.family) {
    case 'power-set': return power.supported;
    case 'brightness-set': return brightness.supported;
    case 'scene-activate': return scenes.supported && scenes.sceneIds.includes(command.data.sceneId);
    case 'zone-power-set': return zones.supported && zones.zoneIds.includes(command.data.zoneId);
    case 'media-start': return media.supported && media.playlistIds.includes(command.data.playlistId);
    case 'media-control': return media.supported && media.actions.includes(command.data.action);
    case 'device-mode-set': return modes.supported && modes.values.includes(command.data.mode);
    case 'moment-play': return moments.supported && moments.moods.includes(command.data.mood) && command.data.durationMs <= moments.maxDurationMs;
  }
}

/** The device kinds that take part in the Hub mode. LIFX joins under #415; Tidbyt and playback do not take part. */
export type HubModeKind = 'nanoleaf' | 'pixoo';
/**
 * The fixed Hub-mode table (#695's settled decisions): the native mode each participating device kind is asked for
 * when the Hub selects a mode. It maps one way only. Pixoo's Monitor serves both Work and Quiet, so a device's mode
 * can never establish the Hub's, and the Hub's selection lives only in `mode/2.0`.
 */
export const HUB_MODE_TABLE: Readonly<Record<HubModeKind, Readonly<Record<Mode, string>>>> = Object.freeze({
  nanoleaf: Object.freeze({work: 'work', free: 'free', quiet: 'quiet'}),
  pixoo: Object.freeze({work: 'monitor', free: 'media', quiet: 'monitor'}),
});
const participating = (kind: string): kind is HubModeKind => Object.hasOwn(HUB_MODE_TABLE, kind);
/** The native mode a device of `kind` is asked for in the Hub's `mode`, or undefined when the kind does not take part. */
export function nativeMode(kind: string, mode: Mode): string | undefined {
  return participating(kind) ? HUB_MODE_TABLE[kind][mode] : undefined;
}

const after = (message: Message, atMs: number): boolean => atMs > Date.parse(message.time);
// A general command goes to one device, named by its subject.
const checkCommand = routedSubject('device');
const checkDevice: PayloadCheck = message => {
  const record = message.data as DeviceRecord;
  if (message.subject !== record.id) return 'envelope /subject not the entity';
  const {modes} = record.capabilities, {mode} = record.desired;
  if (mode.status === 'known' && !(modes.supported && modes.values.includes(mode.value))) return 'payload /desired/mode not an advertised mode';
  // Evidence is never newer than the message that reports it.
  if (record.observed.status === 'known' && after(message, record.observed.observedAtMs)) return 'payload /observed/observedAtMs after time';
  if (record.externalControl.status === 'known' && after(message, record.externalControl.observedAtMs)) {
    return 'payload /externalControl/observedAtMs after time';
  }
  if (record.lastTransmission.status === 'known' && after(message, record.lastTransmission.transmittedAtMs)) {
    return 'payload /lastTransmission/transmittedAtMs after time';
  }
  // Each pending command has a family, and the kinds list each family once.
  if (record.pending > 0 && record.pendingKinds.length === 0) return 'payload /pendingKinds missing for pending commands';
  return record.pendingKinds.length > record.pending ? 'payload /pendingKinds more kinds than pending commands' : undefined;
};

export type {PayloadFamily} from './registry.js';
/**
 * Every device family, in registration order. Each command type is `org.bunny.<entity>.<verb>.requested`, whose verb
 * is the family's last word. Replies, outcomes and removals use the payloads the profile owns.
 */
export const deviceFamilies: readonly PayloadFamily[] = [
  defineFamily('device', 'state', 'org.bunny.device.updated', checkDevice),
  defineFamily('power-set', 'command', 'org.bunny.power.set.requested', checkCommand),
  defineFamily('brightness-set', 'command', 'org.bunny.brightness.set.requested', checkCommand),
  defineFamily('scene-activate', 'command', 'org.bunny.scene.activate.requested', checkCommand),
  defineFamily('zone-power-set', 'command', 'org.bunny.zone-power.set.requested', checkCommand),
  defineFamily('media-start', 'command', 'org.bunny.media.start.requested', checkCommand),
  defineFamily('media-control', 'command', 'org.bunny.media.control.requested', checkCommand),
  defineFamily('device-mode-set', 'command', 'org.bunny.device-mode.set.requested', checkCommand),
];

/**
 * Registers every device family with its checks. Call it after `registerCoreFamilies`: a device label uses the session
 * family's display text, so registration without the core families throws.
 */
export function registerDeviceFamilies(validator: MessageValidator): void {
  registerFamilies(validator, deviceFamilies);
}
