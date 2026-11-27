// Browser-safe list of commands eligible for an explicit Conversation request.
import type {Capabilities, DeviceRecord} from './devices.js';

export const SHOW_SAVE_WINDOW_MS = 30_000;

export const LIFX_COLOR_PARAMETERS = {
  hue: {unit: 'degree', minimum: 0, maximum: 360, step: 1},
  saturation: {unit: 'percent', minimum: 0, maximum: 100, step: 1},
} as const;

const lifx = 'bunny/modules/lifx', wemo = 'bunny/modules/wemo', nanoleaf = 'bunny/modules/nanoleaf';
const pixoo = 'bunny/modules/pixoo', tidbyt = 'bunny/modules/tidbyt', volcano = 'bunny/modules/volcano';
export const assistantDeviceOwners = [lifx, wemo, nanoleaf, pixoo, tidbyt, 'bunny/modules/roborock', volcano] as const;
export type CatalogDeviceOwner = typeof assistantDeviceOwners[number];

type DeviceRoute = {binding: 'device'; owners: readonly CatalogDeviceOwner[]; capability?: keyof Capabilities; fields: string; guardedMinor?: '2.1' | '2.3'};
type RecordRoute = {binding: 'record'; owner: string; record: string; fields: string};
type FixedRoute = {binding: 'fixed'; owner: string; target: string; fields: string};
type Route = DeviceRoute | RecordRoute | FixedRoute;

export const assistantRoutes = {
  'power-set': {binding: 'device', owners: [nanoleaf, pixoo], capability: 'power', fields: 'on'},
  'brightness-set': {binding: 'device', owners: [nanoleaf, pixoo, tidbyt], capability: 'brightness', fields: 'percent'},
  'device-mode-set': {binding: 'device', owners: [lifx, nanoleaf, pixoo, tidbyt], capability: 'modes', fields: 'mode'},
  'lifx-color-set': {binding: 'device', owners: [lifx], fields: 'hue saturation'},
  'lifx-temperature-set': {binding: 'device', owners: [lifx], fields: 'kelvin'},
  'scene-activate': {binding: 'device', owners: [nanoleaf], capability: 'scenes', fields: 'sceneId'},
  'moment-play': {binding: 'device', owners: [nanoleaf, pixoo, tidbyt], capability: 'moments', guardedMinor: '2.3', fields: 'momentId mood palette durationMs priorityClass coversStatus startAtMs toleranceMs'},
  'media-start': {binding: 'device', owners: [pixoo], capability: 'media', fields: 'playlistId'},
  'media-control': {binding: 'device', owners: [pixoo], capability: 'media', fields: 'action'},
  'pixoo-media-show': {binding: 'device', owners: [pixoo], capability: 'media', fields: 'renditionId playback'},
  'pixoo-monitor-set': {binding: 'device', owners: [pixoo], fields: 'filter cadenceMs'},
  'pixoo-now-playing-set': {binding: 'device', owners: [pixoo], fields: 'media'},
  'pixoo-moments-set': {binding: 'device', owners: [pixoo], fields: 'overStatus'},
  'nanoleaf-animation-play': {binding: 'device', owners: [nanoleaf], guardedMinor: '2.1', fields: 'animation'},
  'pixoo-playlist-change': {binding: 'device', owners: [pixoo], fields: 'change'},
  'pixoo-asset-change': {binding: 'device', owners: [pixoo], fields: 'change'},
  'pixoo-notice-dismiss': {binding: 'device', owners: [pixoo], fields: 'session noticeId'},
  'nanoleaf-wall-edit': {binding: 'device', owners: [nanoleaf], guardedMinor: '2.1', fields: 'edit'},
  'nanoleaf-machine-edit': {binding: 'device', owners: [nanoleaf], guardedMinor: '2.1', fields: 'edit'},
  'nanoleaf-favorite-edit': {binding: 'device', owners: [nanoleaf], guardedMinor: '2.1', fields: 'edit'},
  'nanoleaf-notice-acknowledge': {binding: 'device', owners: [nanoleaf], guardedMinor: '2.1', fields: 'task noticeId'},
  'nanoleaf-reactive-preset-save': {binding: 'fixed', owner: nanoleaf, target: 'reactive-presets', fields: 'presetId expectedRevision name recipe'},
  'wemo-hold-release': {binding: 'device', owners: [wemo], fields: 'heldRequestId'},
  'mode-override-set': {binding: 'record', owner: 'bunny/core', record: 'mode', fields: 'mode'},
  'notice-clear': {binding: 'record', owner: 'bunny/core', record: 'session', fields: 'noticeId'},
  'session-label-set': {binding: 'record', owner: 'bunny/core', record: 'session', fields: 'label'},
  'inbox-handle': {binding: 'record', owner: 'bunny/core', record: 'inbox-item', fields: 'action'},
  'home-layout-set': {binding: 'record', owner: 'bunny/core', record: 'home-layout', fields: 'layouts'},
  'lighting-layout-set': {binding: 'record', owner: 'bunny/core', record: 'lighting-layout', fields: 'layout'},
  'playback-layout-set': {binding: 'record', owner: 'bunny/core', record: 'playback-layout', fields: 'assignments'},
  'art-catalog-edit': {binding: 'fixed', owner: 'bunny/modules/art', target: 'art', fields: 'action artworkId favorite signal target'},
  'playback-control': {binding: 'record', owner: 'bunny/modules/playback', record: 'playback', fields: 'action'},
  'volcano-session-gap': {binding: 'record', owner: volcano, record: 'volcano-status', fields: 'gapMinutes'},
  'art-request': {binding: 'fixed', owner: 'bunny/modules/art', target: 'art', fields: 'format description showTargets'},
  'art-show': {binding: 'fixed', owner: 'bunny/core', target: 'hub', fields: 'artworkId targets coversStatus guards'},
  'nanoleaf-show-save': {binding: 'fixed', owner: nanoleaf, target: 'shows', fields: 'showId expectedVersion name versionName timeline'},
  'music-lighting-control': {binding: 'record', owner: 'bunny/core', record: 'music-lighting-state', fields: 'action showId version positionMs startDelayMs generation'},
} as const satisfies Readonly<Record<string, Route>>;

