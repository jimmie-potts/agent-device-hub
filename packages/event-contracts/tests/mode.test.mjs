import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {MessageValidator} from '../dist/v2/index.js';
import {registerCoreFamilies} from '../dist/v2/families.js';
import {effectiveMode, normalizeModeState} from '../dist/v2/mode.js';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/v2/families.json', import.meta.url), 'utf8')).valid;
const validator = new MessageValidator(); registerCoreFamilies(validator);

test('mode versions preserve global fields and reject ambiguous or invalid exceptions', () => {
  assert.equal(validator.validate(fixtures.mode).ok, true);
  const message = structuredClone(fixtures['mode-with-overrides']);
  assert.equal(validator.validate(message).ok, true);
  const choice = message.data.overrides[0];
  for (const overrides of [[choice, choice], [{...choice, mode: message.data.mode}], [{...choice, mode: 'monitor'}], [{...choice, target: '../wall'}], [{...choice, selectedAtMs: -1}], [{...choice, address: 'private'}]]) {
    assert.equal(validator.validate({...message, data: {...message.data, overrides}}).ok, false);
    assert.equal(normalizeModeState({...message.data, overrides}), undefined);
  }
  assert.equal(validator.validate({...fixtures.mode, data: {...fixtures.mode.data, overrides: []}}).ok, false, '2.0 remains closed');
  assert.equal(validator.validate(fixtures['mode-override-set']).ok, true);
});

test('synthetic future consumer reads effective choice without default permission, state ownership or effects', () => {
  const record = normalizeModeState(fixtures['mode-with-overrides'].data);
  assert.equal(effectiveMode(record, 'wall', true), 'free');
  assert.equal(effectiveMode(record, 'future-companion', true), 'quiet');
  const companion = {...record, overrides: [{target: 'future-companion', mode: 'work', selectedAtMs: 12}]};
  assert.equal(effectiveMode(companion, 'future-companion', true), 'work');
  assert.equal(effectiveMode(JSON.parse(JSON.stringify(companion)), 'future-companion', true), 'work');
  assert.equal(effectiveMode({...companion, overrides: []}, 'future-companion', true), 'quiet');
  assert.equal(effectiveMode(companion, 'future-companion', false), undefined);
  assert.equal(effectiveMode(undefined, 'future-companion', true), undefined);
  assert.equal(effectiveMode(normalizeModeState(fixtures.mode.data), 'future-companion', true), 'quiet');
});
