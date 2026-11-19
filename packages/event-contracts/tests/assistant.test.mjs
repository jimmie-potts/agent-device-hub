// Assistant families (Hub #499, #46): the dispatch command is closed to one allowlisted family and target, and the public
// state names its provider, model and tools without any conversation text.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {MessageValidator} from '../dist/v2/index.js';
import {registerCoreFamilies} from '../dist/v2/families.js';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/v2/families.json', import.meta.url), 'utf8'));
const validator = new MessageValidator(); registerCoreFamilies(validator);
const check = value => validator.validate(value, {nowMs: Date.parse(value.time)});
const valid = value => assert.equal(check(value).ok, true, JSON.stringify(check(value)));
const invalid = value => assert.equal(check(value).ok, false, JSON.stringify(value));
const dispatch = (data = fixtures.valid['assistant-dispatch'].data) => ({...structuredClone(fixtures.valid['assistant-dispatch']), data: structuredClone(data)});
const state = (data = fixtures.valid['assistant-state'].data) => ({...structuredClone(fixtures.valid['assistant-state']), data: structuredClone(data)});

test('assistant-dispatch admits only an allowlisted mode-set for the Hub from the assistant subject', () => {
  valid(dispatch());
  valid(dispatch({requestId: 'r-1', family: 'mode-set', target: 'hub', data: {mode: 'quiet'}}));
  invalid(dispatch({...dispatch().data, family: 'power-set'}));
  invalid(dispatch({...dispatch().data, target: 'wall'}));
  invalid(dispatch({...dispatch().data, data: {mode: 'party'}}));
  invalid(dispatch({...dispatch().data, data: {mode: 'work', text: 'unrequested private field'}}));
  invalid({...dispatch(), subject: 'reachy'});
  invalid({...dispatch(), type: 'org.bunny.assistant.input.requested'});
  invalid({...dispatch(), kind: 'state'});
});

test('assistant-dispatch 2.1 requires both LIFX guards and admits only the exact power or brightness value', () => {
  const guards = {expectedConfigurationRevision: 12, expectedGeneration: {epoch: 'start-1', sequence: 0}};
  const light = (family, data, target = 'desk-lamp') => ({...dispatch({requestId: 'r-2', family, target, data}),
    dataschema: 'https://bunny.invalid/events/assistant-dispatch/2.1'});
  valid(light('power-set', {...guards, on: false}));
  valid(light('brightness-set', {...guards, percent: 30}));
  invalid(light('power-set', {on: false}));
  invalid(light('power-set', {expectedConfigurationRevision: 12, on: false}));
  invalid(light('brightness-set', {...guards, percent: 101}));
  invalid(light('brightness-set', {...guards, percent: 0.3}));
  invalid(light('brightness-set', {...guards, percent: 30, on: false}));
  invalid(light('power-set', {...guards, on: false}, 'Desk Lamp'));
  invalid(light('device-mode-set', {...guards, mode: 'free'}));
  invalid({...light('power-set', {...guards, on: false}), subject: 'desk-lamp'});
});

test('assistant-dispatch 2.2 binds Wemo power to its owning integration and requires both guards', () => {
  const wemo = {requestId: 'wemo-1', family: 'power-set', target: 'table-plug', owner: 'bunny/modules/wemo',
    data: {on: true, expectedConfigurationRevision: 2, expectedGeneration: {epoch: 'start-1', sequence: 0}}};
  const command = data => ({...dispatch(data), dataschema: 'https://bunny.invalid/events/assistant-dispatch/2.2'});
  valid(command(wemo));
  valid(command({...wemo, data: {...wemo.data, on: false}}));
  invalid(command({...wemo, owner: 'bunny/modules/lifx'}));
  invalid(command({...wemo, family: 'brightness-set'}));
  invalid(command({...wemo, data: {on: true, expectedConfigurationRevision: 2}}));
  invalid(command({...wemo, data: {...wemo.data, on: 'true'}}));
  invalid({...command(wemo), dataschema: 'https://bunny.invalid/events/assistant-dispatch/2.1'});
});

test('assistant-state carries the provider, model and tool names and refuses unknown providers or extra fields', () => {
  valid(state());
  valid(state({...state().data, provider: 'anthropic', model: 'claude-opus-5-5', tools: ['read_sessions', 'set_mode']}));
  invalid(state({...state().data, provider: 'openai'}));
  invalid(state({...state().data, tools: ['Bad Name']}));
  invalid(state({...state().data, model: ''}));
  const missing = state(); delete missing.data.tools; invalid(missing);
  invalid(state({...state().data, prompt: 'private text'}));
});
