// A module's section of the runtime's configuration file (Hub #919), as the runtime and the module test kit check it
// before the module starts: `checkConfiguration`.
import assert from 'node:assert/strict';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {MAX_SECRETS, checkConfiguration, type ConfigurationCheck, type Configured, type ModuleManifest} from '../src/index.js';
import {it} from './support.js';

type Sign = {greeting: string};
const configure = (section: unknown): Configured<Sign> | ReturnType<typeof errorBody> => {
  const {greeting, devices} = section as {greeting?: unknown; devices?: unknown};
  if (typeof greeting !== 'string') return errorBody('invalid-request', {detail: 'greeting must be text'});
  return {config: {greeting}, devices: devices as string[]};
};
const configured: ModuleManifest<Sign> = {name: 'sign', apiVersion: '1.1', configure};
const plain: ModuleManifest = {name: 'plain', apiVersion: '1.0'};

/** The refusal's code and detail, or `accepted`. */
const problem = (check: ConfigurationCheck<unknown>): string => check.status === 'accepted' ? 'accepted' : `${check.problem.code}: ${check.problem.detail}`;

it('a module without configure takes no configuration, and a section gives it only the secrets the section names', () => {
  assert.deepEqual(checkConfiguration(plain, undefined), {status: 'accepted', config: undefined, devices: [], secrets: new Map()});
  const check = checkConfiguration(plain, {ignored: true, secrets: {token: '/home/owner/.config/bunny/plain-token'}});
  assert.deepEqual(check, {status: 'accepted', config: undefined, devices: [], secrets: new Map([['token', '/home/owner/.config/bunny/plain-token']])});
});

it('configure receives the module\'s section, and its configuration, devices and secrets are accepted', () => {
  const section = {greeting: 'hello', devices: ['sign-1', 'sign-2'], secrets: {token: '/s/sign-token', 'api-key': '/s/key'}};
  assert.deepEqual(checkConfiguration(configured, section), {
    status: 'accepted', config: {greeting: 'hello'}, devices: ['sign-1', 'sign-2'], secrets: new Map([['token', '/s/sign-token'], ['api-key', '/s/key']]),
  });
});

it('a module with configure needs a section, and a section must be a JSON object', () => {
  assert.equal(problem(checkConfiguration(configured, undefined)), 'not-found: the configuration has no section for this module');
  for (const section of [null, [], 'hello', 3, true]) {
    assert.equal(problem(checkConfiguration(configured, section)), 'invalid-request: the module\'s section of the configuration must be a JSON object', JSON.stringify(section));
    assert.equal(checkConfiguration(plain, section).status, 'refused', 'even for a module without configure');
  }
});

it('the section\'s secrets must map names to absolute paths, and at most MAX_SECRETS of them', () => {
  const many = Object.fromEntries(Array.from({length: MAX_SECRETS + 1}, (_, index) => [`s${index}`, `/s/${index}`]));
  for (const secrets of [[], 'token', {Token: '/s/t'}, {token: 'relative/token'}, {token: 7}, {token: '/s/\0t'}, {'': '/s/t'}, many]) {
    assert.match(problem(checkConfiguration(configured, {greeting: 'hi', secrets})), /^invalid-request: the section's secrets must map/, JSON.stringify(secrets));
  }
});

it('a refusal from configure keeps its code and detail, and a configure that throws or answers neither is internal', () => {
  assert.equal(problem(checkConfiguration(configured, {greeting: 7})), 'invalid-request: greeting must be text');
  const failure = new TypeError('the configure failed, quoting tok_SYNTHETIC919');
  const thrown = checkConfiguration({...configured, configure: () => { throw failure; }}, {});
  assert.equal(problem(thrown), 'internal: the module\'s configure failed');
  assert.equal(thrown.status === 'refused' && thrown.error, failure, 'what it threw stays in memory');
  const odd = {...configured, configure: () => ({greeting: 'no wrapper'}) as unknown as Configured<Sign>};
  assert.equal(problem(checkConfiguration(odd, {})), 'internal: the module\'s configure returned neither a configuration nor a refusal');
  const unregistered = {...configured, configure: () => ({error: {code: 'nope', retryable: false}}) as unknown as Configured<Sign>};
  assert.equal(problem(checkConfiguration(unregistered, {})), 'internal: the module\'s configure returned neither a configuration nor a refusal',
    'a refusal with an unregistered code is no refusal');
});

it('the devices a module names must be distinct routing IDs', () => {
  for (const devices of [['Sign 1'], ['sign_1'], ['-sign'], ['x'.repeat(129)], ['sign-1', 'sign-1'], 'sign-1', [7]]) {
    assert.match(problem(checkConfiguration(configured, {greeting: 'hi', devices})), /^invalid-request: the module's devices must be distinct routing IDs/, JSON.stringify(devices));
  }
  assert.equal(problem(checkConfiguration(configured, {greeting: 'hi', devices: ['x'.repeat(128)]})), 'accepted');
});
