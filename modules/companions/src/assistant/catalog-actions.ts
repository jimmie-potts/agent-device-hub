import {artDescription, assistantDeviceOwners, catalogFamily, catalogProposal, catalogRoute, permitsDevice, type CatalogBinding, type CatalogFamily, type CatalogProposal} from '@jimmie-potts/event-contracts/v2/assistant-actions';
import {ART_SHOW_EFFECTS_FAMILY, acceptsArtRendition, artDestination, artShowSurfaces, type ArtDestination, type ArtShowEffects, type ArtShowGuard, type ArtTargets} from '@jimmie-potts/event-contracts/v2/art-show';
import type {ArtRecord, ArtworkSummary, CatalogArtwork} from '@jimmie-potts/event-contracts/v2/art-state';
import type {ErrorBody, ErrorCode} from '@jimmie-potts/event-contracts/v2';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {OperationRecord, PlaybackState} from '@jimmie-potts/event-contracts/v2/families';
import type {LightingState} from '@jimmie-potts/event-contracts/v2/music-lighting-data';
import type {ShowCatalog} from '@jimmie-potts/event-contracts/v2/nanoleaf-shows';
import {draftProblem} from '@jimmie-potts/event-contracts/v2/nanoleaf-shows';
import {usableArtComposition, type ModuleContext, type TraceContext} from '@jimmie-potts/sdk';
import {deviceLabel, MAX_OBSERVATION_AGE_MS, observationStale, WEMO_OBSERVATION_AGE_MS} from './devices.js';
import {ShowDrafts} from './show-drafts.js';
import {textBytes, type ToolCall} from './provider.js';
import {CREATE_SHOW, EDIT_SHOW, MAX_CATALOG_ARGUMENTS, PREVIEW_SHOW, READ_ART, READ_ART_EFFECTS, READ_DEVICES, READ_OPERATION,
  READ_PLAYBACK, READ_SHOWS, READ_VACUUM, READ_VOLCANO} from './catalog-tools.js';

const CORE = 'bunny/core', NANOLEAF = 'bunny/modules/nanoleaf';
const LIFX = 'bunny/modules/lifx', WEMO = 'bunny/modules/wemo';
type LifxColor = {id: string; capabilities: {color: {supported: boolean}; temperature: {supported: boolean}};
  observed: {status: 'unknown'} | {status: 'known'; observedAtMs: number; hue: number; saturation: number; brightness: number; kelvin: number}};
