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
import {StepFailure, act, answered, answers, bodyOf, deviceState, dispatchOnce, expect, holds, publish, recorded, refusedWith, running, waiting, type GatewayAnswer, type Harness, type ModuleRun, type Scenario} from '../framework.js';
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
  id: 'assistant-mode-approval', title: 'an approved assistant proposal changes the Hub mode once through the tracked dispatcher; a stale approval is refused',
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
    act('operator asks for quiet mode', h => assistantInput(h, 'approval-start', false, 'SYNTHETIC_ASSISTANT_PLEASE quiet mode')),
    expect('the task waits for the owner with a proposal bound to the current mode revision', answers(CONVERSATION, response =>
      response.status === 200 && JSON.stringify(bodyOf(response)).includes('"kind":"approval"') && JSON.stringify(bodyOf(response)).includes('"mode":"quiet"') || 'proposal missing')),
    expect('no command was sent while the proposal waits', h => modeOperations(h).length === 0 && hubMode(h)?.mode === 'free' || 'a command was sent before approval'),
    act('runtime restarts while the proposal waits', async h => {
      assistantSyncsBeforeRestart.set(h, h.reader.syncs('assistant-state', 'bunny/modules/companions'));
      await h.restart();
    }),
    // The approval names the public revision; it waits for the reader's copy to resync so a restart cannot leave it stale.
    expect('the reader resyncs assistant state after restart', h =>
      h.reader.syncs('assistant-state', 'bunny/modules/companions') > (assistantSyncsBeforeRestart.get(h) ?? Number.MAX_SAFE_INTEGER) || 'the reader has not resynced'),
    holds('restart keeps the proposal and sends nothing', h => assistant(h)?.tasks[0]?.status === 'waiting' && modeOperations(h).length === 0 || 'restart changed the proposal', 100),
    expect('reader cannot approve', answers({as: 'reader', method: 'POST', path: '/api/v2/modules/companions/upload?family=assistant-input&target=assistant&requestId=approval-reader&name=input.json', headers: {'content-type': 'application/octet-stream'}, body: {}}, response => refusedWith(response, 403, 'forbidden'))),
    act('operator explicitly approves', h => assistantInput(h, 'approval-yes', true, 'approve')),
    expect('one tracked mode-set requested by the module completes and the Hub is quiet', h => {
      const operations = modeOperations(h); return operations.length === 1 && operations[0]?.status === 'completed' && operations[0].result === 'succeeded' && hubMode(h)?.mode === 'quiet' || `operations ${String(operations.length)}, mode ${hubMode(h)?.mode ?? 'unknown'}`;
    }, 10_000),
    expect('the task reports the accepted command without claiming a device effect', answers(CONVERSATION, response => response.status === 200 && JSON.stringify(bodyOf(response)).includes('accepted by the core, outcome tracked separately: accepted') && !JSON.stringify(bodyOf(response)).includes('applied: accepted') || 'result text differs')),
    expect('public state, operations and logs contain no conversation text', h => !JSON.stringify([h.published(), h.logs()]).includes('SYNTHETIC_ASSISTANT_') || 'private text escaped'),
    act('operator asks for work mode, then changes the mode by hand before deciding', async h => {
      for (let n = 0; n < 300 && assistant(h)?.tasks[0]?.status !== 'succeeded'; n += 1) await new Promise(resolve => setTimeout(resolve, 10));
      await assistantInput(h, 'stale-start', false, 'SYNTHETIC_ASSISTANT_PLEASE work mode');
      for (let n = 0; n < 300 && assistant(h)?.tasks[0]?.status !== 'waiting'; n += 1) await new Promise(resolve => setTimeout(resolve, 10));
      await dispatchOnce(h, 'operator', 'stale-manual', modeSet('work'), 'stale-manual');
    }),
    expect('the manual selection was accepted and the Hub is Work', h => answered(h, 'stale-manual', 'accepted') === true && hubMode(h)?.mode === 'work' || `mode ${hubMode(h)?.mode ?? 'unknown'}`),
    act('operator approves the stale proposal', h => assistantInput(h, 'stale-yes', true, 'approve')),
    expect('the stale approval is refused by the core and reported, with no second command', h => {
      const task = assistant(h)?.tasks[0], operations = modeOperations(h);
      return task?.status === 'succeeded' && operations.length === 2 && operations.some(record => record.status === 'rejected') && hubMode(h)?.mode === 'work' || `status ${task?.status ?? 'none'}, operations ${String(operations.length)}`;
    }, 10_000),
    expect('the conversation names the refusal', answers(CONVERSATION, response => response.status === 200 && JSON.stringify(bodyOf(response)).includes('refused: revision-conflict') || 'refusal text missing')),
    expect('the reply explains that the mode changed since the proposal', answers(CONVERSATION, response =>
      JSON.stringify(bodyOf(response)).includes('the Hub mode changed since this was proposed; nothing was changed') || 'explanation missing')),
    // #1657 (AC3): Send again could never repeat a stale revision, so the refusal stays in history and opens no item.
    holds('the stale refusal opens no inbox item', h => {
      const rejected = modeOperations(h).find(record => record.status === 'rejected');
      return rejected !== undefined && h.reader.states('inbox-item').length === 0 || `rejected ${String(rejected?.requestId)}, inbox ${String(h.reader.states('inbox-item').length)}`;
    }, 300),
  ],
}, {
  id: 'assistant-lifx', title: 'Conversation reads status and controls only the approved simulated LIFX bulb',
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
    act('ask to turn off the desk lamp', h => assistantInput(h, 'lifx-assistant-power', false, 'SYNTHETIC_LIFX power desk-lamp off')),
    expect('power awaits approval', answers(CONVERSATION, response => JSON.stringify(bodyOf(response)).includes('"family":"power-set"') || 'power proposal missing')),
    expect('no device command is tracked before approval', h => lifxOperations(h).length === 0 || 'a device command escaped approval'),
    act('approve power', h => assistantInput(h, 'lifx-assistant-power-yes', true, 'approve')),
    expect('one power change reaches the selected bulb', h => lifxOperations(h).filter(record =>
      record.target === 'desk-lamp' && record.family === 'power-set' && record.result === 'succeeded').length === 1 || 'power not tracked'),
    expect('the power turn completes', h => assistant(h)?.tasks[0]?.status === 'succeeded' || 'power still running'),
    act('ask to set desk-lamp brightness', h => assistantInput(h, 'lifx-assistant-brightness', false, 'SYNTHETIC_LIFX brightness desk-lamp 30')),
    expect('brightness awaits approval', answers(CONVERSATION, response => JSON.stringify(bodyOf(response)).includes('"percent":30') || 'brightness proposal missing')),
    act('approve brightness', h => assistantInput(h, 'lifx-assistant-brightness-yes', true, 'approve')),
    expect('both approved actions completed on the selected bulb once', h => {
      const records = lifxOperations(h);
      return records.length === 2 && records.every(record => record.target === 'desk-lamp' && record.result === 'succeeded') || 'tracked actions differ';
    }),
    expect('the brightness turn completes', h => assistant(h)?.tasks[0]?.status === 'succeeded' || 'brightness still running'),
    act('ask for an invalid brightness', h => assistantInput(h, 'lifx-invalid', false, 'SYNTHETIC_LIFX brightness desk-lamp 101')),
    expect('Conversation refuses the invalid value', answers(CONVERSATION, response =>
      JSON.stringify(bodyOf(response)).includes('refused: invalid-request; no light change was proposed') || 'invalid value was not refused')),
    expect('the invalid turn completes', h => assistant(h)?.tasks[0]?.status === 'succeeded' || 'invalid turn still running'),
    act('request power on for the side lamp', h => assistantInput(h, 'lifx-decline', false, 'SYNTHETIC_LIFX power side-lamp on')),
    expect('the side lamp proposal waits', h => assistant(h)?.tasks[0]?.status === 'waiting' || 'proposal did not wait'),
    act('decline the side lamp proposal', h => assistantInput(h, 'lifx-declined', true, 'decline')),
    expect('the decline completes without a new device operation', h => assistant(h)?.tasks[0]?.status === 'succeeded' && lifxOperations(h).length === 2 || 'decline caused work'),
    act('ask to change brightness again', h => assistantInput(h, 'lifx-stale', false, 'SYNTHETIC_LIFX brightness desk-lamp 45')),
    expect('the brightness proposal waits', h => assistant(h)?.tasks[0]?.status === 'waiting' || 'proposal did not wait'),
    act('the owner changes the desk lamp through the dispatcher', h => dispatchOnce(h, 'operator', 'lifx-manual-write', {
      key: 'bunny.cmd.power-set.desk-lamp', draft: {type: 'org.bunny.power.set.requested', subject: 'desk-lamp',
        dataschema: 'https://bunny.invalid/events/power-set/2.0', data: {on: true}}}, 'lifx-manual-write')),
    expect('the manual write completed', h => recorded(h, 'lifx-manual-write', 'succeeded', 'transmitted')),
    act('approve the original proposal', h => assistantInput(h, 'lifx-stale-yes', true, 'approve')),
    expect('the stale approval does not send another light command', h => assistant(h)?.tasks[0]?.status === 'succeeded' && lifxOperations(h).length === 2 || 'stale approval caused work'),
    expect('Conversation explains the stale approval', answers(RECENT_CONVERSATION, response => JSON.stringify(bodyOf(response)).includes('refused: revision-conflict') || 'stale refusal missing')),
    act('ask for power off again', h => assistantInput(h, 'lifx-before-restart', false, 'SYNTHETIC_LIFX power desk-lamp off')),
    expect('the power proposal waits', h => assistant(h)?.tasks[0]?.status === 'waiting' || 'proposal did not wait'),
    act('restart the simulated runtime while approval is pending', h => {
      assistantSyncsBeforeRestart.set(h, h.reader.syncs('assistant-state', 'bunny/modules/companions'));
      return h.restart();
    }),
    expect('the same pending proposal still exists', answers(RECENT_CONVERSATION, response =>
      JSON.stringify(bodyOf(response)).includes('"family":"power-set"') || 'approval was lost')),
    expect('the simulated light and Conversation are both synced after restart', h =>
      h.reader.syncs('assistant-state', 'bunny/modules/companions') > (assistantSyncsBeforeRestart.get(h) ?? Number.MAX_SAFE_INTEGER) &&
      h.reader.states<DeviceRecord>('device', 'bunny/modules/lifx').some(record => record.data.id === 'desk-lamp' && record.data.availability === 'available')
      && assistant(h)?.tasks[0]?.status === 'waiting' || 'not synced after restart'),
    act('approve against the previous device generation', h => assistantInput(h, 'lifx-old-generation', true, 'approve')),
    expect('the previous generation does not cause another command', h => assistant(h)?.tasks[0]?.status === 'succeeded' &&
      lifxOperations(h).length === 2 || 'the old generation caused work'),
    expect('Conversation records refusal after restart', answers(RECENT_CONVERSATION, response => JSON.stringify(bodyOf(response)).includes('refused: revision-conflict') || 'stale generation refusal missing')),
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
  id: 'assistant-wemo', title: 'Conversation approves Wemo power while the existing maximum-on limit stays in force',
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
    act('ask to turn the first plug on', h => assistantInput(h, 'wemo-assistant-on', false, 'SYNTHETIC_WEMO power desk-lamp on')),
    expect('the exact plug and effect await approval', answers(RECENT_CONVERSATION, response => {
      const history = JSON.stringify(bodyOf(response));
      return history.includes('"owner":"bunny/modules/wemo"') && history.includes('"target":"desk-lamp"') && history.includes('"on":true') || 'Wemo proposal missing';
    })),
    expect('there is no effect before approval', h => wemoEffects(h, 'desk-lamp')?.writes === 0 || 'unapproved effect'),
    act('approve Wemo power on', h => assistantInput(h, 'wemo-assistant-on-yes', true, 'approve')),
    expect('only the selected plug is switched on once', h => wemoEffects(h, 'desk-lamp')?.power === true &&
      wemoEffects(h, 'desk-lamp')?.writes === 1 && wemoEffects(h, 'shelf-lamp')?.writes === 0 || 'power reached the wrong plug'),
    expect('core tracks a successful Wemo power transmission', h => h.reader.states<OperationRecord>('operation').some(({data}) =>
      data.family === 'power-set' && data.target === 'desk-lamp' && data.requestedBy === 'bunny/modules/companions' &&
      data.result === 'succeeded' && data.evidence === 'transmitted') || 'missing tracked result'),
    act('allow the power observation and automatic shutoff', h => h.wait(6200)),
    expect('the existing limit switches off the plug exactly once', h => wemoEffects(h, 'desk-lamp')?.power === false &&
      wemoEffects(h, 'desk-lamp')?.writes === 2 && wemoEffects(h, 'shelf-lamp')?.writes === 0 || 'maximum-on behavior changed'),
    expect('the first power turn completes', h => assistant(h)?.tasks[0]?.status === 'succeeded' || 'assistant still working'),
    act('ask to turn the second plug on', h => assistantInput(h, 'wemo-assistant-shelf-on', false, 'SYNTHETIC_WEMO power shelf-lamp on')),
    expect('the second plug on approval waits', h => assistant(h)?.tasks[0]?.status === 'waiting' || 'second plug proposal missing'),
    act('approve Wemo power on for the second plug', h => assistantInput(h, 'wemo-assistant-shelf-on-yes', true, 'approve')),
    expect('second plug on succeeds', h => assistant(h)?.tasks[0]?.status === 'succeeded' && wemoEffects(h, 'shelf-lamp')?.power === true || 'power on missing'),
    act('ask to turn the second plug off', h => assistantInput(h, 'wemo-assistant-shelf-off', false, 'SYNTHETIC_WEMO power shelf-lamp off')),
    expect('the unchanged second plug awaits the off approval', h => assistant(h)?.tasks[0]?.status === 'waiting' &&
      wemoEffects(h, 'shelf-lamp')?.writes === 1 || 'unapproved power off'),
    act('approve Wemo power off for the second plug', h => assistantInput(h, 'wemo-assistant-shelf-off-yes', true, 'approve')),
    expect('the approved off reaches only the second plug once', h => wemoEffects(h, 'shelf-lamp')?.power === false &&
      wemoEffects(h, 'shelf-lamp')?.writes === 2 && wemoEffects(h, 'desk-lamp')?.writes === 2 || 'power off missed the selected plug'),
    expect('the off turn completes', h => assistant(h)?.tasks[0]?.status === 'succeeded' || 'assistant still working'),
    act('ask to turn the second plug on again', h => assistantInput(h, 'wemo-assistant-old', false, 'SYNTHETIC_WEMO power shelf-lamp on')),
    expect('the on approval waits', h => assistant(h)?.tasks[0]?.status === 'waiting' || 'second plug proposal missing'),
    act('restart before approval', h => {
      assistantSyncsBeforeRestart.set(h, h.reader.syncs('assistant-state', 'bunny/modules/companions'));
      return h.restart();
    }),
    expect('the proposal and new plug generation are visible', h =>
      h.reader.syncs('assistant-state', 'bunny/modules/companions') > (assistantSyncsBeforeRestart.get(h) ?? Number.MAX_SAFE_INTEGER) &&
      h.reader.states<DeviceRecord>('device', 'bunny/modules/wemo').some(({data}) => data.id === 'shelf-lamp' && data.availability === 'available') &&
      assistant(h)?.tasks[0]?.status === 'waiting' || 'restart readback missing'),
    act('approve against the previous Wemo generation', h => assistantInput(h, 'wemo-assistant-old-yes', true, 'approve')),
    expect('Conversation refuses the old generation', answers(RECENT_CONVERSATION, response =>
      JSON.stringify(bodyOf(response)).includes('refused: revision-conflict') || 'stale Wemo approval was not refused')),
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
    act('propose the Volcano software gap setting', h => catalogInput(h, 'catalog-volcano', 'control_volcano_session_gap',
      {owner: 'bunny/modules/volcano', target: 'volcano', arguments: '{"gapMinutes":30}'})),
    expect('the software setting awaits approval', h => assistant(h)?.tasks[0]?.status === 'waiting' && catalogOperations(h).length === 0 || 'gap was dispatched early'),
    act('approve the session gap without operating the device', h => assistantInput(h, 'catalog-volcano-approve', true, 'approve')),
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
    act('propose using the LIFX color contract', h => catalogInput(h, 'catalog-lifx-color', 'control_lifx_color_set',
      {owner: 'bunny/modules/lifx', target: LIFX_SIMULATED_SECTION.bulbs[0]?.id, arguments: '{"hue":120,"saturation":60}'})),
    expect('the color proposal awaits approval', h => assistant(h)?.tasks[0]?.status === 'waiting' &&
      catalogOperations(h).length === 1 || 'color was not safely proposed'),
    act('approve the exact color change', h => assistantInput(h, 'catalog-lifx-approve', true, 'approve')),
    expect('the LIFX owner reports one tracked color transmission', h => catalogOperations(h).some(record =>
      record.family === 'lifx-color-set' && record.target === LIFX_SIMULATED_SECTION.bulbs[0]?.id &&
      record.evidence === 'transmitted' && record.result === 'succeeded') || 'color transmission missing'),
  ],
}, {
  id: 'assistant-light-show', title: 'Conversation authors and approves an immutable light-show version and generation-bound playback',
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
    act('try to play the unsaved draft', h => catalogInput(h, 'show-unsaved', 'control_music_lighting_control',
      lightingInput({action: 'start-show', showId: draftIds.get(h), version: 1}))),
    expect('unsaved playback is refused without work', conversationAnswer((response, h) =>
      JSON.stringify(bodyOf(response)).includes('refused: not-found') && catalogFinished(h) &&
      showOperations(h).length === 0 || 'unsaved show was not refused')),
    act('propose saving the exact draft', h => catalogInput(h, 'show-save', 'save_light_show', {draftId: draftIds.get(h), revision: 2, versionName: 'First'})),
    expect('save awaits approval and the library has no version', h => assistant(h)?.tasks[0]?.status === 'waiting' &&
      showCatalog(h)?.shows.length === 0 || 'premature save'),
    act('approve the catalog save', h => assistantInput(h, 'show-save-approve', true, 'approve')),
    expect('the approved immutable version is stored without a lighting operation', h => showCatalog(h)?.shows.some(show =>
      show.id === draftIds.get(h) && show.versions[0]?.version === 1 && show.versions[0]?.versionName === 'First') === true &&
      catalogFinished(h) && showOperations(h).every(record => record.family === 'nanoleaf-show-save') || 'save missing or played lighting'),
    act('propose a second save against the version Conversation observed', h => catalogInput(h, 'show-save-stale', 'save_light_show',
      {draftId: draftIds.get(h), revision: 2, versionName: 'Stale proposal'})),
    expect('a second save proposal remains pending', h => assistant(h)?.tasks[0]?.status === 'waiting' ||
      'second save did not wait for approval'),
    act('the owner saves a different version from the existing catalog', h => dispatchOnce(h, 'operator', 'show-other-save', {
      key: 'bunny.cmd.nanoleaf-show-save.shows', draft: {type: 'org.bunny.nanoleaf-show.save.requested', subject: 'shows',
        dataschema: 'https://bunny.invalid/events/nanoleaf-show-save/2.0', data: {showId: draftIds.get(h), expectedVersion: 1,
          name: 'Dawn test', versionName: 'Independent edit', timeline: {version: 1, durationMs: 30000,
            cues: [{id: 'cue', offsetMs: 0, durationMs: 30000, recipe: {preset: 'ocean'}, intensity: 0.5}]}}}}, 'show-other-save')),
    expect('the independent version is retained', h => showCatalog(h)?.shows[0]?.version === 2 || 'second catalog version missing'),
    act('approve the stale Conversation save', h => assistantInput(h, 'show-save-stale-approve', true, 'approve')),
    expect('the stale save cannot overwrite the library or play a light', conversationAnswer((response, h) =>
      catalogFinished(h) && JSON.stringify(bodyOf(response)).includes('refused: revision-conflict') &&
      showCatalog(h)?.shows[0]?.version === 2 && showOperations(h).every(record => record.family === 'nanoleaf-show-save')
      || 'stale save escape or lighting operation')),
    act('the owner puts the simulated wall in Free mode', h => dispatchOnce(h, 'operator', 'show-free-mode', {
      key: 'bunny.cmd.device-mode-set.wall', draft: {type: 'org.bunny.device-mode.set.requested', subject: 'wall',
        dataschema: 'https://bunny.invalid/events/device-mode-set/2.0', data: {mode: 'free'}}}, 'show-free-mode')),
    expect('the wall enters Free mode', h => recorded(h, 'show-free-mode', 'succeeded', 'observed')),
    expect('the worker finishes the Free base and saves the layout', h => {
      const wall = h.reader.states<{layout: string; mode: string; modePending: boolean}>('nanoleaf-wall', 'bunny/modules/nanoleaf')[0]?.data;
      return wall?.layout === 'saved' && wall.mode === 'free' && !wall.modePending || 'Free base is not ready';
    }, 15_000),
    act('propose playing version one on the wall', h => catalogInput(h, 'show-play', 'control_music_lighting_control',
      lightingInput({action: 'start-show', showId: draftIds.get(h), version: 1, startDelayMs: 250}))),
    expect('play awaits owner approval', conversationAnswer((response, h) => {
      const text = JSON.stringify(bodyOf(response));
      return assistant(h)?.tasks[0]?.status === 'waiting' && text.includes('"action":"start-show"') && text.includes('"version":1') &&
        lightingState(h)?.session.status === 'idle' || 'safe playback proposal missing';
    })),
    act('approve playing this version', h => assistantInput(h, 'show-play-approve', true, 'approve')),
    expect('the selected wall plays the requested immutable version', h => {
      const session = lightingState(h)?.session;
      return session?.status === 'active' && 'show' in session && session.show.showId === draftIds.get(h) &&
        session.show.version === 1 && catalogFinished(h) || `saved show did not start: ${JSON.stringify(lightingState(h))}`;
    }),
    act('propose stopping the active wall session', h => catalogInput(h, 'show-stop', 'control_music_lighting_control', lightingInput({action: 'stop'}))),
    expect('stop is bound to the active generation', conversationAnswer((response, h) => {
      const session = lightingState(h)?.session;
      return assistant(h)?.tasks[0]?.status === 'waiting' && session !== undefined && session.status !== 'idle' &&
        JSON.stringify(bodyOf(response)).includes(`"generation":"${session.generation}"`) || 'generation-bound stop missing';
    })),
    act('approve stopping this session only', h => assistantInput(h, 'show-stop-approve', true, 'approve')),
    expect('the session owner stops playback and reports restoration', h => lightingState(h)?.session.status === 'idle' &&
      lightingState(h)?.last?.reason === 'stopped' && lightingState(h)?.last?.restoration === 'restored' || 'stop result missing'),
    act('propose playback of the original version again', h => catalogInput(h, 'show-play-stale', 'control_music_lighting_control',
      lightingInput({action: 'start-show', showId: draftIds.get(h), version: 1, startDelayMs: 250}))),
    expect('the new start waits for approval', h => assistant(h)?.tasks[0]?.status === 'waiting' || 'no second approval'),
    act('the operator starts a different saved version through the same playback owner', h => dispatchOnce(h, 'operator', 'show-independent-play', {
      key: 'bunny.cmd.music-lighting-control.wall', draft: {type: 'org.bunny.music-lighting.control.requested', subject: 'wall',
        dataschema: 'https://bunny.invalid/events/music-lighting-control/2.0', data: {
          action: 'start-show', showId: draftIds.get(h), version: 2, positionMs: 0, startDelayMs: 250,
          expectedRevision: lightingState(h)?.revision,
        }}}, 'show-independent-play')),
    expect('the independently started version is active', h => {
      const session = lightingState(h)?.session;
      return session?.status === 'active' && 'show' in session && session.show.version === 2 || 'version two did not start';
    }),
    act('approve the stale start', h => assistantInput(h, 'show-play-stale-approve', true, 'approve')),
    expect('the stale start is refused and cannot replace the active version', conversationAnswer((response, h) => {
      const session = lightingState(h)?.session;
      return catalogFinished(h) && JSON.stringify(bodyOf(response)).includes('refused: revision-conflict') &&
        session?.status === 'active' && 'show' in session && session.show.version === 2 || 'stale start displaced or missed version two';
    })),
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
const lightingInput = (data: object) => ({owner: 'bunny/core', target: 'wall', arguments: JSON.stringify(data)});

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
const modeSet = (mode: string) => ({key: 'bunny.cmd.mode-set.hub', draft: {type: 'org.bunny.mode.set.requested', subject: 'hub', dataschema: 'https://bunny.invalid/events/mode-set/2.0', data: {mode}}});

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
