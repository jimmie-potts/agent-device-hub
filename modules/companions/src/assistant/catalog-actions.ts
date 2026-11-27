import {randomUUID} from 'node:crypto';
import {containsControlValue, literalToolDeviceId, literalDeviceId, normalizedControlText, type SceneReceipt} from './control-intent.js';
import type {FieldAccess} from './sharing.js';
import {catalogCueReferences, catalogQuoteNames, catalogSelectorId, type CatalogReferenceRole} from './catalog-grounding.js';
import {operationOutcome, type ActionEvidence} from './closing-reply.js';
import {artDescription, assistantDeviceOwners, catalogFamily, catalogProposal, catalogRoute, permitsDevice, type CatalogBinding, type CatalogFamily, type CatalogProposal} from '@jimmie-potts/event-contracts/v2/assistant-actions';
import {ART_SHOW_EFFECTS_FAMILY, acceptsArtRendition, artDestination, artShowSurfaces, type ArtDestination, type ArtShowEffects, type ArtShowGuard, type ArtTargets} from '@jimmie-potts/event-contracts/v2/art-show';
import type {ArtRecord, ArtworkSummary, CatalogArtwork} from '@jimmie-potts/event-contracts/v2/art-state';
import type {ErrorBody, ErrorCode} from '@jimmie-potts/event-contracts/v2';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {OperationRecord, PlaybackState} from '@jimmie-potts/event-contracts/v2/families';
import type {LightingState} from '@jimmie-potts/event-contracts/v2/music-lighting-data';
import type {ShowCatalog} from '@jimmie-potts/event-contracts/v2/nanoleaf-shows';
import {draftProblem} from '@jimmie-potts/event-contracts/v2/nanoleaf-shows';
import {deviceFacts, deviceLabel, matchingDevices, MAX_OBSERVATION_AGE_MS, Outcome, readDeviceRecords, readLifxDeviceFacts, usableArtComposition,
  type LifxDeviceFacts, type ModuleContext, type OwnedDevice, type TraceContext} from '@jimmie-potts/sdk';
import type {DeviceReadDisplay} from './devices.js';
import {ShowDrafts, showCueIndex} from './show-drafts.js';
import {SET_LIFX_BRIGHTNESS} from './tool-scope.js';
import {textBytes, type ToolCall} from './provider.js';
import {catalogTool, CREATE_SHOW, MAX_CATALOG_ARGUMENTS, PREVIEW_SHOW, READ_ART, READ_ART_EFFECTS, READ_DEVICES, READ_OPERATION,
  READ_PLAYBACK, READ_SHOWS, READ_VACUUM, READ_VOLCANO} from './catalog-tools.js';

const CORE = 'bunny/core', NANOLEAF = 'bunny/modules/nanoleaf';
const LIFX = 'bunny/modules/lifx', WEMO = 'bunny/modules/wemo';
function lifxSupports(family: CatalogFamily, light: LifxDeviceFacts | undefined): boolean {
  return family === 'lifx-color-set' ? light?.capabilities.color.supported === true
    : family === 'lifx-temperature-set' ? light?.capabilities.temperature.supported === true : true;
}
const PLAYBACK = 'bunny/modules/playback', ART = 'bunny/modules/art', VOLCANO = 'bunny/modules/volcano';
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const idList = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 && value.length <= 3 &&
  value.every(item => typeof item === 'string' && /^[a-z0-9-]{1,128}$/.test(item)) && new Set(value).size === value.length;
function textResult(value: unknown): string {
  const text = JSON.stringify(value);
  if (textBytes(text) <= 4000) return text;
  return new TextDecoder().decode(new TextEncoder().encode(text).slice(0, 3950)) + '… (narrow the read to one item)';
}
type Proposed = {proposal: CatalogProposal; text: string; targets?: readonly (readonly string[])[]; knownTargets?: readonly (readonly string[])[]; draftRevision?: number; sceneReceipt?: SceneReceipt}
  | {question: string} | {code: ErrorCode};
type CanNameDevice = (id: string) => boolean;
type CatalogTarget = {id: string; label: string; owner?: string};
type CatalogTargetSource = 'artwork' | 'devices' | 'operations' | 'playback' | 'sessions' | 'shows' | 'status';
export type CatalogAdmission = {
  readonly selector: (kind: CatalogReferenceRole, selector: string, contextIds?: readonly string[]) => boolean;
  readonly hasSelection: (role: CatalogReferenceRole) => boolean;
  readonly target: (id: string, source: CatalogTargetSource, alternatives: readonly CatalogTarget[], implicit?: boolean, nested?: readonly string[]) => ErrorCode | undefined;
  readonly excludedNames: (role: CatalogReferenceRole) => readonly string[];
  readonly excluded: (role: CatalogReferenceRole, id: string, label?: string) => boolean;
  readonly lastActivatedScene: (deviceId: string, parent: TraceContext) => Promise<SceneReceipt | null | undefined>;
  readonly visible: (source: CatalogTargetSource, id: string) => boolean;
  readonly attachedArtwork?: (sourceRequestId: string, artworkIds: readonly string[], displays: readonly string[]) => boolean;
  readonly current: () => boolean;
  readonly covers: (ids: readonly string[]) => boolean;
  readonly ownerText: () => {text: string; explicitIds: readonly string[]};
};

export function deviceClarification(noun: string, ids: readonly string[], canName: CanNameDevice): string {
  const visible: string[] = [];
  for (const id of new Set(ids)) {
    if (canName(id)) visible.push(id);
    if (visible.length === 4) break;
  }
  return visible.length > 1
    ? `Which ${noun} did you mean? Matching device IDs: ${visible.map(id => noun === 'display' ? `id:${id}` : id).join(', ')}.`
    : `Which ${noun} did you mean? Give its exact device ID.`;
}
type Refusal = {code: ErrorCode};
type Match = OwnedDevice;
export type NamedDeviceLookup = {owner: string; target: string; request: string};
type ScopedDeviceFacts = {
  subject: string | undefined;
  named: NamedDeviceLookup | undefined;
  granted: (id: string) => boolean;
  recordNamed: (owner: string, id: string) => void;
  brightnessControl: boolean;
  resolve: (id: string) => void;
};
const normalize = (name: string): string => name.trim().toLocaleLowerCase();

/** Only registered identity-bearing fields can account for a nested explicit ID. */
function nestedSelectors(family: CatalogFamily, data: Record<string, unknown>): string[] {
  let selectors: readonly unknown[] = [];
  if (family === 'scene-activate') selectors = [catalogSelectorId('scene', data.sceneId)];
  else if (family === 'media-start') selectors = [catalogSelectorId('playlist', data.playlistId)];
  else if (family === 'pixoo-media-show') selectors = [catalogSelectorId('rendition', data.renditionId)];
  else if (family === 'art-show' || family === 'art-catalog-edit') selectors = [catalogSelectorId('artwork', data.artworkId)];
  else if (family === 'music-lighting-control' && data.action === 'start-show') selectors = [catalogSelectorId('draft', data.showId)];
  else if (family === 'nanoleaf-reactive-preset-save') selectors = [data.presetId];
  else if (family === 'pixoo-asset-change' && object(data.change) && data.change.operation !== 'import') selectors = [catalogSelectorId('asset', data.change.assetId)];
  else if (family === 'pixoo-playlist-change' && object(data.change) && data.change.operation !== 'create') selectors = [catalogSelectorId('playlist', data.change.playlistId)];
  else if (family === 'notice-clear') selectors = [data.noticeId];
  else if (family === 'pixoo-notice-dismiss') selectors = [data.session, data.noticeId];
  else if (family === 'nanoleaf-notice-acknowledge') selectors = [data.task, data.noticeId];
  else if (family === 'wemo-hold-release') selectors = [data.heldRequestId];
  return selectors.flatMap(value => typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}$/u.test(literalDeviceId(value) ?? value)
    ? [literalDeviceId(value) ?? value] : []);
}

function citedNestedIdentity(family: CatalogFamily, data: Record<string, unknown>, admission: CatalogAdmission): boolean {
  const cited = (role: CatalogReferenceRole, value: unknown): boolean =>
    typeof value === 'string' && admission.selector(role, value);
  if (family === 'notice-clear') return data.noticeId === null || cited('notice', data.noticeId);
  if (family === 'pixoo-notice-dismiss') return cited('session', data.session) && cited('notice', data.noticeId);
  if (family === 'nanoleaf-notice-acknowledge') return cited('session', data.task) && cited('notice', data.noticeId);
  if (family === 'wemo-hold-release') return data.heldRequestId === undefined || cited('operation', data.heldRequestId);
  if (family === 'nanoleaf-favorite-edit' && object(data.edit)) return cited('favorite', data.edit.name);
  if (family === 'pixoo-playlist-change' && object(data.change)) {
    const {items, itemIds} = data.change;
    if (Array.isArray(itemIds) && !itemIds.every(id => cited('playlist-item', id))) return false;
    if (Array.isArray(items) && !items.every(item =>
      object(item) && cited('rendition', item.renditionId) && (item.id === undefined || cited('playlist-item', item.id)))) return false;
  }
  return true;
}

