import React, {useEffect, useState} from 'react';
import type {AssistantProfile, AssistantState} from '@jimmie-potts/event-contracts/v2/assistant';
import type {FrontendCommand, FrontendContext} from '@jimmie-potts/sdk/frontend';
import {LIMITS} from '../assistant/limits.js';

// Browser-local wire types: importing the database-backed store would include Node code.
type Message = {seq: number; taskId: string; role: 'owner' | 'assistant' | 'tool'; text: string; atMs: number};
type Proposal = {family: string; target: string; data: {mode: string}; expectedRevision: number};
type Question = {id: string; text: string; answer: string | null; kind: 'clarification' | 'approval'; proposal: Proposal | null};
type CurrentTask = {taskId: string; question: Question | null};
type Page = {version: 1; conversationId: string | null; messages: Message[]; next: number | null; currentTask: CurrentTask | null};
const profiles: Readonly<Record<AssistantProfile, string>> = {bunny: 'B.U.N.N.Y.', reachy: 'Reachy', microduck: 'MicroDuck'};
/** The engine's per-task bounds, shown beside each counter, from the module's shared constants. */
const BOUNDS = {modelCalls: LIMITS.modelCalls, toolCalls: LIMITS.toolCalls, questions: LIMITS.questions, activeSeconds: LIMITS.activeMs / 1000, units: LIMITS.units};
/** Every tool the section may allow; a name missing from the state's `tools` is shown as unavailable. */
const CATALOG = ['read_sessions', 'set_mode'];
const finished = (status: string): boolean => ['succeeded', 'failed', 'cancelled'].includes(status);
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function questionValue(value: unknown): Question | null {
  if (value === null) return null;
  if (!record(value) || typeof value.id !== 'string' || typeof value.text !== 'string' || !(value.answer === null || typeof value.answer === 'string') ||
    !['clarification', 'approval'].includes(String(value.kind))) throw new Error('Invalid question');
  const proposal = value.proposal ?? null;
  if (proposal !== null && !(record(proposal) && typeof proposal.family === 'string' && typeof proposal.target === 'string' && record(proposal.data) &&
    typeof proposal.data.mode === 'string' && integer(proposal.expectedRevision))) throw new Error('Invalid proposal');
  return {id: value.id, text: value.text, answer: value.answer, kind: value.kind as Question['kind'], proposal: proposal as Proposal | null};
}
function pageValue(value: unknown, after: number): Page {
  if (!record(value) || value.version !== 1 || !(value.conversationId === null || typeof value.conversationId === 'string') ||
    !Array.isArray(value.messages) || !(value.next === null || integer(value.next)) ||
    new TextEncoder().encode(JSON.stringify(value)).byteLength > 65_536) throw new Error('Invalid conversation page');
  const current = value.currentTask;
  const taskId = current === null ? null : record(current) && typeof current.taskId === 'string' ? current.taskId : undefined;
  if (taskId === undefined || (current !== null && !record(current))) throw new Error('Invalid current task');
  const currentTask = current === null || taskId === null ? null : {taskId, question: questionValue(current.question)};
  let previous = after;
  for (const message of value.messages) {
    if (!record(message) || !integer(message.seq) || message.seq <= previous || typeof message.taskId !== 'string' ||
      !['owner', 'assistant', 'tool'].includes(String(message.role)) || typeof message.text !== 'string' || !integer(message.atMs)) throw new Error('Invalid conversation message');
    previous = message.seq;
  }
  if (value.next !== null && (value.messages.length === 0 || value.next !== previous)) throw new Error('Invalid conversation cursor');
  return {version: 1, conversationId: value.conversationId, messages: value.messages as Message[], next: value.next, currentTask};
}
const providerLabel = (state: AssistantState): string => state.provider === 'synthetic' ? 'Synthetic (no paid calls)' : `Anthropic · ${state.model}`;

