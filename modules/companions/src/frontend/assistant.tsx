import React, {useEffect, useState} from 'react';
import type {AssistantProfile, AssistantState} from '@jimmie-potts/event-contracts/v2/assistant';
import type {FrontendCommand, FrontendContext} from '@jimmie-potts/sdk/frontend';

// Browser-local wire types: importing the database-backed store would include Node code.
type Message = {seq: number; taskId: string; role: 'owner' | 'assistant' | 'tool'; text: string; atMs: number};
type CurrentTask = {taskId: string; question: {id: string; text: string; answer: string | null} | null};
type Page = {version: 1; conversationId: string | null; messages: Message[]; next: number | null; currentTask: CurrentTask | null};
const profiles: Readonly<Record<AssistantProfile, string>> = {bunny: 'B.U.N.N.Y.', reachy: 'Reachy', microduck: 'MicroDuck'};
const finished = (status: string): boolean => ['succeeded', 'failed', 'cancelled'].includes(status);
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function pageValue(value: unknown, after: number): Page {
  if (!record(value) || value.version !== 1 || !(value.conversationId === null || typeof value.conversationId === 'string') ||
    !Array.isArray(value.messages) || !(value.next === null || integer(value.next)) ||
    new TextEncoder().encode(JSON.stringify(value)).byteLength > 65_536) throw new Error('Invalid conversation page');
  const current = value.currentTask;
  if (!(current === null || (record(current) && typeof current.taskId === 'string' && (current.question === null ||
    (record(current.question) && typeof current.question.id === 'string' && typeof current.question.text === 'string' &&
      (current.question.answer === null || typeof current.question.answer === 'string')))))) throw new Error('Invalid current task');
  let previous = after;
  for (const message of value.messages) {
    if (!record(message) || !integer(message.seq) || message.seq <= previous || typeof message.taskId !== 'string' ||
      !['owner', 'assistant', 'tool'].includes(String(message.role)) || typeof message.text !== 'string' || !integer(message.atMs)) throw new Error('Invalid conversation message');
    previous = message.seq;
  }
  if (value.next !== null && (value.messages.length === 0 || value.next !== previous)) throw new Error('Invalid conversation cursor');
  return value as Page;
}

