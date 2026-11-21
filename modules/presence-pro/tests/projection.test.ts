import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Projection} from '../src/projection.js';
import {SYNTHETIC_SENSOR, reports} from '../src/simulated.js';
import {known} from '../src/contracts.js';
import {channels, configurePresence} from '../src/configuration.js';

const ready = (): Projection => { const projection = new Projection(SYNTHETIC_SENSOR); projection.connected(); for (const report of reports()) projection.report(report, 1000); return projection; };
const point = (projection: Projection) => structuredClone(projection.current).targets[0]?.apartmentMeters;

void test('inactive resets both axes, and a zero-loss pair never projects', () => {
  const projection = new Projection(SYNTHETIC_SENSOR);
  projection.connected();
  for (const report of reports()) projection.report(report, 1000);
  assert.deepEqual(structuredClone(projection.current).targets[0]?.apartmentMeters, {status: 'known', value: {x: 4, z: 2}});
  projection.report({key: 4, value: false}, 1001);
  projection.report({key: 4, value: true}, 1002);
  projection.report({key: 2, value: 1000}, 1003);
  assert.equal(structuredClone(projection.current).targets[0]?.apartmentMeters.status, 'unknown');
  projection.report({key: 3, value: 2000}, 1004);
  assert.equal(structuredClone(projection.current).targets[0]?.apartmentMeters.status, 'known');
  projection.report({key: 2, value: 0}, 1005);
  projection.report({key: 3, value: 0}, 1006);
  assert.equal(structuredClone(projection.current).targets[0]?.apartmentMeters.status, 'unknown');
});

void test('initial axes and Active before settings still yield only a sufficient same-connection approximate point', () => {
  const projection = new Projection(SYNTHETIC_SENSOR); projection.connected();
  const initial = reports();
  for (const report of [...initial.slice(6), ...initial.slice(0, 6)]) projection.report(report, 1000);
  assert.deepEqual(point(projection), known({x: 4, z: 2}));
  projection.disconnected(); projection.connected();
  projection.report({key: 4, value: true}, 2000); projection.report({key: 2, value: 1000}, 2001);
  assert.equal(point(projection)?.status, 'unknown');
});
void test('fresh axes after an inactive reset may arrive before Active=true without borrowing pre-reset values', () => {
  const projection = ready(); projection.report({key: 4, value: false}, 1001);
  projection.report({key: 2, value: 1500}, 1002); assert.equal(point(projection)?.status, 'unknown');
  projection.report({key: 3, value: 2500}, 1003); assert.equal(point(projection)?.status, 'unknown');
  projection.report({key: 4, value: true}, 1004); const projected = point(projection); assert.equal(projected?.status, 'known');
  if (projected?.status === 'known') { assert.ok(Math.abs(projected.value.x - 4.5) < 1e-12); assert.ok(Math.abs(projected.value.z - 1.5) < 1e-12); }
  projection.report({key: 4, value: false}, 1005); projection.report({key: 2, value: 1500}, 1006);
  projection.report({key: 4, value: true}, 1007); assert.equal(point(projection)?.status, 'unknown');
});

void test('invalid, missing, nonfinite and finite out-of-bounds axes reset both channels without changing occupancy', () => {
  for (const report of [{key: 2, value: NaN}, {key: 2, value: Infinity}, {key: 2, value: 1e30}, {key: 2, value: 0, missing: true}, {key: 2, value: '1000'}]) {
    const projection = ready(); projection.report(report, 1001);
    assert.equal(point(projection)?.status, 'unknown'); assert.equal(projection.current.occupancy.value, 'occupied');
    projection.report({key: 3, value: 2000}, 1002); assert.equal(point(projection)?.status, 'unknown');
    projection.report({key: 2, value: 1000}, 1003); assert.equal(point(projection)?.status, 'known');
  }
});

void test('disabled detail and missing configuration inhibit points; restoring detail requires fresh axes', () => {
  const projection = ready(); projection.report({key: 7, value: 'Targets Position'}, 1001);
  assert.equal(point(projection)?.status, 'unknown'); assert.equal(projection.current.targets[0]?.rawMm.x.status, 'unknown');
  projection.report({key: 7, value: 'Above + Targets active'}, 1002);
  assert.equal(point(projection)?.status, 'unknown');
  projection.report({key: 2, value: 1000}, 1003); projection.report({key: 3, value: 2000}, 1004);
  assert.equal(point(projection)?.status, 'known');
  projection.report({key: 9, value: false, missing: true}, 1005); assert.equal(point(projection)?.status, 'unknown');
});