function admittedRecord<T extends {id: string}>(records: readonly T[] | undefined, selector: string,
  label: (record: T) => string | undefined, source: CatalogTargetSource, admission?: CatalogAdmission, implicit = false, nested: readonly string[] = []): T | Refusal {
  if (admission?.current() === false) return {code: 'forbidden'};
  const visible = records?.filter(record => admission?.visible(source, record.id) ?? true);
  const selected = implicit && selector === 'auto' && visible?.length === 1 && visible[0] !== undefined ? visible[0] : namedRecord(visible, selector, label);
  if ('code' in selected) return selected;
  const alternatives = visible?.map(record => ({id: record.id, label: label(record) ?? record.id})) ?? [];
  const refused = admission?.target(selected.id, source, alternatives, implicit, nested);
  return refused === undefined ? selected : {code: refused};
}

function namedRecord<T extends {id: string}>(records: readonly T[] | undefined, selector: unknown,
  label: (record: T) => string | undefined): T | Refusal {
  if (typeof selector !== 'string' || selector.trim() === '' || selector.length > 131) return {code: 'invalid-request'};
  if (records === undefined) return {code: 'unavailable'};
  const exact = literalDeviceId(selector);
  const matches = records.filter(record => exact === undefined ? selector === record.id : exact === record.id);
  const candidates = matches.length > 0 || exact !== undefined ? matches : records.filter(record => {
    const name = label(record);
    return name !== undefined && normalize(name) === normalize(selector);
  });
  if (candidates.length > 1) return {code: 'invalid-state'};
  return candidates[0] ?? {code: 'not-found'};
}

export function chooseBrightnessSubject(matches: readonly Match[], answer?: string): Match | undefined {
  const selected = answer === undefined ? matches : matches.filter(({device}) => device.id === answer.trim().replace(/^id:/u, ''));
  return selected.length === 1 ? selected[0] : undefined;
}

/** A bounded read through the Art owner's public SDK content manifest for an exact retained ID outside recent state. */
export type CatalogIdentityQuery = {kind: 'scene'; deviceId: string; name: string} |
  ({kind: 'asset'; currentText?: string} & ({name: string; id?: never} | {id: string; name?: never}));
export type CatalogIdentityRead = (query: CatalogIdentityQuery, timeoutMs: number) => Promise<{id: string} | ErrorBody>;

export type RetainedArtworkRead = (artworkId: string, timeoutMs: number) => Promise<CatalogArtwork | ErrorBody | undefined>;

export class ConversationActions {
  #drafts: ShowDrafts | undefined;
  constructor(private readonly context: ModuleContext, private readonly enabled: readonly string[],
    private readonly deviceDisplay: DeviceReadDisplay, private readonly retainedArtwork?: RetainedArtworkRead,
    private readonly readIdentity?: CatalogIdentityRead) {}

