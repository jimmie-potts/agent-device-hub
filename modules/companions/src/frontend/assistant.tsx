import React, {useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore} from 'react';
import type {AssistantProfile, AssistantState, AssistantStatus} from '@jimmie-potts/event-contracts/v2/assistant';
import type {CodingState} from '@jimmie-potts/event-contracts/v2/coding';
import type {FrontendCommand, FrontendContext} from '@jimmie-potts/sdk/frontend';
import type {SyncedCopy} from '@jimmie-potts/sdk';
import {LIMITS} from '../assistant/limits.js';
import {useCompanionSpeechCopy, useSpeechControlsSession} from './speech.js';
import {ConversationVoice, stopSpeakingButton} from './conversation-voice.js';

import type {SavedQuestion} from '../assistant/history-contract.js';
import {loadEarlierConversationHistory, refreshConversationHistory, type ConversationHistory} from './conversation-history.js';
import {ConversationDetails, useDetailsOverlay} from './conversation-details.js';
import {spendNotice, useSpend} from './conversation-spend.js';
import {ArtworkAttachment, useConversationArt} from './conversation-art.js';
import {ConversationTranscript} from './conversation-transcript.js';
import {conversationRail, profiles} from './conversation-rail.js';
import './conversation.css';

const finished = (status: string): boolean => ['succeeded', 'failed', 'cancelled'].includes(status);
const taskCue: Readonly<Record<AssistantStatus, string>> = {
  running: 'Working', waiting: 'Task waiting', paused: 'Paused', succeeded: 'Task completed', failed: 'Task failed',
  cancelled: 'Task cancelled', uncertain: 'Uncertain outcome',
};

function SavedQuestionContext({question}: {question: SavedQuestion}): React.JSX.Element {
  return <article aria-label="Saved question" className="conversation-question">
    <p>{question.text}</p>
    {question.answer !== null && <p>Saved answer: {question.answer}</p>}
  </article>;
}

