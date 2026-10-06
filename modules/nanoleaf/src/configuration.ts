// Installation configuration: registered devices, their saved or discovered geometry, and Line pairing (configuration.py).
// The state directory's location is the installation's, so `data_dir` is not ported (PORTING.md).
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {isObject, pyHypot, pyMod, pyRound, pySum, radians, sameValue} from './compat.js';
import {credential, DEFAULT, KINDS, layoutDevices, linesEntry, projection, registry, saveDeviceLayout, type DeviceProjection, type LayoutEntry,
  type RegistryEntry} from './devices.js';
import {ValueError} from './errors.js';
import {readJson, writeJson} from './jsonfile.js';
import {readLayout} from './panels.js';
import type {LightRequest} from './transport.js';

/** One device's configuration: config.json with the device's layout, identity, address and credential. */
export interface LoadedConfig extends DeviceProjection {
  device: string;
  ip?: string;
  token?: string;
  [key: string]: unknown;
}

const LINE_ZONE = 18;

interface Reported {
  panelId: number;
  x: number;
  y: number;
  o: number;
}

/** Every reported position by panel ID, as the device listed them. */
function reportedPoints(panelLayout: unknown): Map<unknown, unknown> {
  const layout = isObject(panelLayout) ? panelLayout.layout : undefined;
  const points = isObject(layout) ? layout.positionData : undefined;
  if (!Array.isArray(points)) throw new ValueError('Invalid Lines layout.');
  return new Map(points.map(point => [isObject(point) ? point.panelId : undefined, point]));
}

/** A reported position with the fields pairing reads. */
function reported(point: unknown): Reported {
  if (!isObject(point)) throw new ValueError('Invalid Lines position.');
  const {panelId, x, y, o} = point;
  if (typeof panelId !== 'number' || typeof x !== 'number' || typeof y !== 'number' || typeof o !== 'number') throw new ValueError('Invalid Lines position.');
  return {panelId, x, y, o};
}

/** Pair the two collinear light zones of each NL59 Line, excluding connectors, in the installed orientation's order. */
export function pairLines(panelLayout: unknown): number[][] {
  const zones = [...reportedPoints(panelLayout).values()].filter(point => isObject(point) && point.shapeType === LINE_ZONE).map(reported);
  const global = isObject(panelLayout) ? panelLayout.globalOrientation : undefined;
  const orientation = isObject(global) ? global.value : undefined;
  if (zones.length === 0 || zones.length % 2 !== 0) throw new ValueError('Expected two light zones per Line.');
  const nearest = new Map<number, number>();
  const byId = new Map(zones.map(zone => [zone.panelId, zone]));
  for (const a of zones) {
    let best: [number, number] | null = null;
    const angle = radians(a.o);
    for (const other of zones) {
      if (sameValue(a, other) || pyMod(a.o - other.o, 180) !== 0) continue;
      const dx = other.x - a.x;
      const dy = other.y - a.y;
      // Orientation zero follows the y axis in the controller's layout.
      if (Math.abs(dx * Math.cos(angle) + dy * Math.sin(angle)) >= 3) continue;
      const candidate: [number, number] = [pyHypot(dx, dy), other.panelId];
      if (best === null || candidate[0] < best[0] || (candidate[0] === best[0] && candidate[1] < best[1])) best = candidate;
    }
    if (best === null) throw new ValueError('Could not pair a Line zone.');
    nearest.set(a.panelId, best[1]);
  }
  const pairs = new Map<string, [number, number]>();
  for (const [first, second] of nearest) {
    if (nearest.get(second) !== first) throw new ValueError('Line zone pairing is ambiguous.');
    const pair: [number, number] = first < second ? [first, second] : [second, first];
    pairs.set(pair.join(':'), pair);
  }
  // Follow the installed orientation for a spatially ordered notification sweep.
  if (typeof orientation !== 'number') throw new ValueError('Invalid Lines orientation.');
  const turn = radians(orientation);
  const location = (pair: readonly [number, number]): [number, number] => {
    const x = pySum(pair.map(id => byId.get(id)?.x ?? Number.NaN)) / 2;
    const y = pySum(pair.map(id => byId.get(id)?.y ?? Number.NaN)) / 2;
    return [pyRound(x * Math.cos(turn) - y * Math.sin(turn)), pyRound(x * Math.sin(turn) + y * Math.cos(turn))];
  };
  // Python sorted a set; distinct Lines never share a rounded location, so the pair only breaks impossible ties.
  return [...pairs.values()].map(pair => ({pair, at: location(pair)}))
    .sort((a, b) => (a.at[0] !== b.at[0] ? a.at[0] - b.at[0] : a.at[1] !== b.at[1] ? a.at[1] - b.at[1] : a.pair[0] - b.pair[0]))
    .map(({pair}) => [...pair]);
}