  async #snapshot<T extends object>(owner: string, family: string, parent: TraceContext): Promise<readonly T[] | undefined> {
    const result = await this.context.sdk.sync<T>([family], () => {}, {owner, timeoutMs: 1200, parent});
    if (result.status !== 'synced') return undefined;
    try {
      return result.copy.states().filter(message => message.source === owner).map(message => message.data);
    } finally {await result.copy.close();}
  }

  async #deviceRecords(owners: readonly string[], parent: TraceContext): Promise<{rows: Match[]; unreadable: string[]}> {
    return readDeviceRecords(this.context.sdk, owners, {timeoutMs: 1200, parent});
  }

  async deviceSubjectMatches(subject: string, parent: TraceContext): Promise<Match[]> {
    const {rows} = await this.#deviceRecords(assistantDeviceOwners, parent);
    const id = literalDeviceId(subject);
    return rows.filter(({device}) => id === undefined ? [device.id, deviceLabel(device)].some(value => normalizedControlText(value) === subject) : device.id === id);
  }

  async namedDeviceMatch({owner, target, request}: NamedDeviceLookup, granted: (id: string) => boolean, parent: TraceContext): Promise<Match | undefined> {
    const owners = owner === 'auto' ? assistantDeviceOwners : assistantDeviceOwners.filter(source => source === owner);
    const {rows} = await this.#deviceRecords(owners, parent);
    const visible = rows.filter(({device}) => granted(device.id));
    const literal = literalToolDeviceId(target);
    // A longer permitted name in the request cannot authorize a shorter alias.
    if (literal === undefined && visible.some(({device}) => [device.id, deviceLabel(device)].some(value =>
      normalizedControlText(value) !== normalizedControlText(target) && containsControlValue(value, target) && containsControlValue(request, value)))) return undefined;
    const matches = matchingDevices(visible, target, owner, literal);
    return matches.length === 1 ? matches[0] : undefined;
  }

  async #artDestinations(parent: TraceContext): Promise<ArtDestination[] | undefined> {
    const directory = (await this.#snapshot<ArtTargets>(CORE, 'art-targets', parent))?.[0];
    if (directory === undefined) return undefined;
    const owners = [...new Set(directory.targets.map(item => 'bunny/modules/' + item.kind))];
    const {rows} = await this.#deviceRecords(owners, parent);
    return directory.targets.map(item => artDestination(item, rows.find(row =>
      row.owner === 'bunny/modules/' + item.kind && row.device.id === item.target)?.device));
  }

  async #artSelection(names: unknown, parent: TraceContext, canNameDevice: CanNameDevice, artwork?: ArtworkSummary,
    requestedFormat?: 'png' | 'gif', visible?: (id: string) => boolean): Promise<
    {targets: string[]; labels: string[]; guards: ArtShowGuard[]; known: readonly (readonly string[])[]} | {question: string} | Refusal> {
    if (!Array.isArray(names) || names.length > 3 || !names.every((value): value is string =>
      typeof value === 'string' && value.trim().length > 0 && value.length <= (value.startsWith('id:') ? 131 : 128))) return {code: 'invalid-request'};
    const targets: string[] = [], labels: string[] = [], guards: ArtShowGuard[] = [];
    if (names.length === 0) return {targets, labels, guards, known: []};
    const configured = names.every(name => normalize(name) === 'browser') ? [] : await this.#artDestinations(parent);
    if (configured === undefined) return {code: 'unavailable'};
    const devices = visible === undefined ? configured : configured.filter(device => visible(device.target));
    const lookup = (name: string) => {
      const key = normalizedControlText(name);
      const exactId = name.startsWith('id:') ? name.slice(3) : name;
      const exact = devices.filter(device => device.target === exactId);
      const matches = name.startsWith('id:') ? exact : key === 'pixoo' || key === 'tidbyt' ? devices.filter(device => device.kind === key || device.target === key)
        : devices.filter(device => normalizedControlText(device.target) === key || normalizedControlText(device.label ?? device.target) === key);
      const eligible = matches.filter(device => device.guard !== undefined &&
        (requestedFormat === undefined || device.formats?.includes(requestedFormat) === true) &&
        (artwork === undefined || acceptsArtRendition(device, usableArtComposition(artwork, device.kind)?.renditions[0])));
      return {matches, eligible};
    };
    const browser = (name: string) => normalize(name) === 'browser' || normalize(name) === 'ui' && !devices.some(device => device.target === 'ui');
    for (const name of names) {
      if (browser(name)) {
        if (artwork !== undefined && usableArtComposition(artwork, 'ui') === undefined) return {question: 'This artwork has no browser rendition. Which available destination would you like?'};
        if (targets.includes('browser')) return {code: 'invalid-request'};
        targets.push('browser'); labels.push('Browser');
        continue;
      }
      const {matches, eligible} = lookup(name);
      if (eligible.length > 1) return {question: deviceClarification('display', eligible.map(device => device.target), canNameDevice)};
      const selected = eligible[0];
      if (selected?.guard === undefined) {
        if (matches.length === 0) return {question: 'No configured art display matches the request. Which destination would you like?'};
        if (matches.every(device => device.guard === undefined)) return {question: 'The selected display is unavailable for an art show. Which destination would you like?'};
        if (requestedFormat !== undefined) return {question: 'The selected display does not accept ' + requestedFormat.toUpperCase() + '. Which format or destination would you like?'};
        return {question: 'This artwork has no compatible rendition for the selected display. Choose another destination or request a new rendition separately.'};
      }
      if (targets.includes(selected.target) || guards.length === 2) return {code: 'invalid-request'};
      targets.push(selected.target);
      labels.push(selected.label === undefined || selected.label === selected.target ? selected.target : `${selected.label} (${selected.target})`);
      guards.push(selected.guard);
    }
    return {targets, labels, guards, known: devices.map(device => [device.target, device.label ?? device.target])};
  }

  async #operation(requestId: unknown, parent: TraceContext): Promise<OperationRecord | undefined> {
    const operations = await this.#snapshot<OperationRecord>(CORE, 'operation', parent);
    return operations?.find(row => row.requestId === requestId && row.requestedBy === this.context.sdk.source);
  }

  async lastActivatedScene(deviceId: string,
    candidatesNow: () => readonly {requestId: string; sceneId: string; permitted: boolean}[], parent: TraceContext): Promise<SceneReceipt | undefined> {
    const operations = await this.#snapshot<OperationRecord>(CORE, 'operation', parent);
    if (operations === undefined) return undefined;
    const candidates = candidatesNow();
    const relevant = operations.filter(row => row.target === deviceId && row.family === 'scene-activate');
    const ruledOut = (row: OperationRecord): boolean => row.status === 'expired' || row.status === 'rejected' ||
      row.status === 'completed' && row.result === Outcome.failed;
    const ordered = relevant.filter(row => !ruledOut(row)).sort((a, b) => b.sentAtMs - a.sentAtMs);
    const [latest, next] = ordered;
    if (latest?.status !== 'completed' || latest.result !== Outcome.succeeded || latest.sentAtMs === next?.sentAtMs ||
      latest.requestedBy !== this.context.sdk.source) return undefined;
    const index = candidates.findIndex(candidate => candidate.requestId === latest.requestId);
    if (index < 0 || candidates.slice(0, index).some(candidate => !relevant.some(row => row.requestId === candidate.requestId))) return undefined;
    const candidate = candidates[index];
    if (candidate?.permitted === true) return {requestId: latest.requestId, revision: latest.revision, sceneId: candidate.sceneId};
    return undefined;
  }

  async #canonicalExclusion(kind: 'scene' | 'asset', id: string, deviceId: string, guard: () => ErrorCode | undefined,
    admission?: CatalogAdmission): Promise<ErrorCode | undefined> {
    if (admission?.excluded(kind, id) === true) return 'not-found';
    const names = admission?.excludedNames(kind).filter(name => catalogSelectorId(kind, name) === undefined) ?? [];
    if (names.length === 0) return undefined;
    const read = this.readIdentity;
    if (read === undefined) return 'unavailable';
    const matches = await Promise.all(names.map(name => read(kind === 'scene' ? {kind, deviceId, name} : {kind, name}, 1200)));
    const changed = guard();
    if (changed !== undefined) return changed;
    if (matches.some(match => 'id' in match && match.id === id)) return 'not-found';
    const refusal = matches.find(match => 'error' in match && match.error.code !== 'not-found');
    return refusal !== undefined && 'error' in refusal ? refusal.error.code : undefined;
  }

  #authoring(): ShowDrafts {return this.#drafts ??= new ShowDrafts(this.context.database());}

  async #saveData(call: ToolCall, parent: TraceContext, admission?: CatalogAdmission): Promise<{draftRevision: number; data: Record<string, unknown>} | Refusal> {
    const drafts = this.#authoring();
    const selector = call.input.draftId;
    if (admission !== undefined && (typeof selector !== 'string' || !admission.selector('draft', selector))) return {code: 'not-found'};
    const allowed = (id: string) => admission?.visible('shows', id) ?? true;
    const selected = drafts.find(selector, allowed);
    if ('code' in selected) return selected;
    const selectedRefusal = admission?.target(selected.value.showId, 'shows', drafts.references(allowed));
    if (selectedRefusal !== undefined) return {code: 'not-found'};
    const revision = call.input.revision === -1 ? selected.revision : call.input.revision;
    let draft = selected;
    if (draft.revision !== revision) return {code: 'revision-conflict'};
    const readStarted = this.context.clock.now();
    const library = (await this.#snapshot<ShowCatalog>(NANOLEAF, 'nanoleaf-shows', parent))?.[0];
    if (library === undefined) return {code: 'unavailable'};
    if (admission !== undefined && (!admission.current() || !allowed(selected.value.showId))) return {code: 'not-found'};
    const refreshed = drafts.read(selected.value.showId);
    if (refreshed === undefined) return {code: 'not-found'};
    draft = refreshed;
    if (draft.revision !== revision) return {code: 'revision-conflict'};
    const {showId, expectedVersion} = draft.value;
    const current = library.shows.find(show => show.id === showId);
    const pending = draft.pending;
    if (pending !== null) {
      const saved = current?.versions.find(version => version.version === expectedVersion + 1);
      if (saved?.savedByRequest === pending.requestId) {
        drafts.confirmSave(draft);
      } else if (readStarted >= pending.admitByMs) {
        // The owner checks this same deadline inside its save transaction. A fresh approval can proceed.
        drafts.clearSave(showId, pending.requestId);
      } else {
        return {code: 'uncertain-result'};
      }
      const updated = drafts.read(showId);
      if (updated === undefined) return {code: 'not-found'};
      draft = updated;
    }
    const versionName = call.input.versionName;
    if (typeof versionName !== 'string') return {code: 'invalid-request'};
    const head = current?.version ?? 0;
    if (head < draft.value.expectedVersion) return {code: 'revision-conflict'};
    const value = {...draft.value, expectedVersion: head, versionName};
    if (draftProblem(value) !== undefined) return {code: 'invalid-request'};
    return {draftRevision: draft.revision, data: value};
  }

  /** The input's effect fields never supply routing or revision guards. */
  async propose(family: CatalogFamily, call: ToolCall, parent: TraceContext, canNameDevice: CanNameDevice, admission?: CatalogAdmission): Promise<Proposed> {
    if (family === 'art-request') {
      const {format, description} = call.input;
      if (!artDescription(description) || (format !== 'gif' && format !== 'still')) return {code: 'invalid-request'};
      const selected = await this.#artSelection(call.input.showTargets ?? [], parent, canNameDevice, undefined, format === 'gif' ? 'gif' : 'png');
      if (!('targets' in selected)) return selected;
      const data = {format, description: description.trim(), ...(selected.targets.length > 0 ? {showTargets: selected.targets} : {})};
      const binding = {kind: 'fixed', owner: ART, target: 'art'} as const;
      return {proposal: {family: 'catalog-action', command: family, target: 'art', binding, data},
        text: `Create ${format === 'gif' ? 'an animated GIF' : 'a still image'} for this reply? This may use the art allowance. ${data.description}${selected.labels.length > 0 ? '. When ready, review showing it on ' + selected.labels.join(', ') + '.' : ''}`};
    }
    const route = catalogRoute(family);
    const owner = family === 'nanoleaf-show-save' ? NANOLEAF : call.input.owner;
    const name = family === 'nanoleaf-show-save' ? 'shows' : call.input.target;
    const literalId = route.binding === 'device' ? literalToolDeviceId(name) : undefined;
    if (typeof owner !== 'string' || typeof name !== 'string' || name.length === 0 || (literalId ?? name).length > 128) return {code: 'invalid-request'};
    let data: Record<string, unknown>;
    let draftRevision: number | undefined;
    let sceneReceipt: SceneReceipt | undefined;
    if (family === 'nanoleaf-show-save') {
      const saved = await this.#saveData(call, parent, admission);
      if ('code' in saved) return saved;
      ({draftRevision, data} = saved);
    } else {
      const args = call.input.arguments;
      if (typeof args !== 'string' || textBytes(args) > MAX_CATALOG_ARGUMENTS) return {code: 'invalid-request'};
      let value: unknown;
      try {value = JSON.parse(args);} catch {return {code: 'invalid-request'};}
      if (!object(value)) return {code: 'invalid-request'};
      data = value;
    }
    if (family === 'moment-play' && Object.keys(data).every(key => ['mood', 'palette', 'durationMs', 'coversStatus'].includes(key))) {
      data = {...data, momentId: randomUUID(), priorityClass: 'flourish', coversStatus: data.coversStatus ?? false,
        startAtMs: this.context.clock.now(), toleranceMs: 2000};
    }
    let binding: CatalogBinding;
    let deviceApproval: string | undefined;
    let targets: readonly (readonly string[])[] | undefined;
    let knownTargets: readonly (readonly string[])[] | undefined;
    if (route.binding === 'device') {
      const owners = owner === 'auto' ? route.owners : route.owners.filter(source => source === owner);
      if (owners.length === 0) return {code: 'unsupported-capability'};
      const {rows, unreadable} = await this.#deviceRecords(route.owners, parent);
      const visible = rows.filter(row => admission?.visible('devices', row.device.id) !== false);
      const eligible = visible.filter(row => owners.some(owner => owner === row.owner));
      const found = matchingDevices(eligible, name, owner, literalId);
      const selected = found[0];
      const nested = nestedSelectors(family, data);
      const heldId = family === 'wemo-hold-release' ? selected?.device.held?.requestId : undefined;
      if (heldId !== undefined && admission?.selector('operation', heldId) === true) nested.push(heldId);
      const alternatives = (admission === undefined ? eligible : visible.filter(row => row === selected || permitsDevice(route, row.device)))
        .map(({owner, device}) => ({owner, id: device.id, label: deviceLabel(device)}));
      if (found.length > 1 && selected !== undefined) {
        const result = admission?.target(selected.device.id, 'devices', alternatives, false, nested);
        if (result !== undefined && result !== 'invalid-state') return {code: 'not-found'};
        return {question: deviceClarification('device', found.map(({device}) => device.id), canNameDevice)};
      }
      if (selected === undefined) return {code: admission === undefined && unreadable.length > 0 ? 'unavailable' : 'not-found'};
      const {device} = selected;
      targets = [[device.id, deviceLabel(device)]];
      knownTargets = visible.filter(row => permitsDevice(route, row.device)).map(row => [row.device.id, deviceLabel(row.device)]);
      const guard = () => admission?.target(device.id, 'devices', alternatives, false, nested);
      const refused = guard();
      if (refused !== undefined) {
        const matching = alternatives.filter(item => catalogQuoteNames(deviceLabel(device), item.id, item.label));
        return refused === 'invalid-state' ? {question: deviceClarification('device', matching.map(item => item.id), canNameDevice)} : {code: refused};
      }
      if (admission !== undefined && !citedNestedIdentity(family, data, admission)) return {code: 'invalid-request'};
      if (!permitsDevice(route, device)) return {code: 'unsupported-capability'};
      if (selected.owner === 'bunny/modules/pixoo') {
        const resolved = await this.#pixooCatalog(family, data, device, parent, guard, admission);
        if (!('data' in resolved)) return resolved;
        ({data} = resolved);
      }
      const {modes, scenes, moments, media} = device.capabilities;
      const sceneSelector = data.sceneId;
      if (family === 'scene-activate' && typeof sceneSelector === 'string') {
        const previous = await admission?.lastActivatedScene(device.id, parent);
        if (previous !== undefined) {
          if (previous === null || sceneSelector !== 'last-activated' || !scenes.supported || !scenes.sceneIds.includes(previous.sceneId)) {
            return {question: 'Which saved scene would you like to activate on this light?'};
          }
          if (guard() !== undefined) return {code: 'forbidden'};
          sceneReceipt = previous;
          data = {...data, sceneId: previous.sceneId};
        } else {
          if (admission !== undefined && !admission.selector('scene', sceneSelector, [device.id])) return {code: 'invalid-request'};
          data = {...data, sceneId: literalDeviceId(sceneSelector) ?? sceneSelector};
        }
      }
      if (family === 'scene-activate' && scenes.supported && typeof data.sceneId === 'string' &&
        !scenes.sceneIds.includes(data.sceneId) && !/^scene-[a-f0-9]{64}$/u.test(data.sceneId) && this.readIdentity !== undefined) {
        const match = await this.readIdentity({kind: 'scene', deviceId: device.id, name: data.sceneId}, 1200);
        const change = guard();
        if (change !== undefined) return {code: 'forbidden'};
        if ('error' in match) return match.error.code === 'invalid-state'
          ? {question: 'More than one saved scene has that name on this light. Which scene ID should I use?'}
          : {code: match.error.code};
        data = {...data, sceneId: match.id};
      }
      if (family === 'scene-activate' && typeof data.sceneId === 'string') {
        const exclusion = await this.#canonicalExclusion('scene', data.sceneId, device.id, guard, admission);
        if (exclusion !== undefined) return exclusion === 'invalid-state'
          ? {question: 'Which saved scene would you like to activate on this light?'} : {code: exclusion};
      }

      if (family === 'device-mode-set' && (!modes.supported || !modes.values.some(value => value === data.mode)) ||
        family === 'scene-activate' && (!scenes.supported || !scenes.sceneIds.some(id => id === data.sceneId)) ||
        family === 'media-start' && (!media.supported || selected.owner !== 'bunny/modules/pixoo' && !media.playlistIds.some(id => id === data.playlistId)) ||
        family === 'media-control' && (!media.supported || !media.actions.some(action => action === data.action)) ||
        family === 'pixoo-media-show' && (!media.supported || !media.renditionIds.some(id => id === data.renditionId))) {
        return {code: 'unsupported-capability'};
      }
      if (family === 'moment-play') {
        if (!moments.supported || !moments.moods.some(mood => mood === data.mood) || data.coversStatus === true && !moments.coversStatus) {
          return {code: 'unsupported-capability'};
        }
        if (typeof data.durationMs !== 'number' || !Number.isSafeInteger(data.durationMs) || data.durationMs <= 0 ||
          data.durationMs > moments.maxDurationMs || typeof data.coversStatus !== 'boolean') return {code: 'invalid-request'};
      }
      if (family === 'lifx-color-set' || family === 'lifx-temperature-set') {
        const lights = await readLifxDeviceFacts(this.context.sdk, {timeoutMs: 1200, parent});
        const light = lights?.find(candidate => candidate.id === device.id);
        if (light === undefined) return {code: 'unavailable'};
        if (!lifxSupports(family, light)) return {code: 'unsupported-capability'};
      }
      if (family === 'wemo-hold-release') {
        if (device.held === undefined || data.heldRequestId !== undefined && data.heldRequestId !== device.held.requestId) return {code: 'revision-conflict'};
        if (admission?.excluded('operation', device.held.requestId) === true ||
          admission?.hasSelection('operation') === true && !admission.selector('operation', device.held.requestId)) return {code: 'not-found'};
        data = {...data, heldRequestId: device.held.requestId};
      } else if (device.held !== undefined) return {code: 'unavailable'};
      binding = {kind: 'device', target: device.id, owner: selected.owner, configurationRevision: device.configurationRevision, generation: device.generation};
      if (family === 'brightness-set' && selected.owner === 'bunny/modules/pixoo') {
        if (typeof data.percent !== 'number' || !Number.isSafeInteger(data.percent) || data.percent < 0 || data.percent > 100) {
          return {code: 'invalid-request'};
        }
        deviceApproval = `Set ${deviceLabel(device)} brightness to ${data.percent}%?`;
      }
    } else if (route.binding === 'record') {
      if (owner !== route.owner) return {code: 'forbidden'};
      if (admission !== undefined && !citedNestedIdentity(family, data, admission)) return {code: 'invalid-request'};
      const guarded = family === 'playback-control' ? await this.#playback(name, data, parent, admission)
        : family === 'volcano-session-gap' ? await this.#volcano(name, data, parent, admission)
          : family === 'music-lighting-control' ? await this.#lighting(name, data, parent, admission)
            : await this.#coreSetting(family, route.record, name, data, parent, admission);
      if ('code' in guarded) return guarded;
      ({binding, data} = guarded);
    } else {
      if (owner !== route.owner || name !== route.target) return {code: 'forbidden'};
      binding = {kind: 'fixed', target: route.target, owner};
      if (family !== 'art-show' && family !== 'nanoleaf-show-save' &&
        admission !== undefined && !admission.covers([route.target, ...nestedSelectors(family, data)])) return {code: 'not-found'};
      if (family === 'nanoleaf-reactive-preset-save') {
        const selector = data.presetId ?? data.name;
        if (admission !== undefined && (typeof selector !== 'string' || !admission.selector('preset', selector))) return {code: 'not-found'};
        if (admission?.visible('status', route.target) === false) return {code: 'forbidden'};
        const library = (await this.#snapshot<{revision: number; presets: readonly {presetId: string; name: string}[]}>(
          NANOLEAF, 'nanoleaf-reactive-presets', parent))?.[0];
        if (admission?.visible('status', route.target) === false) return {code: 'forbidden'};
        if (library === undefined) return {code: 'unavailable'};
        const {presetId, expectedRevision, name} = data;
        if (expectedRevision !== undefined && expectedRevision !== library.revision) return {code: 'revision-conflict'};
        if (presetId === undefined && typeof name === 'string') {
          const named = library.presets.filter(preset => normalize(preset.name) === normalize(name));
          if (named.length > 1) return {question: 'Which saved reactive preset should change?'};
          data = {...data, presetId: named[0]?.presetId ?? `preset-${randomUUID()}`};
        }
        const preset = library.presets.find(candidate => candidate.presetId === data.presetId);
        if (preset !== undefined && admission?.excluded('preset', preset.presetId, preset.name) === true) return {code: 'not-found'};
        data = {...data, expectedRevision: library.revision};
      }
    }
    let showText: string | undefined;
    const contextDisplays = family === 'art-show' && Array.isArray(data.targets) ? data.targets.flatMap(target =>
      typeof target === 'string' ? [literalDeviceId(target) ?? target] : []) : [];
    if (family === 'art-catalog-edit' && admission !== undefined &&
      (typeof data.artworkId !== 'string' || !admission.selector('artwork', data.artworkId) || !admission.visible('artwork', data.artworkId))) {
      return {code: 'not-found'};
    }
    if (family === 'art-show') {
      if (!Array.isArray(data.targets) || data.targets.length === 0 || 'guards' in data) return {code: 'invalid-request'};
      if (typeof data.artworkId !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(data.artworkId)) {
        return {question: 'Which saved artwork should I use? Give its ID or refer to an artwork already in this conversation.'};
      }
      const artworkId = data.artworkId;
      if (admission !== undefined && contextDisplays.every(name => normalize(name) === 'browser') &&
        !admission.covers([binding.target, artworkId, 'browser'])) return {code: 'not-found'};
      if (admission?.visible('artwork', artworkId) === false || admission?.excluded('artwork', artworkId) === true) return {code: 'not-found'};
      const art = (await this.#snapshot<ArtRecord>(ART, 'art', parent))?.[0];
      if (admission?.visible('artwork', artworkId) === false) return {code: 'not-found'};
      if (art === undefined) return {code: 'unavailable'};
      const recent = art.artworks.find(item => item.artworkId === artworkId);
      const job = art.jobs.find(item => item.artworkId === artworkId);
      const artworkIds = art.artworks.map(item => item.artworkId);
      const displayIds = contextDisplays.filter(id => !artworkIds.includes(id));
      const explicit = admission === undefined || admission.selector('artwork', artworkId, displayIds);
      const attachment = !explicit && recent !== undefined && job?.status === 'finished' && job.outcome === Outcome.succeeded &&
        admission.attachedArtwork?.(job.requestId, artworkIds, displayIds) === true ? job.requestId : undefined;
      if (!explicit && attachment === undefined) {
        // A single visible item can explain the incompatibility. A show still needs an identified artwork.
        if (admission.covers([artworkId, 'browser']) && recent !== undefined && contextDisplays.length === 1 && normalize(contextDisplays[0] ?? '') === 'browser' &&
          usableArtComposition(recent, 'ui') === undefined && art.artworks.filter(item => admission.visible('artwork', item.artworkId)).length === 1) {
          return {question: 'This artwork has no browser rendition. Which available destination would you like? Give the artwork ID as well.'};
        }
        return {code: 'not-found'};
      }
      const retained = recent === undefined || job === undefined ? await this.retainedArtwork?.(artworkId, 1200) : undefined;
      if (admission?.visible('artwork', artworkId) === false) return {code: 'not-found'};
      if (retained !== undefined && 'error' in retained) return {code: retained.error.code};
      const artwork = recent ?? retained;
      if (artwork === undefined) return {code: 'not-found'};
      const selected = await this.#artSelection(data.targets, parent, canNameDevice, artwork, undefined,
        admission === undefined ? undefined : id => admission.visible('devices', id));
      if (admission?.visible('artwork', artworkId) === false ||
        attachment !== undefined && admission?.attachedArtwork?.(attachment, artworkIds, displayIds) !== true) return {code: 'not-found'};
      if (!('targets' in selected)) return selected;
      if (admission !== undefined && !admission.covers([binding.target, artworkId, ...selected.targets])) return {code: 'not-found'};
      const sourceRequestId = job?.requestId ?? retained?.sourceRequestId;
      const attached = sourceRequestId === undefined ? undefined : this.context.database().prepare(
        'SELECT description FROM assistant_art_attachments WHERE request_id=?').get(sourceRequestId);
      const title = typeof attached?.description === 'string' ? attached.description : 'saved artwork ' + artwork.artworkId;
      showText = 'Show ' + title + ' on ' + selected.labels.join(', ') + '?' + (data.coversStatus === false ? ' Keep status visible.' : '');
      knownTargets = selected.known;
      targets = selected.targets.map((target, index) => [target, selected.labels[index]?.split(' (')[0] ?? target]);
      data = {...data, targets: selected.targets, guards: selected.guards};
    }
    const proposal = catalogProposal({family: 'catalog-action', command: family, target: binding.target, binding, data});
    if (proposal === undefined) return {code: 'invalid-request'};
    if (family === 'nanoleaf-show-save' && typeof data.showId === 'string') targets = [[data.showId]];
    const order = family === 'pixoo-playlist-change' && object(data.change) && data.change.operation === 'order' &&
      Array.isArray(data.change.itemIds) ? `Reorder ${String(data.change.itemIds.length)} items in playlist ${String(data.change.playlistId)} on ${binding.target}` : undefined;
    const effect = family === 'nanoleaf-show-save'
      ? `Save draft ${String(data.name)} (${String(data.showId)}) as “${String(data.versionName)}”, version ${Number(data.expectedVersion) + 1}?`
      : deviceApproval ?? showText ?? order ?? `${family} on ${binding.target} (${binding.owner}): ${JSON.stringify(data)}`;
    if (effect.length > 1024) return {code: 'capacity'};
    return {proposal, text: effect, ...(targets === undefined ? {} : {targets}), ...(knownTargets === undefined ? {} : {knownTargets}),
      ...(draftRevision === undefined ? {} : {draftRevision}), ...(sceneReceipt === undefined ? {} : {sceneReceipt})};
  }

  async #pixooCatalog(family: CatalogFamily, data: Record<string, unknown>, device: DeviceRecord,
    parent: TraceContext, guard: () => ErrorCode | undefined, admission?: CatalogAdmission): Promise<{data: Record<string, unknown>} | Refusal | {question: string}> {
    const {media} = device.capabilities;
    if (family === 'media-start' || family === 'pixoo-playlist-change') {
      const change = data.change;
      if (family === 'pixoo-playlist-change' && (!object(change) || change.operation === 'create')) return {data};
      const selector = family === 'media-start' ? data.playlistId : object(change) ? change.playlistId : undefined;
      if (admission !== undefined && (typeof selector !== 'string' || !admission.selector('playlist', selector, [device.id]))) return {code: 'invalid-request'};
      const playlistId = catalogSelectorId('playlist', selector);
      if (family === 'media-start' && playlistId !== undefined && (admission?.excludedNames('playlist').length ?? 0) === 0) {
        // The device advertises a preview. The Pixoo writer validates an exact ID against its full library.
        return {data: {...data, playlistId}};
      }
      const playlists = await this.#snapshot<{id: string; name: string; playlistRevision: number}>('bunny/modules/pixoo', 'pixoo-playlist', parent);
      if (guard() !== undefined) return {code: 'forbidden'};
      const selected = namedRecord(playlists, selector, playlist => playlist.name);
      if ('code' in selected) return selected;
      if (admission?.excluded('playlist', selected.id, selected.name) === true) return {code: 'not-found'};
      if (family === 'media-start') return {data: {...data, playlistId: selected.id}};
      if (!object(change)) return {code: 'invalid-request'};
      if (change.revision !== undefined && change.revision !== selected.playlistRevision) return {code: 'revision-conflict'};
      return {data: {...data, change: {...change, playlistId: selected.id, revision: selected.playlistRevision}}};
    }
    if (family === 'pixoo-media-show' && admission !== undefined &&
      (typeof data.renditionId !== 'string' || !admission.selector('rendition', data.renditionId, [device.id]))) return {code: 'invalid-request'};
    if (family === 'pixoo-media-show' && media.supported &&
      (!media.renditionIds.some(id => id === data.renditionId) || (admission?.excludedNames('rendition').length ?? 0) > 0)) {
      const renditions = await this.#snapshot<{id: string; name: string; compatible: boolean}>('bunny/modules/pixoo', 'pixoo-rendition', parent);
      if (guard() !== undefined) return {code: 'forbidden'};
      const selected = namedRecord(renditions?.filter(item => item.compatible), data.renditionId, item => item.name);
      if ('code' in selected) return selected;
      return admission?.excluded('rendition', selected.id, selected.name) === true ? {code: 'not-found'} : {data: {...data, renditionId: selected.id}};
    }
    if (family === 'pixoo-asset-change' && object(data.change) && data.change.operation !== 'import') {
      const {assetId} = data.change;
      if (typeof assetId !== 'string' || assetId.length === 0 || assetId.length > 128) return {code: 'invalid-request'};
      if (admission !== undefined && !admission.selector('asset', assetId, [device.id])) return {code: 'invalid-request'};
      const exact = literalDeviceId(assetId) ?? assetId;
      const isId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(exact);
      if (this.readIdentity === undefined) return {question: 'Which saved asset should I use?'};
      const source = admission?.ownerText();
      const current = source === undefined || source.explicitIds.includes(exact) ? {} : {currentText: source.text};
      const lookup: CatalogIdentityQuery = isId ? {kind: 'asset', id: exact, ...current} : {kind: 'asset', name: assetId, ...current};
      const match = await this.readIdentity(lookup, 1200);
      if (guard() !== undefined) return {code: 'forbidden'};
      if ('error' in match) return match.error.code === 'invalid-state'
        ? {question: 'More than one saved asset has that name. Which asset ID should I use?'}
        : {code: match.error.code};
      const exclusion = await this.#canonicalExclusion('asset', match.id, device.id, guard, admission);
      if (exclusion !== undefined) return exclusion === 'invalid-state'
        ? {question: 'Which saved asset would you like to use?'} : {code: exclusion};
      return {data: {...data, change: {...data.change, assetId: match.id}}};
    }
    return {data};
  }

  async #coreSetting(family: CatalogFamily, recordFamily: string, target: string, data: Record<string, unknown>,
    parent: TraceContext, admission?: CatalogAdmission): Promise<{binding: CatalogBinding; data: Record<string, unknown>} | Refusal> {
    const recordId = family === 'mode-override-set' ? 'hub' : target;
    const records = await this.#snapshot<{id: string; revision: number; label?: {value: string}; title?: {value: string}}>(CORE, recordFamily, parent);
    const immutableTarget = family === 'mode-override-set' || family === 'home-layout-set' || family === 'lighting-layout-set' || family === 'playback-layout-set';
    const row = family === 'mode-override-set'
      ? namedRecord(records, 'hub', () => undefined)
      : admittedRecord(records, recordId, item => recordFamily === 'session' ? item.label?.value ?? item.title?.value : undefined,
        recordFamily === 'session' ? 'sessions' : 'status', admission, immutableTarget, nestedSelectors(family, data));
    if ('code' in row) return row;
    if (family !== 'mode-override-set') target = row.id;
    if (family === 'mode-override-set') {
      const {rows} = await this.#deviceRecords([LIFX, NANOLEAF, 'bunny/modules/pixoo', 'bunny/modules/tidbyt'], parent);
      const visible = rows.filter(({device}) => admission?.visible('devices', device.id) !== false);
      const selected = matchingDevices(visible, target, 'auto', literalDeviceId(target));
      if (selected.length !== 1 || selected[0] === undefined) return {code: selected.length === 0 ? 'not-found' : 'invalid-state'};
      const refused = admission?.target(selected[0].device.id, 'devices', visible.map(({owner, device}) => ({owner, id: device.id, label: deviceLabel(device)})));
      if (refused !== undefined) return {code: refused};
      const modes = selected[0].device.capabilities.modes;
      if (!modes.supported || data.mode !== null && !modes.values.some(value => value === data.mode)) return {code: 'unsupported-capability'};
      target = selected[0].device.id;
    }
    return {binding: {kind: 'record', owner: CORE, target, revision: row.revision}, data};
  }

  async #volcano(name: string, data: Record<string, unknown>, parent: TraceContext, admission?: CatalogAdmission): Promise<{binding: CatalogBinding; data: Record<string, unknown>} | Refusal> {
    const states = await this.#snapshot<{id: string; label?: string; configurationRevision: number}>(VOLCANO, 'volcano-status', parent);
    const current = admittedRecord(states, name, row => row.label, 'status', admission);
    if ('code' in current) return current;
    return {binding: {kind: 'record', owner: VOLCANO, target: current.id, revision: current.configurationRevision}, data};
  }

  async #playback(name: string, data: Record<string, unknown>, parent: TraceContext, admission?: CatalogAdmission): Promise<{binding: CatalogBinding; data: Record<string, unknown>} | Refusal> {
    const records = await this.#snapshot<PlaybackState>(PLAYBACK, 'playback', parent);
    const visible = records?.filter(record => admission?.visible('playback', record.id) ?? true);
    const implicit = visible?.length === 1 && (name === 'auto' || visible[0]?.id === name);
    const current = admittedRecord(visible, name, () => undefined, 'playback', admission, implicit);
    if ('code' in current) return current;
    if (current.availability !== 'available' || current.playback.status !== 'known') return {code: 'unavailable'};
    if (!current.playback.controls.some(control => control === data.action)) return {code: 'unsupported-capability'};
    return {binding: {kind: 'record', owner: PLAYBACK, target: current.id, revision: current.revision}, data};
  }

  async #lighting(name: string, data: Record<string, unknown>, parent: TraceContext, admission?: CatalogAdmission): Promise<{binding: CatalogBinding; data: Record<string, unknown>} | Refusal> {
    const lighting = await this.#snapshot<LightingState>(CORE, 'music-lighting-state', parent);
    const current = admittedRecord(lighting, name, () => undefined, 'devices', admission, false, nestedSelectors('music-lighting-control', data));
    if ('code' in current) return current;
    const {action, showId, version} = data;
    if (action === 'start-show') {
      if (current.session.status !== 'idle') return {code: 'invalid-state'};
      if (admission !== undefined && (typeof showId !== 'string' || !admission.selector('draft', showId))) return {code: 'not-found'};
      const library = (await this.#snapshot<ShowCatalog>(NANOLEAF, 'nanoleaf-shows', parent))?.[0];
      if (admission?.visible('devices', current.id) === false) return {code: 'forbidden'};
      if (library === undefined) return {code: 'unavailable'};
      const show = namedRecord(library.shows.filter(record => admission?.visible('shows', record.id) ?? true), showId, record => record.name);
      if ('code' in show) return show;
      if (admission?.excluded('draft', show.id, show.name) === true) return {code: 'not-found'};
      const selected = version === -1 ? show.version : version;
      if (typeof selected !== 'number' || !show.versions.some(item => item.version === selected)) return {code: 'not-found'};
      data = {action, showId: show.id, version: selected, positionMs: data.positionMs ?? 0, startDelayMs: data.startDelayMs ?? 0};
    } else {
      if (action !== 'stop' && action !== 'pause-show' && action !== 'resume-show' && action !== 'seek-show') return {code: 'invalid-request'};
      if (current.session.status === 'idle' || !('show' in current.session)) return {code: 'invalid-state'};
      if (action === 'seek-show' && (typeof data.positionMs !== 'number' || !Number.isSafeInteger(data.positionMs) || data.positionMs < 0)) {
        return {code: 'invalid-request'};
      }
      data = {action, generation: current.session.generation, ...(action === 'seek-show' ? {positionMs: data.positionMs} : {})};
    }
    return {binding: {kind: 'record', owner: CORE, target: current.id, revision: current.revision}, data};
  }

  beforeDispatch(proposal: CatalogProposal, requestId: string, admitByMs: number, draftRevision?: number): ErrorCode | undefined {
    if (proposal.command === 'nanoleaf-show-save') {
      return draftRevision === undefined ? 'revision-conflict' : this.#authoring().noteSave(proposal.data, {requestId, admitByMs}, draftRevision);
    }
    if (proposal.command === 'art-show' && idList(proposal.data.targets)) {
      const db = this.context.database();
      db.exec('CREATE TABLE IF NOT EXISTS assistant_art_shows (request_id TEXT PRIMARY KEY, targets TEXT NOT NULL)');
      db.prepare('INSERT INTO assistant_art_shows (request_id, targets) VALUES (?, ?)').run(requestId, JSON.stringify(proposal.data.targets));
    }
    return undefined;
  }

  rejected(proposal: CatalogProposal, requestId: string): void {
    if (proposal.command === 'nanoleaf-show-save' && typeof proposal.data.showId === 'string') {
      this.#authoring().clearSave(proposal.data.showId, requestId);
    }
  }

  mutateDraft(call: ToolCall, access: FieldAccess, admission: CatalogAdmission): {text: string; draftId: string} | (Refusal & {draftId?: string}) {
    const drafts = this.#authoring();
    if (call.name === CREATE_SHOW) {
      if (!access('shows', 'details')) return {code: 'forbidden'};
      return admission.covers([]) ? drafts.create(call.input) : {code: 'not-found'};
    }
    const selector = call.input.draftId;
    if (typeof selector !== 'string' || !admission.selector('draft', selector)) return {code: 'not-found'};
    const allowed = (id: string) => access('shows', 'details', id);
    const draft = drafts.find(selector, allowed);
    if ('code' in draft) return {code: 'not-found'};
    const {cue} = call.input, {cues} = draft.value.timeline;
    const index = typeof cue === 'string' ? showCueIndex(cues, cue) : -1;
    const selected = cues[index];
    if (selected === undefined) return {code: 'not-found'};
    const cueReferences = catalogCueReferences(selected.id, index);
    if (cueReferences.some(value => admission.excluded('cue', value)) || !cueReferences.some(value => admission.selector('cue', value))) {
      return {code: 'not-found'};
    }
    if (admission.target(draft.value.showId, 'shows', drafts.references(allowed), false, [selected.id]) !== undefined) return {code: 'not-found'};
    return {...drafts.edit({...call.input, draftId: draft.value.showId, cue: selected.id}), draftId: draft.value.showId};
  }

  async read(call: ToolCall, parent: TraceContext, observe: (evidence: ActionEvidence) => void, access: FieldAccess, ownsOperation: (id: unknown) => boolean, scopedDeviceFacts?: ScopedDeviceFacts): Promise<string | undefined> {
    const input = call.input;
    switch (call.name) {
      case PREVIEW_SHOW: {
        if (!access('shows', 'details', typeof input.draftId === 'string' ? input.draftId : undefined)) return 'refused: forbidden';
        const drafts = this.#authoring();
        const result = drafts.preview(input.draftId);
        return 'code' in result ? `refused: ${result.code}` : result.text;
      }
      case READ_DEVICES: return this.#readDevices(input, parent, access, scopedDeviceFacts);
      case READ_SHOWS: return this.#readShows(input, parent, access);
      case READ_ART: {
        const art = (await this.#snapshot<ArtRecord>(ART, 'art', parent))?.[0];
        if (art === undefined) return 'Saved art unavailable.';
        const artworks = art.artworks.filter(item => access('artwork', 'index', item.artworkId) && access('artwork', 'details', item.artworkId));
        for (const job of art.jobs) {
          if (job.status !== 'finished' || !ownsOperation(job.requestId)) continue;
          const saved = artworks.find(item => item.artworkId === job.artworkId);
          if (saved?.compositions.some(item => item.outcome === Outcome.succeeded && item.renditions.length > 0) === true) {
            observe({requestId: job.requestId, source: 'effect', text: 'the artwork was saved'});
          } else if (job.outcome === Outcome.failed || job.outcome === Outcome.rejected || job.outcome === 'cancelled') {
            observe({requestId: job.requestId, source: 'effect', text: `art generation ended with status ${job.outcome}`});
          }
        }
        const destinations = await this.#artDestinations(parent);
        return textResult({displays: destinations?.filter(({target}) => access('devices', 'index', target) && access('devices', 'details', target)).map(({target, kind, label, guard, formats, maxBytes}) => ({routingId: target, kind, label: access('devices', 'label', target) ? label : undefined, available: access('devices', 'status', target) ? guard !== undefined : undefined, formats, maxBytes})) ?? null,
          // `sourceRequestId` is the generation request a Conversation attachment names (Hub #2029), so a follow-up such as
          // "show that animation" can find the attached artwork's ID.
          artworks: artworks.map(item => {
            const requestId = art.jobs.find(job => job.artworkId === item.artworkId)?.requestId;
            const sourceRequestId = requestId !== undefined && access('operations', 'details', requestId) && access('artwork', 'attachment', requestId)
              ? requestId : null;
            return {artworkId: item.artworkId, sourceRequestId, createdAtMs: item.createdAtMs, favorite: item.favorite,
              renditionKinds: item.compositions.filter(part => usableArtComposition(item, part.target) !== undefined).map(part => part.target)};
          })});
      }
      case READ_PLAYBACK: {
        const records = await this.#snapshot<PlaybackState>(PLAYBACK, 'playback', parent);
        return records === undefined ? 'Playback unavailable.' : textResult(records.filter(({id}) => access('playback', 'index', id) && access('playback', 'details', id)).map(({id, observedAtMs, availability, playback}) => ({id, observedAtMs, availability, playback})));
      }
      case READ_VACUUM: return this.#status('bunny/modules/roborock', 'roborock-vacuum',
        ['id', 'observedAtMs', 'availability', 'activity', 'status'], parent, access);
      case READ_VOLCANO: return this.#status('bunny/modules/volcano', 'volcano-status',
        ['id', 'observedAtMs', 'availability', 'link', 'heater', 'pump', 'currentDeciC', 'targetDeciC', 'gapMinutes'], parent, access);
      case READ_OPERATION: {
        if (typeof input.requestId !== 'string' || !ownsOperation(input.requestId) ||
          !access('operations', 'details', input.requestId)) return 'Operation unavailable.';
        const operation = await this.#operation(input.requestId, parent);
        if (operation !== undefined) observe({requestId: operation.requestId, source: 'operation', revision: operation.revision, text: operationOutcome(operation)});
        return textResult(operation ?? 'Operation unavailable.');
      }
      case READ_ART_EFFECTS: return typeof input.requestId === 'string' && ownsOperation(input.requestId) &&
        access('operations', 'details', input.requestId) ? this.#artEffects(input.requestId, parent, observe, access) : 'Show request unavailable.';
      default: return undefined;
    }
  }

  async #readShows(input: ToolCall['input'], parent: TraceContext, access: FieldAccess): Promise<string> {
    const {view, id, offset} = input;
    if (typeof id !== 'string' || id.length > 128 || typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) {
      return 'refused: invalid-request';
    }
    const size = 8;
    const page = (items: readonly unknown[]) => JSON.stringify({items: items.slice(0, size), nextOffset: items.length > size ? offset + size : null});
    if (view === 'drafts') {
      if (!access('shows', 'index') || !access('shows', 'details', id === '' ? undefined : id)) return page([]);
      return page(this.#authoring().list(offset, size + 1, id, record =>
        access('shows', 'index', record) && access('shows', 'details', record) && access('shows', 'label', record)));
    }
    if (view === 'lighting') {
      const states = await this.#snapshot<LightingState>(CORE, 'music-lighting-state', parent);
      return states === undefined ? 'Lighting sessions unavailable.' : page(states.filter(state => (id === '' || id === state.id) && access('shows', 'index', state.id) && access('shows', 'details', state.id))
        .map(({id, revision, session, last}) => ({id, revision, session, last})).slice(offset, offset + size + 1));
    }
    if (view !== 'saved') return 'refused: invalid-request';
    const catalog = (await this.#snapshot<ShowCatalog>(NANOLEAF, 'nanoleaf-shows', parent))?.[0];
    if (catalog === undefined) return 'Saved shows unavailable.';
    const visible = catalog.shows.filter(show => access('shows', 'index', show.id) && access('shows', 'details', show.id));
    if (id === '') return page(visible.slice(offset, offset + size + 1).map(({id, name, version}) => ({id, name: access('shows', 'label', id) ? name : undefined, latestVersion: version})));
    const show = visible.find(row => row.id === id);
    if (show === undefined) return 'refused: not-found';
    return page(show.versions.slice(offset, offset + size + 1).map(({version, versionName, kind}) => ({showId: id, version, versionName: access('shows', 'label', id) ? versionName : undefined, kind})));
  }

  async #status(owner: string, family: string, fields: readonly string[], parent: TraceContext, access: FieldAccess): Promise<string> {
    const records = await this.#snapshot<Record<string, unknown>>(owner, family, parent);
    return textResult(records?.filter(record => typeof record.id === 'string' && access('status', 'index', record.id) && access('status', 'details', record.id)).map(record => Object.fromEntries(fields.map(key => [key, record[key]]))) ?? 'Status unavailable.');
  }

  async #readDevices(input: ToolCall['input'], parent: TraceContext, access: FieldAccess, scopedFacts?: ScopedDeviceFacts): Promise<string> {
    const {target, owner} = input;
    if (typeof target !== 'string' || typeof owner !== 'string') return 'refused: invalid-request';
    const owners = owner === 'auto' ? assistantDeviceOwners : assistantDeviceOwners.filter(source => source === owner);
    if (owners.length === 0) return 'refused: unsupported-capability';
    if (scopedFacts !== undefined) {
      const matches = scopedFacts.named !== undefined || scopedFacts.subject === undefined ? []
        : await this.deviceSubjectMatches(scopedFacts.subject, parent);
      const selected = scopedFacts.named !== undefined ? await this.namedDeviceMatch(scopedFacts.named, scopedFacts.granted, parent)
        : matches.length === 1 ? matches[0] : undefined;
      if (selected === undefined || !owners.some(value => value === selected.owner) ||
          target !== '' && matchingDevices([selected], target, owner, literalToolDeviceId(target)).length !== 1) return textResult({devices: []});
      const {owner: source, device} = selected;
      scopedFacts.resolve(device.id);
      if (!access('devices', 'index', device.id) || !access('devices', 'label', device.id) || !access('devices', 'status', device.id)) {
        return textResult({devices: []});
      }
      if (scopedFacts.named !== undefined) scopedFacts.recordNamed(source, device.id);
      if (scopedFacts.brightnessControl) {
        const route = catalogRoute('brightness-set'), tool = catalogTool('brightness-set');
        const controls = this.enabled.filter(name => name === SET_LIFX_BRIGHTNESS && source === LIFX && device.capabilities.brightness.supported ||
          name === tool && route.binding === 'device' && route.owners.some(owner => owner === source) && permitsDevice(route, device));
        const facts = deviceFacts(selected, this.context.clock.now(), family => family === 'brightness-set' && controls.length > 0, {maxAgeMs: MAX_OBSERVATION_AGE_MS});
        return textResult({devices: [{owner: source, id: device.id, name: facts.name,
          lastReportedAvailability: facts.lastReportedAvailability, controls,
          brightness: controls.length > 0 ? facts.choices.brightness : undefined, actions: facts.actions,
          ...(facts.observation.value.status === 'known' ? {observation: facts.observation, observationBases: facts.observationBases} : {})}]});
      }
      const now = this.context.clock.now();
      const colors = source === LIFX ? await readLifxDeviceFacts(this.context.sdk, {timeoutMs: 1200, parent}) : undefined;
      const lifx = colors?.find(light => light.id === device.id);
      const facts = deviceFacts(selected, now, family => catalogFamily(family) && this.enabled.includes(catalogTool(family)) ||
        family === 'brightness-set' && source === LIFX && this.enabled.includes(SET_LIFX_BRIGHTNESS) ||
        family === 'power-set' && (source === WEMO && this.enabled.includes('set_wemo_power') ||
          source === LIFX && this.enabled.includes('set_lifx_power')),
      lifx === undefined ? {} : {lifx});
      if (source === WEMO) return textResult({devices: [{owner: source, id: device.id, name: facts.name,
        lastReportedAvailability: facts.lastReportedAvailability, observation: facts.observation.value, freshness: facts.observation.freshness,
        choices: {power: facts.choices.power}, actions: facts.actions,
        hold: facts.hold === null || facts.actions.includes('wemo-hold-release') ? facts.hold : {held: true},
        ...(facts.actions.length === 0 ? {} : {configurationRevision: facts.configurationRevision, generation: facts.generation}),
        maximumOnLimit: this.deviceDisplay.powerLimit(device.id, now)}]});
      return textResult({devices: [{owner: source, id: device.id, name: facts.name,
        lastReportedAvailability: facts.lastReportedAvailability, observation: facts.observation.value, freshness: facts.observation.freshness,
        choices: facts.choices, actions: facts.actions,
        ...(facts.lightCapabilities === undefined ? {} : {lightCapabilities: facts.lightCapabilities}),
        ...(facts.color === undefined ? {} : {color: facts.color}),
        ...(facts.observationBases.length === 0 ? {} : {observationBases: facts.observationBases})}]});
    }
    const {rows, unreadable} = await this.#deviceRecords(owners, parent);
    const visible = rows.filter(({device}) => access('devices', 'index', device.id) && access('devices', 'label', device.id));
    const selected = target === '' ? visible : matchingDevices(visible, target, owner, literalToolDeviceId(target)).filter(({device}) => access('devices', 'details', device.id) && access('devices', 'status', device.id));
    if (target === '') return textResult({devices: selected.map(({owner, device}) => ({owner, id: device.id,
      name: deviceLabel(device), lastReportedAvailability: access('devices', 'status', device.id) ? device.availability : undefined})), unreadable});
    if (selected.length > 1) return textResult({matches: selected.map(({owner, device}) => ({owner, id: device.id})),
      guidance: 'Select the exact owner and ID.'});
    const colors = selected.some(row => row.owner === LIFX) ? await readLifxDeviceFacts(this.context.sdk, {timeoutMs: 1200, parent}) : undefined;
    const now = this.context.clock.now();
    const devices = selected.map(row => {
      const {owner: source, device} = row;
      const light = colors?.find(row => row.id === device.id);
      const controls = this.enabled.filter(tool => {
        if (tool === 'set_wemo_power') return source === WEMO && device.capabilities.power.supported;
        if (tool === 'set_lifx_power') return source === LIFX && device.capabilities.power.supported;
        if (tool === 'set_lifx_brightness') return source === LIFX && device.capabilities.brightness.supported;
        const family = tool.startsWith('control_') ? tool.slice(8).replaceAll('_', '-') : '';
        if (!catalogFamily(family) || !lifxSupports(family, light)) return false;
        const route = catalogRoute(family);
        return route.binding === 'device' && route.owners.some(eligible => eligible === source) && permitsDevice(route, device);
      });
      const facts = deviceFacts(row, now, family => catalogFamily(family) && controls.includes(catalogTool(family)) ||
        family === 'power-set' && controls.some(tool => tool === 'set_wemo_power' || tool === 'set_lifx_power') ||
        family === 'brightness-set' && controls.includes(SET_LIFX_BRIGHTNESS), light === undefined ? {} : {lifx: light});
      return {
        ...facts,
        observation: {...facts.observation,
          ...(device.observed.status === 'known' ? {time: this.deviceDisplay.instant(device.observed.observedAtMs)} : {})},
        ...(source === WEMO ? {maximumOnLimit: this.deviceDisplay.powerLimit(device.id, now)} : {}),
        controls,
      };
    });
    return textResult({devices, unreadable});
  }

  async #artEffects(requestId: unknown, parent: TraceContext, observe: (evidence: ActionEvidence) => void, access: FieldAccess): Promise<string> {
    if (typeof requestId !== 'string') return 'refused: invalid-request';
    const db = this.context.database();
    db.exec('CREATE TABLE IF NOT EXISTS assistant_art_shows (request_id TEXT PRIMARY KEY, targets TEXT NOT NULL)');
    const row = db.prepare('SELECT targets FROM assistant_art_shows WHERE request_id = ?').get(requestId);
    if (typeof row?.targets !== 'string') return 'Show request unavailable.';
    const list: unknown = JSON.parse(row.targets);
    if (!idList(list)) return 'Show targets unavailable.';
    const [operations, skips] = await Promise.all([this.#snapshot<OperationRecord>(CORE, 'operation', parent),
      this.#snapshot<ArtShowEffects>(CORE, ART_SHOW_EFFECTS_FAMILY, parent)]);
    const show = skips?.find(row => row.requestId === requestId);
    const skipped = show?.skipped ?? [];
    const result = (id: string) => operations?.find(operation => operation.requestId === id);
    const summary = (record: OperationRecord | undefined) => record === undefined ? {status: 'evidence unavailable'}
      : {status: record.status, result: record.result, evidence: record.evidence, code: record.error?.code};
    const effects = await artShowSurfaces(requestId, list);
    const phaseResult = (id: string, target: string, phase: 'prepare' | 'present') => {
      if (!access('operations', 'details', id)) return undefined;
      const skip = skipped.find(entry => entry.target === target && entry.phase === phase);
      const label = phase === 'prepare' ? 'preparation' : 'presentation';
      if (skip !== undefined) {
        observe({requestId, source: 'phase', phaseId: id, revision: show?.revision ?? 0, text: `${label} on ${target} was skipped`});
        return {status: 'skipped', code: skip.code};
      }
      const operation = result(id);
      observe({requestId, source: 'phase', phaseId: id, revision: operation?.revision ?? -1,
        text: operation === undefined ? `${label} on ${target} is unconfirmed` : `for ${label} on ${target}, ${operationOutcome(operation)}`});
      return summary(operation);
    };
    const perDisplay = effects.filter(surface => access('devices', 'index', surface.target) && access('devices', 'status', surface.target)).map(surface => surface.kind === 'browser'
      ? {target: surface.target, presentation: phaseResult(surface.presentRequestId, surface.target, 'present')}
      : {target: surface.target, preparation: phaseResult(surface.prepareRequestId, surface.target, 'prepare'), presentation: phaseResult(surface.momentRequestId, surface.target, 'present')});
    const operation = result(requestId);
    if (operation !== undefined) observe({requestId, source: 'operation', revision: operation.revision, text: operationOutcome(operation)});
    return textResult({show: summary(operation), effects: perDisplay});
  }
}
