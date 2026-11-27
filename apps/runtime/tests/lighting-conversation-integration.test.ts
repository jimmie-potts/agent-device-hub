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
    {kind: 'power', label: 'refuses a power write during a pure device check', text: 'Check Studio 2.', refusal: 'read-only'},
    {kind: 'power', label: 'refuses a contextual device check expressed as a command', text: 'Check it.', refusal: 'read-only',
      previous: 'Turn Studio 2 off.'},
    {kind: 'power', label: 'admits a mixed check and command without punctuation', text: 'Check Studio 2 then turn it off.'},
    {kind: 'power', label: 'admits a command following a device check', text: 'Check Studio 2, then turn it off.'},
    {kind: 'power', label: 'refuses a status write when the owner adds please', text: 'Is Studio 2 off, please?', refusal: 'read-only'},
    {kind: 'power', label: 'refuses a status write with a conjunction in a polite check', text: 'Is Desk and Shelf Lamp off, please?',
      deviceLabel: 'Desk and Shelf Lamp', refusal: 'read-only'},
    {kind: 'power', label: 'retains polarity when the owner asks for a report too', text: 'Turn Studio 2 on, then tell me if it worked.',
      refusal: 'opposite'},
    {kind: 'power', label: 'refuses the opposite of an explicit power action', text: 'Turn Studio 2 on.', refusal: 'opposite'},
    {kind: 'power', label: 'refuses writing to a device named with a conjunction during status', text: 'Is Desk and Shelf Lamp off?',
      deviceLabel: 'Desk and Shelf Lamp', refusal: 'read-only'},
    {kind: 'power', label: 'refuses the opposite for a device named with a conjunction', text: 'Turn Desk and Shelf Lamp on.',
      deviceLabel: 'Desk and Shelf Lamp', refusal: 'opposite'},
    {kind: 'power', label: 'refuses a power write on a contextual status question', text: 'Is it off?', refusal: 'read-only', previous: 'Turn Studio 2 off.'},
    {kind: 'power', label: 'refuses the opposite of a contextual power action', text: 'Turn it on.', refusal: 'opposite', previous: 'Turn Studio 2 off.'},
    {kind: 'power', label: 'admits a matching contextual power action', text: 'Switch that one off.', previous: 'Turn Studio 2 off.'},
    {kind: 'brightness', label: 'admits a qualitative brightness setting', text: 'Set Studio 2 to half brightness.', percent: 50},
    {kind: 'brightness', label: 'asks for a value when the owner gives a subjective brightness setting', text: 'Set Studio 2 to a gentle glow.',
      literal: 'a gentle glow', refusal: 'missing'},
    {kind: 'brightness', label: 'asks for a value when the owner supplies only a time', text: 'Set Studio 2 brightness at sunset.',
      literal: 'sunset', refusal: 'missing'},
    {kind: 'brightness', label: 'uses half brightness despite a conflicting scalar', text: 'Set Studio 2 to half brightness.',
      percent: 23, expected: 50},
    {kind: 'brightness', label: 'converts a written fraction of brightness to a percent', text: 'Set Studio 2 to 3/4 brightness.',
      percent: 2, expected: 75},
    {kind: 'brightness', label: 'converts a fraction of the actual maximum', text: 'Set Studio 2 to ½ of maximum brightness.',
      percent: 99, expected: 50},
    {kind: 'brightness', label: 'refuses a fractional percent below the supported step', text: 'Set Studio 2 brightness to ½%.',
      percent: 50, refusal: 'unsupported-fraction'},
    {kind: 'brightness', label: 'uses the actual maximum despite a conflicting scalar', text: 'Set Studio 2 to maximum brightness.',
      percent: 50, expected: 100},
    {kind: 'brightness', label: 'uses the actual minimum despite a conflicting scalar', text: 'Set Studio 2 to minimum brightness.',
      percent: 50, expected: 0},
    {kind: 'brightness', label: 'uses the capability maximum for an explicit extreme', text: 'Set Studio 2 to maximum brightness.',
      percent: 100, extreme: 'maximum'},
    {kind: 'brightness', label: 'asks when the owner omitted a brightness setting', text: 'Set Studio 2 brightness.', refusal: 'missing'},
    {kind: 'brightness', label: 'binds a typed missing setting to the resolved device', text: 'Set Studio 2 brightness.',
      refusal: 'missing', typedMissing: true},
    {kind: 'brightness', label: 'binds a fractional clarification to the resolved device', text: 'Set Studio 2 brightness.',
      refusal: 'missing', typedMissing: true, answer: 'half', answerPercent: 50},
    {kind: 'brightness', label: 'binds an extreme clarification to the resolved device', text: 'Set Studio 2 brightness.',
      refusal: 'missing', typedMissing: true, answer: 'maximum', answerPercent: 100},
    {kind: 'brightness', label: 'does not repeat an answered brightness question', text: 'Set Studio 2 brightness.',
      refusal: 'missing', typedMissing: true, repeatQuestion: true},
    {kind: 'brightness', label: 'rejects a scalar that differs from the supplied answer', text: 'Set Studio 2 brightness.',
      refusal: 'missing', typedMissing: true, wrongCorrection: true},
    {kind: 'brightness', label: 'asks when a polite suffix supplies no brightness setting', text: 'Set Studio 2 brightness, please.', refusal: 'missing'},
    {kind: 'brightness', label: 'asks when a second sentence supplies no brightness setting', text: 'Set Studio 2 brightness. Thanks.', refusal: 'missing'},
    {kind: 'brightness', label: 'asks when a polite question supplies no brightness setting',
      text: 'Could you change the brightness of Studio 2?', refusal: 'missing'},
    {kind: 'brightness', label: 'asks when a device name includes a brightness-setting separator', text: 'Set Wall to Wall brightness.',
      deviceLabel: 'Wall to Wall', refusal: 'missing'},
    {kind: 'brightness', label: 'asks when the owner omitted a contextual brightness setting', text: 'Set its brightness.', refusal: 'missing',
      previous: 'Set Studio 2 brightness to 50%.'},
    {kind: 'brightness', label: 'admits a contextual qualitative brightness setting', text: 'Set it to half brightness.', percent: 50,
      previous: 'Set Studio 2 brightness to 50%.'},
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
      const extrema = 'extreme' in scenario ? scenario.extreme : undefined;
      const ownerLiteral = 'literal' in scenario ? scenario.literal : '';
      const ownerAnswer = 'repeatQuestion' in scenario ? 'Yes.' : 'answer' in scenario ? scenario.answer : '42%';
      const clock = manualClock(1_700_000_000_000);
      const id = 'fixture-light', owner = 'bunny/modules/lifx';
      let light = deviceRecord(id, 1, 'lifx', 'available');
      light.label = 'deviceLabel' in scenario ? scenario.deviceLabel : 'Studio 2';
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
        ? {device: `id:${id}`, percent: extrema !== undefined || 'typedMissing' in scenario ? 0 : qualitative ?? (refusal === 'missing' ? 50 : absolute ? 45 : 10),
          operation: 'typedMissing' in scenario ? 'missing'
            : extrema ?? (qualitative !== undefined || absolute || refusal === 'missing' ? 'absolute' : 'increase'),
          literal: qualitative !== undefined || refusal === 'missing' ? ownerLiteral : absolute ? '45%' : '10 percentage points', startingLiteral: ''}
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
        const answered = refusal === 'missing' && lastResult === ownerAnswer;
        const command = (lastResult === undefined || answered) && body.tools !== undefined && body.tools.length > 0;
        const followUpName = answered && 'repeatQuestion' in scenario ? 'ask_owner' : name;
        const args = answered ? 'repeatQuestion' in scenario ? {text: 'How bright should I set it?'}
          : {...input, operation: 'absolute', percent: 'wrongCorrection' in scenario ? 50 : 42, literal: '42%'} : input;
        const callId = answered ? 'answered' : 'fixture';
        const usage = {input_tokens: 50, output_tokens: 20};
        return Promise.resolve(Response.json(provider === 'anthropic' ? {usage,
          stop_reason: command ? 'tool_use' : 'end_turn',
          content: command ? [{type: 'tool_use', id: callId, name: followUpName, input: args}] : [{type: 'text', text: 'Fixture response.'}],
        } : {usage, status: 'completed', output: command
          ? [{type: 'function_call', id: `fc_${callId}`, call_id: callId, name: followUpName, arguments: JSON.stringify(args)}]
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
      if ('previous' in scenario) {
        await submit({action: 'start', text: scenario.previous});
        await waitFor(() => writes.length === 1);
        clock.advance(1200);
        await waitFor(() => companions.inspectAssistant()?.tasks[0]?.status === 'succeeded');
        assert.equal(submissions.length, 1);
        writes.length = 0;
        submissions.length = 0;
      }
      const prior = companions.inspectAssistant()?.tasks[0]?.taskId;
      await submit({action: 'start', text});
      await waitFor(() => companions.inspectAssistant()?.tasks[0]?.taskId !== prior);
      if (refusal === 'stale' || refusal === 'read-only' || refusal === 'opposite' || refusal === 'missing' || refusal === 'unsupported-fraction') {
        await waitFor(() => ['waiting', 'succeeded'].includes(companions.inspectAssistant()?.tasks[0]?.status ?? ''));
        assert.equal(submissions.length, 0);
        assert.equal(writes.length, 0);
        if (refusal !== 'missing') return;
        const awaiting = companions.inspectAssistant()?.tasks[0];
        assert.equal(awaiting?.status, 'waiting');
        await submit({action: 'answer', taskId: awaiting?.taskId, questionId: awaiting?.questionId,
          text: ownerAnswer});
        if ('repeatQuestion' in scenario || 'wrongCorrection' in scenario) {
          await waitFor(() => companions.inspectAssistant()?.tasks[0]?.status === 'succeeded');
          assert.equal(submissions.length, 0);
          assert.equal(writes.length, 0);
          return;
        }
        await waitFor(() => writes.length > 0);
        assert.equal(submissions.length, 1);
        assert.equal(writes.length, 1);
        assert.equal(writes[0]?.percent, 'answerPercent' in scenario ? scenario.answerPercent : 42);
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
      else assert.equal(kind === 'brightness' ? sent.percent : sent.kelvin,
        'expected' in scenario ? scenario.expected : qualitative ?? (kind === 'brightness' ? 45 : 3400));
      assert.equal(core.operation(sent.requestId)?.family, family);
      assert.equal(core.operation(sent.requestId)?.requestedBy, 'bunny/modules/companions');
    });
  }
}