/** A saved entry with a position for every element needs no device read. */
const complete = (layout: LayoutEntry | null): boolean => layout !== null && layout.elements.every(element => element.position !== null);

/**
 * Configuration and layout for one registered device; the original Lines device by default.
 *
 * A saved layout needs no device request. A missing or incomplete one is read from the device through `request` and
 * saved before use.
 */
export async function loadConfig(directory: string, device: string = DEFAULT, request?: LightRequest): Promise<LoadedConfig> {
  const config = readJson(join(directory, 'config.json'));
  const entries = registry(config);
  const entry = entries.get(device);
  if (entry === undefined || !isObject(config)) throw new ValueError('Unknown device.');
  const token = credential(config, entry);
  const layoutFile = join(directory, 'layout.json');
  // A malformed file is rejected and left in place.
  const known = layoutDevices(existsSync(layoutFile) ? readJson(layoutFile) : {});
  let layout = known.get(device) ?? null;
  if (layout === null || !complete(layout)) {
    // The Nanoleaf HTTP client joins in slice 2b; until then the caller supplies the request.
    if (request === undefined) throw new ValueError('Reading the layout from the device needs a light request.');
    const reply = await request({ip: entry.ip ?? '', token: token ?? ''}, 'GET');
    if (!isObject(reply) || !Object.hasOwn(reply, 'panelLayout')) throw new ValueError('The device reported no layout.');
    const panelLayout = reply.panelLayout;
    if (entry.kind === 'panels') {
      // Reported triangles only; unsupported geometry fails before anything is saved.
      layout = readLayout(panelLayout);
    } else {
      const groups = layout !== null ? layout.elements.map(element => element.zones) : pairLines(panelLayout);
      const points = reportedPoints(panelLayout);
      const at = (id: number): Reported => reported(points.get(id));
      const positions = groups.map(pair => [pySum(pair.map(id => at(id).x)) / 2, pySum(pair.map(id => at(id).y)) / 2]);
      layout = linesEntry(groups, positions, layout);
    }
    saveDeviceLayout(layoutFile, device, layout, writeJson);
  }
  const result: LoadedConfig = {...config, ...projection(layout), device};
  if (entry.ip !== null) result.ip = entry.ip;
  if (token !== null) result.token = token;
  const groups = result.line_groups;
  const ids = groups.flat();
  if (groups.length === 0 || groups.some(pair => pair.length !== KINDS[entry.kind]) || new Set(ids).size !== ids.length
      || ids.some(id => !Number.isInteger(id))) {
    throw new ValueError('Invalid physical Line mapping.');
  }
  const positions = result.line_positions;
  if ((Array.isArray(positions) ? positions.length : 0) !== groups.length) throw new ValueError('Each Line needs a position for outward pulses.');
  return result;
}

/** Registered device ids, the original Lines device first; an unreadable configuration means Lines only. */
export function registeredDevices(directory: string): string[] {
  let devices: Map<string, unknown>;
  try {
    devices = registry(readJson(join(directory, 'config.json'), true));
  } catch (error) {
    if (error instanceof ValueError || (error instanceof Error && 'code' in error)) return [DEFAULT];
    throw error;
  }
  return [DEFAULT, ...[...devices.keys()].filter(device => device !== DEFAULT)];
}

/** Point a running pass at its device's registered address and credential; keep them if unreadable. */
export function followRegistry(directory: string, config: {ip?: string; token?: string}, device: string): void {
  let saved: unknown;
  let entry: RegistryEntry | undefined;
  try {
    saved = readJson(join(directory, 'config.json'), true);
    entry = registry(saved).get(device);
  } catch (error) {
    if (error instanceof ValueError || (error instanceof Error && 'code' in error)) return;
    throw error;
  }
  if (entry === undefined || !isObject(saved)) return;
  if (entry.ip !== null) config.ip = entry.ip;
  const token = credential(saved, entry);
  if (token !== null) config.token = token;
}
