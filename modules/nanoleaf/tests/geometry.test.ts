// Translated from codex-nanoleaf tests/test_connector_geometry.py: the connector graph from cached geometry. The wall
// server's enrichment and its state are not ported (#844). Line pairing and map geometry recorded from Python follow.
import assert from 'node:assert/strict';
import {join} from 'node:path';
import type {Json} from '../src/compat.js';
import {loadConfig, pairLines} from '../src/configuration.js';
import {projection} from '../src/devices.js';
import {ValueError} from '../src/errors.js';
import {connectorLayout, geometry, triangleGeometry, validatedConnectorGeometry, type GeometryConfig} from '../src/geometry.js';
import {writeJson} from '../src/jsonfile.js';
import {readLayout} from '../src/panels.js';
import {lineId} from '../src/project-map.js';
import {fixtureJson, suite, temporary, test} from './support.js';

interface Point {
  panelId: number;
  x: number;
  y: number;
  o: number;
  shapeType: number;
  [key: string]: unknown;
}
interface Reported {
  globalOrientation: {value: number};
  layout: {positionData: Point[]};
}

const lines = (): Reported => fixtureJson('lines-layout.json') as Reported;
const withOrientation = (layout: Reported, orientation: number): Reported => ({...layout, globalOrientation: {...layout.globalOrientation, value: orientation}});
const close = (actual: number, expected: number): boolean => Math.abs(actual - expected) < 5e-8;

/** ConnectorGeometryTest.setUp: the real Lines layout with its reported zones as the zone geometry cache. */
function setUp(): {raw: Reported; groups: number[][]; config: GeometryConfig & {zone_geometry: {positionData: Point[]; orientation: number}}} {
  const raw = lines();
  const groups = pairLines(raw);
  const config = {line_groups: groups, zone_geometry: {positionData: raw.layout.positionData, orientation: raw.globalOrientation.value},
    ip: '192.0.2.1', token: 'SECRET_CANARY', line_positions: Array.from({length: 15}, (_, i) => [i, 0])};
  return {raw, groups, config};
}

