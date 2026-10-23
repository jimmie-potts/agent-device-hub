import type {CompanionArchive, ContextDocument, DuckWidget, KnowledgeView} from '@jimmie-potts/companions';
import {StepFailure, act, answers, bodyOf, expect, recorded, refusedWith, running, type Harness, type Scenario} from './framework.js';
const endpoint = '/modules/companions/content/';
const upload = (requestId: string): string => `/api/v2/modules/companions/upload?${new URLSearchParams({family: 'assistant-input', target: 'knowledge', requestId, name: 'knowledge.json'})}`;
/** Replacement client uses only the authenticated public document boundary. */
class ReplacementClient {
  constructor(readonly h: Harness) {}
  async read<T>(ref: string, query: Record<string, string> = {}): Promise<T> {
    const response = await this.h.gateway({as: 'reader', method: 'GET', path: `${endpoint}${ref}?${new URLSearchParams(query)}`});
    if (response.status !== 200) throw new StepFailure('private companion read refused'); return bodyOf(response) as T;
  }
  context(profile: string, conversationId?: string, messages?: string): Promise<ContextDocument> {
    const query: Record<string, string> = {profile, ...(conversationId === undefined ? {} : {conversationId})};
    const selected = messages === undefined ? [] : messages.split(',');
    for (let index = 0; index < selected.length; index += 3) query[index === 0 ? 'messages' : `messages${index / 3 + 1}`] = selected.slice(index, index + 3).join(',');
    return this.read('companion-context', query);
  }
}
type Answer = {persona: string; records: string[]; text: string; audioRule: string};
const records = (context: ContextDocument): string[] => [...context.knowledge.map(value => `${value.id}:${value.text}`), ...context.preferences.map(value => `${value.id}:${value.text}`),
  ...context.messages.map(value => `${value.messageId}:${value.revision}:${JSON.stringify(value.meaning)}`)];
/** Deliberately different fake interfaces and prose; neither has a provider or audio transport. */
const modelA = (context: ContextDocument, question: string): Answer => ({persona: context.persona.id, records: records(context),
  text: `${context.persona.character} Synthetic answer A: ${question}`, audioRule: context.persona.audio});
const modelB = {ask: (question: string, input: ContextDocument): Answer => ({persona: input.persona.id, records: records(input),
  text: `Synthetic B / ${question} / ${input.persona.character}`, audioRule: input.persona.audio})};