function TaskControls({context, command, state, profile, live, question}: {
  context: FrontendContext; command: FrontendCommand; state: AssistantState; profile: AssistantProfile; live: boolean; question: Question | undefined;
}): React.JSX.Element {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const task = state.tasks.find(value => value.profile === profile);
  const unfinished = state.tasks.find(value => !finished(value.status));
  const pending = task !== undefined && task.questionId !== null && !task.hasAnswer && ['waiting', 'paused'].includes(task.status);
  const approval = pending && question?.kind === 'approval';
  const draftKey = `${profile}:${pending ? task.questionId ?? 'start' : 'start'}`;
  const draft = drafts[draftKey] ?? '';
  const bytes = new TextEncoder().encode(draft).byteLength;
  const locked = command.locked || !live || !context.control || !context.operationsLive;
  const control = (action: 'enable' | 'disable' | 'resume' | 'cancel', taskId?: string): void => {
    const requestId = crypto.randomUUID();
    void command.run({family: 'assistant-control', target: 'assistant', requestId,
      data: {action, expectedRevision: state.revision, ...(taskId === undefined ? {} : {taskId})}});
  };
  const send = (text: string, answer: boolean): void => {
    // Command retains this identity before staging. The draft remains on refusals and uncertain replies.
    const requestId = crypto.randomUUID();
    const input = {action: answer ? 'answer' : 'start', profile, text, expectedRevision: state.revision,
      ...(answer && task !== undefined ? {taskId: task.taskId, questionId: task.questionId} : {})};
    void command.run({family: 'assistant-input', target: 'assistant', requestId,
      upload: {name: 'input.json', file: new Blob([JSON.stringify(input)], {type: 'application/json'})}});
  };
  const submit = (): void => {
    if (locked || !state.enabled || approval || draft.trim() === '' || bytes > 4096 || (!pending && unfinished !== undefined)) return;
    send(draft, pending);
  };
  return <>
    <fieldset disabled={locked}><legend>Conversation controls</legend>
      <button type="button" aria-pressed={state.enabled} disabled={state.enabled && unfinished !== undefined}
        onClick={() => {control(state.enabled ? 'disable' : 'enable');}}>{state.enabled ? 'Disable' : 'Enable'} conversation</button>
      {unfinished !== undefined && <p>One task can remain unfinished across all profiles. Finish or cancel it before sending another message or disabling the conversation.</p>}
      {approval && question?.proposal !== null && question?.proposal !== undefined ? <article aria-label="Proposed command">
        <p>{question.text}</p>
        <p>Command: <code>{question.proposal.family}</code> on <code>{question.proposal.target}</code>, mode <strong>{question.proposal.data.mode}</strong>.
          {' '}Bound to Hub-mode revision {String(question.proposal.expectedRevision)}; a mode changed since then refuses it.</p>
        <button type="button" disabled={!state.enabled} style={{marginInlineEnd: '0.5rem'}} onClick={() => {send('approve', true);}}>Approve proposal</button>
        <button type="button" disabled={!state.enabled} onClick={() => {send('decline', true);}}>Decline proposal</button>
        <p>Approval sends one tracked command; its outcome is reported separately. Declining changes nothing.</p>
      </article> : <form onSubmit={event => {event.preventDefault(); submit();}}>
        <label htmlFor="assistant-input">{pending ? 'Answer' : 'Message'}</label>
        <textarea id="assistant-input" rows={4} value={draft} aria-describedby="assistant-input-help"
          style={{width: '100%', maxWidth: '100%', boxSizing: 'border-box'}}
          onChange={event => {setDrafts(previous => ({...previous, [draftKey]: event.target.value}));}}/>
        <p id="assistant-input-help">{bytes} / 4096 UTF-8 bytes. Drafts stay in this page until reload. Submitted text is saved privately and sent to the selected model.</p>
        {bytes > 4096 && <p role="alert">Shorten the text to 4096 UTF-8 bytes.</p>}
        <button type="submit" disabled={!state.enabled || draft.trim() === '' || bytes > 4096 || (!pending && unfinished !== undefined)}>
          {pending ? 'Save answer and continue' : 'Send message'}</button>
      </form>}
      {task !== undefined && !finished(task.status) && <>
        <button type="button" disabled={!state.enabled || !['paused', 'uncertain', 'waiting'].includes(task.status) || (task.questionId !== null && !task.hasAnswer)}
          onClick={() => {control('resume', task.taskId);}}>Resume task</button>
        <button type="button" onClick={() => {control('cancel', task.taskId);}}>Cancel task</button>
      </>}
    </fieldset>
    <p>Draft text is retained after submission. Review the saved conversation before sending it again.</p>
    <p role="status">Command receipt: {command.text}</p>
    <p>A successful command receipt confirms the control was saved. Task completion is reported separately above.</p>
  </>;
}

