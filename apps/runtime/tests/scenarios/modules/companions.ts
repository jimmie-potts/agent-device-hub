import {chmod, mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {knowledgeScenarios} from '../knowledge.js';
import {preferenceScenarios} from '../preferences.js';
import type {AssistantState} from '@jimmie-potts/event-contracts/v2/assistant';
import type {ModeState, OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {CompanionState} from '@jimmie-potts/event-contracts/v2/companions';
import {approvalPrompt, approvalResolved, sessionStarted, turnEnded, turnStarted} from '../../fixtures/agents.js';
import {StepFailure, act, answered, answers, bodyOf, dispatchOnce, expect, holds, publish, recorded, refusedWith, running, waiting, type Harness, type ModuleRun, type Scenario} from '../framework.js';
const state = (h: Harness): CompanionState | undefined => h.reader.states<CompanionState>('companion-state', 'bunny/modules/companions')[0]?.data;
const assistantSyncsBeforeRestart = new WeakMap<Harness, number>();
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
  seed: {modules: ['core', 'companions'], sections: {companions: {assistant: {tools: ['read_sessions', 'set_mode']}}}, follows: [{owner: 'bunny/core', families: ['session', 'mode', 'operation']},
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
  ],
}];


const assistant = (h: Harness): AssistantState | undefined => h.reader.states<AssistantState>('assistant-state', 'bunny/modules/companions')[0]?.data;
async function assistantInput(h: Harness, requestId: string, answer = false, text = answer ? 'SYNTHETIC_ASSISTANT_ANSWER' : 'SYNTHETIC_ASSISTANT_PROMPT'): Promise<void> {
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
