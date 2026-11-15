import assert from 'node:assert/strict';
import {test} from 'node:test';
import {configurePresence} from '../src/configuration.js';
import {presenceValidator} from '../src/families.js';
import {SCHEMA, SOURCE, TYPE} from '../src/contracts.js';
import {Projection} from '../src/projection.js';
import {build} from 'esbuild';
import {SYNTHETIC_SECTION, SYNTHETIC_SENSOR, reports} from '../src/simulated.js';

void test('strict private configuration accepts two explicit sensors and refuses ambiguous bindings/identity and inline secrets', () => {
  assert.ok('config' in configurePresence(SYNTHETIC_SECTION));
  for (const change of [
    (value: typeof SYNTHETIC_SENSOR) => { const target = value.targets[0]; assert.ok(target); target.y = target.x; },
    (value: typeof SYNTHETIC_SENSOR) => { value.address = 'guess.local'; },
    (value: typeof SYNTHETIC_SENSOR) => { value.security = {mode: 'noise'}; },
    (value: typeof SYNTHETIC_SENSOR) => { (value.security as unknown as Record<string, unknown>).key = 'private-token'; },
  ]) {
    const sensor = structuredClone(SYNTHETIC_SENSOR); change(sensor); const result = configurePresence({sensors: [sensor]});
    assert.ok('error' in result); assert.ok(!JSON.stringify(result).includes('private-token'));
  }
  assert.ok('error' in configurePresence({sensors: [SYNTHETIC_SENSOR, SYNTHETIC_SENSOR]}));
});
void test('public contracts constants bundle for a browser without the acquisition module or Node APIs', async () => {
  const result = await build({stdin: {contents: 'export {FAMILY,SCHEMA,TYPE} from "@jimmie-potts/presence-pro/contracts"', resolveDir: process.cwd()}, bundle: true, platform: 'browser', format: 'esm', write: false});
  assert.equal(result.outputFiles[0]?.text.includes('presence-observation'), true);
  assert.doesNotMatch(result.outputFiles[0]?.text ?? '', /node:|noise-c|NativeFactory|createPresenceModule/);
});
void test('public schema validates full and disconnected reports and rejects phantom points, foreign sources and content fields', () => {
  const projection = new Projection(SYNTHETIC_SENSOR); projection.connected(); for (const report of reports()) projection.report(report, 1000);
  projection.current.revision = 1;
  const envelope = () => ({specversion: '1.0', traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01', datacontenttype: 'application/json', bunnyprofile: '2.0', id: 'synthetic-message', source: SOURCE, kind: 'state', type: TYPE,
    subject: SYNTHETIC_SENSOR.id, time: '2026-11-15T00:00:00.000Z', dataschema: SCHEMA, data: structuredClone(projection.current)});
  const validator = presenceValidator(); assert.equal(validator.validate(envelope()).ok, true);
  const phantom = envelope(); const target = phantom.data.targets[0]; assert.ok(target); target.active.value = {status: 'known', value: false}; assert.equal(validator.validate(phantom).ok, false);
  const leak = envelope(); (leak.data as unknown as Record<string, unknown>).password = 'synthetic-secret'; assert.equal(validator.validate(leak).ok, false);
  const foreign = envelope(); foreign.source = 'bunny/modules/other'; assert.equal(validator.validate(foreign).ok, false);
  projection.disconnected(); projection.current.revision = 2; assert.equal(validator.validate(envelope()).ok, true);
});
