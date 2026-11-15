import React, {useCallback, useEffect, useRef, useState} from 'react';
import type {AssistantProfile, AssistantState} from '@jimmie-potts/event-contracts/v2/assistant';
import type {CodingState} from '@jimmie-potts/event-contracts/v2/coding';
import type {FrontendCommand, FrontendContext} from '@jimmie-potts/sdk/frontend';
import type {SyncedCopy} from '@jimmie-potts/sdk';
import {LIMITS} from '../assistant/limits.js';
import {SpeechControls, useCompanionSpeechCopy} from './speech.js';

import type {SavedQuestion} from '../assistant/history-contract.js';
import {loadEarlierConversationHistory, refreshConversationHistory, type ConversationHistory} from './conversation-history.js';
import {ConversationTranscript} from './conversation-transcript.js';
import './conversation.css';

const profiles: Readonly<Record<AssistantProfile, string>> = {bunny: 'B.U.N.N.Y.', reachy: 'Reachy', microduck: 'MicroDuck'};
/** The engine's per-task bounds, shown beside each counter, from the module's shared constants. */
const BOUNDS = {modelCalls: LIMITS.modelCalls, toolCalls: LIMITS.toolCalls, questions: LIMITS.questions, activeSeconds: LIMITS.activeMs / 1000, units: LIMITS.units};
/** Every tool the section may allow; a name missing from the state's `tools` is shown as unavailable. */
const CATALOG = ['read_sessions', 'set_mode', 'delegate_coding'];
const finished = (status: string): boolean => ['succeeded', 'failed', 'cancelled'].includes(status);
const providerLabel = (state: AssistantState): string => state.provider === 'synthetic' ? 'Synthetic (no paid calls)' : `Anthropic · ${state.model}`;

function SavedQuestionContext({question}: {question: SavedQuestion}): React.JSX.Element {
  return <article aria-label="Saved question" className="conversation-question">
    <p>{question.text}</p>
    {question.answer !== null && <p>Saved answer: {question.answer}</p>}
  </article>;
}

