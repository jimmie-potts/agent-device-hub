import {ASSISTANT_LIGHT_OWNER, ASSISTANT_WEMO_OWNER, type AssistantDeviceAction, type AssistantDeviceOwner} from '@jimmie-potts/event-contracts/v2/assistant';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {Cancel, ModuleContext, SyncedCopy, TraceContext} from '@jimmie-potts/sdk';
import type {ToolCall} from './provider.js';
import {READ_BYTES, SET_LIFX_POWER, SET_WEMO_POWER} from './tools.js';

/** A read-only SDK copy of one owner's device records. A gap makes the copy unavailable until it resyncs. */
export class AssistantDeviceCopy {
  #copy: SyncedCopy<DeviceRecord> | undefined;
  #work: Promise<void> | undefined;
  #retry: Cancel | undefined;
  #delay = 1000;
  #fresh = false;
  #closed = false;
  constructor(private readonly context: ModuleContext, private readonly owner: AssistantDeviceOwner) {}

  start(): void {this.#work = this.#follow();}
  records(): readonly DeviceRecord[] | undefined {
    return this.#fresh ? this.#copy?.states().map(record => record.data) : undefined;
  }
  async read(name: unknown, signal: AbortSignal, parent: TraceContext): Promise<string> {
    const records = this.records(), now = this.context.clock.now();
    if (this.owner !== ASSISTANT_LIGHT_OWNER || signal.aborted) return readDevices(records, name, now, this.owner);
    const selection = chooseDevice(records, name);
    if (!('device' in selection) || (selection.device.observed.status === 'known' &&
      !observationStale(selection.device, now, MAX_OBSERVATION_AGE_MS))) return readDevices(records, name, now, this.owner);

    // The owner's sync requests a rate-limited LightGet. A read that finds the same
    // state can leave the published timestamp unchanged.
    const before = selection.device;
    let finish: () => void = () => {};
    const observed = new Promise<void>(resolve => {finish = resolve;});
    const deadline = this.context.scheduler.after(2000, finish);
    signal.addEventListener('abort', finish, {once: true});
    try {
      const snapshot = await this.context.sdk.sync<DeviceRecord>(['device'], change => {
        if (change.type === 'failed' || (change.type === 'updated' && change.message.data.id === before.id &&
          change.message.data.revision > before.revision)) finish();
      }, {owner: this.owner, timeoutMs: 1000, parent});
      if (snapshot.status !== 'synced') return readDevices(records, name, this.context.clock.now(), this.owner);
      try {
        if (!snapshot.copy.states().some(({data}) => data.id === before.id && data.revision > before.revision)) await observed;
        return readDevices(snapshot.copy.states().map(({data}) => data), name, this.context.clock.now(), this.owner);
      } finally {await snapshot.copy.close();}
    } finally {
      deadline();
      signal.removeEventListener('abort', finish);
    }
  }
  async close(): Promise<void> {
    this.#closed = true;
    this.#retry?.();
    await this.#work;
    await this.#copy?.close();
  }

  async #follow(): Promise<void> {
    await this.#copy?.close();
    this.#copy = undefined;
    if (this.#closed) return;
    let replacing = false;
    try {
      const result = await this.context.sdk.sync<DeviceRecord>(['device'], change => {
        if (change.type === 'failed') {replacing = true; this.#resync();}
        if (change.type === 'synced') {
          replacing = false;
          this.#fresh = this.#copy !== undefined;
        }
      }, {owner: this.owner, timeoutMs: 5000, onRestarted: () => {replacing = true; this.#fresh = false;}});
      if (result.status !== 'synced') {this.#resync(); return;}
      if (this.#closed) {await result.copy.close(); return;}
      this.#copy = result.copy;
      this.#fresh = !replacing;
      this.#delay = 1000;
    } catch {this.#resync();}
  }
  #resync(): void {
    this.#fresh = false;
    if (this.#closed || this.#retry !== undefined) return;
    this.#retry = this.context.scheduler.after(this.#delay, () => {this.#retry = undefined; this.start();});
    this.#delay = Math.min(this.#delay * 2, 30_000);
  }
}

export const deviceLabel = (device: DeviceRecord): string => device.label?.slice(0, 128) ?? device.id;
const normalized = (name: string): string => name.trim().toLowerCase().replace(/[\s-]+/g, '-');
type Selection = {device: DeviceRecord} | {matches: readonly DeviceRecord[]} | {code: 'invalid-request' | 'not-found' | 'unavailable'};

export function chooseDevice(devices: readonly DeviceRecord[] | undefined, name: unknown): Selection {
  if (typeof name !== 'string' || name.length > 128 || name.trim() === '') return {code: 'invalid-request'};
  if (devices === undefined) return {code: 'unavailable'};
  const exact = devices.find(device => device.id === name);
  if (exact !== undefined) return {device: exact};
  const matches = devices.filter(device => normalized(deviceLabel(device)) === normalized(name) || normalized(device.id) === normalized(name));
  if (matches.length === 0) return {code: 'not-found'};
  return matches.length === 1 && matches[0] !== undefined ? {device: matches[0]} : {matches};
}

// LIFX treats a reading older than 30 seconds as due for an on-demand refresh.
const MAX_OBSERVATION_AGE_MS = 30_000;
function observationStale({observed, lastTransmission}: DeviceRecord, now: number, maxAgeMs: number): boolean {
  return observed.status === 'known' && (observed.observedAtMs > now || now - observed.observedAtMs >= maxAgeMs ||
    (lastTransmission.status === 'known' && observed.observedAtMs < lastTransmission.transmittedAtMs));
}
export function readDevices(devices: readonly DeviceRecord[] | undefined, name: unknown, nowMs: number,
  owner: AssistantDeviceOwner = ASSISTANT_LIGHT_OWNER): string {
  const wemo = owner === ASSISTANT_WEMO_OWNER;
  const brand = wemo ? 'Wemo' : 'LIFX', namePlural = wemo ? 'plugs' : 'lights';
  const maxAgeMs = wemo ? 15_000 : MAX_OBSERVATION_AGE_MS;
  if (name === '') {
    if (devices === undefined) return `${brand} status unavailable: the device copy is not synced.`;
    if (devices.length === 0) return `No configured ${brand} ${namePlural} are known.`;
    return devices.slice(0, 10).map(device => `${deviceLabel(device)} (${device.id})`).join('\n').slice(0, READ_BYTES / 4);
  }
  const selected = chooseDevice(devices, name);
  if ('code' in selected) return `${brand} status unavailable: ${selected.code}.`;
  if ('matches' in selected) return `Multiple ${brand} ${namePlural} match. Ask the owner which one: ${selected.matches.slice(0, 4).map(device => device.id).join(', ')}.`;
  const {device} = selected;
  const {observed, availability, capabilities} = device;
  const actions = [capabilities.power.supported ? 'power' : '', capabilities.brightness.supported ? 'brightness' : ''].filter(value => value !== '');
  const controls = `Supported controls: ${actions.length === 0 ? 'none' : actions.join(', ')}.`;
  const last = observed.status !== 'known' ? (wemo ? 'Observed power is unknown.' : 'Observed power and brightness are unknown.') :
    `Observed power: ${observed.power.status === 'known' ? (observed.power.value ? 'on' : 'off') : 'unknown'}. ` +
    (wemo ? '' : `Observed brightness: ${observed.brightness.status === 'known' ? `${String(observed.brightness.value)}%` : 'unknown'}. `) +
    `Last observation at ${new Date(observed.observedAtMs).toISOString()}.`;
  const stale = observationStale(device, nowMs, maxAgeMs);
  const state = availability === 'available' && !stale ? last : `Current state is unknown. ${stale ? 'The observation is stale. ' : ''}${last}`;
  return `${deviceLabel(device)} (${device.id}). Last reported availability: ${availability}.${device.held === undefined ? '' : ' Device held.'} ${controls} ${state}`;
}

export function deviceProposal(call: ToolCall, device: DeviceRecord): {proposal: AssistantDeviceAction} | {code: 'invalid-request' | 'unavailable' | 'unsupported-capability'} {
  if (device.availability !== 'available' || device.held !== undefined) return {code: 'unavailable'};
  if (Object.keys(call.input).length !== 2) return {code: 'invalid-request'};
  const guards = {expectedConfigurationRevision: device.configurationRevision, expectedGeneration: device.generation};
  const {on, percent} = call.input;
  if (call.name === SET_LIFX_POWER || call.name === SET_WEMO_POWER) {
    if (typeof on !== 'boolean') return {code: 'invalid-request'};
    if (!device.capabilities.power.supported) return {code: 'unsupported-capability'};
    const action = {family: 'power-set', target: device.id, data: {...guards, on}} as const;
    return {proposal: call.name === SET_WEMO_POWER ? {...action, owner: ASSISTANT_WEMO_OWNER} : action};
  }
  if (typeof percent !== 'number' || !Number.isInteger(percent) || percent < 0 || percent > 100) return {code: 'invalid-request'};
  if (!device.capabilities.brightness.supported) return {code: 'unsupported-capability'};
  return {proposal: {family: 'brightness-set', target: device.id, data: {...guards, percent}}};
}

export function deviceProposalText(action: AssistantDeviceAction, label: string): string {
  return action.family === 'power-set' ? `Turn ${action.data.on ? 'on' : 'off'} ${label}?` : `Set ${label} brightness to ${String(action.data.percent)}%?`;
}
