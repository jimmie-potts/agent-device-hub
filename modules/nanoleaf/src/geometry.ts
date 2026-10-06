// Map geometry from cached device layouts: Line segments, NL22 triangles and the Lines connector graph (project_map.py).
// Nothing here contacts a device; the map shows only what the saved layout already holds.
import {isObject, pyHypot, pyMod, pyRound, radians} from './compat.js';
import {elementId, elements, type DeviceConfig} from './devices.js';
import {ValueError} from './errors.js';
import {SIDE} from './panels.js';

/** A point on the map: x to the right and y downward, after the device's global orientation. */
export type Point = [number, number];

/** One element's outline: a Line's three points along its length, or a triangle's three corners. */
export interface Shape {
  id: string;
  number: number;
  points: Point[];
}

/** A device configuration with its cached geometry, which is validated before use. */
export interface GeometryConfig extends DeviceConfig {
  zone_geometry?: unknown;
  connector_geometry?: unknown;
  panel_geometry?: unknown;
}

export interface ConnectorPoint {
  panelId: number;
  x: number;
  y: number;
  o: number;
  shapeType: number;
}

/** The allowlisted copy of a reported layout that the connector graph is built from. */
export interface ConnectorCache {
  version: 1;
  orientation: number;
  positionData: ConnectorPoint[];
}

export interface ConnectorNode {
  id: string;
  x: number;
  y: number;
  sourceIds: number[];
}

export interface ConnectorLine {
  id: string;
  number: number;
  a: string;
  b: string;
  zoneIds: number[];
}

export interface ConnectorGraph {
  version: 1;
  nodes: ConnectorNode[];
  lines: ConnectorLine[];
}

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);
/** Python's truth value of a cached value: None, False, 0, '' and empty containers are false. */
const falsy = (value: unknown): boolean => value === undefined || value === null || value === false || value === 0 || value === ''
  || (Array.isArray(value) && value.length === 0) || (isObject(value) && Object.keys(value).length === 0);
/** Python's math.degrees. */
const degrees = (value: number): number => value * (180 / Math.PI);

/** Map coordinates: the device's global orientation applied, with y pointing down. */
function rotation(orientation: number): (x: number, y: number) => Point {
  const angle = radians(orientation);
  return (x, y) => [x * Math.cos(angle) - y * Math.sin(angle), -(x * Math.sin(angle) + y * Math.cos(angle))];
}

/** A reported position's coordinate, which Python read by key and raised on when missing. */
function coordinate(point: unknown, key: 'x' | 'y' | 'o'): number {
  const value = isObject(point) ? point[key] : undefined;
  if (typeof value !== 'number') throw new TypeError(`A reported position needs a numeric ${key}.`);
  return value;
}

/** Map segments for two-zone Lines; a device without that shape has no Line geometry. */
export function geometry(config: GeometryConfig): Shape[] {
  const raw = config.zone_geometry;
  const items = elements(config);
  if (falsy(raw) || items.some(element => element.zones.length !== 2)) return [];
  if (!isObject(raw) || !Array.isArray(raw.positionData)) throw new TypeError('Invalid zone geometry.');
  const zones = new Map<unknown, unknown>(raw.positionData.map(point => [isObject(point) ? point.panelId : undefined, point]));
  const rotate = rotation(Object.hasOwn(raw, 'orientation') ? coordinateValue(raw.orientation) : 0);
  return items.map(element => {
    const [a, b] = element.zones.map(id => {
      if (!zones.has(id)) throw new RangeError(`No reported position for zone ${id}.`);
      return zones.get(id);
    });
    const [ax, ay, bx, by] = [coordinate(a, 'x'), coordinate(a, 'y'), coordinate(b, 'x'), coordinate(b, 'y')];
    const dx = bx - ax;
    const dy = by - ay;
    return {id: element.id, number: element.number, points: [rotate(ax - dx / 2, ay - dy / 2), rotate((ax + bx) / 2, (ay + by) / 2), rotate(bx + dx / 2, by + dy / 2)]};
  });
}

