// Each module declares a manifest. A module whose API version does not match, or whose manifest is malformed, is
// refused and never started; health says why, and the other modules run.
import assert from 'node:assert/strict';
import {checkApiVersion} from '@jimmie-potts/sdk';
import {contextOf, entry, fixture, health, it, run, setMode, type Fixture} from './support.js';

it('refuses a module whose API version does not match, and starts the others', async context => {
  const started: string[] = [];
  const track = (name: string, apiVersion: string) => fixture(name, () => { started.push(name); }, apiVersion);
  const modules = [
    track('newer-major', '2.0'), track('newer-minor', '1.3'), track('older-major', '0.9'), track('malformed', 'one'), track('current', '1.2'),
    track('older-minor', '1.0'),
  ];
  const {runtime, logs} = await run(context, {modules});
  assert.deepEqual(started.sort(), ['current', 'older-minor'], 'an older minor version only lacks later additions');

  const {status, body} = await health(runtime.url);
  assert.equal(status, 200, 'the runtime itself answers');
  assert.equal(body.status, 'degraded');
  const mismatch = (apiVersion: string) => ({
    apiVersion, state: 'refused', healthy: false, syncRestarts: 0,
    reason: {code: 'unsupported-version', detail: `module API ${apiVersion} does not match this runtime's 1.2`},
  });
  assert.deepEqual(body.modules, [
    {name: 'newer-major', ...mismatch('2.0')},
    {name: 'newer-minor', ...mismatch('1.3')},
    {name: 'older-major', ...mismatch('0.9')},
    {name: 'malformed', apiVersion: 'one', state: 'refused', healthy: false, syncRestarts: 0, reason: {code: 'invalid-request', detail: 'apiVersion must be <major>.<minor>'}},
    {name: 'current', apiVersion: '1.2', state: 'running', healthy: true, syncRestarts: 0},
    {name: 'older-minor', apiVersion: '1.0', state: 'running', healthy: true, syncRestarts: 0},
  ]);
  assert.equal(modules.reduce((stops, module) => stops + module.stops, 0), 0, 'a refused module is never stopped, and the running one not yet');
  const refusals = logs.filter(record => record.event_name === 'runtime.module.refused');
  assert.deepEqual(refusals.map(record => record.attributes), [
    ...['newer-major', 'newer-minor', 'older-major'].map(name => ({'bunny.module': name, 'bunny.code': 'unsupported-version', 'bunny.phase': 'manifest', 'bunny.provenance': 'source'})),
    {'bunny.module': 'malformed', 'bunny.code': 'invalid-request', 'bunny.phase': 'manifest', 'bunny.provenance': 'source'},
  ], 'a refusal names the module and its registry code, never the sentence');
  assert.equal(refusals[0]?.severity_text, 'ERROR');
});

it('refuses a module whose pages, tools or settings the runtime would not serve, and starts the others', async context => {
  const started: string[] = [];
  const page = {id: 'preview', title: 'Preview', render: () => '<p>preview</p>'};
  const contributing = (name: string, apiVersion: string, contributions: object): Fixture => {
    const module = fixture(name, () => { started.push(name); }, apiVersion);
    return Object.assign(module, {manifest: {...module.manifest, ...contributions}});
  };
  const modules = [
    contributing('older', '1.1', {pages: [page]}), contributing('reserved', '1.2', {pages: [{...page, id: 'content'}]}),
    contributing('unconfigured', '1.2', {settings: {schema: {type: 'object'}, show: () => ({})}}), contributing('current', '1.2', {pages: [page]}),
  ];
  const {runtime} = await run(context, {modules});
  assert.deepEqual(started, ['current']);
  assert.deepEqual(runtime.health().modules.map(module => [module.name, module.state, module.reason?.detail]), [
    ['older', 'refused', 'pages, content, tools and settings need module API 1.2'],
    ['reserved', 'refused', 'each page needs a distinct ID of lowercase letters and digits with single hyphens, at most 64, other than content'],
    ['unconfigured', 'refused', 'settings show what configure accepted, so they need configure'],
    ['current', 'running', undefined],
  ]);
});

it('a refused module gets no participant, so nothing it would answer reaches it', async context => {
  const refused = fixture('lamp', async ({sdk}) => { await sdk.respond('bunny.cmd.mode.lamp', () => ({status: 'accepted'})); }, '2.0');
  const caller = fixture('caller');
  await run(context, {modules: [refused, caller]});
  assert.equal(refused.context, undefined);
  const result = await contextOf(caller).sdk.request('bunny.cmd.mode.lamp', setMode, {timeoutMs: 1000});
  assert.equal(result.status, 'rejected');
  assert.equal(result.error.error.code, 'unavailable');
});

it('refuses a malformed name and a second module with the same name', async context => {
  const first = fixture('wall');
  const second = fixture('wall');
  const badNames = ['Wall', 'wall_2', '-wall', 'wall-', '', 'x'.repeat(65)].map(name => fixture(name));
  const {runtime, logs} = await run(context, {modules: [first, second, ...badNames]});
  assert.ok(first.context, 'the first module with a name runs');
  // A malformed name is no identity, so its refusal leaves the name out rather than lose the record.
  assert.deepEqual(logs.filter(record => record.event_name === 'runtime.module.refused').map(record => record.attributes['bunny.module']),
    ['wall', ...badNames.map(() => undefined)]);
  assert.equal(second.context, undefined);
  const report = runtime.health();
  assert.deepEqual(report.modules[1], {
    name: 'wall', apiVersion: '1.0', state: 'refused', healthy: false, syncRestarts: 0,
    reason: {code: 'invalid-request', detail: 'another module already has this name'},
  });
  assert.equal(entry(report, 'wall').state, 'running');
  for (const [index, module] of badNames.entries()) {
    assert.equal(module.context, undefined);
    assert.deepEqual(report.modules[index + 2]?.reason, {
      code: 'invalid-request', detail: 'name must be lowercase letters and digits with single hyphens, at most 64 characters',
    });
  }
});

it('a module API version matches when the major is the same and the minor is not newer', () => {
  assert.equal(checkApiVersion('1.2', '1.2'), undefined);
  assert.equal(checkApiVersion('1.0', '1.2'), undefined, 'an older minor only lacks later additions');
  assert.equal(checkApiVersion('1.3', '1.2')?.code, 'unsupported-version');
  assert.equal(checkApiVersion('2.0', '1.2')?.code, 'unsupported-version');
  assert.equal(checkApiVersion('0.2', '1.2')?.code, 'unsupported-version');
  for (const malformed of ['1', '1.0.0', 'v1.0', '01.0', '1.x', ' 1.0', '']) {
    assert.equal(checkApiVersion(malformed, '1.2')?.code, 'invalid-request', malformed);
  }
});
