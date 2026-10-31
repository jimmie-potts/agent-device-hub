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

test('assistant-state carries the provider, model and tool names and refuses unknown providers or extra fields', () => {
  valid(state());
  valid(state({...state().data, provider: 'anthropic', model: 'claude-opus-5-5', tools: ['read_sessions', 'set_mode']}));
  invalid(state({...state().data, provider: 'openai'}));
  invalid(state({...state().data, tools: ['Bad Name']}));
  invalid(state({...state().data, model: ''}));
  const missing = state(); delete missing.data.tools; invalid(missing);
  invalid(state({...state().data, prompt: 'private text'}));
});