function TaskControls({context, command, state, profile, live}: {
  context: FrontendContext; command: FrontendCommand; state: AssistantState; profile: AssistantProfile; live: boolean;
}): React.JSX.Element {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const task = state.tasks.find(value => value.profile === profile);
  const unfinished = state.tasks.find(value => !finished(value.status));
  const draftKey = `${profile}:${task?.questionId !== null && task?.questionId !== undefined && !task.hasAnswer ? task.questionId : 'start'}`;
  const draft = drafts[draftKey] ?? '';
  const bytes = new TextEncoder().encode(draft).byteLength;
  const locked = command.locked || !live || !context.control || !context.operationsLive;
  const answer = task !== undefined && task.questionId !== null && !task.hasAnswer && ['waiting', 'paused'].includes(task.status);
  const control = (action: 'enable' | 'disable' | 'resume' | 'cancel', taskId?: string): void => {
    const requestId = crypto.randomUUID();
    void command.run({family: 'assistant-control', target: 'assistant', requestId,
      data: {action, expectedRevision: state.revision, ...(taskId === undefined ? {} : {taskId})}});
  };
  const submit = (): void => {
    if (locked || !state.enabled || draft.trim() === '' || bytes > 4096 || (!answer && unfinished !== undefined)) return;
    // Command retains this identity before staging. The draft remains on refusals and uncertain replies.
    const requestId = crypto.randomUUID();
    const input = {action: answer ? 'answer' : 'start', profile, text: draft, expectedRevision: state.revision,
      ...(answer ? {taskId: task.taskId, questionId: task.questionId} : {})};
    void command.run({family: 'assistant-input', target: 'assistant', requestId,
      upload: {name: 'input.json', file: new Blob([JSON.stringify(input)], {type: 'application/json'})}});
  };
  return <>
    <fieldset disabled={locked}><legend>Synthetic task controls</legend>
      <button type="button" aria-pressed={state.enabled} disabled={state.enabled && unfinished !== undefined}
        onClick={() => {control(state.enabled ? 'disable' : 'enable');}}>{state.enabled ? 'Disable' : 'Enable'} synthetic tasks</button>
      {unfinished !== undefined && <p>One task can remain unfinished across all profiles. Finish or cancel it before starting another or disabling synthetic tasks.</p>}
      <form onSubmit={event => {event.preventDefault(); submit();}}>
        <label htmlFor="assistant-input">{answer ? 'Clarification answer' : 'Task text'}</label>
        <textarea id="assistant-input" rows={4} value={draft} aria-describedby="assistant-input-help"
          style={{width: '100%', maxWidth: '100%', boxSizing: 'border-box'}}
          onChange={event => {setDrafts(previous => ({...previous, [draftKey]: event.target.value}));}}/>
        <p id="assistant-input-help">{bytes} / 4096 UTF-8 bytes. Drafts stay in this page until reload. Submitted text is saved privately.</p>
        {bytes > 4096 && <p role="alert">Shorten the text to 4096 UTF-8 bytes.</p>}
        <button type="submit" disabled={!state.enabled || draft.trim() === '' || bytes > 4096 || (!answer && unfinished !== undefined)}>
          {answer ? 'Save answer and continue' : 'Start synthetic task'}</button>
      </form>
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
  const currentQuestion = visibleHistory?.currentTask?.taskId === task?.taskId ? visibleHistory?.currentTask?.question : undefined;
  const {Command, Facts, Badge} = context.ui;
  return <section aria-label="Synthetic tasks" className="panel">
    <h2>Synthetic tasks</h2>
    <p>A private text workflow with fake model and read-tool calls. It makes no paid calls, speech or physical actions. Activation defaults to off.</p>
    <label htmlFor="assistant-profile">Companion profile</label>
    <select id="assistant-profile" value={profile} onChange={event => {setProfile(event.target.value as AssistantProfile); setPages(1);}}>
      {Object.entries(profiles).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
    {!connected ? <p role="status">Disconnected. Saved history remains readable; task status may be stale and controls are unavailable.</p>
      : !live && <p role="status">Synthetic tasks are unavailable. Saved history remains readable.</p>}
    {!context.control && <p>Read-only access. Controls require operator authority.</p>}
    <h3>Current task</h3>
    {task === undefined ? <p>No task saved for {profiles[profile]}.</p> : <>
      <p role="status">Task status: {task.status}{!live ? ' (last known)' : ''}</p>
      {task.code !== null && <p>Task code: {task.code}</p>}
      {task.questionId !== null && <>
        <p>{task.hasAnswer ? 'Answer saved.' : finished(task.status) ? 'Saved clarification.' : 'A clarification answer is needed.'}</p>
        {currentQuestion?.id === task.questionId && <article aria-label="Saved clarification">
          <p style={{whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}}>{currentQuestion.text}</p>
          {currentQuestion.answer !== null && <p style={{whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}}>Saved answer: {currentQuestion.answer}</p>}
        </article>}
      </>}
      <Facts items={[
        ['Task', task.taskId], ['Conversation', task.conversationId], ['Run', task.runId ?? 'Not active'],
        ['Model calls', `${task.modelCalls} / 4`], ['Read-tool calls', `${task.toolCalls} / 2`], ['Questions', `${task.questions} / 2`],
        ['Active time', `${(task.activeMs / 1000).toFixed(1)} / 120 seconds`],
        ['Fake-model usage', task.usageUnits === null ? 'Unknown' : `${task.usageUnits} units`],
        ['Reserved usage', `${task.reservedUnits} / 8192 units`], ['Paid cost', '0 (synthetic calls)'],
      ]}/>
    </>}
    {state !== undefined && <Command context={context} target="assistant">{command =>
      <TaskControls context={context} command={command} state={state} profile={profile} live={live}/>
    }</Command>}
    <h3>Saved conversation — {profiles[profile]}</h3>
    <Badge>Private saved history</Badge>
    <p role="status">{historyStatus}</p>
    {visibleHistory === undefined || visibleHistory.messages.length === 0 ? <p>No conversation text loaded for this profile.</p> :
      <ol aria-label="Saved conversation messages">
        {visibleHistory.messages.map(message => <li key={message.seq}>
          <article aria-label={`${message.role} message`}>
            <strong>{message.role === 'owner' ? 'You' : message.role === 'tool' ? 'Synthetic read tool' : profiles[profile]}</strong>
            <p style={{whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}}>{message.text}</p>
          </article>
        </li>)}
      </ol>}
    {visibleHistory?.next !== null && visibleHistory?.next !== undefined && <button type="button" disabled={!connected || historyStatus === 'Loading saved conversation.'}
      onClick={() => {setPages(value => value + 1);}}>Load more saved messages</button>}
  </section>;
}
