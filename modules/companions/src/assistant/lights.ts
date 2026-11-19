import {ASSISTANT_LIGHT_OWNER, type AssistantLightAction} from '@jimmie-potts/event-contracts/v2/assistant';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {Cancel, ModuleContext, SyncedCopy} from '@jimmie-potts/sdk';
import type {ToolCall} from './provider.js';
import {READ_BYTES, SET_LIFX_POWER} from './tools.js';

/** A read-only SDK copy of the LIFX owner's device records. A gap makes the copy unavailable until it resyncs. */
export class AssistantLights {
  #copy: SyncedCopy<DeviceRecord> | undefined;
  #work: Promise<void> | undefined;
  #retry: Cancel | undefined;
  #delay = 1000;
  #fresh = false;
  #closed = false;
  constructor(private readonly context: ModuleContext) {}

  start(): void {this.#work = this.#follow();}
  records(): readonly DeviceRecord[] | undefined {
    return this.#fresh ? this.#copy?.states().map(record => record.data) : undefined;
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
      }, {owner: ASSISTANT_LIGHT_OWNER, timeoutMs: 5000, onRestarted: () => {replacing = true; this.#fresh = false;}});
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

export const lightLabel = (device: DeviceRecord): string => device.label?.slice(0, 128) ?? device.id;
const normalized = (name: string): string => name.trim().toLowerCase().replace(/[\s-]+/g, '-');
type Selection = {device: DeviceRecord} | {matches: readonly DeviceRecord[]} | {code: 'invalid-request' | 'not-found' | 'unavailable'};

export function chooseLight(devices: readonly DeviceRecord[] | undefined, name: unknown): Selection {
  if (typeof name !== 'string' || name.length > 128 || name.trim() === '') return {code: 'invalid-request'};
  if (devices === undefined) return {code: 'unavailable'};
  const exact = devices.find(device => device.id === name);
  if (exact !== undefined) return {device: exact};
  const matches = devices.filter(device => normalized(lightLabel(device)) === normalized(name) || normalized(device.id) === normalized(name));
  if (matches.length === 0) return {code: 'not-found'};
  return matches.length === 1 && matches[0] !== undefined ? {device: matches[0]} : {matches};
}

export function readLights(devices: readonly DeviceRecord[] | undefined, name: unknown): string {
  if (name === '') {
    if (devices === undefined) return 'LIFX status unavailable: the device copy is not synced.';
    if (devices.length === 0) return 'No configured LIFX lights are known.';
    return devices.slice(0, 10).map(device => `${lightLabel(device)} (${device.id})`).join('\n').slice(0, READ_BYTES / 4);
  }
  const selected = chooseLight(devices, name);
  if ('code' in selected) return `LIFX status unavailable: ${selected.code}.`;
  if ('matches' in selected) return `Multiple LIFX lights match. Ask the owner which one: ${selected.matches.slice(0, 4).map(device => device.id).join(', ')}.`;
  const {device} = selected;
  const {observed, availability, capabilities, lastTransmission} = device;
  const actions = [capabilities.power.supported ? 'power' : '', capabilities.brightness.supported ? 'brightness' : ''].filter(value => value !== '');
  const controls = `Supported controls: ${actions.length === 0 ? 'none' : actions.join(', ')}.`;
  const last = observed.status !== 'known' ? 'Observed power and brightness are unknown.' :
    `Observed power: ${observed.power.status === 'known' ? (observed.power.value ? 'on' : 'off') : 'unknown'}. Observed brightness: ${observed.brightness.status === 'known' ? `${String(observed.brightness.value)}%` : 'unknown'}. Last observation at ${new Date(observed.observedAtMs).toISOString()}.`;
  const olderThanWrite = observed.status === 'known' && lastTransmission.status === 'known' && observed.observedAtMs < lastTransmission.transmittedAtMs;
  const state = availability === 'available' && !olderThanWrite ? last : `Current state is unknown. ${last}`;
  return `${lightLabel(device)} (${device.id}) is ${availability}. ${controls} ${state}`;
}

export function lightProposal(call: ToolCall, device: DeviceRecord): {proposal: AssistantLightAction} | {code: 'invalid-request' | 'unavailable' | 'unsupported-capability'} {
  if (device.availability !== 'available' || device.held !== undefined) return {code: 'unavailable'};
  if (Object.keys(call.input).length !== 2) return {code: 'invalid-request'};
  const guards = {expectedConfigurationRevision: device.configurationRevision, expectedGeneration: device.generation};
  const {on, percent} = call.input;
  if (call.name === SET_LIFX_POWER) {
    if (typeof on !== 'boolean') return {code: 'invalid-request'};
    if (!device.capabilities.power.supported) return {code: 'unsupported-capability'};
    return {proposal: {family: 'power-set', target: device.id, data: {...guards, on}}};
  }
  if (typeof percent !== 'number' || !Number.isInteger(percent) || percent < 0 || percent > 100) return {code: 'invalid-request'};
  if (!device.capabilities.brightness.supported) return {code: 'unsupported-capability'};
  return {proposal: {family: 'brightness-set', target: device.id, data: {...guards, percent}}};
}

export function lightText(action: AssistantLightAction, label: string): string {
  return action.family === 'power-set' ? `Turn ${action.data.on ? 'on' : 'off'} ${label}?` : `Set ${label} brightness to ${String(action.data.percent)}%?`;
}