function TaskControls({context, command, state, profile, live, question, drafts, setDraft, refreshHistory, historyBusy, voice}: {
  context: FrontendContext; command: FrontendCommand; state: AssistantState | undefined; profile: AssistantProfile; live: boolean;
  question: SavedQuestion | undefined; drafts: Record<string, string>; setDraft: (key: string, value: string) => void;
  refreshHistory: () => void; historyBusy: boolean; voice: React.JSX.Element;
}): React.JSX.Element {
  const formId = useId();
  const task = state?.tasks.find(value => value.profile === profile);
  const unfinished = state?.tasks.find(value => !finished(value.status));
  const pending = task !== undefined && task.questionId !== null && !task.hasAnswer && ['waiting', 'paused'].includes(task.status);
  const approval = pending && question?.kind === 'approval';
  const unavailableDecision = pending && (question === undefined || (approval && question.proposal === null));
  const delegated = pending && question?.kind === 'delegation';
  const enabled = state?.enabled === true;
  const canResume = task !== undefined && enabled && ['paused', 'uncertain', 'waiting'].includes(task.status)
    && (task.questionId === null || task.hasAnswer);
  const draftKey = `${profile}:${pending ? task.questionId ?? 'start' : 'start'}`;
  const draft = drafts[draftKey] ?? '';
  const bytes = new TextEncoder().encode(draft).byteLength;
  const showInput = state !== undefined && !unavailableDecision && !approval && !delegated;
  const tooLong = bytes > LIMITS.inputBytes;
  const locked = command.locked || !live || !context.control || !context.operationsLive;
  const canSubmit = showInput && !locked && enabled && draft.trim() !== '' && !tooLong && (pending || unfinished === undefined);
  const control = (action: 'resume' | 'cancel', taskId: string): void => {
    if (state === undefined) return;
    const requestId = crypto.randomUUID();
    void command.run({family: 'assistant-control', target: 'assistant', requestId,
      data: {action, expectedRevision: state.revision, taskId}});
  };
  const send = (text: string, answer: boolean): void => {
    if (state === undefined) return;
    // Command retains this identity before staging. The draft remains on refusals and uncertain replies.
    const requestId = crypto.randomUUID();
    const input = {action: answer ? 'answer' : 'start', profile, text, expectedRevision: state.revision,
      ...(answer && task !== undefined ? {taskId: task.taskId, questionId: task.questionId} : {})};
    void command.run({family: 'assistant-input', target: 'assistant', requestId,
      upload: {name: 'input.json', file: new Blob([JSON.stringify(input)], {type: 'application/json'})}});
  };
  const submit = (): void => {
    if (canSubmit) send(draft, pending);
  };
  return <>
    {unavailableDecision && <div>
      <p role="status">{approval ? 'The saved proposal is unavailable. Refresh history to continue.' : 'The saved question is unavailable. Refresh history to continue.'}</p>
      <button type="button" className="secondary" disabled={historyBusy || !context.connected} onClick={refreshHistory}>Refresh history</button>
    </div>}
    <fieldset className="conversation-task-controls" aria-label="Conversation controls" disabled={locked}>
      {!unavailableDecision && (delegated ? <article aria-label="Delegated work">
        <p>{question?.text}</p>
        <p>Waiting for the coding worker on your computer. Its structured result ends this wait; Cancel task asks the worker to stop.</p>
      </article> : approval && question?.proposal !== null && question?.proposal !== undefined ? <article aria-label="Proposed command">
        <strong>Needs approval</strong>
        <p>{question.text}</p>
        {question.proposal.family === 'mode-set'
          ? <p>Command: <code>{question.proposal.family}</code> on <code>{question.proposal.target}</code>, mode <strong>{question.proposal.data.mode}</strong>.
            {' '}Bound to Hub-mode revision {String(question.proposal.expectedRevision)}; a mode changed since then refuses it.</p>
          : question.proposal.family === 'coding-dispatch' ? <p>Delegation to the coding worker in repository <strong>{question.proposal.data.repository}</strong>, in a fresh worktree with edits, builds and tests allowed and no push.
            {' '}Brief: <span style={{whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}}>{question.proposal.data.brief}</span>.
            {' '}Bound to coding worker revision {String(question.proposal.expectedRevision)}; a worker changed since then refuses it.</p>
          : question.proposal.family === 'catalog-action'
            ? <details><summary>{question.proposal.command} on {question.proposal.target}</summary>
              <pre style={{whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}}>{JSON.stringify(question.proposal.data, null, 2)}</pre>
            </details>
          : <p><code>{question.proposal.target}</code> · {question.proposal.family === 'power-set' ? (question.proposal.data.on ? 'Power on' : 'Power off') : `Brightness ${String(question.proposal.data.percent)}%`}</p>}
        <button type="button" disabled={!enabled} style={{marginInlineEnd: '0.5rem'}} onClick={() => {send('approve', true);}}>Approve proposal</button>
        <button type="button" className="secondary" disabled={!enabled} onClick={() => {send('decline', true);}}>Decline proposal</button>
        <p>Approval sends one tracked command; its outcome is reported separately. Declining changes nothing.</p>
      </article> : null)}
      {task !== undefined && !finished(task.status) && <div className="conversation-task-actions">
        {canResume && <button type="button" className="secondary" onClick={() => {control('resume', task.taskId);}}>Resume task</button>}
        <button type="button" className="secondary" onClick={() => {control('cancel', task.taskId);}}>Cancel task</button>
      </div>}
    </fieldset>
    <div className="conversation-input-surface">
      {showInput && <form id={formId} onSubmit={event => {event.preventDefault(); submit();}}>
        <label className="vh" htmlFor="assistant-input">{pending ? 'Answer' : 'Message'}</label>
        <textarea id="assistant-input" rows={2} value={draft} aria-describedby="assistant-input-help"
          placeholder={pending ? 'Answer the question' : `Message ${profiles[profile].name}`} disabled={locked} aria-invalid={tooLong || undefined}
          onKeyDown={event => {
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
            event.preventDefault();
            if (!event.repeat) submit();
          }}
          onChange={event => {setDraft(draftKey, event.target.value);}}/>
        <div className="conversation-byte-feedback">
          {bytes >= LIMITS.inputBytes * 0.8 && <p>{bytes.toLocaleString('en-US')} / {LIMITS.inputBytes.toLocaleString('en-US')} UTF-8 bytes</p>}
          {tooLong && <p role="alert">Shorten the text to {LIMITS.inputBytes.toLocaleString('en-US')} UTF-8 bytes.</p>}
        </div>
      </form>}
      <div className="conversation-composer-actions">
        {voice}
        {showInput && <button type="submit" form={formId} disabled={!canSubmit}>{pending ? 'Answer' : 'Send'}</button>}
      </div>
    </div>
    {showInput && <div id="assistant-input-help" className="conversation-input-help">
      <p>Enter to {pending ? 'answer' : 'send'}. Shift+Enter for a new line.</p>
      <p>Saved privately. Sent to the selected model.</p>
    </div>}
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
  // The selected profile is shared with the rail's conversation group (Hub #1890), which chooses it from any page.
  const profile = useSyncExternalStore(conversationRail.subscribe, () => conversationRail.getSnapshot().profile);
  useEffect(() => {
    conversationRail.setOpen(true);
    return () => {conversationRail.setOpen(false);};
  }, []);
  const [history, setHistory] = useState<ConversationHistory>();
  const historyRef = useRef<ConversationHistory>(undefined);
  const historyAttempt = useRef<HistoryAttempt>(undefined);
  const [historyStatus, setHistoryStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const failedCursor = useRef<string>(undefined);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [speakRequest, setSpeakRequest] = useState<string>();
  const [coding, setCoding] = useState<CodingState>();
  const companionSpeech = useCompanionSpeechCopy(context);
  const speech = useSpeechControlsSession(context, companionSpeech.copy);
  const [panel, setPanel] = useState<'voice' | 'details'>();
  const detailsOpen = panel === 'details';
  const detailsOverlay = useDetailsOverlay();
  const detailsId = useId();
  const detailsTrigger = useRef<HTMLButtonElement>(null);
  const priorPanel = useRef<typeof panel>(undefined);
  const closeDetails = useCallback((): void => {
    setPanel(current => current === 'details' ? undefined : current);
  }, []);
  const setVoiceOpen = useCallback((open: boolean): void => {
    setPanel(current => open ? 'voice' : current === 'voice' ? undefined : current);
  }, []);
  useLayoutEffect(() => {
    if (priorPanel.current === 'details' && panel === undefined) detailsTrigger.current?.focus({preventScroll: true});
    priorPanel.current = panel;
  }, [panel]);
  const stopSpeaking = stopSpeakingButton(speech);
  const stopInDrawer = detailsOpen && detailsOverlay;
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
  // A profile chosen here or in the rail shows as loading before it is painted, never as another profile's result.
  useLayoutEffect(() => {
    historyAttempt.current?.controller.abort();
    setHistoryStatus('loading');
  }, [profile]);
  // The rail marks a conversation that needs the owner. The page shares the kind of question it has already read.
  useEffect(() => {
    const task = history?.currentTask;
    if (history !== undefined && task?.question != null) conversationRail.learn(history.profile, {taskId: task.taskId, questionId: task.question.id, kind: task.question.kind});
  }, [history]);
  const live = connected && !unavailable && state !== undefined && state.available;
  const spend = useSpend(api, connected && historyApi === api, state?.revision);
  // Only a paid profile's new message meets the shared spend limits and the price table; the synthetic demos cost nothing.
  const spendLimit = profile === 'bunny' ? spendNotice(spend) : undefined;
  const task = state?.tasks.find(value => value.profile === profile);
  const unfinished = state?.tasks.find(value => !finished(value.status));
  const visibleHistory = history?.profile === profile ? history : undefined;
  const hasArt = visibleHistory?.windows.some(window => window.messages.some(message => message.attachment !== undefined)) ?? false;
  const art = useConversationArt(context.api, connected && hasArt);
  const savedTask = visibleHistory?.currentTask;
  const currentQuestion = task !== undefined && savedTask?.taskId === task.taskId && savedTask.question?.id === task.questionId ? savedTask.question : undefined;
  const pendingQuestion = task !== undefined && task.questionId !== null && !task.hasAnswer && ['waiting', 'paused'].includes(task.status);
  const activeClarification = pendingQuestion && currentQuestion?.kind === 'clarification' ? currentQuestion : undefined;
  let cue = task === undefined ? undefined : taskCue[task.status];
  if (task?.status === 'waiting' && pendingQuestion) cue = activeClarification && 'Needs your answer';
  const {Command, Facts} = context.ui;
  return <section aria-label="B.U.N.N.Y. conversation" className="conversation-page">
    <Command context={context} target="assistant">{command => {
      const locked = command.locked || !live || !context.control || !context.operationsLive;
      const speakReceipt = speakRequest !== undefined && command.requestId === speakRequest;
      const operation = context.operations.find(value => value.target === 'assistant' && value.requestId === command.requestId);
      const routineReceipt = !speakReceipt && !command.locked && (command.requestId === undefined || (
        context.operationsLive && operation?.status === 'completed' && operation.result === 'succeeded'
      ));
      const present = (action: 'enable' | 'disable'): void => {
        if (state === undefined || locked || (action === 'disable' && unfinished !== undefined)) return;
        void command.run({family: 'assistant-control', target: 'assistant', requestId: crypto.randomUUID(),
          data: {action, expectedRevision: state.revision}});
      };
      return <div className="conversation-layout">
        <div className="conversation-main">
          <div className="conversation-context">
            <header className="conversation-header">
              <h2>{profiles[profile].name}</h2>
              {profile !== 'bunny' && <small className="conversation-demo-tag">{profiles[profile].kind}</small>}
              <button type="button" className="secondary conversation-details-trigger" ref={detailsTrigger}
                aria-expanded={detailsOpen} aria-controls={detailsId} onClick={() => {
                  if (detailsOpen) closeDetails();
                  else setPanel('details');
                }}>Details</button>
            </header>
            {profile !== 'bunny' && <p className="conversation-demo-note">Demo profile. No paid calls.</p>}
            {!connected ? <p role="status">Disconnected. Saved history remains readable. Last known task state.</p>
              : !live && <p role="status">Stale. Current conversation state is unavailable. Saved history remains readable.</p>}
            {!context.control && <p>Read-only access. Controls require operator authority.</p>}
            {context.control && !context.operationsLive && <p>Tracked operations are unavailable. Conversation controls are locked.</p>}
          </div>
          <ConversationTranscript key={profile} history={visibleHistory} status={!connected && historyStatus === 'loading' ? 'unavailable' : historyStatus}
            live={live} canStart={!locked && state?.enabled === true && unfinished === undefined}
            readLocked={!connected || historyStatus === 'loading'} loadEarlier={before => {readHistory(before);}} retry={() => {readHistory(failedCursor.current);}}
            renderToolEvidence={message => {
              const operation = context.operations.find(value => value.requestId === message.id && value.requestedBy === 'bunny/modules/companions');
              if (operation === undefined) return null;
              return <p>Tracked operation {operation.result ?? operation.status}
                {operation.evidence !== undefined && operation.evidence !== 'none' ? ` · evidence ${operation.evidence}` : ''}
                {operation.error !== undefined ? ` · ${operation.error.code}` : ''}{!context.operationsLive ? ' (Last known)' : ''}</p>;
            }}
            renderMessage={message => <article aria-label={`${message.role} message`}>
              <strong className="conversation-speaker">{message.role === 'owner' ? 'You' : profiles[profile].name}</strong>
              <p className="conversation-message-text" dir="auto">{message.text}</p>
              {message.attachment !== undefined && <ArtworkAttachment key={message.attachment.requestId} api={context.api}
                connected={connected} attachment={message.attachment}
                artRevision={art?.revision}/>}
              {message.role === 'assistant' && (message.text.length > LIMITS.spokenChars
                ? <small className="conversation-voice-note">Written only. Read aloud supports up to {LIMITS.spokenChars} characters.</small>
                : state !== undefined && <button type="button" aria-label={`Read aloud message ${message.seq}`}
                className="secondary conversation-read-aloud" disabled={locked}
                onClick={() => {
                  const requestId = crypto.randomUUID();
                  setSpeakRequest(requestId);
                  void command.run({family: 'assistant-control', target: 'assistant', requestId,
                    data: {action: 'speak', expectedRevision: state.revision, taskId: message.taskId, messageId: message.id}});
                }}>Read aloud</button>)}
            </article>}/>
          <div className="conversation-compose">
            {state !== undefined && !state.enabled && <p>Conversation is off. <button type="button" disabled={locked} onClick={() => {present('enable');}}>Enable conversation</button></p>}
            {unfinished !== undefined && unfinished.profile !== profile && <p>One task is still unfinished. <button type="button"
              onClick={() => {conversationRail.select(unfinished.profile);}}>Go to {profiles[unfinished.profile].name} task</button></p>}
            {cue !== undefined && <p role="status" className={live && task?.status === 'succeeded' ? 'conversation-completed' : undefined}>
              {cue}{!live ? ' (Last known)' : ''}
            </p>}
            {task?.code != null && <p>Task code: {task.code}</p>}
            {spendLimit !== undefined && <p role="status">{spendLimit}</p>}
            {state?.enabled === true && unfinished !== undefined && !['waiting', 'paused'].includes(task?.status ?? '') && <p>Finish or cancel the unfinished task before sending another message.</p>}
            {activeClarification !== undefined && <SavedQuestionContext question={activeClarification}/>}
            <TaskControls context={context} command={command} state={state} profile={profile} live={live} question={currentQuestion}
              drafts={drafts} setDraft={(key, value) => {setDrafts(prior => ({...prior, [key]: value}));}}
              refreshHistory={() => {readHistory();}} historyBusy={historyStatus === 'loading'}
              voice={<ConversationVoice context={context} speech={speech} open={panel === 'voice'} onOpenChange={setVoiceOpen}
                stopSpeaking={stopInDrawer ? null : stopSpeaking}/>}/>
            {!routineReceipt && <p role="status">{speakReceipt ? 'Read aloud receipt' : 'Command receipt'}: {command.text}</p>}
          </div>
        </div>
        <ConversationDetails id={detailsId} open={detailsOpen} overlay={detailsOverlay} onClose={closeDetails}
          stopSpeaking={stopInDrawer ? stopSpeaking : null} Facts={Facts} profile={profile} profileName={profiles[profile].name} state={state} task={task}
          coding={connected ? coding : undefined} live={live} spend={spend}
          savedQuestion={currentQuestion === undefined ? null : <SavedQuestionContext question={currentQuestion}/>}
          receipt={routineReceipt ? command.text : undefined} locked={locked} unfinished={unfinished !== undefined} setEnabled={present}/>
      </div>;
    }}</Command>
  </section>;
}
