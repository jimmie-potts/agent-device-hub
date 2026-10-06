// Translated configuration loading cases: Line pairing from tests/test_bridge.py, DiscoveryTest from tests/test_panels.py,
// and following a registry change, the untargeted device and the per-device layout save from tests/test_device_worker.py.
// The DeviceTest loading cases are in devices.test.ts. Replies and discovery recorded from Python follow.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import {followRegistry, loadConfig, pairLines} from '../src/configuration.js';
import {layoutDevices, linesEntry, saveDeviceLayout, saveLayout} from '../src/devices.js';
import {readJson, writeJson} from '../src/jsonfile.js';
import {readLayout} from '../src/panels.js';
import type {LightAddress, LightRequest} from '../src/transport.js';
import {fixtureJson, refuse, suite, temporary, test} from './support.js';

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

const [LINES_IP, PANELS_IP] = ['192.0.2.1', '192.0.2.2'];
type Points = {x: number; y: number}[];

/** test_device_worker.triangles: the first `count` reported triangles by position, read as a Panels layout entry. */
function triangles(count: number): ReturnType<typeof readLayout> {
  const reported = structuredClone(NL22) as unknown as {layout: {positionData: Points}};
  reported.layout.positionData = [...reported.layout.positionData].sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y)).slice(0, count);
  return readLayout(reported);
}

/** DeviceWorkerTest.setUp: registered Lines and Panels, in `order`, with both saved layouts. */
function deviceWorker(context: TestContext, order: readonly ('wall' | 'panels')[] = ['wall', 'panels']): string {
  const directory = temporary(context);
  const entries = {wall: {kind: 'lines', ip: LINES_IP, token_ref: 'token'}, panels: {kind: 'panels', ip: PANELS_IP, token_ref: 'panelsToken'}};
  writeJson(join(directory, 'config.json'), {ip: LINES_IP, token: 'fakeLines', panelsToken: 'fakePanels',
    devices: Object.fromEntries(order.map(name => [name, entries[name]]))});
  const lines = linesEntry(LINE_GROUPS, Array.from({length: 15}, (_, i) => [i * 10, 0]));
  saveLayout(join(directory, 'layout.json'), new Map([['wall', lines], ['panels', triangles(18)]]));
  return directory;
}

suite('UntargetedOrderTest', () => {
  test('test_untargeted_calls_address_lines_whatever_the_registry_order', async context => {
    // Partly: the untargeted mode command through the command line moves with the worker slice.
    const directory = deviceWorker(context, ['panels', 'wall']);
    assert.equal((await loadConfig(directory, undefined, refuse)).device, 'wall');
  });
});

suite('MirroredTest', () => {
  test('test_layout_save_keeps_the_other_devices_entry', context => {
    const path = join(deviceWorker(context), 'layout.json');
    const stale = layoutDevices(readJson(path));
    stale.delete('panels');
    const lines = stale.get('wall');
    assert.ok(lines !== undefined);
    saveDeviceLayout(path, 'wall', lines);
    const saved = layoutDevices(readJson(path));
    assert.deepEqual([...saved.keys()].sort(), ['panels', 'wall']);
    assert.equal(saved.get('panels')?.elements.length, 18);
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

/** A recorded Python call: its result, or the exception class and message it raised. */
interface Outcome {
  result?: unknown;
  error?: string;
  message?: string;
}
interface Parsing {
  pairLines: {name: string; layout: unknown; outcome: Outcome}[];
  loadConfig: {name: string; savedGroups: number[][] | null; layout: unknown; outcome: Outcome}[];
}
const PARSING = (fixtureJson('recorded/rendering.json') as {parsing: Parsing}).parsing;

/** Python's ValueError keeps its message; its KeyError and TypeError are ValueErrors here (PORTING.md, Known differences). */
const refusal = (outcome: Outcome): {name: string; message?: string} =>
  (outcome.error === 'ValueError' && outcome.message !== undefined ? {name: 'ValueError', message: outcome.message} : {name: 'ValueError'});

/**
 * Recorded cases where the port differs from Python on purpose (PORTING.md, Known differences): pairing refuses a panel ID
 * that is not a number, which Python paired and load_config then refused with another message.
 */
const DIFFERENT: Readonly<Record<string, Outcome>> = {
  'string panel IDs': {error: 'ValueError', message: 'A reported Lines position has a non-numeric panelId.'},
  'discovered Lines, string panel IDs': {error: 'ValueError', message: 'A reported Lines position has a non-numeric panelId.'},
};

suite('Lines replies parsed as Python parsed them', () => {
  test('pairing reads every reported entry in order, duplicates and connectors included', () => {
    for (const {name, layout, outcome} of PARSING.pairLines) {
      const expected = DIFFERENT[name] ?? outcome;
      if (expected.error === undefined) assert.deepEqual(pairLines(structuredClone(layout)), expected.result, name);
      else assert.throws(() => pairLines(structuredClone(layout)), refusal(expected), name);
    }
    assert.deepEqual(PARSING.pairLines.map(entry => entry.outcome.error ?? 'paired'),
      ['ValueError', 'paired', 'paired', 'KeyError', 'TypeError', 'KeyError', 'ValueError', 'paired']);
    // Python counted the zones before reading any of their fields.
    assert.deepEqual(PARSING.pairLines.find(entry => entry.name === 'odd count, one zone without o')?.outcome,
      {error: 'ValueError', message: 'Expected two light zones per Line.'});
    // Python paired string IDs; load_config then refused them as an invalid Line mapping.
    assert.deepEqual(PARSING.pairLines.find(entry => entry.name === 'string panel IDs')?.outcome, {result: [['a', 'b']]});
    assert.deepEqual(PARSING.loadConfig.find(entry => entry.name === 'discovered Lines, string panel IDs')?.outcome,
      {error: 'ValueError', message: 'Invalid physical Line mapping.'});
  });

  test('Line positions read only x and y, from the last entry with each panel ID', async context => {
    for (const {name, savedGroups, layout, outcome} of PARSING.loadConfig) {
      const directory = temporary(context);
      writeJson(join(directory, 'config.json'), {ip: '192.0.2.1', token: 'fake'});
      if (savedGroups !== null) writeJson(join(directory, 'layout.json'), {line_groups: savedGroups});
      const load = async (): Promise<unknown> => {
        const config = await loadConfig(directory, 'wall', () => Promise.resolve({panelLayout: structuredClone(layout)}));
        return {line_groups: config.line_groups, line_positions: config.line_positions,
          layout: JSON.parse(readFileSync(join(directory, 'layout.json'), 'utf8')) as unknown};
      };
      const expected = DIFFERENT[name] ?? outcome;
      if (expected.error === undefined) assert.deepEqual(await load(), expected.result, name);
      else await assert.rejects(load(), refusal(expected), name);
    }
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
