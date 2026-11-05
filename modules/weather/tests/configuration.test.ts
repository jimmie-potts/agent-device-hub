import assert from 'node:assert/strict';
import {test} from 'node:test';
import {configureWeather} from '../src/configuration.js';
import {SYNTHETIC_SECTION} from '../src/simulated.js';

void test('a section gives coordinates and a contact, and names no device', () => {
  assert.deepEqual(configureWeather({...SYNTHETIC_SECTION}), {config: {...SYNTHETIC_SECTION}});
});

void test('a refusal is a fixed sentence that quotes no coordinate', () => {
  for (const section of [undefined, null, [], {}, {...SYNTHETIC_SECTION, latitude: 91}, {...SYNTHETIC_SECTION, longitude: -181}, {...SYNTHETIC_SECTION, latitude: '12.3456'}, {...SYNTHETIC_SECTION, latitude: Number.NaN},
    {...SYNTHETIC_SECTION, contact: 'x'}, {...SYNTHETIC_SECTION, contact: 'a b)\r\nX-Injected: 1'}, {...SYNTHETIC_SECTION, extra: true}, {...SYNTHETIC_SECTION, secrets: {}}]) {
    const answer = configureWeather(section);
    assert.ok('error' in answer);
    assert.equal(answer.error.code, 'invalid-request');
    assert.doesNotMatch(JSON.stringify(answer), /12\.3456|65\.4321|Injected/);
  }
});