const fakeAudio = (answer: Answer, sound: string): boolean => answer.audioRule !== 'quacks-only' || /^(quack[ !]*)+$/i.test(sound);
const saved = new WeakMap<Harness, {archive: CompanionArchive; conversationId: string; messageId: string; removedId: string; knowledgeId: string}>();
async function change(h: Harness, requestId: string, input: object): Promise<void> {
  const view = await new ReplacementClient(h).read<KnowledgeView>('knowledge', {view: 'manage'});
  const response = await h.gateway({as: 'operator', method: 'POST', path: upload(requestId), headers: {'content-type': 'application/octet-stream'}, body: {...input, expectedRevision: view.revision}});
  if (response.status !== 200) throw new StepFailure('companion change refused');
}
export const knowledgeScenarios: readonly Scenario[] = [{id: 'companion-knowledge', title: 'explicit companion context and attributed history survive public client substitution and recovery',
  seed: {modules: ['core', 'companions'], follows: [{owner: 'bunny/core', families: ['operation']}, {owner: 'bunny/modules/companions', families: ['assistant-state', 'preference-state']}]},
  steps: [
    expect('core and companions running', h => running(h, ['core', 'companions'])),
    ...['knowledge', 'companion-profiles', 'companion-history', 'companion-context', 'companion-archive', 'duck-widget'].map(ref => expect(`anonymous ${ref} denied`, answers({as: 'anonymous', method: 'GET', path: `${endpoint}${ref}`}, response => refusedWith(response, 401, 'unauthenticated')))),
    expect('reader cannot change companion content', answers({as: 'reader', method: 'POST', path: upload('knowledge-reader'), headers: {'content-type': 'application/octet-stream'}, body: {}}, response => refusedWith(response, 403, 'forbidden'))),
    act('owner explicitly saves synthetic knowledge', h => change(h, 'knowledge-create', {action: 'create', title: 'Synthetic household', text: 'SYNTHETIC_KNOWLEDGE_OLD'})),
    expect('knowledge write completes', h => recorded(h, 'knowledge-create', 'succeeded', 'observed')),
    act('owner explicitly creates fictional exchange', h => change(h, 'knowledge-fixture', {action: 'fixture'})),
    expect('fixture write completes', h => recorded(h, 'knowledge-fixture', 'succeeded', 'observed')),
    act('replacement client exports current source data', async h => {
      const archive = await new ReplacementClient(h).read<CompanionArchive>('companion-archive');
      const conversationId = archive.conversations[0]?.id, messageId = archive.messages[1]?.messageId, removedId = archive.messages[3]?.messageId, knowledgeId = archive.knowledge[0]?.id;
      if (conversationId === undefined || messageId === undefined || removedId === undefined || knowledgeId === undefined) throw new StepFailure('missing explicit fixture');
      saved.set(h, {archive, conversationId, messageId, removedId, knowledgeId});
    }),
    expect('a newly created conversation is not automatically selected for Home', async h => (await new ReplacementClient(h).read<DuckWidget>('duck-widget')).conversation === null || 'Home was selected implicitly'),
    act('owner selects one explicit Reachy Duck conversation', async h => {
      const state = saved.get(h); if (state === undefined) throw new StepFailure('missing fixture');
      await change(h, 'duck-selection', {action: 'select-duck-conversation', conversationId: state.conversationId});
    }),
    expect('selection completes durably', h => recorded(h, 'duck-selection', 'succeeded', 'observed')),
    expect('widget reads one latest Duck message while history retains both speakers', async h => {
      const client = new ReplacementClient(h), latest = await client.read<DuckWidget>('duck-widget'), history = await client.read<DuckWidget>('duck-widget', {view: 'history'});
      return latest.conversation?.id === saved.get(h)?.conversationId && latest.messages.length === 1 && latest.messages[0]?.messageId === saved.get(h)?.removedId && history.messages.length === 4 || 'selected latest/history differs';
    }),
    expect('two fake adapters preserve records across three curated personas', async h => {
      const client = new ReplacementClient(h), characters = new Set<string>();
      for (const profile of ['bunny', 'reachy', 'microduck']) {
        const context = await client.context(profile); characters.add(context.persona.character);
        if (context.knowledge.length !== 1 || context.messages.length !== 0 || context.persona.voiceRef !== null) return 'current explicit context differs';
        for (const question of ['What was explicitly saved?', 'What conversation was selected?']) {
          const a = modelA(context, question), b = modelB.ask(question, context);
          if (JSON.stringify(a.records) !== JSON.stringify(b.records) || a.text === b.text || a.persona !== profile || a.audioRule !== b.audioRule) return 'adapter portability differs';
          if (profile === 'microduck' && (fakeAudio(a, 'English speech') || fakeAudio(b, 'English speech') || !fakeAudio(a, 'quack!'))) return 'Duck fake audio admitted English';
        }
      }
      return characters.size === 3 || 'curated personas collapsed';
    }),
    expect('another persona private context is refused', async h => {
      const state = saved.get(h); if (state === undefined) return 'missing fixture';
      const response = await h.gateway({as: 'reader', method: 'GET', path: `${endpoint}companion-context?${new URLSearchParams({profile: 'bunny', conversationId: state.conversationId, messages: state.messageId})}`});
      return refusedWith(response, 403, 'forbidden');
    }),
    expect('unselected sharing destination is refused', answers({as: 'reader', method: 'GET', path: `${endpoint}companion-context?profile=reachy&destination=unselected`}, response => refusedWith(response, 403, 'forbidden'))),
    act('owner deactivates knowledge and corrects selected meaning', async h => {
      const state = saved.get(h); if (state === undefined) throw new StepFailure('missing fixture');
      await change(h, 'knowledge-stop', {action: 'set-active', id: state.knowledgeId, active: false});
      await change(h, 'knowledge-correct', {action: 'correct-message', messageId: state.messageId, meaning: {kind: 'unknown'}});
      await change(h, 'knowledge-remove', {action: 'delete-message', messageId: state.removedId});
    }),
    expect('latest current reads preserve unknown meaning and never recall removed content', async h => {
      const state = saved.get(h); if (state === undefined) return 'missing fixture';
      const context = await new ReplacementClient(h).context('microduck', state.conversationId, `${state.messageId},${state.removedId}`);
      return context.knowledge.length === 0 && context.messages.length === 1 && context.messages[0]?.revision === 2 && context.messages[0].meaning.kind === 'unknown' &&
        modelA(context, 'What remains?').records.join() === modelB.ask('What remains?', context).records.join() || 'current context stale';
    }),
    act('old archive is imported then the source owner restarts', async h => {
      await change(h, 'knowledge-old-import', {action: 'import-archive', archive: saved.get(h)?.archive}); await h.restart();
    }),
    expect('replacement client still reads corrected and removed state after restart', async h => {
      const state = saved.get(h); if (state === undefined) return 'missing fixture';
      const archive = await new ReplacementClient(h).read<CompanionArchive>('companion-archive');
      return archive.knowledge[0]?.active === false && archive.messages.find(value => value.messageId === state.messageId)?.meaning.kind === 'unknown' &&
        !archive.messages.some(value => value.messageId === state.removedId) && archive.removals.some(value => value.messageId === state.removedId) || 'restart/import changed retained state';
    }),
    expect('widget selection survives restart with the corrected previous Duck message', async h => {
      const latest = await new ReplacementClient(h).read<DuckWidget>('duck-widget');
      return latest.conversation?.id === saved.get(h)?.conversationId && latest.messages.length === 1 && latest.messages[0]?.messageId === saved.get(h)?.messageId && latest.messages[0]?.meaning.kind === 'unknown' || 'widget resurrected or reselected content';
    }),
    act('owner imports sixteen historical messages for explicit context selection', async h => {
      const archive = await new ReplacementClient(h).read<CompanionArchive>('companion-archive'), template = archive.messages[0];
      if (template === undefined) throw new StepFailure('missing message template');
      archive.messages.push(...Array.from({length: 16}, (_, index) => ({...template,
        messageId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, ordering: {...template.ordering, sequence: index + 5}})));
      await change(h, 'knowledge-sixteen', {action: 'import-archive', archive});
    }),
    expect('sixteen-message import completes', h => recorded(h, 'knowledge-sixteen', 'succeeded', 'observed')),
    expect('public replacement client can select all sixteen UUID messages', async h => {
      const state = saved.get(h); if (state === undefined) return 'missing conversation';
      const ids = Array.from({length: 16}, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`);
      const context = await new ReplacementClient(h).context('microduck', state.conversationId, ids.join(','));
      return context.messages.length === 16 && context.messages.every((message, index) => message.messageId === ids[index]) || 'bounded selection unavailable';
    }),
    expect('public metadata and diagnostics exclude private prose', h => !JSON.stringify([h.published(), h.logs()]).includes('SYNTHETIC_KNOWLEDGE_') || 'private prose escaped'),
  ],
}];