function coordinateValue(value: unknown): number {
  if (typeof value !== 'number') throw new TypeError('A geometry orientation must be a number.');
  return value;
}

/**
 * Map polygons for one-zone NL22 triangles from cached geometry; [] when it is unavailable.
 *
 * Each vertex sits one circumradius from the reported centroid at 90° + o + k·120°, so o 0 is an apex-up triangle and o 60
 * an apex-down one, which is the only reading that makes the cached rows edge-adjacent. The global orientation and the
 * display Y inversion match `geometry`.
 */
export function triangleGeometry(config: GeometryConfig): Shape[] {
  const raw = config.panel_geometry;
  const items = elements(config);
  if (!isObject(raw) || !Array.isArray(raw.triangles) || items.length === 0 || items.some(element => element.zones.length !== 1)) return [];
  const known = new Map<string, {x: number; y: number; o: number}>();
  for (const triangle of raw.triangles) {
    if (!isObject(triangle) || typeof triangle.id !== 'string') continue;
    const {x, y, o} = triangle;
    if (isFiniteNumber(x) && isFiniteNumber(y) && isFiniteNumber(o)) known.set(triangle.id, {x, y, o});
  }
  const orientation = Object.hasOwn(raw, 'orientation') ? raw.orientation : 0;
  if (!isFiniteNumber(orientation) || items.some(element => !known.has(element.id))) return [];
  const rotate = rotation(orientation);
  const radius = SIDE / Math.sqrt(3);
  return items.map(element => {
    const triangle = known.get(element.id) ?? {x: Number.NaN, y: Number.NaN, o: Number.NaN};
    const corners = [0, 1, 2].map(k => radians(90 + triangle.o + 120 * k));
    return {id: element.id, number: element.number,
      points: corners.map(corner => rotate(triangle.x + radius * Math.cos(corner), triangle.y + radius * Math.sin(corner)))};
  });
}

const CONNECTOR_SHAPES: ReadonlySet<number> = new Set([16, 18, 19, 20]);
const LINE_ZONE = 18;
const bounded = (value: unknown): value is number => isFiniteNumber(value) && Math.abs(value) <= 1_000_000;
const distance = (a: {x: number; y: number}, b: {x: number; y: number}): number => pyHypot(a.x - b.x, a.y - b.y);

