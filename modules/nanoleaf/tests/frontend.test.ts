import assert from 'node:assert/strict';
import {editorGeometry, legacyWall, wallAction, type ConnectorGraph, type WallRecord} from '../src/frontend/model.js';
import {test} from './support.js';

test('wall actions preserve the selected device, existing command family and explicit edit', () => {
  assert.deepEqual(wallAction('/api/assign', {lines: {'1:2': {project: null, signature: 1}}}, 'wall', 'edit-1'), {
    family: 'nanoleaf-wall-edit', target: 'wall', requestId: 'edit-1', data: {edit: {kind: 'assign', elements: [{id: '1:2', project: null, signature: 1}]}},
  });
  assert.deepEqual(wallAction('/api/settings', {flip_x: 1, palette: 'default'}, 'panels', 'edit-2'), {
    family: 'nanoleaf-wall-edit', target: 'panels', requestId: 'edit-2', data: {edit: {kind: 'settings', settings: {flipX: 1, palette: 'default'}}},
  });
  assert.deepEqual(wallAction('/api/mode', {mode: 'quiet'}, 'panels', 'edit-3'), {
    family: 'device-mode-set', target: 'panels', requestId: 'edit-3', data: {mode: 'quiet'},
  });
  assert.equal(typeof wallAction('/api/unsupported', {}, 'wall', 'edit-4'), 'string');
  assert.equal(typeof wallAction('/api/assign', {lines: {}}, 'wall', 'edit-5'), 'string');
});

const graph: ConnectorGraph = {version: 1, nodes: [
  {id: 'a', x: 0, y: 0, sourceIds: [1]}, {id: 'b', x: 300, y: 0, sourceIds: [2]},
], lines: [{id: '1:2', number: 1, a: 'a', b: 'b', zoneIds: [1, 2]}]};
const record: WallRecord = {
  id: 'wall', revision: 1, configurationRevision: 1, kind: 'lines', mode: 'work', modePending: false,
  failing: false, held: false, source: 'shared', layout: 'saved', pendingEdit: false,
  settings: {style: 'project', coverage: 'whole', rotation: 0, flipX: 0, flipY: 0},
  palette: {base: '#000000', working: '#00ff00', question: '#ffff00', blocked: '#ff0000', unread: '#ff00ff'},
  projects: [{id: 'project', name: null, color: '#123456', assigned: 1, active: 1, waiting: 0}],
  elements: [{id: '1:2', number: 1, project: 'project', signature: 0, task: 'task', points: [[0, 0], [150, 0], [300, 0]]}],
  tasks: [{id: 'task', title: '<img src=x onerror=alert(1)>', project: 'project', status: 'working', startedAtMs: 1000,
    element: '1:2', manualProject: null, evictionToken: 'synthetic', statusEvidence: 'current', codexUrl: 'javascript:alert(1)'}],
};

test('wall projection retains uncertain evidence and missing geometry without inventing content or links', () => {
  const stale = legacyWall(record, [{id: 'wall', name: 'Synthetic wall', default: true}], false, graph);
  assert.equal(stale.current, false);
  assert.equal(stale.tasks[0]?.statusEvidence, 'uncertain');
  assert.equal(stale.tasks[0]?.title, record.tasks[0]?.title);
  assert.equal(stale.tasks[0]?.started, 1);
  assert.equal(stale.tasks[0]?.codexUrl, undefined);
  assert.equal(stale.projects[0]?.name, 'project');
  assert.equal(stale.connector_layout, graph);
  const valid = structuredClone(record);
  const task = valid.tasks[0]; assert.ok(task !== undefined);
  task.codexUrl = 'codex://threads/12345678-abcd-abcd-abcd-1234567890ab';
  assert.equal(legacyWall(valid, [], true).tasks[0]?.codexUrl, task.codexUrl);
  const element = valid.elements[0]; assert.ok(element !== undefined);
  element.points = null;
  assert.equal(legacyWall(valid, [], true).lines.length, 0);
  assert.match(legacyWall(valid, [], true).geometry_error, /Saved geometry is unavailable/);
  assert.equal(record.tasks[0]?.statusEvidence, 'current');
});

test('saved geometry must match the requested device and remain finite and bounded', () => {
  const document = {schema: 'nanoleaf-editor-layout/2.0', device: 'wall', geometry: graph};
  assert.equal(editorGeometry(document, 'wall'), graph);
  assert.throws(() => editorGeometry(document, 'panels'), /Invalid saved editor geometry/);
  assert.throws(() => editorGeometry({...document, geometry: {...graph, nodes: [{id: 'a', x: NaN, y: 0, sourceIds: []}]}}, 'wall'));
  assert.throws(() => editorGeometry({...document, geometry: {...graph, lines: []}}, 'wall'));
});
