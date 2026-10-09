import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {InProcessBus, type ModuleContentRequest} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {pairLines} from '../src/configuration.js';
import {createNanoleafModule, SYNTHETIC_TOKEN} from '../src/module/index.js';
import {SECTION, TestClock} from './module-support.js';
import {fixtureJson, test} from './support.js';

const request = (query: Record<string, string>): ModuleContentRequest => ({query, signal: new AbortController().signal});

test('the wall contribution serves cached geometry without touching its scene or controller', async context => {
  const clock = new TestClock();
  const bus = new InProcessBus({now: clock.now, scheduler: clock.scheduler});
  const core = bus.connect('bunny/core');
  await core.serveSync(['session'], () => ({revision: 1, states: []}));
  let calls = 0;
  const module = createNanoleafModule({transport: () => { calls += 1; return Promise.reject(new Error('synthetic offline controller')); }});
  assert.deepEqual(module.manifest.pages, [{id: 'wall', title: 'Wall', presentation: 'react'}]);
  assert.equal(module.manifest.apiVersion, '1.3');
  const content = module.manifest.content;
  assert.ok(content !== undefined);
  assert.equal((await content('editor-layout', request({device: 'wall'})) as {error: {code: string}}).error.code, 'unavailable');
  const directory = mkdtempSync(join(tmpdir(), 'nanoleaf-editor-'));
  let harness: ModuleHarness | undefined;
  context.after(async () => { await harness?.stop(); await core.close(); rmSync(directory, {recursive: true, force: true}); });
  const folder = join(directory, 'nanoleaf');
  mkdirSync(folder);
  const raw = fixtureJson('lines-layout.json') as {globalOrientation: {value: number}; layout: {positionData: unknown[]}};
  const groups = pairLines(raw);
  const layout = JSON.stringify({version: 2, devices: {wall: {kind: 'lines', elements: groups.map((zones, index) => ({
    id: zones.join(':'), number: index + 1, zones, position: null,
  })), zone_geometry: {positionData: raw.layout.positionData, orientation: raw.globalOrientation.value, token: SYNTHETIC_TOKEN}}}});
  writeFileSync(join(folder, 'layout.json'), layout);
  writeFileSync(join(folder, 'scene-state.json'), '{"effect":"SYNTHETIC_SCENE","brightness":31}');
  const scene = readFileSync(join(folder, 'scene-state.json'));
  harness = new ModuleHarness(module, {bus, stateDir: directory, clock: {now: clock.now}, scheduler: clock.scheduler,
    section: SECTION, secrets: {token: SYNTHETIC_TOKEN}});
  await harness.start();
  // Let the module's normal startup observation settle; the editor read must add no controller access.
  for (let turn = 0; turn < 4; turn += 1) await new Promise<void>(resolve => { setImmediate(resolve); });
  const callsBeforeRead = calls;
  const before = harness.moduleDatabase()?.prepare('SELECT total_changes() AS count').get();
  const answer = await content('editor-layout', request({device: 'wall'}));
  assert.ok(answer !== undefined && !('error' in answer));
  assert.equal(answer.type, 'application/json');
  const text = Buffer.from(answer.bytes).toString('utf8');
  const value = JSON.parse(text) as {schema: string; device: string; geometry: {nodes: unknown[]; lines: {id: string}[]}};
  assert.equal(value.schema, 'nanoleaf-editor-layout/2.0');
  assert.equal(value.device, 'wall');
  assert.deepEqual(value.geometry.lines.map(line => line.id), groups.map(zones => zones.join(':')));
  assert.ok(value.geometry.nodes.length > 0);
  assert.ok(!text.includes(SYNTHETIC_TOKEN) && !text.includes(folder) && !text.includes('address'));
  assert.equal(calls, callsBeforeRead);
  assert.deepEqual(harness.moduleDatabase()?.prepare('SELECT total_changes() AS count').get(), before);
  assert.deepEqual(readFileSync(join(folder, 'scene-state.json')), scene);
  assert.equal(readFileSync(join(folder, 'layout.json'), 'utf8'), layout);
  const refusedQueries: [Record<string, string>, string][] = [[{}, 'invalid-request'], [{device: '../wall'}, 'invalid-request'], [{device: 'wall', path: folder}, 'invalid-request'],
    [{device: 'other'}, 'not-found']];
  for (const [query, code] of refusedQueries) {
    const error = await content('editor-layout', request(query));
    assert.ok(error !== undefined && 'error' in error);
    assert.equal(error.error.code, code);
    assert.ok(!JSON.stringify(error).includes(folder));
  }
  assert.equal(await content('unknown', request({device: 'wall'})), undefined);
  writeFileSync(join(folder, 'layout.json'), '{}');
  const missing = await content('editor-layout', request({device: 'wall'}));
  assert.ok(missing !== undefined && 'error' in missing);
  assert.equal(missing.error.code, 'invalid-state');
  assert.equal(calls, callsBeforeRead);
  await harness.stop();
  const stopped = await content('editor-layout', request({device: 'wall'}));
  assert.ok(stopped !== undefined && 'error' in stopped);
  assert.equal(stopped.error.code, 'unavailable');
});
