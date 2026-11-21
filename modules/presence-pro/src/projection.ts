import {settingChannels, type Binding, type ExclusionBinding, type SensorConfig} from './configuration.js';
import {known, unknown, type PresenceObservation, type Target} from './contracts.js';

export type ScalarReport = {key: number; value: unknown; missing?: boolean};
type Point = {x: number; y: number};
type Exclusion = {status: 'pending' | 'invalid'} | {status: 'known'; vertices: Point[]};
const emptyTarget = (slot: number): Target => ({slot, active: {value: unknown(), receivedAtMs: unknown()}, rawMm: {x: unknown(), y: unknown(), xReceivedAtMs: unknown(), yReceivedAtMs: unknown()}, apartmentMeters: unknown(), calibrationRevision: unknown()});
const clear = (target: Target): void => { target.rawMm = emptyTarget(target.slot).rawMm; target.apartmentMeters = unknown(); };
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e9;
const DETAILS = ['None', 'Targets Position', 'Above + Zone count', 'Above + Targets active', 'Above + Distance and Angle', 'Above + Speed and Resolution'];

export function polygon(value: unknown): Point[] | undefined {
  if (value === '') return [];
  if (typeof value !== 'string' || value.length > 1024) return undefined;
  const vertices = value.split(';');
  if (vertices.length < 3 || vertices.length > 20) return undefined;
  const points: Point[] = [];
  for (const vertex of vertices) {
    if (!/^-?\d{1,6}:-?\d{1,6}$/.test(vertex.trim())) return undefined;
    const [x, y] = vertex.trim().split(':').map(Number);
    points.push({x: x as number, y: y as number});
  }
  return points;
}
/** Include boundaries as excluded too: no point is drawn on a known mask edge. */
export function inside(point: Point, vertices: Point[]): boolean {
  let result = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[i] as Point, b = vertices[j] as Point;
    const cross = (point.y - a.y) * (b.x - a.x) - (point.x - a.x) * (b.y - a.y);
    if (cross === 0 && point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x) && point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y)) return true;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}

