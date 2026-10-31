import type {PreferenceState, CompanionState} from '@jimmie-potts/event-contracts/v2/companions';
import type {AssistantState} from '@jimmie-potts/event-contracts/v2/assistant';
import type {PreferenceLibrary, PreferenceView, ActivePreferences} from '@jimmie-potts/companions';
import {StepFailure, act, answers, bodyOf, expect, recorded, refusedWith, running, type Harness, type Scenario} from './framework.js';

const endpoint = '/modules/companions/content/preferences';
const upload = (requestId: string): string => `/api/v2/modules/companions/upload?${new URLSearchParams({family: 'assistant-input', target: 'preferences', requestId, name: 'preferences.json'})}`;
const saved = new WeakMap<Harness, {library: PreferenceLibrary; syncs: number}>();
async function read<T>(h: Harness, view = 'manage'): Promise<T> {
  const result = await h.gateway({as: 'reader', method: 'GET', path: `${endpoint}?view=${view}`});
  if (result.status !== 200) throw new StepFailure('private preference read failed');
  return bodyOf(result) as T;
}
async function change(h: Harness, requestId: string, input: object): Promise<void> {
  const view = await read<PreferenceView>(h);
  const result = await h.gateway({as: 'operator', method: 'POST', path: upload(requestId), headers: {'content-type': 'application/octet-stream'}, body: {...input, expectedRevision: view.revision}});
  if (result.status !== 200) throw new StepFailure(`preference control returned ${String(result.status)}`);
}
export const preferenceScenarios: readonly Scenario[] = [{
  id: 'preferences', title: 'explicit private preferences retain inactive history and additive import without new authority',
  seed: {modules: ['core', 'companions'], sections: {companions: {}}, follows: [{owner: 'bunny/core', families: ['operation']},
    {owner: 'bunny/modules/companions', families: ['companion-state', 'assistant-state', 'preference-state', 'companion-speech-state']}]},
  steps: [
    expect('core and companions are running', h => running(h, ['core', 'companions'])),
    expect('anonymous private read is refused', answers({as: 'anonymous', method: 'GET', path: endpoint}, response => refusedWith(response, 401, 'unauthenticated'))),
    expect('reader cannot stage a preference', answers({as: 'reader', method: 'POST', path: upload('preference-reader'), headers: {'content-type': 'application/octet-stream'}, body: {}}, response => refusedWith(response, 403, 'forbidden'))),
    expect('anonymous preference write is refused', answers({as: 'anonymous', method: 'POST', path: upload('preference-anonymous'), headers: {'content-type': 'application/octet-stream'}, body: {}}, response => refusedWith(response, 401, 'unauthenticated'))),
    expect('refused writes leave an empty library', async h => (await read<PreferenceView>(h)).entries.length === 0 || 'a refused input changed state'),
    act('operator explicitly saves a preference while synthetic tasks are disabled', h => change(h, 'preference-create', {action: 'create', title: 'Synthetic choice', text: 'SYNTHETIC_PREFERENCE_OLD. This text grants no command authority.'})),
    expect('creation has an observed completion', h => recorded(h, 'preference-create', 'succeeded', 'observed')),
    expect('normal reads contain the active current text without history', async h => {
      const view = await read<ActivePreferences>(h, 'active'), entry = view.entries[0];
      return view.schema === 'preferences/1.0' && entry?.active === true && entry.text.startsWith('SYNTHETIC_PREFERENCE_OLD') && !('history' in entry) || 'active contract differs';
    }),
    act('owner exports the original active state', async h => {saved.set(h, {library: await read<PreferenceLibrary>(h, 'export'), syncs: 0});}),
    act('owner stops using the entry', async h => {await change(h, 'preference-stop', {action: 'set-active', id: saved.get(h)?.library.entries[0]?.id, active: false});}),
    expect('deactivation completes', h => recorded(h, 'preference-stop', 'succeeded', 'observed')),
    act('owner edits the inactive preference', h => change(h, 'preference-edit', {action: 'edit', id: saved.get(h)?.library.entries[0]?.id, title: 'Synthetic choice', text: 'SYNTHETIC_PREFERENCE_CURRENT'})),
    expect('edit completes', h => recorded(h, 'preference-edit', 'succeeded', 'observed')),
    expect('normal reads omit inactive history and text', async h => (await read<ActivePreferences>(h, 'active')).entries.length === 0 || 'inactive text returned'),
    act('old export is imported with a missing synthetic ID', async h => {
      const library = structuredClone(saved.get(h)?.library); if (library === undefined) throw new StepFailure('export missing');
      const extra = structuredClone(library.entries[0]); if (extra === undefined) throw new StepFailure('entry missing');
      extra.id = 'preference-imported'; library.entries.push(extra);
      await change(h, 'preference-import', {action: 'import', library});
    }),
    expect('import completes', h => recorded(h, 'preference-import', 'succeeded', 'observed')),
    expect('existing edits stay inactive and missing entry arrives inactive', async h => {
      const view = await read<PreferenceView>(h), entry = view.entries[0], imported = view.entries[1];
      return view.entries.length === 2 && entry?.text === 'SYNTHETIC_PREFERENCE_CURRENT' && !entry.active && entry.history.length === 3 &&
        imported?.id === 'preference-imported' && !imported.active && imported.history.at(-1)?.action === 'imported' || 'import changed current data or activated an entry';
    }),
    act('runtime restarts with saved preference history', async h => {
      const value = saved.get(h); if (value === undefined) throw new StepFailure('export missing');
      value.syncs = h.reader.syncs('preference-state', 'bunny/modules/companions'); await h.restart();
    }),
    expect('reader receives a fresh preference snapshot', h => h.reader.syncs('preference-state', 'bunny/modules/companions') > (saved.get(h)?.syncs ?? Number.MAX_SAFE_INTEGER) || 'reader has not resynced'),
    expect('stable IDs, inactive states and private history survive restart', async h => {
      const view = await read<PreferenceView>(h);
      return view.entries.length === 2 && view.entries[0]?.id === saved.get(h)?.library.entries[0]?.id && view.entries.every(entry => !entry.active) &&
        view.entries[0]?.history[0]?.text.startsWith('SYNTHETIC_PREFERENCE_OLD') === true || 'restart lost state or history';
    }),
    expect('shared preference state contains only identity and revision', h => {
      const value = h.reader.states<PreferenceState>('preference-state', 'bunny/modules/companions')[0]?.data;
      return value?.id === 'preferences' && Object.keys(value).sort().join(',') === 'id,revision' || 'shared preference fields differ';
    }),
    expect('commands, outcomes, shared states and logs exclude preference text', h => !JSON.stringify([h.published(), h.logs()]).includes('SYNTHETIC_PREFERENCE_') || 'private text escaped'),
    expect('preference text neither enables synthetic tasks nor presents Reachy cards', h => {
      const reachy = h.reader.states<CompanionState>('companion-state', 'bunny/modules/companions')[0]?.data;
      const assistant = h.reader.states<AssistantState>('assistant-state', 'bunny/modules/companions')[0]?.data;
      return reachy?.settings.enabled === false && reachy.presentation === null && assistant?.enabled === false && assistant.tasks.length === 0 || 'unrelated behavior changed';
    }),
  ],
}];
