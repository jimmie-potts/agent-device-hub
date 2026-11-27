import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createCompanionsModule} from '@jimmie-potts/companions';
import {lifxSchemas} from '@jimmie-potts/lifx';
import type {BunnyModule, ModuleContext} from '@jimmie-potts/sdk';
import {createCoreModule, type CoreHandle} from '../src/core/core.js';
import {deviceRecord, deviceState} from './fixtures/device.js';
import {edgeConfig, flush, it, manualClock, run, stateDir, waitFor} from './support.js';

for (const provider of ['anthropic', 'openai'] as const) {
  for (const scenario of [
    {kind: 'power', label: 'admits a matching explicit power action', text: 'Turn Studio 2 off.'},
    {kind: 'power', label: 'admits a polite power action', text: 'Could you switch Studio 2 off, please?'},
    {kind: 'power', label: 'refuses a power write on a recognized status question', text: 'Is Studio 2 off?', refusal: 'read-only'},
    {kind: 'power', label: 'refuses the opposite of an explicit power action', text: 'Turn Studio 2 on.', refusal: 'opposite'},
    {kind: 'brightness', label: 'admits a qualitative brightness setting', text: 'Set Studio 2 to half brightness.', percent: 50},
    {kind: 'brightness', label: 'asks when the owner omitted a brightness setting', text: 'Set Studio 2 brightness.', refusal: 'missing'},
    {kind: 'brightness', label: 'admits a relative brightness change from a fresh observation'},
    {kind: 'temperature', label: 'admits a relative temperature change from a fresh observation'},
    {kind: 'brightness', label: 'refuses relative brightness when the observation is stale', refusal: 'stale'},
    {kind: 'brightness', label: 'refuses absolute brightness when the device goes offline before admission', refusal: 'offline'},
    {kind: 'brightness', label: 'refuses absolute brightness when the device becomes held before admission', refusal: 'held'},
  ] as const) {
    it(`${provider} ${scenario.label}`, async context => {
      const {kind} = scenario;
      const refusal = 'refusal' in scenario ? scenario.refusal : undefined;
      const absolute = refusal === 'offline' || refusal === 'held';
      const qualitative = 'percent' in scenario ? scenario.percent : undefined;
      const clock = manualClock(1_700_000_000_000);
      const id = 'fixture-light', owner = 'bunny/modules/lifx';
      let light = deviceRecord(id, 1, 'lifx', 'available');
      light.label = 'Studio 2';
      light.capabilities.power = {supported: true};
      light.capabilities.brightness = {supported: true, minimum: 0, maximum: 100};
      light.observed = {status: 'known', observedAtMs: clock.now() - (refusal === 'stale' ? 31_000 : 0), power: {status: 'known', value: true},
        brightness: {status: 'known', value: 35}};
      const writes: {requestId: string; percent?: number; kelvin?: number; on?: boolean}[] = [];
      let fixtureDevice: ModuleContext | undefined;
      const lifx: BunnyModule = {
        manifest: {name: 'lifx', apiVersion: '1.2', configure: config => ({config, devices: [id]})},
        async start(given) {
          fixtureDevice = given;
          await given.sdk.serveSync(['device'], () => ({revision: light.revision, states: [deviceState(light)]}));
          await given.sdk.serveSync(['lifx-light'], () => ({revision: 1, states: [{
            type: 'org.bunny.lifx-light.updated', subject: id, dataschema: 'https://bunny.invalid/events/lifx-light/2.1',
            data: {id, revision: 1, capabilities: {color: {supported: false}, temperature: {supported: true, minimum: 2700, maximum: 6500}},
              observed: {status: 'known', observedAtMs: clock.now(), hue: 0, saturation: 0, brightness: 35, kelvin: 3600}},
          }]}));
          await given.sdk.respond<{requestId: string; percent?: number; kelvin?: number; on?: boolean}>(`bunny.cmd.${family}.${id}`, command => {
            writes.push(command.data);
            return {status: 'accepted'};
          });
        },
        stop() {},
      };
      const family = kind === 'power' ? 'power-set' : kind === 'brightness' ? 'brightness-set' : 'lifx-temperature-set';
      const name = kind === 'power' ? 'set_lifx_power' : kind === 'brightness' ? 'set_lifx_brightness' : 'control_lifx_temperature_set';
      const input = kind === 'brightness'
        ? {device: `id:${id}`, percent: qualitative ?? (refusal === 'missing' ? 50 : absolute ? 45 : 10),
          operation: qualitative !== undefined || absolute || refusal === 'missing' ? 'absolute' : 'increase',
          literal: qualitative !== undefined || refusal === 'missing' ? '' : absolute ? '45%' : '10 percentage points', startingLiteral: ''}
        : kind === 'power' ? {device: `id:${id}`, on: false}
        : {owner, target: `id:${id}`, arguments: JSON.stringify({kelvin: {kind: 'decrease', amount: 200, literal: '200 Kelvin'}})};
      const companions = createCompanionsModule({share: () => true, transport: (_url, init) => {
        const body = JSON.parse(init.body) as {
          tools?: unknown[];
          messages?: {content: {type: string; content?: string}[]}[];
          input?: {type?: string; output?: string}[];
        };
        const lastResult = provider === 'anthropic'
          ? body.messages?.flatMap(message => message.content).filter(block => block.type === 'tool_result').at(-1)?.content
          : body.input?.filter(item => item.type === 'function_call_output').at(-1)?.output;
        const answered = refusal === 'missing' && lastResult === '42%';
        const command = (lastResult === undefined || answered) && body.tools !== undefined && body.tools.length > 0;
        const args = answered ? {...input, percent: 42, literal: '42%'} : input;
        const callId = answered ? 'answered' : 'fixture';
        const usage = {input_tokens: 50, output_tokens: 20};
        return Promise.resolve(Response.json(provider === 'anthropic' ? {usage,
          stop_reason: command ? 'tool_use' : 'end_turn',
          content: command ? [{type: 'tool_use', id: callId, name, input: args}] : [{type: 'text', text: 'Fixture response.'}],
        } : {usage, status: 'completed', output: command
          ? [{type: 'function_call', id: `fc_${callId}`, call_id: callId, name, arguments: JSON.stringify(args)}]
          : [{type: 'message', role: 'assistant', content: [{type: 'output_text', text: 'Fixture response.', annotations: []}]}]}));
      }});
      const submissions: {schema: string; basis: unknown}[] = [];
      const coreRefusals: string[] = [];
      const tracedCompanions: BunnyModule = {...companions, start: given => companions.start({
        ...given, sdk: {...given.sdk, request: async (key, draft, options) => {
          const submit = key === 'bunny.cmd.assistant-dispatch.assistant';
          if (submit) {
            submissions.push({schema: draft.dataschema, basis: 'observationBasis' in draft.data ? draft.data.observationBasis : undefined});
            if (absolute) {
              assert.ok(fixtureDevice);
              light = {...light, revision: light.revision + 1, ...(refusal === 'offline' ? {availability: 'unavailable'}
                : {held: {requestId: 'fixture-hold', heldAtMs: clock.now()}})};
              await fixtureDevice.sdk.publish(`bunny.state.device.${id}`, {kind: 'state', ...deviceState(light),
                dataschema: 'https://bunny.invalid/events/device/2.1'});
              await flush();
            }
          }
          const result = await given.sdk.request(key, draft, options);
          if (submit && result.status === 'rejected') coreRefusals.push(result.error.error.code);
          return result;
        }},
      })};
      const secret = join(await stateDir(context), 'provider-fixture');
      await writeFile(secret, 'test-token', {mode: 0o600});
      const secretName = provider === 'anthropic' ? 'anthropic-api-key' : 'openai-responses-api-key';
      const files = await edgeConfig(context, [], {modules: {lifx: {},
        companions: {assistant: {provider, tools: [name]}, secrets: {[secretName]: secret}},
      }});
      let handle: CoreHandle | undefined;
      await run(context, {modules: [createCoreModule({parts: [{start: core => {
        handle = core;
        return Promise.resolve();
      }}]}), lifx, tracedCompanions], configFile: files.config, clock, scheduler: clock.scheduler, edge: {schemas: lifxSchemas}});
      assert.ok(handle);
      const core = handle;
      const enable = randomUUID();
      const admitted = await core.sdk.request('bunny.cmd.assistant-control.assistant', {
        type: 'org.bunny.assistant.control.requested', subject: 'assistant', dataschema: 'https://bunny.invalid/events/assistant-control/2.0',
        data: {requestId: enable, action: 'enable', expectedRevision: companions.inspectAssistant()?.revision},
      }, {requestId: enable, timeoutMs: 2000});
      assert.equal(admitted.status, 'accepted', JSON.stringify(admitted));
      const text = 'text' in scenario ? scenario.text : absolute ? 'Set Studio 2 brightness to 45%.' : kind === 'brightness'
        ? 'Raise Studio 2 brightness by 10 percentage points.' : 'Make Studio 2 warmer by 200 Kelvin.';
      async function submit(input: Record<string, unknown>) {
        const requestId = randomUUID();
        const staged = await companions.manifest.upload?.stage({target: 'assistant', name: 'input.json', requestId,
          signal: new AbortController().signal, bytes: Buffer.from(JSON.stringify({profile: 'bunny',
            expectedRevision: companions.inspectAssistant()?.revision, ...input}))});
        assert.ok(staged !== undefined && !('error' in staged), JSON.stringify(staged));
        const reply = await core.sdk.request('bunny.cmd.assistant-input.assistant', {
          type: 'org.bunny.assistant.input.requested', subject: 'assistant', dataschema: 'https://bunny.invalid/events/assistant-input/2.0',
          data: {requestId, ...staged.data},
        }, {requestId, timeoutMs: 2000});
        assert.equal(reply.status, 'accepted', JSON.stringify(reply));
      }
      await submit({action: 'start', text});
      if (refusal === 'stale' || refusal === 'read-only' || refusal === 'opposite' || refusal === 'missing') {
        await waitFor(() => ['waiting', 'succeeded'].includes(companions.inspectAssistant()?.tasks[0]?.status ?? ''));
        assert.equal(submissions.length, 0);
        assert.equal(writes.length, 0);
        if (refusal !== 'missing') return;
        const awaiting = companions.inspectAssistant()?.tasks[0];
        assert.equal(awaiting?.status, 'waiting');
        await submit({action: 'answer', taskId: awaiting?.taskId, questionId: awaiting?.questionId, text: '42%'});
        await waitFor(() => writes.length > 0);
        assert.equal(submissions.length, 1);
        assert.equal(writes.length, 1);
        assert.equal(writes[0]?.percent, 42);
        return;
      }
      if (absolute) {
        await waitFor(() => coreRefusals.length > 0);
        assert.deepEqual(coreRefusals, ['unavailable']);
        assert.equal(submissions.length, 1);
        assert.equal(submissions[0]?.basis, undefined);
        assert.deepEqual(writes, []);
        return;
      }
      await waitFor(() => writes.length > 0);
      assert.deepEqual(submissions, [{schema: `https://bunny.invalid/events/assistant-dispatch/${kind === 'power' || qualitative !== undefined ? '2.1' : '2.4'}`,
        basis: kind === 'power' || qualitative !== undefined ? undefined : {kind, observedAtMs: clock.now(), value: kind === 'brightness' ? 35 : 3600}}]);
      assert.equal(writes.length, 1);
      const sent = writes[0] ?? assert.fail('Expected a single device submission.');
      if (kind === 'power') assert.equal(sent.on, false);
      else assert.equal(kind === 'brightness' ? sent.percent : sent.kelvin, qualitative ?? (kind === 'brightness' ? 45 : 3400));
      assert.equal(core.operation(sent.requestId)?.family, family);
      assert.equal(core.operation(sent.requestId)?.requestedBy, 'bunny/modules/companions');
    });
  }
}