function TaskControls({context, command, state, profile, live, question, drafts, setDraft, refreshHistory, historyBusy}: {
  context: FrontendContext; command: FrontendCommand; state: AssistantState; profile: AssistantProfile; live: boolean;
  question: SavedQuestion | undefined; drafts: Record<string, string>; setDraft: (key: string, value: string) => void;
  refreshHistory: () => void; historyBusy: boolean;
}): React.JSX.Element {
  const task = state.tasks.find(value => value.profile === profile);
  const unfinished = state.tasks.find(value => !finished(value.status));
  const pending = task !== undefined && task.questionId !== null && !task.hasAnswer && ['waiting', 'paused'].includes(task.status);
  const approval = pending && question?.kind === 'approval';
  const unavailableDecision = pending && (question === undefined || (approval && question.proposal === null));
  const delegated = pending && question?.kind === 'delegation';
  const canResume = task !== undefined && state.enabled && ['paused', 'uncertain', 'waiting'].includes(task.status)
    && (task.questionId === null || task.hasAnswer);
  const draftKey = `${profile}:${pending ? task.questionId ?? 'start' : 'start'}`;
  const draft = drafts[draftKey] ?? '';
  const bytes = new TextEncoder().encode(draft).byteLength;
  const locked = command.locked || !live || !context.control || !context.operationsLive;
  const control = (action: 'resume' | 'cancel', taskId: string): void => {
    const requestId = crypto.randomUUID();
    void command.run({family: 'assistant-control', target: 'assistant', requestId,
      data: {action, expectedRevision: state.revision, taskId}});
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
    if (locked || !state.enabled || unavailableDecision || approval || delegated || draft.trim() === '' || bytes > 4096 || (!pending && unfinished !== undefined)) return;
    send(draft, pending);
  };
  return <>
    {unavailableDecision && <div>
      <p role="status">{approval ? 'The saved proposal is unavailable. Refresh history to continue.' : 'The saved question is unavailable. Refresh history to continue.'}</p>
      <button type="button" className="secondary" disabled={historyBusy || !context.connected} onClick={refreshHistory}>Refresh history</button>
    </div>}
    <fieldset className="conversation-task-controls" aria-label="Conversation controls" disabled={locked}>
      {unavailableDecision ? null : delegated ? <article aria-label="Delegated work">
        <p>{question?.text}</p>
        <p>Waiting for the coding worker on your computer. Its structured result ends this wait; Cancel task asks the worker to stop.</p>
      </article> : approval && question?.proposal !== null && question?.proposal !== undefined ? <article aria-label="Proposed command">
        <strong>Needs approval</strong>
        <p>{question.text}</p>
        {question.proposal.family === 'mode-set'
          ? <p>Command: <code>{question.proposal.family}</code> on <code>{question.proposal.target}</code>, mode <strong>{question.proposal.data.mode}</strong>.
            {' '}Bound to Hub-mode revision {String(question.proposal.expectedRevision)}; a mode changed since then refuses it.</p>
          : <p>Delegation to the coding worker in repository <strong>{question.proposal.data.repository}</strong>, in a fresh worktree with edits, builds and tests allowed and no push.
            {' '}Brief: <span style={{whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}}>{question.proposal.data.brief}</span>.
            {' '}Bound to coding worker revision {String(question.proposal.expectedRevision)}; a worker changed since then refuses it.</p>}
        <button type="button" disabled={!state.enabled} style={{marginInlineEnd: '0.5rem'}} onClick={() => {send('approve', true);}}>Approve proposal</button>
        <button type="button" className="secondary" disabled={!state.enabled} onClick={() => {send('decline', true);}}>Decline proposal</button>
        <p>Approval sends one tracked command; its outcome is reported separately. Declining changes nothing.</p>
      </article> : <form onSubmit={event => {event.preventDefault(); submit();}}>
        <label htmlFor="assistant-input">{pending ? 'Answer' : 'Message'}</label>
        <textarea id="assistant-input" rows={2} value={draft} aria-describedby="assistant-input-help"
          style={{width: '100%', maxWidth: '100%', boxSizing: 'border-box'}}
          onKeyDown={event => {
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
            event.preventDefault();
            if (!event.repeat) submit();
          }}
          onChange={event => {setDraft(draftKey, event.target.value);}}/>
        <div id="assistant-input-help">
          <p>{bytes} / 4096 UTF-8 bytes. Saved privately and sent to the selected model. Drafts remain after sending.</p>
          {bytes > 4096 && <p role="alert">Shorten the text to 4096 UTF-8 bytes.</p>}
        </div>
        <button type="submit" disabled={!state.enabled || draft.trim() === '' || bytes > 4096 || (!pending && unfinished !== undefined)}>
          {pending ? 'Save answer and continue' : 'Send message'}</button>
      </form>}
      {task !== undefined && !finished(task.status) && <div className="conversation-task-actions">
        {canResume && <button type="button" className="secondary" onClick={() => {control('resume', task.taskId);}}>Resume task</button>}
        <button type="button" className="secondary" onClick={() => {control('cancel', task.taskId);}}>Cancel task</button>
      </div>}
    </fieldset>
  </>;
}

type HistoryAttempt = {
  controller: AbortController;
  before: string | undefined;
  refreshAfter: boolean;
};

