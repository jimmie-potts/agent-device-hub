import assert from 'node:assert/strict';
import {registration} from '@jimmie-potts/roborock';
import {createCoreModule} from '../src/index.js';
import {edgeConfig, entry, fixture, it, run} from './support.js';

it('an unconfigured shipped Roborock module is refused while core and another module keep running', async context => {
  const token = 'tok_SYNTHETIC376_catalog';
  const files = await edgeConfig(context, [{source: 'bunny/roborock-reader', token, scopes: ['read']}], {
    modules: {steady: {}}, mcp: true,
  });
  const {runtime} = await run(context, {
    modules: [createCoreModule(), registration.create(), fixture('steady')],
    configFile: files.config,
    edge: {schemas: registration.schemas ?? {}},
  });
  const report = runtime.health();
  assert.equal(entry(report, 'core').state, 'running');
  assert.equal(entry(report, 'steady').state, 'running');
  assert.equal(entry(report, 'roborock').state, 'refused');
  assert.equal(entry(report, 'roborock').reason?.code, 'not-found');
  const response = await fetch(new URL('/api/v2/modules', runtime.url), {headers: {authorization: `Bearer ${token}`}});
  assert.equal(response.status, 200);
  const catalog = await response.json() as {modules: {name: string; state: string; pages: unknown[]; tools: string[]}[]};
  const vacuum = catalog.modules.find(module => module.name === 'roborock');
  assert.ok(vacuum !== undefined);
  assert.equal(vacuum.state, 'refused');
  assert.deepEqual(vacuum.pages, []);
  assert.deepEqual(vacuum.tools, []);
  assert.equal(JSON.stringify(catalog).includes(token), false);
});
