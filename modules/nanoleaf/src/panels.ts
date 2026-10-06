// NL22 Light Panels geometry: reported triangles become stable one-zone elements (panels.py).
import {isObject, pyRound, radians, type Json} from './compat.js';
import {validateElements, type LayoutEntry} from './devices.js';
import {ValueError} from './errors.js';

export const TRIANGLE = 0;
// The Rhythm module and the Shapes controller report positions but emit no light.
export const NON_LIGHT = new Set([1, 12]);
export const SIDE = 150;
// Edge-adjacent triangle centroids are two inradii apart.
export const NEIGHBOR = SIDE / Math.sqrt(3);
export const TOLERANCE = 0.1;

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000;

interface Triangle {
  x: number;
  y: number;
  o: number;
  panelId: number;
}

/** Validate a reported Light Panels layout and return its per-device layout entry. */
export function readLayout(panelLayout: unknown): LayoutEntry {
  if (!isObject(panelLayout) || !isObject(panelLayout.layout)) throw new ValueError('Invalid Light Panels layout.');
  const points = panelLayout.layout.positionData;
  if (!Array.isArray(points) || points.length < 1 || points.length > 300) throw new ValueError('Invalid Light Panels positions.');
  const reported = panelLayout.globalOrientation === undefined ? {value: 0} : panelLayout.globalOrientation;
  const orientation = isObject(reported) ? reported.value : null;
  if (!isNumber(orientation)) throw new ValueError('Invalid Light Panels orientation.');
  const seen = new Set<number>();
  const triangles: Triangle[] = [];
  for (const point of points) {
    if (!isObject(point)) throw new ValueError('Invalid Light Panels position.');
    const panel = point.panelId;
    const shape = point.shapeType;
    if (typeof panel !== 'number' || !Number.isInteger(panel) || panel < 0 || panel > 65535 || seen.has(panel)) {
      throw new ValueError('Invalid or duplicate panel identity.');
    }
    if (typeof shape !== 'number' || !Number.isInteger(shape) || (shape !== TRIANGLE && !NON_LIGHT.has(shape))) {
      throw new ValueError('Unsupported Light Panels shape.');
    }
    const {x, y, o} = point;
    if (!isNumber(x) || !isNumber(y) || !isNumber(o)) throw new ValueError('Invalid Light Panels coordinate.');
    seen.add(panel);
    if (shape === TRIANGLE) triangles.push({x, y, o, panelId: panel});
  }
  if (triangles.length === 0) throw new ValueError('No Light Panels triangles.');
  const angle = radians(orientation);
  const location = (t: Triangle): [number, number, number] =>
    [pyRound(t.x * Math.cos(angle) - t.y * Math.sin(angle)), pyRound(t.x * Math.sin(angle) + t.y * Math.cos(angle)), t.panelId];
  triangles.sort((a, b) => {
    const [ax, ay, ap] = location(a);
    const [bx, by, bp] = location(b);
    if (ax !== bx) return ax - bx;
    return ay !== by ? ay - by : ap - bp;
  });
  const ids = triangles.map(t => String(t.panelId));
  const neighbors: [string, string][] = [];
  const degree = triangles.map(() => 0);
  triangles.forEach((first, i) => {
    for (let j = i + 1; j < triangles.length; j += 1) {
      const other = triangles[j];
      if (other === undefined) continue;
      const gap = Math.hypot(first.x - other.x, first.y - other.y);
      if (gap < NEIGHBOR * (1 - TOLERANCE)) throw new ValueError('Overlapping Light Panels triangles.');
      if (gap <= NEIGHBOR * (1 + TOLERANCE)) {
        neighbors.push([ids[i] ?? '', ids[j] ?? '']);
        degree[i] = (degree[i] ?? 0) + 1;
        degree[j] = (degree[j] ?? 0) + 1;
      }
    }
  });
  if (Math.max(...degree) > 3) throw new ValueError('A triangle has more than three edges.');
  const start = ids[0] ?? '';
  const reached = new Set([start]);
  const frontier = [start];
  for (let current = frontier.pop(); current !== undefined; current = frontier.pop()) {
    for (const [a, b] of neighbors) {
      if (a !== current && b !== current) continue;
      const other = a === current ? b : a;
      if (!reached.has(other)) {
        reached.add(other);
        frontier.push(other);
      }
    }
  }
  if (reached.size !== triangles.length) throw new ValueError('Light Panels triangles are not connected.');
  const elements = validateElements('panels', triangles.map((t, index) =>
    ({id: ids[index] ?? '', number: index + 1, zones: [t.panelId], position: [t.x, t.y]})));
  const geometry: Json = {version: 1, orientation, neighbors,
    triangles: triangles.map((t, index) => ({id: ids[index] ?? '', panelId: t.panelId, x: t.x, y: t.y, o: t.o}))};
  return {kind: 'panels', elements, panel_geometry: geometry};
}
