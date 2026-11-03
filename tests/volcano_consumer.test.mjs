import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {Ajv2020} from 'ajv/dist/2020.js';
import {checkConfiguration, checkManifest} from '@jimmie-potts/sdk';
import {gapsSchema, registration, sessionsSchema, statusSchema, timelineSchema, totalsSchema} from '@jimmie-potts/volcano';
import {registrySource} from '../apps/runtime/dist/build/registry.js';

const SECTION = {id: 'volcano', hostId: 'host-a', sourceId: 'volcano-a'};

void test('the shipped module loads through the registry, and its real build reaches no device', () => {
  const real = registration.create(), synthetic = registration.simulate();
  assert.equal(checkManifest(real.manifest), undefined);
  assert.equal(checkConfiguration(real.manifest, undefined).status, 'refused');
  assert.equal(checkConfiguration(real.manifest, SECTION).status, 'accepted');
  assert.equal(checkConfiguration(synthetic.manifest, SECTION).status, 'accepted');
  assert.equal(registration.shipped, true);
  assert.equal(registration.hostLocal(SECTION), true);
  assert.deepEqual(real.manifest.tools.map(tool => tool.name), ['status']);
  assert.equal(real.manifest.pages, undefined);
  assert.ok(registrySource(process.cwd()).includes('from "@jimmie-potts/volcano"'));
});

void test('MCP and standalone consumers compile all selected schemas without an external registry', () => {
  const ajv = new Ajv2020({strict: true});
  for (const schema of [statusSchema, timelineSchema, sessionsSchema, totalsSchema, gapsSchema]) assert.equal(typeof ajv.compile(schema), 'function');
  assert.equal(typeof new Ajv2020({strict: true}).compile(registration.create().manifest.tools[0].output), 'function');
});

void test('the runtime container gains no native dependency: the root lockfile has no Bluetooth binding, and the collector package pins it', () => {
  const root = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  assert.equal(Object.keys(root.packages).some(path => path.includes('@stoprocent/noble')), false);
  assert.equal(Object.hasOwn(root.packages, 'apps/volcano-collector'), false);
  const own = JSON.parse(readFileSync(new URL('../apps/volcano-collector/package.json', import.meta.url), 'utf8'));
  assert.deepEqual(own.dependencies, {'@stoprocent/noble': '2.8.0'});
  const lock = JSON.parse(readFileSync(new URL('../apps/volcano-collector/package-lock.json', import.meta.url), 'utf8'));
  assert.equal(lock.packages['node_modules/@stoprocent/noble'].version, '2.8.0');
});
