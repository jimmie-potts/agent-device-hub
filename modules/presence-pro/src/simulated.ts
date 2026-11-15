import type {SensorConfig} from './configuration.js';
import type {NativeFactory} from './native.js';
import {NativeFault, type NativeCallbacks} from './native.js';
import type {DeviceAction, DeviceSimulation} from '@jimmie-potts/sdk';
import {createPresenceModule} from './module.js';
import type {ScalarReport} from './projection.js';

export const SYNTHETIC_SENSOR: SensorConfig = {
  id: 'presence-a', address: '192.0.2.41', port: 6053, mac: '020000000041', roomId: 'synthetic-room', mappingRevision: 1, security: {mode: 'plaintext'},
  occupancy: {key: 1}, held: {key: 5}, zones: [{id: 'zone-one', roomId: 'synthetic-room', binding: {key: 6}}], targets: [{slot: 1, x: {key: 2}, y: {key: 3}, active: {key: 4}}],
  settings: {detail: {key: 7}, angle: {key: 8}, upsideDown: {key: 9}, range: {key: 10}, exclusions: [{key: 11}, {key: 12}]},
  calibration: {revision: 1, tx: 2, tz: 3, yaw: Math.PI / 2, angle: 0, upsideDown: false, rangeCm: 600},
};
export const SYNTHETIC_SECTION = {sensors: [SYNTHETIC_SENSOR, {...SYNTHETIC_SENSOR, id: 'presence-b', address: '192.0.2.42', mac: '020000000042'}]};
export const reports = (): ScalarReport[] => [
  {key: 7, value: 'Above + Targets active'}, {key: 8, value: 0}, {key: 9, value: false}, {key: 10, value: 600}, {key: 11, value: ''}, {key: 12, value: ''},
  {key: 1, value: true}, {key: 5, value: false}, {key: 6, value: true}, {key: 4, value: true}, {key: 2, value: 1000}, {key: 3, value: 2000},
];
export const simulatedNative: NativeFactory = (_sensor, _secrets, callbacks) => ({open: () => { for (const report of reports()) callbacks.report(report); return Promise.resolve(); }, close: () => {}});

export class SimulatedPresence {
  readonly #callbacks = new Map<string, NativeCallbacks>();
  readonly #offline = new Set<string>();
  readonly #reports = new Map<string, Map<number, ScalarReport>>();
  initial(id: string): {online: boolean; reports: ScalarReport[]} { return {online: !this.#offline.has(id), reports: [...(this.#reports.get(id)?.values() ?? reports())]}; }
  state(): unknown { return Object.fromEntries(SYNTHETIC_SECTION.sensors.map(sensor => [sensor.id, this.initial(sensor.id)])); }
  readonly native: NativeFactory = (sensor, _secrets, callbacks) => ({open: () => {
    const initial = this.initial(sensor.id);
    if (!initial.online) return Promise.reject(new NativeFault('unavailable'));
    this.#callbacks.set(sensor.id, callbacks);
    for (const report of initial.reports) callbacks.report(report);
    return Promise.resolve();
  }, close: () => { if (this.#callbacks.get(sensor.id) === callbacks) this.#callbacks.delete(sensor.id); }});
  act(action: DeviceAction): void {
    const id = String(action.id);
    if (action.action === 'offline') { this.#offline.add(id); this.#callbacks.get(id)?.disconnected('unavailable'); }
    else if (action.action === 'online') this.#offline.delete(id);
    else {
      let values = this.#reports.get(id);
      if (values === undefined) { values = new Map(reports().map(report => [report.key, report])); this.#reports.set(id, values); }
      const report: ScalarReport = {key: Number(action.key), value: action.value, missing: action.missing === true};
      values.set(report.key, report); this.#callbacks.get(id)?.report(report);
    }
  }
}
export const simulation: DeviceSimulation<SimulatedPresence, SimulatedPresence> = {
  actions: ['report', 'offline', 'online'],
  admits: (action, fields) => typeof fields.id === 'string' && /^presence-[ab]$/.test(fields.id)
    && (action === 'report' ? Object.keys(fields).every(key => ['id', 'key', 'value', 'missing'].includes(key)) && Number.isInteger(fields.key) && Number(fields.key) >= 1 && Number(fields.key) <= 12
      && (fields.value === null || ['number', 'string', 'boolean'].includes(typeof fields.value)) && (fields.missing === undefined || typeof fields.missing === 'boolean') : Object.keys(fields).length === 1),
  memory: {create: () => new SimulatedPresence(), state: device => device.state(), act: (device, action) => { device.act(action); }, build: device => createPresenceModule({native: device.native})},
  run: {create: () => new SimulatedPresence(), state: device => device.state(), act: async (device, action, push) => { device.act(action); await push(action); },
    serve: (device, call) => call.method === 'initial' ? device.initial(String((call.args as {id: string}).id)) : null,
    remote: link => {
      const callbacks = new Map<string, NativeCallbacks>();
      link.onPush(action => {
        const callback = callbacks.get(String(action.id));
        if (action.action === 'offline') callback?.disconnected('unavailable');
        if (action.action === 'report') callback?.report({key: Number(action.key), value: action.value, missing: action.missing === true});
      });
      return createPresenceModule({native: (sensor, _secrets, callback) => ({open: async signal => {
        const answer = await link.call('initial', {id: sensor.id}, signal);
        if (answer.status !== 'answered') throw new NativeFault('unavailable');
        const initial = answer.value as {online: boolean; reports: ScalarReport[]};
        if (!initial.online) throw new NativeFault('unavailable');
        callbacks.set(sensor.id, callback);
        for (const report of initial.reports) callback.report(report);
      }, close: () => { if (callbacks.get(sensor.id) === callback) callbacks.delete(sensor.id); }})});
    }},
};