export function AssistantPage({context}: {context: FrontendContext}): React.JSX.Element {
  const {api, connected} = context;
  const [state, setState] = useState<AssistantState>();
  const [unavailable, setUnavailable] = useState(true);
  const [profile, setProfile] = useState<AssistantProfile>('bunny');
  const [pages, setPages] = useState(1);
  const [history, setHistory] = useState<{profile: AssistantProfile; messages: Message[]; next: number | null; currentTask: CurrentTask | null}>();
  const [historyStatus, setHistoryStatus] = useState('Loading saved conversation.');
  useEffect(() => {
    if (!connected) return;
    let active = true;
    let close: (() => Promise<void>) | undefined;
    setUnavailable(true);
    void api.sync<AssistantState>(['assistant-state'], change => {
      if (!active) return;
      if (change.type === 'updated' && change.message.data.id === 'assistant') {setState(change.message.data); setUnavailable(false);}
      else if (change.type === 'failed') setUnavailable(true);
    }).then(result => {
      if (result.status !== 'synced') {if (active) setUnavailable(true); return;}
      if (!active) {void result.copy.close(); return;}
      close = () => result.copy.close();
      const current = result.copy.states().find(message => message.data.id === 'assistant');
      if (current !== undefined) {setState(current.data); setUnavailable(false);}
    }, () => {if (active) setUnavailable(true);});
    return () => {active = false; void close?.();};
  }, [api, connected]);
  useEffect(() => {
    if (!connected) return;
    let active = true;
    setHistoryStatus('Loading saved conversation.');
    void (async () => {
      const messages: Message[] = [];
      let after = 0;
      let next: number | null = null;
      let conversationId: string | null | undefined;
      let currentTask: CurrentTask | null = null;
      for (let index = 0; index < pages; index += 1) {
        const page = pageValue(await api.read(`/modules/companions/content/conversation?profile=${profile}&after=${after}`), after);
        if (!active) return;
        if (conversationId !== undefined && conversationId !== page.conversationId) throw new Error('Conversation changed');
        conversationId = page.conversationId;
        messages.push(...page.messages); next = page.next; if (index === 0) currentTask = page.currentTask;
        if (next === null) break;
        after = next;
      }
      if (active) {setHistory({profile, messages, next, currentTask}); setHistoryStatus('Saved conversation loaded.');}
    })().catch(() => {if (active) setHistoryStatus('Saved conversation could not be refreshed. Previously loaded text remains readable.');});
    return () => {active = false;};
  }, [api, connected, profile, pages, state?.revision]);
  const live = connected && !unavailable && state !== undefined && state.available;
  const task = state?.tasks.find(value => value.profile === profile);
  const visibleHistory = history?.profile === profile ? history : undefined;
  const currentQuestion = visibleHistory?.currentTask?.taskId === task?.taskId ? visibleHistory?.currentTask?.question ?? undefined : undefined;
  const synthetic = state === undefined || state.provider === 'synthetic' || profile !== 'bunny';
  const allowed = state?.tools ?? [];
  const unavailableTools = CATALOG.filter(name => !allowed.includes(name)).join(', ');
  const {Command, Facts, Badge} = context.ui;
  return <section aria-label="B.U.N.N.Y. conversation" className="panel">
    <h2>Conversation</h2>
    <p>Talk to B.U.N.N.Y. about coding sessions and the Hub mode. Reads need no approval; every proposed change waits for your explicit approval here. Reachy and MicroDuck keep the synthetic provider. Activation defaults to off.</p>
    <label htmlFor="assistant-profile">Companion profile</label>
    <select id="assistant-profile" value={profile} onChange={event => {setProfile(event.target.value as AssistantProfile); setPages(1);}}>
      {Object.entries(profiles).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
    {state !== undefined && <Facts items={[
      ['Provider', profile === 'bunny' ? providerLabel(state) : 'Synthetic (no paid calls)'],
      ['Allowed tools', allowed.length === 0 ? 'None' : allowed.join(', ')],
      ['Unavailable tools', unavailableTools === '' ? 'None' : unavailableTools],
    ]}/>}
    {!connected ? <p role="status">Disconnected. Saved history remains readable; task status may be stale and controls are unavailable.</p>
      : !live && <p role="status">The conversation is unavailable. Saved history remains readable.</p>}
    {!context.control && <p>Read-only access. Controls require operator authority.</p>}
    <h3>Current task</h3>
    {task === undefined ? <p>No task saved for {profiles[profile]}.</p> : <>
      <p role="status">Task status: {task.status}{!live ? ' (last known)' : ''}</p>
      {task.code !== null && <p>Task code: {task.code}</p>}
      {task.questionId !== null && <>
        <p>{task.hasAnswer ? 'Answer saved.' : finished(task.status) ? 'Saved question.' : currentQuestion?.kind === 'approval' ? 'A proposal is waiting for your decision.' : 'An answer is needed.'}</p>
        {currentQuestion?.id === task.questionId && <article aria-label="Saved question">
          <p style={{whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}}>{currentQuestion.text}</p>
          {currentQuestion.answer !== null && <p style={{whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}}>Saved answer: {currentQuestion.answer}</p>}
        </article>}
      </>}
      <Facts items={[
        ['Task', task.taskId], ['Conversation', task.conversationId], ['Run', task.runId ?? 'Not active'],
        ['Model calls', `${task.modelCalls} / ${BOUNDS.modelCalls}`], ['Tool calls', `${task.toolCalls} / ${BOUNDS.toolCalls}`], ['Questions', `${task.questions} / ${BOUNDS.questions}`],
        ['Active time', `${(task.activeMs / 1000).toFixed(1)} / ${BOUNDS.activeSeconds} seconds`],
        [synthetic ? 'Fake-model usage' : 'Model usage', task.usageUnits === null ? 'Unknown' : `${task.usageUnits} ${synthetic ? 'units' : 'tokens'}`],
        ['Reserved usage', `${task.reservedUnits} / ${BOUNDS.units} ${synthetic ? 'units' : 'tokens'}`],
        ['Paid cost', synthetic ? '0 (synthetic calls)' : 'Unknown here; billed by the provider'],
      ]}/>
    </>}
    {state !== undefined && <Command context={context} target="assistant">{command =>
      <TaskControls context={context} command={command} state={state} profile={profile} live={live} question={currentQuestion}/>
    }</Command>}
    <h3>Saved conversation — {profiles[profile]}</h3>
    <Badge>Private saved history</Badge>
    <p role="status">{historyStatus}</p>
    {visibleHistory === undefined || visibleHistory.messages.length === 0 ? <p>No conversation text loaded for this profile.</p> :
      <ol aria-label="Saved conversation messages">
        {visibleHistory.messages.map(message => <li key={message.seq}>
          <article aria-label={`${message.role} message`}>
            <strong>{message.role === 'owner' ? 'You' : message.role === 'tool' ? 'Tool result' : profiles[profile]}</strong>
            <p style={{whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}}>{message.text}</p>
          </article>
        </li>)}
      </ol>}
    {visibleHistory?.next !== null && visibleHistory?.next !== undefined && <button type="button" disabled={!connected || historyStatus === 'Loading saved conversation.'}
      onClick={() => {setPages(value => value + 1);}}>Load more saved messages</button>}
  </section>;
}
