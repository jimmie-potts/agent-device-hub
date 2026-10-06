// Map geometry from cached device layouts: Line segments, NL22 triangles and the Lines connector graph (project_map.py).
// Nothing here contacts a device; the map shows only what the saved layout already holds.
import type {DeviceConfig} from './devices.js';

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

const notPorted = (): never => {
  throw new Error('Not ported yet (Hub #26, slice 2).');
};

/** Map segments for two-zone Lines; a device without that shape has no Line geometry. */
export function geometry(_config: GeometryConfig): Shape[] {
  return notPorted();
}

/**
 * Map polygons for one-zone NL22 triangles from cached geometry; [] when it is unavailable.
 *
 * Each vertex sits one circumradius from the reported centroid at 90° + o + k·120°, so o 0 is an apex-up triangle and o 60
 * an apex-down one, which is the only reading that makes the cached rows edge-adjacent. The global orientation and the
 * display Y inversion match `geometry`.
 */
export function triangleGeometry(_config: GeometryConfig): Shape[] {
  return notPorted();
}

/** An allowlisted cache and connector graph, or a ValueError for unsupported geometry. */
export function validatedConnectorGeometry(_raw: unknown, _groups: unknown): [ConnectorCache, ConnectorGraph] {
  return notPorted();
}

/** The connector graph from validated cached data only, or null; the controller is never contacted here. */
export function connectorLayout(_config: GeometryConfig): ConnectorGraph | null {
  return notPorted();
}
