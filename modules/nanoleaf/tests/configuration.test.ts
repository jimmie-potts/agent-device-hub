// Translated configuration loading cases: Line pairing from tests/test_bridge.py, DiscoveryTest from tests/test_panels.py
// and following a registry change from tests/test_device_worker.py. The DeviceTest loading cases are in devices.test.ts.
// Discovery recorded from Python follows.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import {followRegistry, loadConfig, pairLines} from '../src/configuration.js';
import {writeJson} from '../src/jsonfile.js';
import type {LightAddress, LightRequest} from '../src/transport.js';
import {fixtureJson, suite, temporary, test} from './support.js';

interface Reported {
  layout: {positionData: {panelId: number; shapeType: number}[]};
}

const NL22 = (fixtureJson('nl22-panels-fixture.json') as {panelLayout: Reported}).panelLayout;
const panelLayout = (mutate?: (points: Reported['layout']['positionData']) => void): Reported => {
  const value = structuredClone(NL22);
  mutate?.(value.layout.positionData);
  return value;
};
const LINE_GROUPS = Array.from({length: 15}, (_, i) => [100 + i * 2, 101 + i * 2]);

suite('BridgeTest', () => {
  test('test_fifteen_physical_lines_are_paired_from_real_layout', () => {
    const layout = fixtureJson('lines-layout.json') as Reported;
    const groups = pairLines(layout);
    assert.equal(groups.length, 15);
    const expected = new Set(layout.layout.positionData.filter(point => point.shapeType === 18).map(point => point.panelId));
    assert.deepEqual(new Set(groups.flat()), expected);
  });
});

/** DiscoveryTest.setUp: registered Lines with a saved legacy layout, and registered Panels without one. */
function discovery(context: TestContext): {directory: string; requests: [string, string, string, string][]; request: LightRequest} {
  const directory = temporary(context);
  writeJson(join(directory, 'config.json'), {ip: '192.0.2.1', token: 'fakeLines', panelsToken: 'fakePanels',
    devices: {panels: {kind: 'panels', ip: '192.0.2.2', token_ref: 'panelsToken'}}});
  writeJson(join(directory, 'layout.json'), {line_groups: LINE_GROUPS, line_positions: Array.from({length: 15}, (_, i) => [i * 10, 0])});
  const requests: [string, string, string, string][] = [];
  const request = (address: LightAddress, method: string, endpoint = ''): Promise<unknown> => {
    requests.push([address.ip, address.token, method, endpoint]);
    return Promise.resolve({name: 'Synthetic panels', panelLayout: panelLayout()});
  };
  return {directory, requests, request};
}

suite('DiscoveryTest', () => {
  test('test_panels_layout_is_discovered_once_and_saved_beside_lines', async context => {
    const {directory, requests, request} = discovery(context);
    const config = await loadConfig(directory, 'panels', request);
    const again = await loadConfig(directory, 'panels', request);
    const lines = await loadConfig(directory, undefined, request);
    assert.deepEqual(requests, [['192.0.2.2', 'fakePanels', 'GET', '']]);
    assert.deepEqual([config.kind, config.line_groups.length], ['panels', 18]);
    assert.deepEqual(again.elements, config.elements);
    assert.ok(config.line_groups.every(zones => zones.length === 1));
    const saved = JSON.parse(readFileSync(join(directory, 'layout.json'), 'utf8')) as {devices: Record<string, object>};
    assert.deepEqual(Object.keys(saved.devices).sort(), ['panels', 'wall']);
    assert.ok('panel_geometry' in (saved.devices.panels ?? {}));
    assert.deepEqual(lines.line_groups, LINE_GROUPS);
  });

  test('test_rejected_geometry_saves_nothing', async context => {
    const {directory} = discovery(context);
    const disk = readFileSync(join(directory, 'layout.json'));
    const broken = (): Promise<unknown> => Promise.resolve({panelLayout: panelLayout(points => Object.assign(points[0] ?? {}, {shapeType: 17}))});
    await assert.rejects(loadConfig(directory, 'panels', broken), {name: 'ValueError'});
    assert.deepEqual(readFileSync(join(directory, 'layout.json')), disk);
  });
});

suite('AddressChangeTest', () => {
  // From tests/test_device_worker.py; the running worker's case moves with the worker slice.
  test('test_unreadable_configuration_keeps_the_current_transport', context => {
    const directory = temporary(context);
    const config = {ip: '192.0.2.2', token: 'fakePanels'};
    writeFileSync(join(directory, 'config.json'), '{');
    followRegistry(directory, config, 'panels');
    assert.deepEqual(config, {ip: '192.0.2.2', token: 'fakePanels'});
    writeJson(join(directory, 'config.json'), {devices: {panels: {kind: 'panels', ip: '192.0.2.4', token_ref: 'panelsToken'}}, panelsToken: 'rotatedPanels'});
    followRegistry(directory, config, 'panels');
    assert.deepEqual(config, {ip: '192.0.2.4', token: 'rotatedPanels'});
  });
});

suite('discovery recorded from Python', () => {
  test('an unsaved Lines layout is paired, positioned and saved as Python saved it', async context => {
    const directory = temporary(context);
    writeJson(join(directory, 'config.json'), {ip: '192.0.2.1', token: 'fake'});
    const reported = fixtureJson('lines-layout.json');
    const config = await loadConfig(directory, 'wall', () => Promise.resolve({panelLayout: structuredClone(reported)}));
    const recorded = (fixtureJson('recorded/rendering.json') as {discovery: {config: Record<string, unknown>; layout: unknown}}).discovery;
    assert.deepEqual(Object.fromEntries(Object.keys(recorded.config).map(key => [key, config[key]])), recorded.config);
    assert.deepEqual(JSON.parse(readFileSync(join(directory, 'layout.json'), 'utf8')), recorded.layout);
  });
});
