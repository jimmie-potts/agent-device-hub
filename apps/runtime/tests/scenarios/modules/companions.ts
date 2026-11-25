import {chmod, mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {SIMULATED_SECTION as NANOLEAF_SECTION} from '@jimmie-potts/nanoleaf';
import type {ShowCatalog} from '@jimmie-potts/event-contracts/v2/nanoleaf-shows';
import type {LightingState} from '@jimmie-potts/event-contracts/v2/music-lighting-data';
import {LIFX_SIMULATED_SECTION} from '@jimmie-potts/lifx';
import {VOLCANO_SIMULATED_SECTION, type VolcanoStatus} from '@jimmie-potts/volcano';
import {WEMO_SIMULATED_SECTION} from '@jimmie-potts/wemo';
import {knowledgeScenarios} from '../knowledge.js';
import {preferenceScenarios} from '../preferences.js';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {AssistantState} from '@jimmie-potts/event-contracts/v2/assistant';
import type {ModeState, OperationRecord, PowerLimitRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {CompanionState} from '@jimmie-potts/event-contracts/v2/companions';
import {approvalPrompt, approvalResolved, sessionStarted, turnEnded, turnStarted} from '../../fixtures/agents.js';
import {StepFailure, act, answers, bodyOf, deviceState, dispatchOnce, expect, holds, publish, recorded, refusedWith, running, waiting, type GatewayAnswer, type Harness, type ModuleRun, type Scenario} from '../framework.js';
const state = (h: Harness): CompanionState | undefined => h.reader.states<CompanionState>('companion-state', 'bunny/modules/companions')[0]?.data;
const assistantSyncsBeforeRestart = new WeakMap<Harness, number>();
const RECENT_CONVERSATION = {as: 'operator', method: 'GET', path: '/modules/companions/content/conversation?profile=bunny&view=recent'} as const;
const CONVERSATION = {as: 'operator', method: 'GET', path: '/modules/companions/content/conversation?profile=bunny&after=0'} as const;
const command = (family: string, data: object) => ({key: `bunny.cmd.${family}.reachy`, draft: {
  type: `org.bunny.${family.slice(0, family.lastIndexOf('-'))}.${family.slice(family.lastIndexOf('-') + 1)}.requested`, subject: 'reachy',
  dataschema: `https://bunny.invalid/events/${family}/2.0`, data}});
export const scenarios: readonly Scenario[] = [...preferenceScenarios, ...knowledgeScenarios, {
  id: 'reachy-text', title: 'optional fixed-text Reachy preserves core attention, scenario attribution and restart without replay',
  seed: {modules: ['core', 'companions'], sections: {companions: {}}, follows: [{owner: 'bunny/core', families: ['session', 'mode', 'operation']},
    {owner: 'bunny/modules/companions', families: ['companion-state']}]},
  steps: [
    expect('core and optional companion are running', h => running(h, ['core', 'companions'])),
    expect('Reachy starts disabled without a card', h => state(h)?.settings.enabled === false && state(h)?.presentation === null || 'default differs'),
    act('hook raises attention while Reachy is disabled', async h => {await publish(h, sessionStarted); await publish(h, turnStarted); await publish(h, approvalPrompt('reachy-off'));}),
    expect('core attention remains authoritative with Reachy off', h => waiting(h, ['reachy-off'])),
    act('operator enables optional text through tracked command', h => dispatchOnce(h, 'operator', 'reachy-enable', command('companion-settings-set',
      {expectedRevision: state(h)?.revision, enabled: true, muted: [], snooze: 'keep'}), 'reachy-enable')),
    expect('enablement completes as a saved setting', h => recorded(h, 'reachy-enable', 'succeeded', 'observed')),
    holds('enablement never replays missed attention', h => state(h)?.presentation === null || 'missed request replayed', 100),
    act('hook clears the old attention and raises a fresh question', async h => {await publish(h, approvalResolved('reachy-off')); await publish(h, approvalPrompt('reachy-live'));}),
    expect('one live card is attributed to the current attention', h => {
      const card = state(h)?.presentation;
      return card?.opportunity.context === 'live' && card.opportunity.evidence === 'lifecycle-metadata' &&
        card.opportunity.attention?.id.status === 'known' && card.opportunity.attention.id.id === 'reachy-live' || 'live attribution missing';
    }),
    act('hook clears attention and ends its turn', async h => {await publish(h, approvalResolved('reachy-live')); await publish(h, turnEnded);}),
    expect('quiet turn card claims no response content', h => state(h)?.presentation?.opportunity.cue === 'turn-ended' &&
      state(h)?.presentation?.content === 'unavailable' || 'turn card differs'),
    act('operator starts a labelled mixed question and arrival', h => dispatchOnce(h, 'operator', 'reachy-mixed', command('companion-fixture-run',
      {scenario: 'question-and-arrival', busy: false, media: false}), 'reachy-mixed')),
    expect('the fixture input completes independently of visibility', h => recorded(h, 'reachy-mixed', 'succeeded', 'observed')),
    expect('coding wins within the synthetic context with unknown identity/location', h => {
      const event = state(h)?.presentation?.opportunity;
      return event?.context === 'scenario' && event.category === 'coding-attention' && event.identity === null && event.location === null || 'synthetic priority or identity differs';
    }),
    act('runtime restarts with only settings and bounded presentation records', h => h.restart()),
    expect('saved settings survive and the card is history', h => state(h)?.settings.enabled === true && state(h)?.presentation?.history === true || 'restore differs'),
    holds('restart never emits a new reaction', h => state(h)?.presentation?.history === true || 'restart replayed a card', 100),
  ],
}, {
  id: 'assistant-task', title: 'private synthetic task waits, restarts and explicitly resumes through existing authenticated controls',
  seed: {modules: ['core', 'companions'], sections: {companions: {}}, follows: [{owner: 'bunny/core', families: ['operation']},
    {owner: 'bunny/modules/companions', families: ['companion-state', 'assistant-state']}]},
  keepCapturePage: true,
  capture: async context => {
    const {captureConversationWorkspace} = await import('../../../verify/conversation-workspace.js');
    await captureConversationWorkspace(context);
  },
  steps: [
    expect('core and companions are running', h => running(h, ['core', 'companions'])),
    expect('assistant and Reachy both default off', h => assistant(h)?.enabled === false && state(h)?.settings.enabled === false || 'defaults differ'),
    act('operator explicitly enables synthetic tasks', h => dispatchOnce(h, 'operator', 'assistant-enable', {key: 'bunny.cmd.assistant-control.assistant', draft: {
      type: 'org.bunny.assistant.control.requested', subject: 'assistant', dataschema: 'https://bunny.invalid/events/assistant-control/2.0',
      data: {action: 'enable', expectedRevision: assistant(h)?.revision}}}, 'assistant-enable')),
    expect('the enable control is durably observed', h => recorded(h, 'assistant-enable', 'succeeded', 'observed')),
    act('operator stages private synthetic text', h => assistantInput(h, 'assistant-start')),
    expect('start receipt means input saved', h => recorded(h, 'assistant-start', 'succeeded', 'observed')),
    expect('the task waits after one fake model call', h => assistant(h)?.tasks[0]?.status === 'waiting' && assistant(h)?.tasks[0]?.modelCalls === 1 || 'task did not wait'),
    act('the runtime restarts on its private store', async h => {
      assistantSyncsBeforeRestart.set(h, h.reader.syncs('assistant-state', 'bunny/modules/companions'));
      await h.restart();
    }),
    expect('the reader resyncs assistant state after restart', h =>
      h.reader.syncs('assistant-state', 'bunny/modules/companions') > (assistantSyncsBeforeRestart.get(h) ?? Number.MAX_SAFE_INTEGER) || 'the reader has not resynced'),
    holds('restart keeps the question without another call', h => assistant(h)?.tasks[0]?.status === 'waiting' && assistant(h)?.tasks[0]?.modelCalls === 1 || 'restart invoked work', 100),
    expect('an authenticated reader can read saved private text', answers({as: 'reader', method: 'GET', path: '/modules/companions/content/conversation?profile=bunny'}, response =>
      response.status === 200 && JSON.stringify(bodyOf(response)).includes('SYNTHETIC_ASSISTANT_PROMPT') || 'private read missing')),
    expect('anonymous conversation read is refused', answers({as: 'anonymous', method: 'GET', path: '/modules/companions/content/conversation?profile=bunny'}, response => refusedWith(response, 401, 'unauthenticated'))),
    expect('reader cannot stage an answer', answers({as: 'reader', method: 'POST', path: '/api/v2/modules/companions/upload?family=assistant-input&target=assistant&requestId=assistant-reader&name=input.json', headers: {'content-type': 'application/octet-stream'}, body: {}}, response => refusedWith(response, 403, 'forbidden'))),
    act('operator explicitly answers the saved question', h => assistantInput(h, 'assistant-answer', true)),
    expect('answer receipt means answer saved', h => recorded(h, 'assistant-answer', 'succeeded', 'observed')),
    expect('completion independently reports three model calls and one read', h => {const task = assistant(h)?.tasks[0]; return task?.status === 'succeeded' && task.modelCalls === 3 && task.toolCalls === 1 || 'completion differs';}),
    expect('public state, operations and logs contain no conversation text', h => !JSON.stringify([h.published(), h.logs()]).includes('SYNTHETIC_ASSISTANT_') || 'private text escaped'),
    expect('Reachy remains disabled and no lifecycle impersonation exists', h => state(h)?.settings.enabled === false && state(h)?.presentation === null || 'Reachy changed'),
  ],
}, {
  id: 'assistant-mode-approval', title: 'an explicit owner request changes the Hub mode once through the tracked dispatcher',
  seed: {modules: ['core', 'companions'], sections: {companions: {assistant: {tools: ['read_sessions', 'set_mode']}}}, follows: [{owner: 'bunny/core', families: ['session', 'mode', 'operation', 'inbox-item']},
    {owner: 'bunny/modules/companions', families: ['assistant-state']}]},
  steps: [
    expect('the synthetic provider and both permitted tools are public, the Hub starts in Free', h => {
      const current = assistant(h); return current?.provider === 'synthetic' && current.tools.join(',') === 'read_sessions,set_mode' && hubMode(h)?.mode === 'free' || 'defaults differ';
    }),
    act('operator explicitly enables the conversation', h => dispatchOnce(h, 'operator', 'approval-enable', {key: 'bunny.cmd.assistant-control.assistant', draft: {
      type: 'org.bunny.assistant.control.requested', subject: 'assistant', dataschema: 'https://bunny.invalid/events/assistant-control/2.0',
      data: {action: 'enable', expectedRevision: assistant(h)?.revision}}}, 'approval-enable')),
    expect('the enable control is durably observed', h => recorded(h, 'approval-enable', 'succeeded', 'observed')),
    act('operator asks for quiet mode', h => assistantInput(h, 'direct-mode-start', false, 'Please set the Hub mode to quiet')),
    expect('one tracked mode-set requested by the module completes and the Hub is quiet', h => {
      const operations = modeOperations(h); return operations.length === 1 && operations[0]?.status === 'completed' && operations[0].result === 'succeeded' && hubMode(h)?.mode === 'quiet' || `operations ${String(operations.length)}, mode ${hubMode(h)?.mode ?? 'unknown'}`;
    }, 10_000),
    expect('the task reports the accepted command without claiming a device effect', answers(CONVERSATION, response => response.status === 200 && JSON.stringify(bodyOf(response)).includes('accepted by the core, outcome tracked separately: accepted') && !JSON.stringify(bodyOf(response)).includes('applied: accepted') || 'result text differs')),
    expect('public state, operations and logs contain no conversation text', h => !JSON.stringify([h.published(), h.logs()]).includes('SYNTHETIC_ASSISTANT_') || 'private text escaped'),
    expect('no approval card is saved for the direct request', answers(CONVERSATION, response =>
      !JSON.stringify(bodyOf(response)).includes('"kind":"approval"') || 'direct mode asked for approval')),
    act('wait for the turn before requesting mode status', async h => {
      for (let n = 0; n < 300 && assistant(h)?.tasks[0]?.status !== 'succeeded'; n += 1) await new Promise(resolve => setTimeout(resolve, 10));
      await assistantInput(h, 'status-does-not-dispatch', false, 'Is the Hub in work mode?');
    }),
    expect('a model suggestion in response to a status question does not change mode', answers(CONVERSATION, response =>
      JSON.stringify(bodyOf(response)).includes('refused: this control needs a clear current owner request') || 'status was not refused')),
    holds('there is still just one mode selection', h => modeOperations(h).length === 1 && hubMode(h)?.mode === 'quiet' || 'a status question changed mode', 300),
  ],
}, {
  id: 'assistant-lifx', title: 'Conversation reads status and controls only the named simulated LIFX bulb',
  seed: {modules: ['core', 'lifx', 'companions'],
    config: {lifx: {bulbs: [
      {id: 'desk-lamp', address: '192.0.2.40', vendor: 1, product: 27, firmwareMajor: 2, firmwareMinor: 90},
      {id: 'side-lamp', address: '192.0.2.41', vendor: 1, product: 27, firmwareMajor: 2, firmwareMinor: 90},
    ]}},
    sections: {companions: {assistant: {tools: ['read_lifx', 'set_lifx_power', 'set_lifx_brightness']}}},
    follows: [{owner: 'bunny/core', families: ['operation']}, {owner: 'bunny/modules/lifx', families: ['device']},
      {owner: 'bunny/modules/companions', families: ['assistant-state']}]},
  steps: [
    expect('both bulbs have observations', h => h.reader.states<DeviceRecord>('device', 'bunny/modules/lifx').filter(record =>
      record.data.availability === 'available' && record.data.observed.status === 'known').length === 2 || 'two bulb observations required'),
    act('enable Conversation', h => dispatchOnce(h, 'operator', 'lifx-assistant-enable', {key: 'bunny.cmd.assistant-control.assistant', draft: {
      type: 'org.bunny.assistant.control.requested', subject: 'assistant', dataschema: 'https://bunny.invalid/events/assistant-control/2.0',
      data: {action: 'enable', expectedRevision: assistant(h)?.revision}}}, 'lifx-assistant-enable')),
    expect('Conversation is enabled', h => assistant(h)?.enabled === true || 'disabled'),
    act('ask about the desk lamp', h => assistantInput(h, 'lifx-assistant-read', false, 'SYNTHETIC_LIFX status desk-lamp')),
    expect('Conversation reports observed power and brightness', answers(CONVERSATION, response =>
      response.status === 200 && JSON.stringify(bodyOf(response)).includes('Observed power: on') &&
      JSON.stringify(bodyOf(response)).includes('Observed brightness:') || 'LIFX status tool result missing')),
    expect('the read completes', h => assistant(h)?.tasks[0]?.status === 'succeeded' || 'read still running'),
    act('ask to turn off the desk lamp', h => assistantInput(h, 'lifx-assistant-power', false, 'Turn off desk-lamp')),
    expect('one power change reaches the selected bulb', h => lifxOperations(h).filter(record =>
      record.target === 'desk-lamp' && record.family === 'power-set' && record.result === 'succeeded').length === 1 || 'power not tracked'),
    expect('the power turn completes', h => assistant(h)?.tasks[0]?.status === 'succeeded' || 'power still running'),
    act('ask to set desk-lamp brightness', h => assistantInput(h, 'lifx-assistant-brightness', false, 'Set desk-lamp brightness to 30%')),
    expect('both requested actions completed on the selected bulb once', h => {
      const records = lifxOperations(h);
      return records.length === 2 && records.every(record => record.target === 'desk-lamp' && record.result === 'succeeded') || 'tracked actions differ';
    }),
    expect('the brightness turn completes', h => assistant(h)?.tasks[0]?.status === 'succeeded' || 'brightness still running'),
    act('ask for an invalid brightness', h => assistantInput(h, 'lifx-invalid', false, 'Set desk-lamp brightness to 101%')),
    expect('Conversation refuses the invalid value', answers(CONVERSATION, response =>
      JSON.stringify(bodyOf(response)).includes('refused: invalid-request; no light change was proposed') || 'invalid value was not refused')),
    expect('the invalid turn completes', h => assistant(h)?.tasks[0]?.status === 'succeeded' || 'invalid turn still running'),
    act('ask whether the side lamp is in quiet mode', h => assistantInput(h, 'lifx-status-never-writes', false, 'SYNTHETIC_LIFX status side-lamp')),
    expect('the read completes without a new device operation', h => assistant(h)?.tasks[0]?.status === 'succeeded' && lifxOperations(h).length === 2 || 'read caused work'),
    act('restart the simulated runtime after the explicit setting', h => {
      assistantSyncsBeforeRestart.set(h, h.reader.syncs('assistant-state', 'bunny/modules/companions'));
      return h.restart();
    }),
    expect('the simulated light and Conversation are both synced after restart', h =>
      h.reader.syncs('assistant-state', 'bunny/modules/companions') > (assistantSyncsBeforeRestart.get(h) ?? Number.MAX_SAFE_INTEGER) &&
      h.reader.states<DeviceRecord>('device', 'bunny/modules/lifx').some(record => record.data.id === 'desk-lamp' && record.data.availability === 'available') || 'not synced after restart'),
    holds('the settled restart does not replay either control', h => lifxOperations(h).length === 2 || 'a command was replayed', 250),
    act('a bulb becomes unreachable after a previously available observation', async h => {
      await h.wait(31_000);
      await h.simulate({device: 'lifx', action: 'offline', address: '192.0.2.40'});
    }),
    expect('the copied bulb is still available before anyone requests a refresh', h =>
      h.reader.states<DeviceRecord>('device', 'bunny/modules/lifx').some(({data}) => data.id === 'desk-lamp' && data.availability === 'available') || 'the owner already observed the change'),
    act('ask Conversation to read the bulb again', h => assistantInput(h, 'lifx-refresh-read', false, 'SYNTHETIC_LIFX status desk-lamp')),
    expect('the explicit read prompts LIFX to discover the loss of availability', h =>
      h.reader.states<DeviceRecord>('device', 'bunny/modules/lifx').some(({data}) => data.id === 'desk-lamp' && data.availability === 'unavailable') || 'the read did not prompt an observation'),
    expect('the read reports uncertainty without a new operation', answers(RECENT_CONVERSATION, response =>
      JSON.stringify(bodyOf(response)).includes('Last reported availability: unavailable') || 'updated availability missing')),
    expect('status alone dispatched nothing', h => lifxOperations(h).length === 2 || 'reading dispatched a device command'),
  ],
}, {
  id: 'assistant-wemo', title: 'Conversation directly sets Wemo power while the existing maximum-on limit stays in force',
  seed: {modules: ['core', 'wemo', 'companions'], sections: {wemo: WEMO_SIMULATED_SECTION,
    companions: {assistant: {tools: ['read_wemo', 'set_wemo_power']}}},
    follows: [{owner: 'bunny/core', families: ['operation', 'power-limit']}, {owner: 'bunny/modules/wemo', families: ['device']},
      {owner: 'bunny/modules/companions', families: ['assistant-state']}]},
  steps: [
    expect('both plugs report available power', h => h.reader.states<DeviceRecord>('device', 'bunny/modules/wemo').filter(record =>
      record.data.availability === 'available' && record.data.observed.status === 'known').length === 2 || 'two plug observations required'),
    act('enable Conversation', h => dispatchOnce(h, 'operator', 'wemo-assistant-enable', {key: 'bunny.cmd.assistant-control.assistant', draft: {
      type: 'org.bunny.assistant.control.requested', subject: 'assistant', dataschema: 'https://bunny.invalid/events/assistant-control/2.0',
      data: {action: 'enable', expectedRevision: assistant(h)?.revision}}}, 'wemo-assistant-enable')),
    expect('Conversation is enabled', h => assistant(h)?.enabled === true || 'disabled'),
    act('ask about the first plug', h => assistantInput(h, 'wemo-assistant-read', false, 'SYNTHETIC_WEMO status desk-lamp')),
    expect('Conversation reports the observed power', answers(RECENT_CONVERSATION, response =>
      JSON.stringify(bodyOf(response)).includes('Observed power: off') || 'Wemo status evidence missing')),
    expect('the read completes without a write', h => assistant(h)?.tasks[0]?.status === 'succeeded' && wemoEffects(h, 'desk-lamp')?.writes === 0 || 'read wrote power'),
    expect('the owner saves a short synthetic maximum-on limit', answers({as: 'operator', method: 'PUT',
      path: '/api/v2/automation/power-limits/desk-lamp', headers: {'bunny-request': '1'},
      body: {enabled: true, durationMs: 1000, expectedSettingsRevision: 0}}, response =>
      response.status === 200 && bodyOf<PowerLimitRecord>(response)?.enabled === true || 'limit save refused')),
    act('ask to turn the first plug on', h => assistantInput(h, 'wemo-assistant-on', false, 'Turn on desk-lamp')),
    expect('only the selected plug is switched on once', h => wemoEffects(h, 'desk-lamp')?.power === true &&
      wemoEffects(h, 'desk-lamp')?.writes === 1 && wemoEffects(h, 'shelf-lamp')?.writes === 0 || 'power reached the wrong plug'),
    expect('core tracks a successful Wemo power transmission', h => h.reader.states<OperationRecord>('operation').some(({data}) =>
      data.family === 'power-set' && data.target === 'desk-lamp' && data.requestedBy === 'bunny/modules/companions' &&
      data.result === 'succeeded' && data.evidence === 'transmitted') || 'missing tracked result'),
    act('allow the power observation and automatic shutoff', h => h.wait(6200)),
    expect('the existing limit switches off the plug exactly once', h => wemoEffects(h, 'desk-lamp')?.power === false &&
      wemoEffects(h, 'desk-lamp')?.writes === 2 && wemoEffects(h, 'shelf-lamp')?.writes === 0 || 'maximum-on behavior changed'),
    expect('the first power turn completes', h => assistant(h)?.tasks[0]?.status === 'succeeded' || 'assistant still working'),
    act('ask to turn the second plug on', h => assistantInput(h, 'wemo-assistant-shelf-on', false, 'Turn on shelf-lamp')),
    expect('second plug on succeeds', h => assistant(h)?.tasks[0]?.status === 'succeeded' && wemoEffects(h, 'shelf-lamp')?.power === true || 'power on missing'),
    act('ask to turn the second plug off after its state publication', async h => {
      await h.wait(100);
      await assistantInput(h, 'wemo-assistant-shelf-off', false, 'Turn off shelf-lamp');
    }),
    expect('the explicit off request reaches only the second plug once', h => wemoEffects(h, 'shelf-lamp')?.power === false &&
      wemoEffects(h, 'shelf-lamp')?.writes === 2 && wemoEffects(h, 'desk-lamp')?.writes === 2 || 'power off missed the selected plug'),
    expect('the off turn completes', h => assistant(h)?.tasks[0]?.status === 'succeeded' || 'assistant still working'),
    act('restart after the second plug is confirmed off', h => {
      assistantSyncsBeforeRestart.set(h, h.reader.syncs('assistant-state', 'bunny/modules/companions'));
      return h.restart();
    }),
    expect('the assistant and new plug generation are visible', h =>
      h.reader.syncs('assistant-state', 'bunny/modules/companions') > (assistantSyncsBeforeRestart.get(h) ?? Number.MAX_SAFE_INTEGER) &&
      h.reader.states<DeviceRecord>('device', 'bunny/modules/wemo').some(({data}) => data.id === 'shelf-lamp' && data.availability === 'available') || 'restart readback missing'),
    expect('no power command repeats after restart', h => wemoEffects(h, 'shelf-lamp')?.writes === 2 &&
      wemoEffects(h, 'desk-lamp')?.writes === 2 || 'a power command repeated'),
  ],
}, {
  id: 'assistant-device-catalog', title: 'Conversation uses the installed device owner and exposes read-only status without misrouting writes',
  seed: {modules: ['core', 'lifx', 'companions', 'roborock', 'volcano'],
    config: {lifx: LIFX_SIMULATED_SECTION}, sections: {roborock: {id: 'vacuum'}, volcano: VOLCANO_SIMULATED_SECTION,
      companions: {assistant: {tools: ['read_devices', 'read_roborock', 'read_volcano', 'control_lifx_color_set',
        'control_power_set', 'control_volcano_session_gap']}}},
    follows: [{owner: 'bunny/core', families: ['operation']}, {owner: 'bunny/modules/lifx', families: ['device', 'lifx-light']},
      {owner: 'bunny/modules/volcano', families: ['volcano-status']}, {owner: 'bunny/modules/companions', families: ['assistant-state']}]},
  steps: [
    expect('the catalog owners are running', h => running(h, ['core', 'lifx', 'companions', 'roborock', 'volcano'])),
    act('enable Conversation', h => enableAssistant(h, 'catalog-enable')),
    expect('Conversation is enabled', h => assistant(h)?.enabled === true || 'assistant disabled'),
    act('read the configured vacuum', h => catalogInput(h, 'catalog-vacuum', 'read_roborock', {})),
    expect('the scoped observation returns the vacuum', conversationAnswer((response, h) =>
      catalogFinished(h) && JSON.stringify(bodyOf(response)).includes('vacuum') || 'vacuum observation missing')),
    act('try to route generic power to the vacuum', h => catalogInput(h, 'catalog-vacuum-power', 'control_power_set',
      {owner: 'bunny/modules/roborock', target: 'vacuum', arguments: '{"on":true}'})),
    expect('the vacuum capability is refused without a tracked device operation', conversationAnswer((response, h) =>
      catalogFinished(h) && JSON.stringify(bodyOf(response)).includes('unsupported-capability') && catalogOperations(h).length === 0 || 'vacuum write escaped')),
    act('set the Volcano software gap', h => catalogControlInput(h, 'catalog-volcano', 'volcano-session-gap', 'volcano', {gapMinutes: 30})),
    expect('the Volcano owner reports the updated gap', h => catalogFinished(h) &&
      h.reader.states<VolcanoStatus>('volcano-status', 'bunny/modules/volcano')[0]?.data.gapMinutes === 30 || 'software update missing'),
    expect('the LIFX owner has a qualified available bulb', h => h.reader.states<DeviceRecord>('device', 'bunny/modules/lifx')
      .some(({data}) => data.id === LIFX_SIMULATED_SECTION.bulbs[0]?.id && data.availability === 'available') || 'light unavailable'),
    act('read the LIFX color capabilities by owner', h => catalogInput(h, 'catalog-lifx-discovery', 'read_devices',
      {owner: 'bunny/modules/lifx', target: LIFX_SIMULATED_SECTION.bulbs[0]?.id})),
    expect('discovery labels the color evidence and lists the allowed qualified control', conversationAnswer((response, h) => {
      const output = JSON.stringify(bodyOf(response));
      return catalogFinished(h) && output.includes('freshness') && output.includes('control_lifx_color_set') && output.includes('color') ||
        'qualified color evidence or tool missing';
    })),
    act('set the exact LIFX hue and saturation', h => catalogControlInput(h, 'catalog-lifx-color', 'lifx-color-set',
      LIFX_SIMULATED_SECTION.bulbs[0]?.id ?? 'device', {hue: 120, saturation: 60})),
    expect('the LIFX owner reports one tracked color transmission', h => catalogOperations(h).some(record =>
      record.family === 'lifx-color-set' && record.target === LIFX_SIMULATED_SECTION.bulbs[0]?.id &&
      record.evidence === 'transmitted' && record.result === 'succeeded') || 'color transmission missing'),
  ],
}, {
  id: 'assistant-light-show', title: 'Conversation authors and saves an immutable light-show version and generation-bound playback',
  seed: {modules: ['core', 'nanoleaf', 'companions'], config: {nanoleaf: NANOLEAF_SECTION}, sections: {
    companions: {assistant: {tools: ['create_light_show_draft', 'edit_light_show_cue', 'preview_light_show_draft', 'save_light_show',
      'read_light_shows', 'control_music_lighting_control']}},
  }, follows: [{owner: 'bunny/core', families: ['operation', 'music-lighting-state']},
    {owner: 'bunny/modules/nanoleaf', families: ['device', 'nanoleaf-shows', 'nanoleaf-wall']}, {owner: 'bunny/modules/companions', families: ['assistant-state']}]},
  steps: [
    expect('Conversation and Nanoleaf are available', h => running(h, ['core', 'nanoleaf', 'companions'])),
    expect('the show catalog is available', h => showCatalog(h) !== undefined || 'no show catalog'),
    act('enable Conversation', h => enableAssistant(h, 'show-enable')),
    expect('Conversation is enabled', h => assistant(h)?.enabled === true || 'assistant disabled'),
    act('create a named warm draft', h => catalogInput(h, 'show-create', 'create_light_show_draft', {name: 'Dawn test', starter: 'warm'})),
    expect('the draft is retained without a device operation', conversationAnswer((response, h) => {
      const text = JSON.stringify(bodyOf(response));
      const id = /show-[0-9a-f-]{36}/.exec(text)?.[0];
      if (id !== undefined) draftIds.set(h, id);
      return id !== undefined && text.includes('Preview only') && catalogFinished(h) &&
        showOperations(h).length === 0 || 'draft preview missing or wrote lighting';
    })),
    act('edit the opening cue intensity', h => catalogInput(h, 'show-edit', 'edit_light_show_cue', {
      draftId: draftIds.get(h), revision: 1, cue: 'opening', changes: '{"intensity":0.25}',
    })),
    expect('the revised draft returns its new cue with no lighting effect', conversationAnswer((response, h) =>
      JSON.stringify(bodyOf(response)).includes('intensity 0.25') && catalogFinished(h) &&
      showOperations(h).length === 0 || 'edited cue missing or dispatched work')),
    act('preview the edited draft', h => catalogInput(h, 'show-preview', 'preview_light_show_draft', {draftId: draftIds.get(h)})),
    expect('preview sends no lighting command', h => catalogFinished(h) && showOperations(h).length === 0 || 'preview wrote lighting'),
    act('try to play the unsaved draft', h => catalogControlInput(h, 'show-unsaved', 'music-lighting-control', 'wall',
      {action: 'start-show', showId: draftIds.get(h), version: 1, positionMs: 0, startDelayMs: 0})),
    expect('unsaved playback is refused without work', conversationAnswer((response, h) =>
      JSON.stringify(bodyOf(response)).includes('refused: not-found') && catalogFinished(h) &&
      showOperations(h).length === 0 || 'unsaved show was not refused')),
    act('request saving the exact draft', h => saveShow(h, 'show-save', 'First')),
    expect('the requested immutable version is stored without a lighting operation', h => showCatalog(h)?.shows.some(show =>
      show.id === draftIds.get(h) && show.versions[0]?.version === 1 && show.versions[0]?.versionName === 'First') === true &&
      catalogFinished(h) && showOperations(h).every(record => record.family === 'nanoleaf-show-save') || 'save missing or played lighting'),
    act('the owner saves a different version from the existing catalog', h => dispatchOnce(h, 'operator', 'show-other-save', {
      key: 'bunny.cmd.nanoleaf-show-save.shows', draft: {type: 'org.bunny.nanoleaf-show.save.requested', subject: 'shows',
        dataschema: 'https://bunny.invalid/events/nanoleaf-show-save/2.0', data: {showId: draftIds.get(h), expectedVersion: 1,
          name: 'Dawn test', versionName: 'Independent edit', timeline: {version: 1, durationMs: 30000,
            cues: [{id: 'cue', offsetMs: 0, durationMs: 30000, recipe: {preset: 'ocean'}, intensity: 0.5}]}}}}, 'show-other-save')),
    expect('the independent version is retained', h => showCatalog(h)?.shows[0]?.version === 2 || 'second catalog version missing'),
    act('request a fresh explicit save of the draft as a new version', h => saveShow(h, 'show-save-fresh', 'Third version')),
    expect('all three immutable versions remain selectable', h => {
      const versions = showCatalog(h)?.shows[0]?.versions;
      return catalogFinished(h) && versions?.map(version => version.versionName).join('|') === 'First|Independent edit|Third version' ||
        'an earlier version or the new save is missing';
    }),
    act('the owner puts the simulated wall in Free mode', h => dispatchOnce(h, 'operator', 'show-free-mode', {
      key: 'bunny.cmd.device-mode-set.wall', draft: {type: 'org.bunny.device-mode.set.requested', subject: 'wall',
        dataschema: 'https://bunny.invalid/events/device-mode-set/2.0', data: {mode: 'free'}}}, 'show-free-mode')),
    expect('the wall enters Free mode', h => recorded(h, 'show-free-mode', 'succeeded', 'observed')),
    expect('the worker finishes the Free base and saves the layout', h => {
      const wall = h.reader.states<{layout: string; mode: string; modePending: boolean}>('nanoleaf-wall', 'bunny/modules/nanoleaf')[0]?.data;
      return wall?.layout === 'saved' && wall.mode === 'free' && !wall.modePending || 'Free base is not ready';
    }, 15_000),
    act('request version one on the wall', h => catalogControlInput(h, 'show-play', 'music-lighting-control', 'wall',
      {action: 'start-show', showId: draftIds.get(h), version: 1, positionMs: 0, startDelayMs: 250})),
    expect('the selected wall plays the requested immutable version', h => {
      const session = lightingState(h)?.session;
      return session?.status === 'active' && 'show' in session && session.show.showId === draftIds.get(h) &&
        session.show.version === 1 && catalogFinished(h) || `saved show did not start: ${JSON.stringify(lightingState(h))}`;
    }),
    act('request that the active wall session stop', h => catalogControlInput(h, 'show-stop', 'music-lighting-control', 'wall', {action: 'stop'})),
    expect('the session owner stops playback and reports restoration', h => lightingState(h)?.session.status === 'idle' &&
      lightingState(h)?.last?.reason === 'stopped' && lightingState(h)?.last?.restoration === 'restored' || 'stop result missing'),
  ],
}];

function conversationAnswer(check: (response: GatewayAnswer, h: Harness) => true | string) {
  return async (h: Harness): Promise<true | string> => check(await h.gateway(RECENT_CONVERSATION), h);
}
const draftIds = new WeakMap<Harness, string>();
const showCatalog = (h: Harness): ShowCatalog | undefined => h.reader.states<ShowCatalog>('nanoleaf-shows', 'bunny/modules/nanoleaf')[0]?.data;
const catalogOperations = (h: Harness): OperationRecord[] => h.reader.states<OperationRecord>('operation', 'bunny/core').map(({data}) => data)
  .filter(record => record.requestedBy === 'bunny/modules/companions');
const showOperations = (h: Harness): OperationRecord[] => h.reader.states<OperationRecord>('operation', 'bunny/core').map(message => message.data)
  .filter(record => ['music-lighting-control', 'music-lighting-work', 'nanoleaf-show-save'].includes(record.family));
const lightingState = (h: Harness): LightingState | undefined => h.reader.states<LightingState>('music-lighting-state', 'bunny/core').find(message => message.subject === 'wall')?.data;
const saveShow = (h: Harness, requestId: string, version: string) => {
  priorTask.set(h, assistant(h)?.tasks[0]?.taskId);
  return assistantInput(h, requestId, false, `Save draft Dawn test (${draftIds.get(h) ?? 'missing'}) revision 2 as ${version}`);
};

export const enableAssistant = (h: Harness, id: string) => dispatchOnce(h, 'operator', id, {key: 'bunny.cmd.assistant-control.assistant', draft: {
  type: 'org.bunny.assistant.control.requested', subject: 'assistant', dataschema: 'https://bunny.invalid/events/assistant-control/2.0',
  data: {action: 'enable', expectedRevision: assistant(h)?.revision}}}, id);
const priorTask = new WeakMap<Harness, string | undefined>();
export const catalogFinished = (h: Harness): boolean => {
  const task = assistant(h)?.tasks[0];
  return task?.status === 'succeeded' && task.taskId !== priorTask.get(h);
};
export function catalogInput(h: Harness, requestId: string, name: string, input: object): Promise<void> {
  priorTask.set(h, assistant(h)?.tasks[0]?.taskId);
  return assistantInput(h, requestId, false, `SYNTHETIC_CATALOG ${JSON.stringify({name, input})}`);
}

export function catalogControlInput(h: Harness, requestId: string, family: string, target: string, fields: object): Promise<void> {
  priorTask.set(h, assistant(h)?.tasks[0]?.taskId);
  return assistantInput(h, requestId, false, `Run ${family} on ${target} with ${JSON.stringify(fields)}`);
}

const wemoEffects = (h: Harness, target: string) => deviceState<Record<string, {power: boolean; writes: number}>>(h, 'wemo')[target];

const lifxOperations = (h: Harness): OperationRecord[] => h.reader.states<OperationRecord>('operation').map(record => record.data)
  .filter(record => record.requestedBy === 'bunny/modules/companions' && (record.family === 'power-set' || record.family === 'brightness-set'));

const assistant = (h: Harness): AssistantState | undefined => h.reader.states<AssistantState>('assistant-state', 'bunny/modules/companions')[0]?.data;
export async function assistantInput(h: Harness, requestId: string, answer = false, text = answer ? 'SYNTHETIC_ASSISTANT_ANSWER' : 'SYNTHETIC_ASSISTANT_PROMPT'): Promise<void> {
  const state = assistant(h), task = state?.tasks[0];
  const query = new URLSearchParams({family: 'assistant-input', target: 'assistant', requestId, name: 'input.json'});
  const result = await h.gateway({as: 'operator', method: 'POST', path: `/api/v2/modules/companions/upload?${query}`, headers: {'content-type': 'application/octet-stream'},
    body: {action: answer ? 'answer' : 'start', profile: 'bunny', text,
      expectedRevision: state?.revision, ...(answer ? {taskId: task?.taskId, questionId: task?.questionId} : {})}});
  if (result.status !== 200) throw new StepFailure(`synthetic assistant input returned ${String(result.status)}`);
}
const hubMode = (h: Harness): ModeState | undefined => h.reader.states<ModeState>('mode').map(state => state.data).find(record => record.id === 'hub');
const modeOperations = (h: Harness): OperationRecord[] => h.reader.states<OperationRecord>('operation').map(state => state.data).filter(record => record.family === 'mode-set' && record.requestedBy === 'bunny/modules/companions');

export const runs: Readonly<Record<string, ModuleRun>> = {
  'browser-speech': {
    description: 'The simulated shipped runtime with private synthetic browser speech qualification',
    prepare: async dataDir => {
      const directory = join(dataDir, 'state', 'modules', 'companions');
      await mkdir(directory, {recursive: true, mode: 0o700});
      const file = join(directory, 'speech-qualification.json');
      await writeFile(file, JSON.stringify({schema: 'browser-speech-qualification/1.0', browserVersion: '150.0.0.1', platform: 'macos',
        qualifiedAt: '2026-10-24T12:00:00.000Z', voice: {name: 'Synthetic local English', lang: 'en-US', voiceURI: 'synthetic-local'}}), {mode: 0o600});
      await chmod(file, 0o600);
    },
  },
};
