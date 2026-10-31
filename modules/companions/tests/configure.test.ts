// The companions section (Hub #46): synthetic by default, a hosted provider only with its key secret, and an allowlist
// of permitted tool names. A configured hosted provider reaches the API through the module's transport with the key
// read from the section's secret file, which never reaches public state or the module's records.
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {InProcessBus} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {API_KEY_SECRET, configureCompanions, createCompanionsModule} from '../src/module.js';
import type {Transport} from '../src/assistant/anthropic.js';

const configured = (section: unknown) => {const result = configureCompanions(section); return 'error' in result ? result.error.code : result.config;};

void test('the section accepts the synthetic default and a keyed hosted provider, and refuses everything else', () => {
  assert.deepEqual(configured({}), {assistant: {provider: 'synthetic', tools: []}});
  assert.deepEqual(configured({assistant: {tools: ['set_mode', 'read_sessions']}}), {assistant: {provider: 'synthetic', tools: ['set_mode', 'read_sessions']}});
  assert.deepEqual(configured({assistant: {provider: 'anthropic', tools: ['read_sessions']}, secrets: {[API_KEY_SECRET]: '/run/secrets/bunny/anthropic-api-key'}}),
    {assistant: {provider: 'anthropic', model: 'claude-opus-5-5', effort: 'medium', tools: ['read_sessions']}});
  assert.deepEqual(configured({assistant: {provider: 'anthropic', model: 'claude-sonnet-5-5', effort: 'low'}, secrets: {[API_KEY_SECRET]: '/run/secrets/bunny/k'}}),
    {assistant: {provider: 'anthropic', model: 'claude-sonnet-5-5', effort: 'low', tools: []}});
  for (const section of [
    [], {other: true}, {assistant: null}, {assistant: {provider: 'openai'}}, {assistant: {provider: 'anthropic'}}, {assistant: {provider: 'anthropic'}, secrets: {}},
    {assistant: {tools: ['ask_owner']}}, {assistant: {tools: ['read_fixture']}}, {assistant: {tools: ['set_mode', 'set_mode']}}, {assistant: {tools: 'set_mode'}},
    {assistant: {model: 'x'}}, {assistant: {provider: 'anthropic', model: 'Bad Model'}, secrets: {[API_KEY_SECRET]: '/run/secrets/bunny/k'}},
    {assistant: {provider: 'anthropic', effort: 'max'}, secrets: {[API_KEY_SECRET]: '/run/secrets/bunny/k'}}, {assistant: {provider: 'anthropic', extra: 1}, secrets: {[API_KEY_SECRET]: '/run/secrets/bunny/k'}},
  ]) assert.equal(configured(section), 'invalid-request', JSON.stringify(section));
});

void test('a configured hosted provider uses the secret key through the transport and exposes only provider, model and tools', async context => {
  const dir = await mkdtemp(join(tmpdir(), 'assistant-configured-')), bus = new InProcessBus(), core = bus.connect('bunny/core');
  await core.serveSync(['session', 'mode'], () => ({revision: 0, states: []}));
  const headers: Record<string, string>[] = [];
  const transport: Transport = (_url, init) => {headers.push(init.headers); return Promise.resolve(new Response(JSON.stringify({content: [{type: 'text', text: 'Hello.'}], stop_reason: 'end_turn', usage: {input_tokens: 3, output_tokens: 2}}), {status: 200}));};
  const module = createCompanionsModule({transport});
  const host = new ModuleHarness(module, {bus, stateDir: dir, section: {assistant: {provider: 'anthropic', tools: ['set_mode']}, secrets: {[API_KEY_SECRET]: '/run/secrets/bunny/anthropic-api-key'}}, secrets: {[API_KEY_SECRET]: 'sk-PRIVATE-TEST-KEY\n'}});
  context.after(async () => {await host.stop(); await core.close(); await rm(dir, {recursive: true, force: true});});
  await host.start();
  const state = module.inspectAssistant(); assert.ok(state);
  assert.deepEqual([state.provider, state.model, state.tools], ['anthropic', 'claude-opus-5-5', ['set_mode']]);
  const requestId = 'configured-enable';
  assert.equal((await core.request('bunny.cmd.assistant-control.assistant', {type: 'org.bunny.assistant.control.requested', subject: 'assistant',
    dataschema: 'https://bunny.invalid/events/assistant-control/2.0', data: {requestId, action: 'enable', expectedRevision: state.revision}}, {requestId, timeoutMs: 5000})).status, 'accepted');
  const staged = await module.manifest.upload?.stage({target: 'assistant', name: 'input.json', requestId: 'configured-start', signal: new AbortController().signal,
    bytes: Buffer.from(JSON.stringify({action: 'start', profile: 'bunny', expectedRevision: module.inspectAssistant()?.revision, text: 'Hi'}))});
  assert.ok(staged !== undefined && !('error' in staged));
  assert.equal((await core.request('bunny.cmd.assistant-input.assistant', {type: 'org.bunny.assistant.input.requested', subject: 'assistant',
    dataschema: 'https://bunny.invalid/events/assistant-input/2.0', data: {requestId: 'configured-start', ...staged.data}}, {requestId: 'configured-start', timeoutMs: 5000})).status, 'accepted');
  for (let n = 0; n < 100 && module.inspectAssistant()?.tasks[0]?.status !== 'succeeded'; n += 1) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(module.inspectAssistant()?.tasks[0]?.status, 'succeeded');
  assert.equal(module.inspectAssistant()?.tasks[0]?.usageUnits, 5);
  // The secret reader trims the file's trailing newline; the adapter sends the key as read.
  assert.deepEqual(headers.map(header => header['x-api-key']), ['sk-PRIVATE-TEST-KEY']);
  assert.equal(JSON.stringify([module.inspectAssistant(), host.logs, host.moduleDatabase()?.prepare('SELECT record FROM assistant_tasks').all()]).includes('PRIVATE-TEST-KEY'), false);
});