export class Projection {
  readonly #config: SensorConfig;
  readonly #settings = new Map<number, unknown>();
  readonly #settingKeys: ReadonlySet<number>;
  current: PresenceObservation;
  constructor(config: SensorConfig) {
    this.#config = config;
    this.#settingKeys = new Set(settingChannels(config.settings).map(({binding}) => binding.key));
    this.current = this.#empty('starting', 'starting');
  }
  #empty(connection: PresenceObservation['connection'], reason: PresenceObservation['reason']): PresenceObservation {
    const config = this.#config;
    return {id: config.id, sensorId: config.id, revision: 0, roomId: config.roomId, mappingRevision: config.mappingRevision, connection, reason,
      occupancy: {value: 'unknown', receivedAtMs: unknown()}, held: {value: unknown(), receivedAtMs: unknown()},
      zones: config.zones.map(zone => ({id: zone.id, roomId: zone.roomId, value: 'unknown', receivedAtMs: unknown()})), targets: config.targets.map(target => emptyTarget(target.slot))};
  }
  connected(): void { this.#settings.clear(); this.current = this.#empty('connected', 'none'); }
  disconnected(reason: PresenceObservation['reason'] = 'unavailable'): void { this.#settings.clear(); this.current = this.#empty('disconnected', reason); }
  #rectangleCoordinate(binding: Binding, minimum: number): number | null | undefined {
    if (!this.#settings.has(binding.key)) return undefined;
    const value = this.#settings.get(binding.key);
    return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= 6000 ? value : null;
  }
  #exclusion(binding: ExclusionBinding): Exclusion {
    if ('key' in binding) {
      if (!this.#settings.has(binding.key)) return {status: 'pending'};
      const vertices = polygon(this.#settings.get(binding.key));
      return vertices === undefined ? {status: 'invalid'} : {status: 'known', vertices};
    }
    const xStart = this.#rectangleCoordinate(binding.xStart, -6000);
    const xEnd = this.#rectangleCoordinate(binding.xEnd, -6000);
    const yStart = this.#rectangleCoordinate(binding.yStart, -1560);
    const yEnd = this.#rectangleCoordinate(binding.yEnd, -1560);
    if (xStart === null || xEnd === null || yStart === null || yEnd === null) return {status: 'invalid'};
    if (xStart === undefined || xEnd === undefined || yStart === undefined || yEnd === undefined) return {status: 'pending'};
    // The same inclusive boundary check handles reversed corners and collapsed masks.
    return {status: 'known', vertices: [
      {x: xStart, y: yStart}, {x: xEnd, y: yStart}, {x: xEnd, y: yEnd}, {x: xStart, y: yEnd},
    ]};
  }
  #interpretable(): boolean {
    const settings = this.#config.settings;
    if (settings === undefined) return false;
    const detail = this.#settings.get(settings.detail.key);
    return typeof detail === 'string' && DETAILS.indexOf(detail) >= 3
      && finite(this.#settings.get(settings.angle.key)) && typeof this.#settings.get(settings.upsideDown.key) === 'boolean'
      && finite(this.#settings.get(settings.range.key)) && Number(this.#settings.get(settings.range.key)) > 0;
  }
  #invalidSettings(): boolean {
    const settings = this.#config.settings;
    if (settings === undefined) return false;
    return [settings.angle, settings.range].some(binding => this.#settings.has(binding.key) && !finite(this.#settings.get(binding.key)))
      || this.#settings.has(settings.range.key) && Number(this.#settings.get(settings.range.key)) <= 0
      || this.#settings.has(settings.upsideDown.key) && typeof this.#settings.get(settings.upsideDown.key) !== 'boolean'
      || this.#settings.has(settings.detail.key) && (typeof this.#settings.get(settings.detail.key) !== 'string' || DETAILS.indexOf(String(this.#settings.get(settings.detail.key))) < 3);
  }
  report(report: ScalarReport, receivedAtMs: number): void {
    if (this.current.connection !== 'connected') return;
    const {key} = report, value = report.missing === true ? undefined : report.value;
    const stamp = known(receivedAtMs);
    const config = this.#config, state = this.current;
    if (key === config.occupancy.key) state.occupancy = {value: typeof value === 'boolean' ? value ? 'occupied' : 'vacant' : 'unknown', receivedAtMs: stamp};
    if (key === config.held?.key) state.held = {value: typeof value === 'boolean' ? known(value) : unknown(), receivedAtMs: stamp};
    for (const [index, zone] of config.zones.entries()) if (key === zone.binding.key) {
      const result = state.zones[index];
      if (result !== undefined) { result.value = typeof value === 'boolean' ? value ? 'occupied' : 'vacant' : 'unknown'; result.receivedAtMs = stamp; }
    }
    const settings = config.settings;
    if (this.#settingKeys.has(key)) {
      const previous = this.#settings.get(key);
      this.#settings.set(key, value);
      // A settings change can change coordinates or masks. Never reuse the old occupant's axes across it.
      if (previous !== undefined && previous !== value || value === undefined) for (const target of state.targets) clear(target);
    }
    const exclusions = settings?.exclusions.map(binding => this.#exclusion(binding)) ?? [];
    const invalidSettings = this.#invalidSettings() || exclusions.some(mask => mask.status === 'invalid');
    const interpretable = this.#interpretable() && exclusions.every(mask => mask.status === 'known');
    for (const [index, binding] of config.targets.entries()) {
      const target = state.targets[index];
      if (target === undefined) continue;
      if (key === binding.active.key) {
        target.active = {value: typeof value === 'boolean' ? known(value) : unknown(), receivedAtMs: stamp};
        if (value !== true) clear(target);
      }
      if (key === binding.x.key || key === binding.y.key) {
        if (!finite(value)) clear(target);
        else if (key === binding.x.key) { target.rawMm.x = known(value); target.rawMm.xReceivedAtMs = stamp; }
        else { target.rawMm.y = known(value); target.rawMm.yReceivedAtMs = stamp; }
      }
      target.apartmentMeters = unknown();
      const calibration = config.calibration;
      target.calibrationRevision = calibration === undefined ? unknown() : known(calibration.revision);
      const {x, y} = target.rawMm;
      if (invalidSettings) { clear(target); continue; }
      if (target.active.value.status === 'known' && !target.active.value.value) continue;
      if (!interpretable || target.active.value.status !== 'known') continue;
      if (x.status !== 'known' || y.status !== 'known') continue;
      if (x.value === 0 && y.value === 0) { clear(target); continue; }
      if (exclusions.some(mask => mask.status === 'known' && inside({x: x.value, y: y.value}, mask.vertices))) { clear(target); continue; }
      if (calibration === undefined || settings === undefined || calibration.angle !== this.#settings.get(settings.angle.key)
        || calibration.upsideDown !== this.#settings.get(settings.upsideDown.key) || calibration.rangeCm !== this.#settings.get(settings.range.key)) continue;
      const localX = x.value / 1000, forward = y.value / 1000;
      target.apartmentMeters = known({x: calibration.tx + Math.cos(calibration.yaw) * localX + Math.sin(calibration.yaw) * forward,
        z: calibration.tz - Math.sin(calibration.yaw) * localX + Math.cos(calibration.yaw) * forward});
    }
  }
}