suite('ConnectorGeometryTest', () => {
  test('test_actual_layout_preserves_identity_and_reported_housings', () => {
    const {groups, config} = setUp();
    const graph = connectorLayout(config);
    assert.ok(graph !== null);
    assert.equal(graph.version, 1);
    assert.equal(graph.lines.length, 15);
    assert.deepEqual(graph.lines.map(line => line.id), groups.map(lineId));
    assert.deepEqual(graph.lines.map(line => line.number), Array.from({length: 15}, (_, i) => i + 1));
    assert.deepEqual(graph.lines.map(line => line.zoneIds), groups);
    const shared = graph.nodes.find(node => node.sourceIds.includes(1036));
    assert.ok(shared !== undefined);
    assert.deepEqual(shared.sourceIds, [1028, 1036]);
    assert.ok(close(shared.x, 423));
    assert.ok(close(shared.y, 402));
    assert.equal(new Set(graph.nodes.map(node => node.id)).size, 12);
    assert.ok(graph.lines.every(line => line.a !== line.b));
    const expectedEnds: Record<string, [number, number]> = {
      '1001,1002': [1003, 1000], '1004,1005': [1006, 1003], '1007,1008': [1009, 1006], '1010,1011': [1009, 1012], '1013,1014': [1022, 1009],
      '1015,1016': [1017, 1003], '1018,1019': [1017, 1009], '1020,1021': [1022, 1017], '1023,1024': [1025, 1022], '1026,1027': [1028, 1003],
      '1029,1030': [1017, 1028], '1031,1032': [1033, 1028], '1034,1035': [1033, 1022], '1037,1038': [1039, 1028], '1040,1041': [1042, 1039],
    };
    for (const line of graph.lines) assert.deepEqual([line.a, line.b], expectedEnds[line.zoneIds.join(',')]?.map(String));
  });

  test('test_graph_is_allowlisted_and_rejects_invalid_geometry', () => {
    const {groups, config} = setUp();
    const zoneGeometry = config.zone_geometry as unknown as {private?: string; positionData: Point[]};
    zoneGeometry.private = 'SOURCE_SECRET';
    const firstPoint = zoneGeometry.positionData[0];
    assert.ok(firstPoint !== undefined);
    firstPoint.token = 'SOURCE_SECRET';
    assert.ok(!JSON.stringify(connectorLayout(config)).includes('SECRET'));
    const mutations: ((cache: {positionData: Point[]}) => void)[] = [
      cache => Object.assign(cache.positionData[1] ?? {}, {x: NaN}),
      cache => Object.assign(cache.positionData[0] ?? {}, {shapeType: 17}),
      cache => cache.positionData.push(structuredClone(cache.positionData[1]) as Point),
      cache => cache.positionData.splice(0, 1),
      cache => Object.assign(cache.positionData[0] ?? {}, {x: 900000}),
    ];
    for (const [index, mutate] of mutations.entries()) {
      const broken = {...config, zone_geometry: {...config.zone_geometry, positionData: config.zone_geometry.positionData.map(point => ({...point}))}};
      mutate(broken.zone_geometry);
      assert.equal(connectorLayout(broken as unknown as GeometryConfig), null, `mutation ${index}`);
    }
    for (const lineGroups of [[[true, 1001]], [groups[0], groups[0]], [], null]) {
      assert.equal(connectorLayout({...config, line_groups: lineGroups} as unknown as GeometryConfig), null, JSON.stringify(lineGroups));
    }
  });

  test('test_synthetic_topologies_and_orientation_preserve_zone_ownership', () => {
    const shapes: Record<string, [[number, number][], [number, number][]]> = {
      chain: [[[0, 0], [180, 0], [360, 0]], [[0, 1], [1, 2]]],
      branch: [[[0, 0], [180, 0], [-90, 90 * Math.sqrt(3)], [-90, -90 * Math.sqrt(3)]], [[0, 1], [0, 2], [0, 3]]],
      cycle: [[[0, 0], [180, 0], [90, 90 * Math.sqrt(3)]], [[0, 1], [1, 2], [2, 0]]],
      disconnected: [[[0, 0], [180, 0], [0, 400], [180, 400]], [[0, 1], [2, 3]]],
    };
    for (const [name, [nodes, edges]] of Object.entries(shapes)) {
      const points: Json[] = nodes.map(([x, y], i) => ({panelId: i + 1, shapeType: 16, x, y, o: 0}));
      const groups: number[][] = [];
      edges.forEach(([a, z], i) => {
        const pair = [100 + i * 2, 101 + i * 2];
        groups.push(pair);
        const [ax = 0, ay = 0] = nodes[a] ?? [];
        const [zx = 0, zy = 0] = nodes[z] ?? [];
        pair.forEach((panelId, k) => {
          const t = k === 0 ? 0.25 : 0.75;
          points.push({panelId, shapeType: 18, x: ax * (1 - t) + zx * t, y: ay * (1 - t) + zy * t, o: 0});
        });
      });
      for (const orientation of [0, 90, 180, 270]) {
        const label = `${name} ${orientation}`;
        const graph = connectorLayout({line_groups: groups, zone_geometry: {positionData: points, orientation}});
        assert.ok(graph !== null, label);
        assert.deepEqual(graph.lines.map(line => [line.a, line.b]), edges.map(([a, z]) => [String(a + 1), String(z + 1)]), label);
        assert.deepEqual(graph.lines.map(line => line.zoneIds), groups, label);
        graph.nodes.forEach((node, i) => {
          const [x = 0, y = 0] = nodes[i] ?? [];
          const angle = orientation * Math.PI / 180;
          assert.ok(close(node.x, x * Math.cos(angle) - y * Math.sin(angle)), label);
          assert.ok(close(node.y, -(x * Math.sin(angle) + y * Math.cos(angle))), label);
        });
      }
    }
  });
});

interface RecordedGeometry {
  pairLines: {orientation: number; groups: number[][]; positions: number[][]}[];
  nearMiss: {orientation: number; offset: number; layout: unknown; outcome: number[][] | string}[];
  lines: {orientation: number; segments: unknown}[];
  triangles: {orientation: number; polygons: unknown}[];
  connectors: {orientation: number; cache: unknown; graph: unknown; layout: unknown}[];
}

const RECORDED = (fixtureJson('recorded/rendering.json') as {geometry: RecordedGeometry}).geometry;