void test('exclusion polygons omit points even with Active=true, and assumed presence stays independently labelled', () => {
  const projection = ready(); projection.report({key: 5, value: true}, 1001);
  assert.deepEqual(projection.current.held.value, known(true)); assert.equal(point(projection)?.status, 'known');
  projection.report({key: 11, value: '500:1500;1500:1500;1500:2500;500:2500'}, 1002);
  projection.report({key: 2, value: 1000}, 1003); projection.report({key: 3, value: 2000}, 1004);
  assert.equal(point(projection)?.status, 'unknown'); assert.equal(projection.current.targets[0]?.rawMm.x.status, 'unknown');
  assert.deepEqual(projection.current.targets[0]?.active.value, known(true));
  projection.report({key: 5, value: false, missing: true}, 1005); assert.equal(projection.current.held.value.status, 'unknown');
});

void test('stock rectangular exclusions require both masks and clear inclusive edges without changing occupancy', () => {
  const first = {xStart: {key: 13}, xEnd: {key: 14}, yStart: {key: 15}, yEnd: {key: 16}};
  const second = {xStart: {key: 17}, xEnd: {key: 18}, yStart: {key: 19}, yEnd: {key: 20}};
  const configure = (exclusions: unknown[]) => configurePresence({sensors: [{
    ...SYNTHETIC_SENSOR, settings: {...SYNTHETIC_SENSOR.settings, exclusions},
  }]});
  assert.ok('error' in configure([first, {key: 21}]), 'mixed mask formats are refused');
  assert.ok('error' in configure([first, {...second, yEnd: undefined}]), 'partial rectangular bindings are refused');
  assert.ok('error' in configure([first, {...second, yEnd: first.xStart}]), 'duplicate keys are refused');
  const configured = configure([first, second]);
  assert.ok('config' in configured, 'accepts stock rectangular bindings');
  const sensor = configured.config.sensors[0]; assert.ok(sensor);
  assert.deepEqual(channels(sensor).filter(({binding}) => binding.key >= 13).map(({type}) => type), Array(8).fill('Number'));
  const projection = new Projection(sensor); projection.connected();
  const axes = (x: number, y: number): void => {
    projection.report({key: 2, value: x}, 1000);
    projection.report({key: 3, value: y}, 1000);
  };
  for (const report of reports().filter(({key}) => key !== 11 && key !== 12)) projection.report(report, 1000);
  for (const [index, value] of [-6000, -6000, -1560, -1560, 3500, 1500, 2500].entries()) projection.report({key: index + 13, value}, 1000);
  assert.equal(point(projection)?.status, 'unknown', 'one unread corner prevents projection');
  projection.report({key: 20, value: 1500}, 1000);
  assert.deepEqual(point(projection), known({x: 4, z: 2}));
  axes(1500, 2000);
  assert.equal(point(projection)?.status, 'unknown', 'edge of reversed rectangle is excluded');
  assert.equal(projection.current.occupancy.value, 'occupied');
  axes(1000, 2000);
  projection.report({key: 15, value: 0, missing: true}, 1001);
  assert.equal(point(projection)?.status, 'unknown');
  assert.equal(projection.current.targets[0]?.rawMm.x.status, 'unknown');
  projection.report({key: 15, value: -1560}, 1002);
  assert.equal(point(projection)?.status, 'unknown', 'recovery needs fresh axes');
  axes(1000, 2000);
  assert.deepEqual(point(projection), known({x: 4, z: 2}));
  axes(-6000, -1560);
  assert.equal(point(projection)?.status, 'unknown', 'a collapsed mask excludes its exact point');
  axes(1000, 2000);
  projection.report({key: 13, value: -6001}, 1003);
  axes(1000, 2000);
  assert.equal(projection.current.targets[0]?.rawMm.x.status, 'unknown', 'invalid bounds suppress otherwise valid axes');
});

void test('missing calibration keeps only raw reports; changed placement recalculates with a new revision', () => {
  const {calibration: _calibration, ...withoutCalibration} = SYNTHETIC_SENSOR;
  const projection = new Projection(withoutCalibration); projection.connected(); for (const report of reports()) projection.report(report, 1000);
  assert.equal(point(projection)?.status, 'unknown'); assert.deepEqual(projection.current.targets[0]?.rawMm.x, known(1000));
  const moved = new Projection({...SYNTHETIC_SENSOR, calibration: {...SYNTHETIC_SENSOR.calibration as NonNullable<typeof SYNTHETIC_SENSOR.calibration>, revision: 2, tx: 5, tz: 8, yaw: 0}});
  assert.equal(point(moved)?.status, 'unknown'); moved.connected(); for (const report of reports()) moved.report(report, 1000);
  assert.deepEqual(point(moved), known({x: 6, z: 10})); assert.deepEqual(moved.current.targets[0]?.calibrationRevision, known(2));
  moved.report({key: 8, value: 5}, 1001); moved.report({key: 2, value: 1000}, 1002); moved.report({key: 3, value: 2000}, 1003);
  assert.equal(point(moved)?.status, 'unknown');
});