/** An allowlisted cache and connector graph, or a ValueError for unsupported geometry. */
export function validatedConnectorGeometry(raw: unknown, groups: unknown): [ConnectorCache, ConnectorGraph] {
  const version = isObject(raw) && Object.hasOwn(raw, 'version') ? raw.version : 1;
  if (!isObject(raw) || !isInt(version) || version !== 1) throw new ValueError('Unsupported connector geometry.');
  const points = raw.positionData;
  const orientation = Object.hasOwn(raw, 'orientation') ? raw.orientation : 0;
  if (!bounded(orientation) || !Array.isArray(points) || points.length < 1 || points.length > 1000) throw new ValueError('Invalid connector positions.');
  const clean: ConnectorPoint[] = [];
  const seen = new Set<number>();
  for (const point of points) {
    if (!isObject(point)) throw new ValueError('Invalid connector position.');
    const {panelId, shapeType, x, y, o} = point;
    if (!isInt(panelId) || panelId < 0 || panelId > 65535 || seen.has(panelId)) throw new ValueError('Invalid or duplicate panel identity.');
    if (!isInt(shapeType) || !CONNECTOR_SHAPES.has(shapeType)) throw new ValueError('Unsupported connector shape.');
    if (!bounded(x) || !bounded(y) || !bounded(o)) throw new ValueError('Invalid connector coordinate.');
    clean.push({panelId, x, y, o, shapeType});
    seen.add(panelId);
  }
  const zones = new Map(clean.filter(point => point.shapeType === LINE_ZONE).map(point => [point.panelId, point]));
  if (!Array.isArray(groups) || groups.length < 1 || groups.length > 300) throw new ValueError('Invalid Line groups.');
  const pairs: [number, number][] = groups.map((pair: unknown) => {
    if (!Array.isArray(pair) || pair.length !== 2 || !isInt(pair[0]) || !isInt(pair[1])) throw new ValueError('Invalid zone mapping.');
    return [pair[0], pair[1]];
  });
  const ids = pairs.flat();
  if (new Set(ids).size !== ids.length || ids.length !== zones.size || ids.some(id => !zones.has(id))) {
    throw new ValueError('Line groups must map every zone exactly once.');
  }
  const nodes: ConnectorNode[] = [];
  for (const point of clean.filter(p => p.shapeType !== LINE_ZONE).sort((a, b) => a.panelId - b.panelId)) {
    const matches = nodes.filter(node => distance(node, point) < 2);
    if (matches.length > 1) throw new ValueError('Ambiguous connector housing.');
    const [match] = matches;
    if (match !== undefined) match.sourceIds.push(point.panelId);
    else nodes.push({id: String(point.panelId), x: point.x, y: point.y, sourceIds: [point.panelId]});
  }
  if (nodes.length === 0) throw new ValueError('No connector positions.');
  const lines: ConnectorLine[] = [];
  const used = new Set<string>();
  const faces = new Map<string, number[]>();
  pairs.forEach((pair, index) => {
    const [a, b] = pair.map(id => zones.get(id) ?? {x: Number.NaN, y: Number.NaN});
    if (a === undefined || b === undefined) throw new ValueError('Invalid zone mapping.');
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = pyHypot(dx, dy);
    if (length < 4) throw new ValueError('Coincident light zones.');
    const [left, right] = [{x: a.x - dx / 2, y: a.y - dy / 2}, {x: b.x + dx / 2, y: b.y + dy / 2}].map(end => {
      const matches = nodes.filter(node => distance(node, end) <= Math.max(2, length * 0.25));
      const [match] = matches;
      if (matches.length !== 1 || match === undefined) throw new ValueError('Missing or ambiguous Line end.');
      return match;
    });
    if (left === undefined || right === undefined) throw new ValueError('Missing or ambiguous Line end.');
    if (left === right) throw new ValueError('Line ends share one connector.');
    const delta = degrees(Math.atan2(right.y - left.y, right.x - left.x) - Math.atan2(dy, dx));
    if (Math.abs(pyMod(delta + 180, 360) - 180) > 1) throw new ValueError('Line zones do not align with connectors.');
    for (const [node, other] of [[left, right], [right, left]] as const) {
      const heading = degrees(Math.atan2(other.y - node.y, other.x - node.x));
      const previous = faces.get(node.id) ?? [];
      faces.set(node.id, previous);
      const [first] = previous;
      if (first !== undefined) {
        const faceOf = (angle: number): number => pyMod(pyRound(pyMod(angle - first, 360) / 60), 6);
        const difference = pyMod(heading - first, 360);
        const face = faceOf(heading);
        if (Math.abs(pyMod(difference - face * 60 + 180, 360) - 180) > 1 || previous.some(old => faceOf(old) === face)) {
          throw new ValueError('Incompatible or duplicate connector face.');
        }
      }
      previous.push(heading);
      used.add(node.id);
    }
    lines.push({id: elementId(pair), number: index + 1, a: left.id, b: right.id, zoneIds: [...pair]});
  });
  const rotate = rotation(orientation);
  const projected = nodes.filter(node => used.has(node.id)).map(node => {
    const [x, y] = rotate(node.x, node.y);
    return {id: node.id, x, y, sourceIds: node.sourceIds};
  });
  return [{version: 1, orientation, positionData: clean}, {version: 1, nodes: projected, lines}];
}

/** The connector graph from validated cached data only, or null; the controller is never contacted here. */
export function connectorLayout(config: GeometryConfig): ConnectorGraph | null {
  for (const raw of [config.connector_geometry, config.zone_geometry]) {
    try {
      return validatedConnectorGeometry(raw, config.line_groups)[1];
    } catch (error) {
      if (error instanceof ValueError || error instanceof TypeError || error instanceof RangeError) continue;
      throw error;
    }
  }
  return null;
}
