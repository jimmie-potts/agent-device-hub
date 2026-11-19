// The Companions overview (Hub #1950): Habitat and the companion features, from the catalog the page holds.
import assert from 'node:assert/strict';
import test from 'node:test';
import {companionsOverview} from '../src/companions-overview.ts';
import type {RuntimeData} from '../src/runtime-feeds.ts';
import {routeHash} from '../src/routes.ts';
import {hardwareRuntime} from './hardware-fixture.ts';

const shown = (runtime: RuntimeData): string[] => companionsOverview(runtime).sections.map(section => `${section.title}: ${section.links.map(link => `${link.label} ${routeHash(link.route)}`).join(', ')}`);

void test('the overview links Habitat, the companion profiles, Preferences and Companion knowledge, and leaves the Conversation to the rail', () => {
  const before = JSON.stringify(hardwareRuntime);
  assert.deepEqual(shown(hardwareRuntime), [
    'Habitat: Open Habitat #/habitat',
    'Companion profiles: Reachy #/module/companions/reachy, MicroDuck #/module/companions/microduck, Duck conversation #/module/companions/duck-conversation',
    'Preferences: Open Preferences #/module/companions/preferences',
    'Companion knowledge: Open Companion knowledge #/module/companions/knowledge',
  ]);
  assert.equal(companionsOverview(hardwareRuntime).note, undefined);
  assert.equal(JSON.stringify(hardwareRuntime), before, 'the projection does not change the runtime copies');
});

void test('without a running companions module only Habitat is offered, and the overview says why', () => {
  const stopped = {...hardwareRuntime, modules: hardwareRuntime.modules?.map(module => module.name === 'companions' ? {...module, state: 'stopped'} : module)};
  assert.deepEqual([shown(stopped), companionsOverview(stopped).note], [['Habitat: Open Habitat #/habitat'], 'Companions: stopped. Its features are unavailable.']);
  const absent = {...hardwareRuntime, modules: hardwareRuntime.modules?.filter(module => module.name !== 'companions')};
  assert.equal(companionsOverview(absent).note, 'No companions module is declared.');
  assert.equal(companionsOverview({...hardwareRuntime, modules: undefined}).note, 'Loading companion features.');
  assert.match(companionsOverview({...hardwareRuntime, modules: undefined, catalogFailed: true}).note ?? '', /catalog is unavailable/);
});