export type CatalogFamily = keyof typeof assistantRoutes;
export const catalogFamily = (value: unknown): value is CatalogFamily => typeof value === 'string' && Object.hasOwn(assistantRoutes, value);
export const catalogRoute = (family: CatalogFamily): Route => assistantRoutes[family];
type Identity = {target: string; owner: string};
export type CatalogBinding =
  | (Identity & {kind: 'device'; configurationRevision: number; generation: DeviceRecord['generation']})
  | (Identity & {kind: 'record'; revision: number})
  | (Identity & {kind: 'fixed'});
export type CatalogProposal = {family: 'catalog-action'; target: string; command: CatalogFamily; binding: CatalogBinding; data: Record<string, unknown>};

export function permitsDevice(route: DeviceRoute, device: DeviceRecord): boolean {
  return route.capability === undefined || device.capabilities[route.capability].supported;
}

/** Parameter and binding checks apply both before saving an approval and at the core boundary. */
export function catalogProposal(value: unknown): CatalogProposal | undefined {
  if (!object(value) || value.family !== 'catalog-action' || !catalogFamily(value.command) ||
    !routingId(value.target) || !object(value.binding) || !object(value.data)) return undefined;
  const {command, target, binding, data} = value, route = catalogRoute(command);
  if (binding.target !== target || typeof binding.owner !== 'string' || binding.kind !== route.binding ||
    Object.keys(data).some(key => !route.fields.split(' ').includes(key))) return undefined;

  const identity = {target, owner: binding.owner};
  let checked: CatalogBinding;
  if (route.binding === 'device') {
    if (!route.owners.some(owner => owner === identity.owner) || !revision(binding.configurationRevision) ||
      !object(binding.generation) || typeof binding.generation.epoch !== 'string' || !revision(binding.generation.sequence)) return undefined;
    checked = {...identity, kind: 'device', configurationRevision: binding.configurationRevision,
      generation: {epoch: binding.generation.epoch, sequence: binding.generation.sequence}};
  } else if (route.binding === 'record') {
    if (identity.owner !== route.owner || !revision(binding.revision)) return undefined;
    checked = {...identity, kind: 'record', revision: binding.revision};
  } else {
    if (identity.owner !== route.owner || target !== route.target) return undefined;
    checked = {...identity, kind: 'fixed'};
  }
  return {family: 'catalog-action', target, command, binding: checked, data};
}

export function artDescription(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 300 && value.trim() !== '' && !/[\uD800-\uDFFF]/u.test(value);
}

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const revision = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export const routingId = (value: unknown): value is string => typeof value === 'string' && value.length <= 128 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);

/** The host's bounded, read-only view of core-owned device power history. */
export const DEVICE_HISTORY_VERSION = 'device-history/1.0';
export const DEVICE_HISTORY_SOURCES = ['bunny/modules/wemo', 'bunny/modules/lifx'] as const;
export type DeviceHistorySource = typeof DEVICE_HISTORY_SOURCES[number];
export type DeviceHistoryQuery = {source: DeviceHistorySource; target: string; fromAtMs: number; toAtMs: number};
export type DevicePower = 'on' | 'off' | 'unknown';
export type DeviceHistoryEvidence = {seq: number; messageId: string | null; atMs: number; power: DevicePower;
  kind: 'observation' | 'continuation' | 'gap' | 'removal'; confirmedThroughMs: number};
export type DeviceHistorySnapshot = {schema: typeof DEVICE_HISTORY_VERSION; query: DeviceHistoryQuery; boundary: number;
  complete: boolean; evidence: DeviceHistoryEvidence[]; durations: Record<DevicePower, number>;
  lastChange: {atMs: number; from: 'on' | 'off'; to: 'on' | 'off'; seq: number} | null;
  links: {requestId: string; sentSeq: number; transmissionOutcomeSeq: number; transmittedAtMs: number; observationSeq: number}[]};
export function deviceHistoryQuery(value: Record<string, unknown>): DeviceHistoryQuery | undefined {
  const {source, target, fromAtMs, toAtMs} = value;
  const owner = DEVICE_HISTORY_SOURCES.find(candidate => candidate === source);
  if (owner === undefined || !routingId(target) || typeof fromAtMs !== 'number' || !Number.isSafeInteger(fromAtMs) ||
    typeof toAtMs !== 'number' || !Number.isSafeInteger(toAtMs) || fromAtMs < 0 || fromAtMs >= toAtMs || toAtMs > 8_640_000_000_000_000 || toAtMs - fromAtMs > 7 * 86_400_000) return undefined;
  return {source: owner, target, fromAtMs, toAtMs};
}