function lifxSupports(family: CatalogFamily, light: LifxColor | undefined): boolean {
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
type Proposed = {proposal: CatalogProposal; text: string} | {question: string} | {code: ErrorCode};
type Refusal = {code: ErrorCode};
type Match = {owner: string; device: DeviceRecord};
const normalize = (name: string): string => name.trim().toLocaleLowerCase();
function matchingDevices(rows: readonly Match[], target: string, owner: string): readonly Match[] {
  const exact = rows.filter(({device}) => device.id === target);
  if (owner !== 'auto' && exact.length > 0) return exact;
  return rows.filter(({device}) => device.id === target || normalize(deviceLabel(device)) === normalize(target));
}

/** A bounded read through the Art owner's public SDK content manifest for an exact retained ID outside recent state. */
export type RetainedArtworkRead = (artworkId: string, timeoutMs: number) => Promise<CatalogArtwork | ErrorBody | undefined>;

export class ConversationActions {
  #drafts: ShowDrafts | undefined;
  constructor(private readonly context: ModuleContext, private readonly enabled: readonly string[], private readonly retainedArtwork?: RetainedArtworkRead) {}

  async #snapshot<T extends object>(owner: string, family: string, parent: TraceContext): Promise<readonly T[] | undefined> {
    const result = await this.context.sdk.sync<T>([family], () => {}, {owner, timeoutMs: 1200, parent});
    if (result.status !== 'synced') return undefined;
    try {
      return result.copy.states().filter(message => message.source === owner).map(message => message.data);
    } finally {await result.copy.close();}
  }

  async #deviceRecords(owners: readonly string[], parent: TraceContext): Promise<{rows: Match[]; unreadable: string[]}> {
    const views = await Promise.all(owners.map(async owner => ({owner, devices: await this.#snapshot<DeviceRecord>(owner, 'device', parent)})));
    return {rows: views.flatMap(({owner, devices}) => devices?.map(device => ({owner, device})) ?? []),
      unreadable: views.filter(view => view.devices === undefined).map(view => view.owner)};
  }

  async #artDestinations(parent: TraceContext): Promise<ArtDestination[] | undefined> {
    const directory = (await this.#snapshot<ArtTargets>(CORE, 'art-targets', parent))?.[0];
    if (directory === undefined) return undefined;
    const owners = [...new Set(directory.targets.map(item => 'bunny/modules/' + item.kind))];
    const {rows} = await this.#deviceRecords(owners, parent);
    return directory.targets.map(item => artDestination(item, rows.find(row =>
      row.owner === 'bunny/modules/' + item.kind && row.device.id === item.target)?.device));
  }

  async #artSelection(names: unknown, parent: TraceContext, artwork?: ArtworkSummary, requestedFormat?: 'png' | 'gif'): Promise<
    {targets: string[]; labels: string[]; guards: ArtShowGuard[]} | {question: string} | Refusal> {
    if (!Array.isArray(names) || names.length > 3 || !names.every((value): value is string =>
      typeof value === 'string' && value.trim().length > 0 && value.length <= (value.startsWith('id:') ? 131 : 128))) return {code: 'invalid-request'};
    const targets: string[] = [], labels: string[] = [], guards: ArtShowGuard[] = [];
    if (names.length === 0) return {targets, labels, guards};
    const devices = names.every(name => normalize(name) === 'browser') ? [] : await this.#artDestinations(parent);
    if (devices === undefined) return {code: 'unavailable'};
    for (const name of names) {
      const key = normalize(name);
      if (key === 'browser' || key === 'ui' && !devices.some(device => device.target === 'ui')) {
        if (artwork !== undefined && usableArtComposition(artwork, 'ui') === undefined) return {question: 'This artwork has no browser rendition. Which available destination would you like?'};
        if (targets.includes('browser')) return {code: 'invalid-request'};
        targets.push('browser'); labels.push('Browser');
        continue;
      }
      const exactId = name.startsWith('id:') ? name.slice(3) : name;
      const exact = devices.filter(device => device.target === exactId);
      const matches = name.startsWith('id:') ? exact : key === 'pixoo' || key === 'tidbyt' ? devices.filter(device => device.kind === key || device.target === key)
        : exact.length > 0 ? exact : devices.filter(device => normalize(device.label ?? device.target) === key);
      const eligible = matches.filter(device => device.guard !== undefined &&
        (requestedFormat === undefined || device.formats?.includes(requestedFormat) === true) &&
        (artwork === undefined || acceptsArtRendition(device, usableArtComposition(artwork, device.kind)?.renditions[0])));
      if (eligible.length > 1) return {question: 'Which display did you mean? ' + eligible.map(device => (device.label ?? device.kind) + ' (id:' + device.target + ')').join(', ')};
      const selected = eligible[0];
      if (selected?.guard === undefined) {
        if (matches.length === 0) return {question: 'No configured art display matches "' + name + '". Which destination would you like?'};
        if (matches.every(device => device.guard === undefined)) return {question: 'The selected display is unavailable for an art show. Which destination would you like?'};
        if (requestedFormat !== undefined) return {question: 'The selected display does not accept ' + requestedFormat.toUpperCase() + '. Which format or destination would you like?'};
        return {question: 'This artwork has no compatible rendition within the limits of "' + name + '". Choose another destination or request a new rendition separately.'};
      }
      if (targets.includes(selected.target) || guards.length === 2) return {code: 'invalid-request'};
      targets.push(selected.target);
      labels.push(selected.label === undefined || selected.label === selected.target ? selected.target : `${selected.label} (${selected.target})`);
      guards.push(selected.guard);
    }
    return {targets, labels, guards};
  }

  async #operation(requestId: unknown, parent: TraceContext): Promise<OperationRecord | undefined> {
    const operations = await this.#snapshot<OperationRecord>(CORE, 'operation', parent);
    return operations?.find(row => row.requestId === requestId && row.requestedBy === this.context.sdk.source);
  }

  #authoring(): ShowDrafts {return this.#drafts ??= new ShowDrafts(this.context.database());}

  async #saveData(call: ToolCall, parent: TraceContext): Promise<Record<string, unknown> | Refusal> {
    const drafts = this.#authoring();
    let draft = drafts.read(call.input.draftId);
    if (draft === undefined) return {code: 'not-found'};
    if (draft.revision !== call.input.revision) return {code: 'revision-conflict'};
    const readStarted = this.context.clock.now();
    const library = (await this.#snapshot<ShowCatalog>(NANOLEAF, 'nanoleaf-shows', parent))?.[0];
    if (library === undefined) return {code: 'unavailable'};
    draft = drafts.read(call.input.draftId);
    if (draft === undefined) return {code: 'not-found'};
    if (draft.revision !== call.input.revision) return {code: 'revision-conflict'};
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
      draft = drafts.read(showId);
      if (draft === undefined) return {code: 'not-found'};
    }
    const versionName = call.input.versionName;
    if (typeof versionName !== 'string') return {code: 'invalid-request'};
    const head = current?.version ?? 0;
    if (head < draft.value.expectedVersion) return {code: 'revision-conflict'};
    const value = {...draft.value, expectedVersion: head, versionName};
    if (draftProblem(value) !== undefined) return {code: 'invalid-request'};
    if (head > draft.value.expectedVersion) drafts.bindSaveToHead(draft, head);
    return value;
  }

  /** The input's effect fields never supply routing or revision guards. */
  async propose(family: CatalogFamily, call: ToolCall, parent: TraceContext): Promise<Proposed> {
    if (family === 'art-request') {
      const {format, description} = call.input;
      if (!artDescription(description) || (format !== 'gif' && format !== 'still')) return {code: 'invalid-request'};
      const selected = await this.#artSelection(call.input.showTargets ?? [], parent, undefined, format === 'gif' ? 'gif' : 'png');
      if (!('targets' in selected)) return selected;
      const data = {format, description: description.trim(), ...(selected.targets.length > 0 ? {showTargets: selected.targets} : {})};
      const binding = {kind: 'fixed', owner: ART, target: 'art'} as const;
      return {proposal: {family: 'catalog-action', command: family, target: 'art', binding, data},
        text: `Create ${format === 'gif' ? 'an animated GIF' : 'a still image'} for this reply? This may use the art allowance. ${data.description}${selected.labels.length > 0 ? '. When ready, review showing it on ' + selected.labels.join(', ') + '.' : ''}`};
    }
    const route = catalogRoute(family);
    const owner = family === 'nanoleaf-show-save' ? NANOLEAF : call.input.owner;
    const name = family === 'nanoleaf-show-save' ? 'shows' : call.input.target;
    if (typeof owner !== 'string' || typeof name !== 'string' || name.length === 0 || name.length > 128) return {code: 'invalid-request'};
    let data: Record<string, unknown>;
    if (family === 'nanoleaf-show-save') {
      const saved = await this.#saveData(call, parent);
      if (typeof saved.code === 'string') return {code: saved.code === 'not-found' || saved.code === 'revision-conflict' ||
        saved.code === 'unavailable' || saved.code === 'uncertain-result' ? saved.code : 'invalid-request'};
      data = saved;
    } else {
      const args = call.input.arguments;
      if (typeof args !== 'string' || textBytes(args) > MAX_CATALOG_ARGUMENTS) return {code: 'invalid-request'};
      let value: unknown;
      try {value = JSON.parse(args);} catch {return {code: 'invalid-request'};}
      if (!object(value)) return {code: 'invalid-request'};
      data = value;
    }
    let binding: CatalogBinding;
    if (route.binding === 'device') {
      const owners = owner === 'auto' ? route.owners : route.owners.filter(source => source === owner);
      if (owners.length === 0) return {code: 'unsupported-capability'};
      const {rows, unreadable} = await this.#deviceRecords(owners, parent);
      const found = matchingDevices(rows, name, owner);
      const selected = found[0];
      if (found.length > 1) return {question: `Which device did you mean? ${found.map(({owner, device}) => `${owner} / ${device.id}`).join(', ')}`};
      if (selected === undefined) return {code: unreadable.length > 0 ? 'unavailable' : 'not-found'};
      const {device} = selected;
      if (!permitsDevice(route, device)) return {code: 'unsupported-capability'};
      if (family === 'lifx-color-set' || family === 'lifx-temperature-set') {
        const lights = await this.#snapshot<LifxColor>(LIFX, 'lifx-light', parent);
        const light = lights?.find(candidate => candidate.id === device.id);
        if (light === undefined) return {code: 'unavailable'};
        if (!lifxSupports(family, light)) return {code: 'unsupported-capability'};
      }
      if (family === 'wemo-hold-release') {
        if (device.held === undefined || data.heldRequestId !== device.held.requestId) return {code: 'revision-conflict'};
      } else if (device.availability !== 'available' || device.held !== undefined) return {code: 'unavailable'};
      binding = {kind: 'device', target: device.id, owner: selected.owner, configurationRevision: device.configurationRevision, generation: device.generation};
    } else if (route.binding === 'record') {
      if (owner !== route.owner) return {code: 'forbidden'};
      const guarded = family === 'playback-control' ? await this.#playback(name, data, parent)
        : family === 'volcano-session-gap' ? await this.#volcano(name, data, parent) : await this.#lighting(name, data, parent);
      if ('code' in guarded) return guarded;
      ({binding, data} = guarded);
    } else {
      if (owner !== route.owner || name !== route.target) return {code: 'forbidden'};
      binding = {kind: 'fixed', target: route.target, owner};
    }
    let showText: string | undefined;
    if (family === 'art-show') {
      if (typeof data.artworkId !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(data.artworkId) || !Array.isArray(data.targets) || data.targets.length === 0 || 'guards' in data) return {code: 'invalid-request'};
      const art = (await this.#snapshot<ArtRecord>(ART, 'art', parent))?.[0];
      if (art === undefined) return {code: 'unavailable'};
      const recent = art.artworks.find(item => item.artworkId === data.artworkId);
      const job = art.jobs.find(item => item.artworkId === data.artworkId);
      const retained = recent === undefined || job === undefined ? await this.retainedArtwork?.(data.artworkId, 1200) : undefined;
      if (retained !== undefined && 'error' in retained) return {code: retained.error.code};
      const artwork = recent ?? retained;
      if (artwork === undefined) return {code: 'not-found'};
      const selected = await this.#artSelection(data.targets, parent, artwork);
      if (!('targets' in selected)) return selected;
      const sourceRequestId = job?.requestId ?? retained?.sourceRequestId;
      const attached = sourceRequestId === undefined ? undefined : this.context.database().prepare(
        'SELECT description FROM assistant_art_attachments WHERE request_id=?').get(sourceRequestId);
      const title = typeof attached?.description === 'string' ? attached.description : 'saved artwork ' + artwork.artworkId;
      showText = 'Show ' + title + ' on ' + selected.labels.join(', ') + '?' + (data.coversStatus === false ? ' Keep status visible.' : '');
      data = {...data, targets: selected.targets, guards: selected.guards};
    }
    const proposal = catalogProposal({family: 'catalog-action', command: family, target: binding.target, binding, data});
    if (proposal === undefined) return {code: 'invalid-request'};
    const effect = family === 'nanoleaf-show-save'
      ? `Save draft ${String(data.name)} (${String(data.showId)}) as “${String(data.versionName)}”, version ${Number(data.expectedVersion) + 1}?`
      : showText ?? `${family} on ${binding.target} (${binding.owner}): ${JSON.stringify(data)}`;
    if (effect.length > 1024) return {code: 'capacity'};
    return {proposal, text: effect};
  }

  async #volcano(name: string, data: Record<string, unknown>, parent: TraceContext): Promise<{binding: CatalogBinding; data: Record<string, unknown>} | Refusal> {
    const states = await this.#snapshot<{id: string; configurationRevision: number}>(VOLCANO, 'volcano-status', parent);
    const current = states?.find(row => row.id === name);
    if (current === undefined) return {code: 'unavailable'};
    return {binding: {kind: 'record', owner: VOLCANO, target: name, revision: current.configurationRevision}, data};
  }

  async #playback(name: string, data: Record<string, unknown>, parent: TraceContext): Promise<{binding: CatalogBinding; data: Record<string, unknown>} | Refusal> {
    const records = await this.#snapshot<PlaybackState>(PLAYBACK, 'playback', parent);
    const current = records?.find(row => row.id === name);
    if (current === undefined || current.availability !== 'available' || current.playback.status !== 'known') return {code: 'unavailable'};
    if (!current.playback.controls.some(control => control === data.action)) return {code: 'unsupported-capability'};
    return {binding: {kind: 'record', owner: PLAYBACK, target: name, revision: current.revision}, data};
  }

  async #lighting(name: string, data: Record<string, unknown>, parent: TraceContext): Promise<{binding: CatalogBinding; data: Record<string, unknown>} | Refusal> {
    const lighting = await this.#snapshot<LightingState>(CORE, 'music-lighting-state', parent);
    const current = lighting?.find(row => row.id === name);
    if (current === undefined) return {code: 'unavailable'};
    const {action, showId, version} = data;
    if (action === 'start-show') {
      if (current.session.status !== 'idle') return {code: 'invalid-state'};
      const library = (await this.#snapshot<ShowCatalog>(NANOLEAF, 'nanoleaf-shows', parent))?.[0];
      if (library === undefined) return {code: 'unavailable'};
      if (typeof version !== 'number' || !library.shows.some(show => show.id === showId && show.versions.some(item => item.version === version))) return {code: 'not-found'};
      data = {action, showId, version, positionMs: data.positionMs ?? 0, startDelayMs: data.startDelayMs ?? 0};
    } else {
      if (action !== 'stop' && action !== 'pause-show' && action !== 'resume-show' && action !== 'seek-show') return {code: 'invalid-request'};
      if (current.session.status === 'idle' || !('show' in current.session)) return {code: 'invalid-state'};
      data = {action, generation: current.session.generation, ...(action === 'seek-show' ? {positionMs: data.positionMs} : {})};
    }
    return {binding: {kind: 'record', owner: CORE, target: name, revision: current.revision}, data};
  }

  beforeDispatch(proposal: CatalogProposal, requestId: string, admitByMs: number): ErrorCode | undefined {
    if (proposal.command === 'nanoleaf-show-save') {
      return this.#authoring().noteSave(proposal.data, {requestId, admitByMs});
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

  async read(call: ToolCall, parent: TraceContext): Promise<string | undefined> {
    const input = call.input;
    switch (call.name) {
      case CREATE_SHOW: case EDIT_SHOW: case PREVIEW_SHOW: {
        const drafts = this.#authoring();
        const result = call.name === CREATE_SHOW ? drafts.create(input) : call.name === EDIT_SHOW ? drafts.edit(input) : drafts.preview(input.draftId);
        return 'code' in result ? `refused: ${result.code}` : result.text;
      }
      case READ_DEVICES: return this.#readDevices(input, parent);
      case READ_SHOWS: return this.#readShows(input, parent);
      case READ_ART: {
        const art = (await this.#snapshot<ArtRecord>(ART, 'art', parent))?.[0];
        if (art === undefined) return 'Saved art unavailable.';
        const destinations = await this.#artDestinations(parent);
        return textResult({displays: destinations?.map(({target, kind, label, guard, formats, maxBytes}) => ({routingId: target, kind, label, available: guard !== undefined, formats, maxBytes})) ?? null,
          artworks: art.artworks.map(item => ({artworkId: item.artworkId, createdAtMs: item.createdAtMs, favorite: item.favorite,
            renditionKinds: item.compositions.filter(part => usableArtComposition(item, part.target) !== undefined).map(part => part.target)}))});
      }
      case READ_PLAYBACK: {
        const records = await this.#snapshot<PlaybackState>(PLAYBACK, 'playback', parent);
        return records === undefined ? 'Playback unavailable.' : textResult(records.map(({id, observedAtMs, availability, playback}) => ({id, observedAtMs, availability, playback})));
      }
      case READ_VACUUM: return this.#status('bunny/modules/roborock', 'roborock-vacuum',
        ['id', 'observedAtMs', 'availability', 'activity', 'status'], parent);
      case READ_VOLCANO: return this.#status('bunny/modules/volcano', 'volcano-status',
        ['id', 'observedAtMs', 'availability', 'link', 'heater', 'pump', 'currentDeciC', 'targetDeciC', 'gapMinutes'], parent);
      case READ_OPERATION: return textResult(await this.#operation(input.requestId, parent) ?? 'Operation unavailable.');
      case READ_ART_EFFECTS: return this.#artEffects(input.requestId, parent);
      default: return undefined;
    }
  }

  async #readShows(input: ToolCall['input'], parent: TraceContext): Promise<string> {
    const {view, id, offset} = input;
    if (typeof id !== 'string' || id.length > 128 || typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) {
      return 'refused: invalid-request';
    }
    const size = 8;
    const page = (items: readonly unknown[]) => JSON.stringify({items: items.slice(0, size), nextOffset: items.length > size ? offset + size : null});
    if (view === 'drafts') return page(this.#authoring().list(offset, size + 1, id));
    if (view === 'lighting') {
      const states = await this.#snapshot<LightingState>(CORE, 'music-lighting-state', parent);
      return states === undefined ? 'Lighting sessions unavailable.' : page(states.filter(state => id === '' || id === state.id)
        .map(({id, revision, session, last}) => ({id, revision, session, last})).slice(offset, offset + size + 1));
    }
    if (view !== 'saved') return 'refused: invalid-request';
    const catalog = (await this.#snapshot<ShowCatalog>(NANOLEAF, 'nanoleaf-shows', parent))?.[0];
    if (catalog === undefined) return 'Saved shows unavailable.';
    if (id === '') return page(catalog.shows.slice(offset, offset + size + 1).map(({id, name, version}) => ({id, name, latestVersion: version})));
    const show = catalog.shows.find(row => row.id === id);
    if (show === undefined) return 'refused: not-found';
    return page(show.versions.slice(offset, offset + size + 1).map(({version, versionName, kind}) => ({showId: id, version, versionName, kind})));
  }

  async #status(owner: string, family: string, fields: readonly string[], parent: TraceContext): Promise<string> {
    const records = await this.#snapshot<Record<string, unknown>>(owner, family, parent);
    return textResult(records?.map(record => Object.fromEntries(fields.map(key => [key, record[key]]))) ?? 'Status unavailable.');
  }

  async #readDevices(input: ToolCall['input'], parent: TraceContext): Promise<string> {
    const {target, owner} = input;
    if (typeof target !== 'string' || typeof owner !== 'string') return 'refused: invalid-request';
    const owners = owner === 'auto' ? assistantDeviceOwners : assistantDeviceOwners.filter(source => source === owner);
    if (owners.length === 0) return 'refused: unsupported-capability';
    const {rows, unreadable} = await this.#deviceRecords(owners, parent);
    const selected = target === '' ? rows : matchingDevices(rows, target, owner);
    if (target === '') return textResult({devices: selected.map(({owner, device}) => ({owner, id: device.id,
      name: deviceLabel(device), lastReportedAvailability: device.availability})), unreadable});
    if (selected.length > 1) return textResult({matches: selected.map(({owner, device}) => ({owner, id: device.id})),
      guidance: 'Select the exact owner and ID.'});
    const colors = selected.some(row => row.owner === LIFX) ? await this.#snapshot<LifxColor>(LIFX, 'lifx-light', parent) : undefined;
    const now = this.context.clock.now();
    const devices = selected.map(({owner: source, device}) => {
      const light = colors?.find(row => row.id === device.id);
      const age = source === LIFX ? MAX_OBSERVATION_AGE_MS : source === WEMO ? WEMO_OBSERVATION_AGE_MS : Number.POSITIVE_INFINITY;
      const stale = observationStale(device, now, age);
      const freshness = device.observed.status === 'unknown' ? 'unknown' : device.availability !== 'available' || stale ? 'stale' : 'current';
      const color = light?.observed;
      const colorStale = color?.status === 'known' && (color.observedAtMs > now || now - color.observedAtMs >= MAX_OBSERVATION_AGE_MS ||
        device.lastTransmission.status === 'known' && color.observedAtMs < device.lastTransmission.transmittedAtMs);
      return {
        owner: source, id: device.id, name: deviceLabel(device), lastReportedAvailability: device.availability, hold: device.held ?? null,
        choices: {modes: device.capabilities.modes, media: device.capabilities.media, scenes: device.capabilities.scenes, moments: device.capabilities.moments},
        observation: {freshness, value: device.observed},
        ...(color === undefined ? {} : {color: {freshness: color.status === 'unknown' ? 'unknown' : colorStale || device.availability !== 'available' ? 'stale' : 'current', value: color}}),
        lastTransmissionAtMs: device.lastTransmission.status === 'known' ? device.lastTransmission.transmittedAtMs : null,
        controls: this.enabled.filter(tool => {
          if (tool === 'set_wemo_power') return source === 'bunny/modules/wemo' && device.capabilities.power.supported;
          if (tool === 'set_lifx_power') return source === 'bunny/modules/lifx' && device.capabilities.power.supported;
          if (tool === 'set_lifx_brightness') return source === 'bunny/modules/lifx' && device.capabilities.brightness.supported;
          const family = tool.startsWith('control_') ? tool.slice(8).replaceAll('_', '-') : '';
          if (!catalogFamily(family) || !lifxSupports(family, light)) return false;
          const route = catalogRoute(family);
          return route.binding === 'device' && route.owners.some(eligible => eligible === source) && permitsDevice(route, device);
        }),
      };
    });
    return textResult({devices, unreadable});
  }

  async #artEffects(requestId: unknown, parent: TraceContext): Promise<string> {
    if (typeof requestId !== 'string') return 'refused: invalid-request';
    const db = this.context.database();
    db.exec('CREATE TABLE IF NOT EXISTS assistant_art_shows (request_id TEXT PRIMARY KEY, targets TEXT NOT NULL)');
    const row = db.prepare('SELECT targets FROM assistant_art_shows WHERE request_id = ?').get(requestId);
    if (typeof row?.targets !== 'string') return 'Show request unavailable.';
    const list: unknown = JSON.parse(row.targets);
    if (!idList(list)) return 'Show targets unavailable.';
    const [operations, skips] = await Promise.all([this.#snapshot<OperationRecord>(CORE, 'operation', parent),
      this.#snapshot<ArtShowEffects>(CORE, ART_SHOW_EFFECTS_FAMILY, parent)]);
    const skipped = skips?.find(show => show.requestId === requestId)?.skipped ?? [];
    const result = (id: string, target?: string, phase?: 'prepare' | 'present') => {
      const skip = skipped.find(entry => entry.target === target && entry.phase === phase);
      if (skip !== undefined) return {status: 'skipped', code: skip.code};
      const record = operations?.find(operation => operation.requestId === id);
      return record === undefined ? {status: 'evidence unavailable'} : {status: record.status, result: record.result, evidence: record.evidence, code: record.error?.code};
    };
    const effects = await artShowSurfaces(requestId, list);
    return textResult({show: result(requestId), effects: effects.map(surface => surface.kind === 'browser'
      ? {target: surface.target, presentation: result(surface.presentRequestId, surface.target, 'present')}
      : {target: surface.target, preparation: result(surface.prepareRequestId, surface.target, 'prepare'), presentation: result(surface.momentRequestId, surface.target, 'present')})});
  }
}