/**
 * Deep equality where numbers may differ in the last bits: Math.sin, Math.cos and Math.atan2 are not the C library's
 * functions Python calls, so rotated coordinates can differ by an ulp (PORTING.md, Known differences). A number may
 * differ by 1e-12 times its magnitude, or by 1e-12 below magnitude 1; the largest difference recorded is 1.4e-14.
 */
function assertClose(actual: unknown, expected: unknown, label: string): void {
  if (typeof expected === 'number' && typeof actual === 'number') {
    assert.ok(Math.abs(actual - expected) <= 1e-12 * Math.max(1, Math.abs(expected)), `${label}: ${actual} is not ${expected}`);
  } else if (Array.isArray(expected) && Array.isArray(actual)) {
    assert.equal(actual.length, expected.length, label);
    expected.forEach((item: unknown, index) => assertClose(actual[index], item, `${label}[${index}]`));
  } else if (typeof expected === 'object' && expected !== null && typeof actual === 'object' && actual !== null) {
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), label);
    for (const [key, value] of Object.entries(expected)) assertClose((actual as Record<string, unknown>)[key], value, `${label}.${key}`);
  } else {
    assert.deepEqual(actual, expected, label);
  }
}

suite('geometry recorded from Python', () => {
  test('Lines pair, order and take their positions the same way in every orientation', async context => {
    const raw = lines();
    for (const {orientation, groups: expected, positions} of RECORDED.pairLines) {
      const reported = withOrientation(raw, orientation);
      assert.deepEqual(pairLines(reported), expected, String(orientation));
      // The port's own discovery, with no saved layout, pairs the Lines and places each at its zones' midpoint.
      const directory = temporary(context);
      writeJson(join(directory, 'config.json'), {ip: '192.0.2.1', token: 'fake'});
      const config = await loadConfig(directory, 'wall', () => Promise.resolve({panelLayout: structuredClone(reported)}));
      assert.deepEqual([config.line_groups, config.line_positions], [expected, positions], String(orientation));
    }
    assert.equal(RECORDED.pairLines.length, 6);
  });

  test('a zone just inside the pairing threshold pairs and one at or beyond it does not', () => {
    // Two zones of one orientation, 60 apart along the Line and moved across it by `offset`; pair_lines
    // pairs zones less than 3 units across.
    for (const {orientation, offset, layout, outcome} of RECORDED.nearMiss) {
      const label = `offset ${offset} at ${orientation} degrees`;
      let actual: number[][] | string;
      try {
        actual = pairLines(layout);
      } catch (error) {
        if (!(error instanceof ValueError)) throw error;
        actual = 'error: ' + error.message;
      }
      assert.deepEqual(actual, outcome, label);
      assert.deepEqual(actual, Math.abs(offset) < 3 ? [[1, 2]] : 'error: Could not pair a Line zone.', label);
    }
    assert.ok(RECORDED.nearMiss.some(entry => entry.offset === 2.999) && RECORDED.nearMiss.some(entry => entry.offset === 3.001));
  });

  test('Line segments, triangles and connector graphs match', () => {
    const raw = lines();
    const groups = pairLines(raw);
    for (const {orientation, segments} of RECORDED.lines) {
      const config = {line_groups: groups, zone_geometry: {positionData: raw.layout.positionData, orientation} as unknown as Json};
      assertClose(geometry(config), segments, `Lines at ${orientation}`);
    }
    for (const {orientation, cache, graph, layout} of RECORDED.connectors) {
      const zoneGeometry = {positionData: raw.layout.positionData, orientation} as unknown as Json;
      assertClose(validatedConnectorGeometry(zoneGeometry, groups), [cache, graph], `connectors at ${orientation}`);
      assertClose(connectorLayout({line_groups: groups, zone_geometry: zoneGeometry}), layout, `connector layout at ${orientation}`);
    }
    const nl22 = (fixtureJson('nl22-panels-fixture.json') as {panelLayout: Reported}).panelLayout;
    for (const {orientation, polygons} of RECORDED.triangles) {
      assertClose(triangleGeometry(projection(readLayout(withOrientation(nl22, orientation)))), polygons, `triangles at ${orientation}`);
    }
  });
});