export function AssistantPage({context}: {context: FrontendContext}): React.JSX.Element {
  const {api, connected} = context;
  const [state, setState] = useState<AssistantState>();
  const [unavailable, setUnavailable] = useState(true);
  const [historyApi, setHistoryApi] = useState<FrontendContext['api']>();
  const [profile, setProfile] = useState<AssistantProfile>('bunny');
  const [history, setHistory] = useState<ConversationHistory>();
  const historyRef = useRef<ConversationHistory>(undefined);
  const historyAttempt = useRef<HistoryAttempt>(undefined);
  const [historyStatus, setHistoryStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const failedCursor = useRef<string>(undefined);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [speakRequest, setSpeakRequest] = useState<string>();
  const [coding, setCoding] = useState<CodingState>();
  const speech = useCompanionSpeechCopy(context);
  useEffect(() => {
    setCoding(undefined);
    if (!connected) return;
    let active = true;
    let copy: SyncedCopy<CodingState> | undefined;
    void api.sync<CodingState>(['coding-state'], change => {
      if (!active) return;
      if (change.type === 'updated' && change.message.data.id === 'coding') setCoding(change.message.data);
      else if (change.type === 'failed' || change.type === 'removed') setCoding(undefined);
      else if (change.type === 'synced' && copy !== undefined) setCoding(copy.states().find(message => message.data.id === 'coding')?.data);
    }, {onRestarted: () => {if (active) setCoding(undefined);}}).then(result => {
      if (result.status !== 'synced') return;
      if (!active) {void result.copy.close(); return;}
      copy = result.copy;
      const current = result.copy.states().find(message => message.data.id === 'coding');
      if (current !== undefined) setCoding(current.data);
    }, () => {if (active) setCoding(undefined);});
    return () => {active = false; void copy?.close();};
  }, [api, connected]);
  useEffect(() => {
    if (!connected) {setHistoryApi(undefined); return;}
    let active = true;
    let copy: SyncedCopy<AssistantState> | undefined;
    setUnavailable(true);
    void api.sync<AssistantState>(['assistant-state'], change => {
      if (!active) return;
      if (change.type === 'updated' && change.message.data.id === 'assistant') {setState(change.message.data); setUnavailable(false);}
      else if (change.type === 'failed' || change.type === 'removed') setUnavailable(true);
      else if (change.type === 'synced' && copy !== undefined) {
        const current = copy.states().find(message => message.data.id === 'assistant');
        if (current !== undefined) {setState(current.data); setUnavailable(false);}
      }
    }, {onRestarted: () => {if (active) setUnavailable(true);}}).then(result => {
      if (!active) {
        if (result.status === 'synced') void result.copy.close();
        return;
      }
      setHistoryApi(api);
      if (result.status !== 'synced') {setUnavailable(true); return;}
      copy = result.copy;
      const current = result.copy.states().find(message => message.data.id === 'assistant');
      if (current !== undefined) {setState(current.data); setUnavailable(false);}
    }, () => {
      if (!active) return;
      setUnavailable(true);
      setHistoryApi(api);
    });
    return () => {active = false; void copy?.close();};
  }, [api, connected]);
  const readHistory = useCallback(function readWindow(before?: string): void {
    if (!connected) return;
    const previous = historyAttempt.current;
    if (before === undefined && previous?.before !== undefined && !previous.controller.signal.aborted) {
      // Finish the deliberate earlier read first. Only the latest read can update the current question.
      previous.refreshAfter = true;
      return;
    }
    previous?.controller.abort();
    const controller = new AbortController();
    const attempt: HistoryAttempt = {controller, before, refreshAfter: false};
    historyAttempt.current = attempt;
    const prior = historyRef.current;
    const read = (path: string): Promise<unknown> => api.read(path);
    failedCursor.current = undefined;
    setHistoryStatus('loading');
    const request = before === undefined
      ? refreshConversationHistory(read, profile, controller.signal, prior)
      : prior?.profile === profile ? loadEarlierConversationHistory(read, prior, before, controller.signal) : undefined;
    if (request === undefined) {
      historyAttempt.current = undefined;
      setHistoryStatus('failed');
      return;
    }
    const current = (): boolean => historyAttempt.current === attempt && !controller.signal.aborted;
    void request.then(next => {
      if (!current()) return;
      historyRef.current = next;
      setHistory(next);
      setHistoryStatus('ready');
    }, () => {
      if (!current()) return;
      failedCursor.current = before;
      setHistoryStatus('failed');
    }).finally(() => {
      if (!current()) return;
      historyAttempt.current = undefined;
      if (attempt.refreshAfter) readWindow();
    });
  }, [api, connected, profile]);
  useEffect(() => () => {
    historyAttempt.current?.controller.abort();
    historyAttempt.current = undefined;
  }, [readHistory]);
  useEffect(() => {
    if (historyApi === api) readHistory();
  }, [api, historyApi, readHistory, state?.revision]);
  const pickProfile = (value: string): void => {
    if (value === profile || (value !== 'bunny' && value !== 'reachy' && value !== 'microduck')) return;
    historyAttempt.current?.controller.abort();
    setHistoryStatus('loading');
    setProfile(value);
  };
  const live = connected && !unavailable && state !== undefined && state.available;
  const task = state?.tasks.find(value => value.profile === profile);
  const unfinished = state?.tasks.find(value => !finished(value.status));
  const visibleHistory = history?.profile === profile ? history : undefined;
  const savedTask = visibleHistory?.currentTask;
  const currentQuestion = task !== undefined && savedTask?.taskId === task.taskId && savedTask.question?.id === task.questionId ? savedTask.question : undefined;
  const synthetic = state === undefined || state.provider === 'synthetic' || profile !== 'bunny';
  const allowed = state?.tools ?? [];
  const unavailableTools = CATALOG.filter(name => !allowed.includes(name)).join(', ');
  const {Command, Facts, Select} = context.ui;
  return <section aria-label="B.U.N.N.Y. conversation" className="panel conversation-page">
    <Command context={context} target="assistant">{command => {
      const locked = command.locked || !live || !context.control || !context.operationsLive;
      const present = (action: 'enable' | 'disable'): void => {
        if (state === undefined || locked || (action === 'disable' && unfinished !== undefined)) return;
        void command.run({family: 'assistant-control', target: 'assistant', requestId: crypto.randomUUID(),
          data: {action, expectedRevision: state.revision}});
      };
      return <div className="conversation-layout">
        <nav className="conversation-profiles" aria-label="Conversation profiles">
          <div className="conversation-profiles-wide">
            {Object.entries(profiles).map(([value, label]) => <button type="button" className="secondary" key={value}
              aria-pressed={value === profile} onClick={() => {pickProfile(value);}}>{label}</button>)}
          </div>
          <div className="conversation-profiles-narrow">
            <Select label="Companion profile" value={profile} onChange={pickProfile}
              options={Object.entries(profiles).map(([value, label]) => ({value, label}))}/>
          </div>
          {profile !== 'bunny' && <p>Synthetic profile. No paid calls.</p>}
        </nav>
        <div className="conversation-main">
          <h3>{profiles[profile]}</h3>
          {!connected ? <p role="status">Disconnected. Saved history remains readable. Last known task state.</p>
            : !live && <p role="status">Stale. Current conversation state is unavailable. Saved history remains readable.</p>}
          {!context.control && <p>Read-only access. Controls require operator authority.</p>}
          {context.control && !context.operationsLive && <p>Tracked operations are unavailable. Conversation controls are locked.</p>}
          <ConversationTranscript key={profile} history={visibleHistory} status={historyStatus} readLocked={!connected || historyStatus === 'loading'}
            loadEarlier={before => {readHistory(before);}} retry={() => {readHistory(failedCursor.current);}}
            renderMessage={message => <article aria-label={`${message.role} message`}>
              <strong>{message.role === 'owner' ? 'You' : message.role === 'tool' ? 'Tool result' : profiles[profile]}</strong>
              <p>{message.text}</p>
              {message.role === 'assistant' && state !== undefined && <button type="button" aria-label={`Speak message ${message.seq}`}
                className="secondary" disabled={locked || message.text.length > LIMITS.spokenChars}
                onClick={() => {
                  const requestId = crypto.randomUUID();
                  setSpeakRequest(requestId);
                  void command.run({family: 'assistant-control', target: 'assistant', requestId,
                    data: {action: 'speak', expectedRevision: state.revision, taskId: message.taskId, messageId: message.id}});
                }}>Speak</button>}
            </article>}/>
          <div className="conversation-compose">
            {state !== undefined && !state.enabled && <p>Conversation is off. <button type="button" disabled={locked} onClick={() => {present('enable');}}>Enable conversation</button></p>}
            {unfinished !== undefined && unfinished.profile !== profile && <p>One task is still unfinished. <button type="button"
              onClick={() => {pickProfile(unfinished.profile);}}>Go to {profiles[unfinished.profile]} task</button></p>}
            {task !== undefined && <p role="status">Task status: {task.status === 'uncertain' ? 'Uncertain outcome' : task.status}{!live ? ' (Last known)' : ''}</p>}
            {task?.status === 'running' && <p>Working</p>}
            {task?.status === 'paused' && <p>Paused</p>}
            {currentQuestion?.kind === 'clarification' && task?.questionId !== null && task?.hasAnswer === false && !finished(task.status) && <p>Needs your answer</p>}
            {task?.code != null && <p>Task code: {task.code}</p>}
            {state?.enabled === true && unfinished !== undefined && !['waiting', 'paused'].includes(task?.status ?? '') && <p>Finish or cancel the unfinished task before sending another message.</p>}
            {currentQuestion?.kind === 'clarification' && <SavedQuestionContext question={currentQuestion}/>}
            {state !== undefined && <TaskControls context={context} command={command} state={state} profile={profile} live={live} question={currentQuestion}
              drafts={drafts} setDraft={(key, value) => {setDrafts(prior => ({...prior, [key]: value}));}}
              refreshHistory={() => {readHistory();}} historyBusy={historyStatus === 'loading'}/>}
            <p role="status">{speakRequest !== undefined && command.requestId === speakRequest ? 'Speak receipt' : 'Command receipt'}: {command.text}</p>
          </div>
        </div>
        <details className="conversation-details">
          <summary>Details</summary>
          <p>Reads need no approval. Proposed changes need your approval here. Reachy and MicroDuck use the synthetic provider.</p>
          {!live && state !== undefined && <p>Last known provider and task details.</p>}
          {state !== undefined && <Facts items={[
            ['Provider', profile === 'bunny' ? providerLabel(state) : 'Synthetic (no paid calls)'],
            ['Allowed tools', allowed.length === 0 ? 'None' : allowed.join(', ')],
            ['Unavailable tools', unavailableTools === '' ? 'None' : unavailableTools],
            ['Coding worker', !connected || coding === undefined ? 'Unknown' : coding.availability === 'available' ? (coding.active === null ? 'Connected and idle' : `Running task ${coding.active.taskId.slice(0, 8)} (${coding.active.status})`) : coding.availability === 'unavailable' ? 'Lost; start it again on your computer' : 'Not connected'],
          ]}/>}
          <h3>Current task</h3>
          {task === undefined ? <p>No task saved for {profiles[profile]}.</p> : <>
            <Facts items={[
              ['Task', task.taskId], ['Conversation', task.conversationId], ['Run', task.runId ?? 'Not active'],
              ['Model calls', `${task.modelCalls} / ${BOUNDS.modelCalls}`], ['Tool calls', `${task.toolCalls} / ${BOUNDS.toolCalls}`], ['Questions', `${task.questions} / ${BOUNDS.questions}`],
              ['Active time', `${(task.activeMs / 1000).toFixed(1)} / ${BOUNDS.activeSeconds} seconds`],
              [synthetic ? 'Fake-model usage' : 'Model usage', task.usageUnits === null ? 'Unknown' : `${task.usageUnits} ${synthetic ? 'units' : 'tokens'}`],
              ['Reserved usage', `${task.reservedUnits} / ${BOUNDS.units} ${synthetic ? 'units' : 'tokens'}`],
              ['Paid cost', synthetic ? '0 (synthetic calls)' : 'Unknown here; billed by the provider'],
            ]}/>
          </>}
          {currentQuestion !== undefined && currentQuestion.kind !== 'clarification' && (currentQuestion.answer !== null || task !== undefined && finished(task.status))
            && <SavedQuestionContext question={currentQuestion}/>}
          {state?.enabled === true && <button type="button" disabled={locked || unfinished !== undefined} onClick={() => {present('disable');}}>Disable conversation</button>}
          <p>Drafts stay in this page until reload. Review saved history before submitting retained text again.</p>
          <p>A successful command receipt confirms that the control was saved. Task completion and playback are reported separately.</p>
          <p>The tab with spoken replies enabled speaks each eligible reply, question or refusal once through the qualified voice it shares with Reachy alerts.
            Replies longer than {LIMITS.spokenChars} characters stay written only. Quiet keeps replies silent. Stop speaking stops audio only.</p>
        </details>
      </div>;
    }}</Command>
    <SpeechControls context={context} companion={speech.copy} compact purpose="replies"/>
  </section>;
}
