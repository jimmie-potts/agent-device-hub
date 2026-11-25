import {codingChoice, type CodingChoice} from '../coding/routing.js';
import type {CodingJobEntry} from '../coding/job-page.js';
import React, {useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore} from 'react';
import type {AssistantProfile, AssistantState, AssistantStatus} from '@jimmie-potts/event-contracts/v2/assistant';
import type {CodingState} from '@jimmie-potts/event-contracts/v2/coding';
import type {FrontendCommand, FrontendContext} from '@jimmie-potts/sdk/frontend';
import type {SyncedCopy} from '@jimmie-potts/sdk';
import {LIMITS} from '../assistant/limits.js';
import {useCompanionSpeechCopy, useSpeechControlsSession} from './speech.js';
import {ConversationVoice, stopSpeakingButton} from './conversation-voice.js';

import type {ConversationListEntry, SavedQuestion} from '../assistant/history-contract.js';
import {loadEarlierConversationHistory, readConversationList, refreshConversationHistory, type ConversationHistory} from './conversation-history.js';
import {CodingJobs, ConversationCodingJob, continueCodingJob, explicitJobInstruction, messageCodingJob, readJobTargets, stopCodingJob, useCodingState} from './coding-jobs.js';
import {ConversationDetails, useDetailsOverlay, type ConversationTitle} from './conversation-details.js';
import {spendNotice, useSpend} from './conversation-spend.js';
import {ArtworkAttachment, useConversationArt} from './conversation-art.js';
import {ConversationUpload} from './conversation-upload.js';
import {ConversationTranscript} from './conversation-transcript.js';
import {conversationRail, profiles, unspokenNote} from './conversation-rail.js';
import {companionName, handOffWaiting, slotBusy} from './coding-status.js';
import {PendingSteers, QueuedMessages} from './conversation-queue.js';
import {steerMessage, supersededReply} from '../assistant/queue-contract.js';
import {useQueue, type QueueView} from './conversation-queue-read.js';
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

function TaskControls({context, command, state, profile, live, question, coding, queue, drafts, setDraft, refreshHistory, historyBusy, voice}: {
  context: FrontendContext; command: FrontendCommand; state: AssistantState | undefined; profile: AssistantProfile; live: boolean; coding: CodingState | undefined;
  question: SavedQuestion | undefined; queue: QueueView | undefined; drafts: Record<string, string>; setDraft: (key: string, value: string) => void;
  refreshHistory: () => void; historyBusy: boolean; voice: React.JSX.Element;
}): React.JSX.Element {
  const formId = useId();
  const [routing, setRouting] = useState<{draft: string; status: 'loading' | 'choose' | 'unavailable' | 'missing' | 'unsupported'; jobs?: CodingJobEntry[]}>();
  // The draft a sent or queued message came from, cleared once its command succeeded, so the composer is ready for the
  // next message while the task runs; a refused or uncertain command keeps it.
  const [submitted, setSubmitted] = useState<{requestId: string; key: string; text: string}>();
  // The text of a queued message's edit that could not be saved: its message started, left the queue or was changed on
  // another page first.
  const [lost, setLost] = useState<{text: string; reason: 'started' | 'changed'}>();
  const task = state?.tasks.find(value => value.profile === profile);
  // Only this conversation's own unfinished task holds a new message; another conversation's never does (Hub #2027).
  const open = task !== undefined && !finished(task.status);
  const pending = task !== undefined && task.questionId !== null && !task.hasAnswer && ['waiting', 'paused'].includes(task.status);
  const approval = pending && question?.kind === 'approval';
  const [codingSelection, setCodingSelection] = useState<{questionId: string; choice: CodingChoice}>();
  const codingQuestion = approval && question?.proposal?.family === 'coding-dispatch' &&
    (coding?.harnesses?.length ?? 0) > 0 ? question : undefined;
  const chosenHarness = codingSelection?.questionId === codingQuestion?.id ? codingSelection?.choice ?? 'auto' : 'auto';
  const clarification = pending && question?.kind === 'clarification';
  const unavailableDecision = pending && (question === undefined || (approval && question.proposal === null));
  const delegated = pending && question?.kind === 'delegation';
  // Send steers a task that works, or that waits on the coding worker (Hub #2031): the task reads the message at its next
  // model call, after the worker's result. A paused or uncertain task makes no next call, so it only queues.
  const steerable = open && (pending ? delegated : task.status === 'running' || task.status === 'waiting');
  const enabled = state?.enabled === true;
  const canResume = task !== undefined && enabled && ['paused', 'uncertain', 'waiting'].includes(task.status)
    && (task.questionId === null || task.hasAnswer);
  const draftKey = `${profile}:${pending ? task.questionId ?? 'start' : 'start'}`;
  const draft = drafts[draftKey] ?? '';
  const currentRouting = routing?.draft === draft ? routing : undefined;
  const jobInstruction = explicitJobInstruction(draft);
  const bytes = new TextEncoder().encode(draft).byteLength;
  // The composer stays available while the task runs or waits (Hub #2030): during an approval or a hand-off it only queues.
  const showInput = state !== undefined && !unavailableDecision;
  const answerable = showInput && !approval && !delegated;
  const tooLong = bytes > LIMITS.inputBytes;
  const locked = command.locked || !live || !context.control || !context.operationsLive;
  const ready = !locked && enabled && draft.trim() !== '' && !tooLong;
  const canSubmit = answerable && ready && (pending || !open);
  const canSteer = steerable && ready;
  // Skip question and send, or Decline with message, sets the question aside and steers the task in one step.
  const setAside = clarification || (approval && question?.proposal !== null && question?.proposal !== undefined);
  const canSetAside = setAside && ready;
  // Queue saves the message for after the current task; with no task it joins a held queue. A free, empty queue with no
  // task to wait for has nothing to queue behind, so Send alone shows.
  const queued = queue?.messages.length ?? 0;
  const queueable = showInput && (open || queued > 0);
  const canQueue = queueable && ready && jobInstruction === undefined && queued < LIMITS.queuedMessages;
  useEffect(() => {
    if (submitted === undefined) return;
    const operation = context.operations.find(value => value.requestId === submitted.requestId);
    if (operation === undefined || operation.status === 'sent' || operation.status === 'accepted') return;
    if (operation.status === 'completed' && operation.result === 'succeeded' && drafts[submitted.key] === submitted.text) setDraft(submitted.key, '');
    setSubmitted(undefined);
  }, [context.operations, drafts, setDraft, submitted]);
  const control = (action: 'resume' | 'cancel', taskId: string): void => {
    if (state === undefined) return;
    const requestId = crypto.randomUUID();
    void command.run({family: 'assistant-control', target: 'assistant', requestId,
      data: {action, expectedRevision: state.revision, taskId}});
  };
  const send = (text: string, action: 'start' | 'answer' | 'queue' | 'steer', questionId?: string): void => {
    if (state === undefined) return;
    // Command retains this identity before staging. The draft remains on refusals and uncertain replies.
    const requestId = crypto.randomUUID();
    // A steer names the turn it expects: one that reaches that turn after it ended, while it is still the latest, is
    // queued as the next message, and one aimed at a turn a newer turn followed is refused instead of joining another.
    const input = {action, profile, text, expectedRevision: state.revision,
      ...(action === 'answer' && task !== undefined ? {taskId: task.taskId, questionId: task.questionId} : {}),
      ...(action === 'answer' && text === 'approve' && codingQuestion !== undefined ? {harness: chosenHarness} : {}),
      ...(action === 'steer' && task !== undefined ? {taskId: task.taskId, ...(questionId === undefined ? {} : {questionId})} : {})};
    if (action !== 'answer' || (text !== 'approve' && text !== 'decline')) setSubmitted({requestId, key: draftKey, text});
    void command.run({family: 'assistant-input', target: 'assistant', requestId,
      upload: {name: 'input.json', file: new Blob([JSON.stringify(input)], {type: 'application/json'})}});
  };
  const sendJob = (job: CodingJobEntry, text: string): void => {
    if (!ready || job.steering !== 'live') return;
    const requestId = crypto.randomUUID();
    setSubmitted({requestId, key: draftKey, text: draft});
    setRouting(undefined);
    messageCodingJob(command, job, text, requestId);
  };
  const routeJob = (target: string, text: string): void => {
    setRouting({draft, status: 'loading'});
    void readJobTargets(path => context.api.read(path), target).then(page => {
      const only = page.jobs.length === 1 && page.next === null ? page.jobs[0] : undefined;
      if (only?.steering === 'live') {sendJob(only, text); return;}
      setRouting(only !== undefined ? {draft, status: only.steering === 'unsupported' ? 'unsupported' : 'unavailable'}
        : page.jobs.length === 0 ? {draft, status: 'missing'} : {draft, status: 'choose', jobs: page.jobs});
    }, () => {setRouting({draft, status: 'unavailable'});});
  };
  // Enter sends, steering a task that works, or answers; during an approval, or while the task is paused, it queues.
  const submit = (): void => {
    if (jobInstruction !== undefined) {
      if (ready && currentRouting?.status !== 'loading') routeJob(jobInstruction.target, jobInstruction.text);
      return;
    }
    if (steerable) {if (canSteer) send(draft, 'steer');}
    else if (canSubmit) send(draft, pending ? 'answer' : 'start');
    else if (canQueue && !(pending && answerable)) send(draft, 'queue');
  };
  return <>
    {unavailableDecision && <div>
      <p role="status">{approval ? 'The saved proposal is unavailable. Refresh history to continue.' : 'The saved question is unavailable. Refresh history to continue.'}</p>
      <button type="button" className="secondary" disabled={historyBusy || !context.connected} onClick={refreshHistory}>Refresh history</button>
    </div>}
    <fieldset className="conversation-task-controls" aria-label="Conversation controls" disabled={locked}>
      {!unavailableDecision && (delegated ? <article aria-label="Delegated work">
        <p>{question?.text}</p>
        {handOffWaiting(coding, task?.taskId)
          ? <p>Waiting for the coding worker: it is busy, and this hand-off starts when {companionName(profile)}'s slot frees. Nothing has been sent yet; Cancel task removes it.</p>
          : <p>Waiting for the coding worker on your computer. Its structured result ends this wait; Cancel task asks the worker to stop.</p>}
      </article> : approval && question?.proposal !== null && question?.proposal !== undefined ? <article aria-label="Proposed command">
        <strong>Needs approval</strong>
        <p>{question.text}</p>
        {question.proposal.family === 'mode-set'
          ? <p>Command: <code>{question.proposal.family}</code> on <code>{question.proposal.target}</code>, mode <strong>{question.proposal.data.mode}</strong>.
            {' '}Bound to Hub-mode revision {String(question.proposal.expectedRevision)}; a mode changed since then refuses it.</p>
          : question.proposal.family === 'coding-dispatch' ? <p>Delegation to the coding worker in repository <strong>{question.proposal.data.repository}</strong>, in a fresh worktree with edits, builds and tests allowed and no push.
            {' '}Brief: <span style={{whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}}>{question.proposal.data.brief}</span>{/[.!?]$/u.test(question.proposal.data.brief) ? '' : '.'}
            {' '}Bound to coding worker revision {String(question.proposal.expectedRevision)}; a worker changed since then refuses it.
            {slotBusy(coding, profile) && <> The coding worker is busy: {companionName(profile)}'s slot is taken, so if you approve, this hand-off waits and starts when the slot frees.</>}</p>
          : question.proposal.family === 'catalog-action'
            ? <details><summary>{question.proposal.command} on {question.proposal.target}</summary>
              <pre style={{whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}}>{JSON.stringify({binding: question.proposal.binding, settings: question.proposal.data}, null, 2)}</pre>
            </details>
          : 'owner' in question.proposal ? <details><summary>Power command on {question.proposal.target}</summary>
              <pre style={{whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}}>{JSON.stringify(question.proposal, null, 2)}</pre>
            </details>
          : <p><code>{question.proposal.target}</code> · {question.proposal.family === 'power-set' ? (question.proposal.data.on ? 'Power on' : 'Power off') : `Brightness ${String(question.proposal.data.percent)}%`}</p>}
        {codingQuestion !== undefined && <p><label>Coding harness{' '}
          <select value={chosenHarness} onChange={event => {
            const choice = event.target.value;
            if (codingChoice(choice)) setCodingSelection({questionId: codingQuestion.id, choice});
          }}>
            <option value="auto">Auto</option>
            <option value="claude-code" disabled={coding?.harnesses?.some(item => item.harness === 'claude-code') !== true}>Claude Code</option>
            <option value="codex" disabled={coding?.harnesses?.some(item => item.harness === 'codex') !== true}>Codex</option>
          </select>
        </label></p>}
        <button type="button" disabled={!enabled} style={{marginInlineEnd: '0.5rem'}} onClick={() => {send('approve', 'answer');}}>Approve proposal</button>
        <button type="button" className="secondary" disabled={!enabled} onClick={() => {send('decline', 'answer');}}>Decline proposal</button>
        <p>Approval sends one tracked command; its outcome is reported separately. Declining changes nothing.</p>
      </article> : null)}
      {task !== undefined && !finished(task.status) && <div className="conversation-task-actions">
        {canResume && <button type="button" className="secondary" onClick={() => {control('resume', task.taskId);}}>Resume task</button>}
        {/* Sets the question aside with the composer's text and steers the task in one step (Hub #2031). It sits with the
            task's own controls, so the composer keeps its height and the transcript its reading position. */}
        {setAside && task.questionId !== null && <button type="button" className="secondary" disabled={!canSetAside}
          onClick={() => {if (canSetAside && task.questionId !== null) send(draft, 'steer', task.questionId);}}>{approval ? 'Decline with message' : 'Skip question and send'}</button>}
        <button type="button" className="secondary" onClick={() => {control('cancel', task.taskId);}}>Cancel task</button>
      </div>}
    </fieldset>
    {/* The queued messages and the unread steers share one bounded, scrolling box, so together they never push the
        transcript out of view (Hub #2031). */}
    {queue !== undefined && (queue.messages.length > 0 || queue.steers.length > 0) && <div className="conversation-queue-stack">
      {/* The steers come first: the running task reads them before anything queued starts. */}
      <PendingSteers queue={queue} waitsOnWorker={delegated}/>
      {state !== undefined && <QueuedMessages context={context} command={command} queue={queue} profile={profile}
        waiting={open} locked={locked} enabled={enabled} onLost={(text, reason) => {setLost({text, reason});}}/>}
    </div>}
    {lost !== undefined && <div className="conversation-queue-lost" role="status">
      <p>{lost.reason === 'changed' ? 'The message was changed on another page before your edit was saved, so your edit was not saved.'
        : 'The message started before your edit was saved.'} Your edited text:</p>
      <p className="conversation-queue-text" dir="auto">{lost.text}</p>
      <div className="conversation-queue-actions">
        <button type="button" className="secondary" onClick={() => {setDraft(draftKey, lost.text); setLost(undefined);}}>Use in composer</button>
        <button type="button" className="secondary" onClick={() => {setLost(undefined);}}>Dismiss</button>
      </div>
    </div>}
    <ConversationUpload key={draftKey} context={context} locked={locked || !answerable}>{attach => <>
      {currentRouting !== undefined && <div aria-live="polite">
        {currentRouting.status === 'loading' && <p>Finding the coding job…</p>}
        {currentRouting.status === 'choose' && <><p>Which job should receive this message?</p>
          <ul>{currentRouting.jobs?.map(job => <li key={job.jobId}><button type="button" className="secondary"
            disabled={locked || job.steering !== 'live'} onClick={() => {
              const instruction = explicitJobInstruction(draft);
              if (instruction !== undefined) sendJob(job, instruction.text);
            }}>{job.label ?? job.repository} · {job.jobId}</button></li>)}</ul>
          <a href="#/module/companions/jobs">Open Jobs</a>
        </>}
        {currentRouting.status === 'missing' && <p>No matching active coding job.</p>}
        {currentRouting.status === 'unsupported' && <p>This harness does not support live messages.</p>}
        {currentRouting.status === 'unavailable' && <p>Live messages are unavailable for this attempt.</p>}
      </div>}
      {showInput && <form id={formId} onSubmit={event => {event.preventDefault(); submit();}}>
        <label className="vh" htmlFor="assistant-input">{pending && answerable ? 'Answer' : 'Message'}</label>
        <textarea id="assistant-input" rows={2} value={draft} aria-describedby="assistant-input-help"
          placeholder={pending && answerable ? 'Answer the question' : steerable ? 'Steer this task, or queue a message for after it' : open ? 'Queue a message for after this task' : `Message ${profiles[profile].name}`}
          disabled={locked} aria-invalid={tooLong || undefined}
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
        {answerable && attach}
        {queueable && <button type="button" className="secondary conversation-queue-button" disabled={!canQueue} onClick={() => {if (canQueue) send(draft, 'queue');}}>Queue</button>}
        {jobInstruction !== undefined ? <button type="submit" form={formId} disabled={!ready || currentRouting?.status === 'loading'}>Message job</button>
          : steerable ? <button type="submit" form={formId} disabled={!canSteer}>Send</button>
          : answerable && <button type="submit" form={formId} disabled={!canSubmit}>{pending ? 'Answer' : 'Send'}</button>}
      </div>
    </>}</ConversationUpload>
    {showInput && <div id="assistant-input-help" className="conversation-input-help">
      <p>{pending && answerable ? 'Enter to answer.' : steerable ? 'Enter to send: the task reads it at its next step.' : answerable && !open ? 'Enter to send.' : 'Enter to queue.'} Shift+Enter for a new line.</p>
      {queued >= LIMITS.queuedMessages && <p>The queue is full. Withdraw a message or wait for one to start.</p>}
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
  // An earlier conversation of this profile the owner opened from Details (Hub #2029), read only; undefined shows the current one.
  const [viewing, setViewing] = useState<string>();
  const previousProfile = useRef(profile);
  const [conversations, setConversations] = useState<readonly ConversationListEntry[]>();
  // The cursor of the next page of the profile's conversations, or null when every one is listed.
  const [olderConversations, setOlderConversations] = useState<string | null>(null);
  const historyRef = useRef<ConversationHistory>(undefined);
  const historyAttempt = useRef<HistoryAttempt>(undefined);
  const [historyStatus, setHistoryStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const failedCursor = useRef<string>(undefined);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [speakRequest, setSpeakRequest] = useState<string>();
  const coding = useCodingState(context);
  const companionSpeech = useCompanionSpeechCopy(context);
  const speech = useSpeechControlsSession(context, companionSpeech.copy);
  const [panel, setPanel] = useState<'voice' | 'details'>();
  const detailsOpen = panel === 'details';
  const detailsOverlay = useDetailsOverlay();
  const detailsId = useId();
  const detailsTrigger = useRef<HTMLButtonElement>(null);
  const priorPanel = useRef<typeof panel>(undefined);
  const readCodingJobs = useCallback((path: string) => api.read(path), [api]);
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
      ? refreshConversationHistory(read, profile, controller.signal, prior, viewing)
      : prior?.profile === profile && prior.earlier === (viewing !== undefined) ? loadEarlierConversationHistory(read, prior, before, controller.signal) : undefined;
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
  }, [api, connected, profile, viewing]);
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
  }, [profile, viewing]);
  // Another profile opens on its current conversation.
  useLayoutEffect(() => {
    const opening = conversationRail.takeOpening(profile);
    if (opening !== undefined || previousProfile.current !== profile) setViewing(opening);
    previousProfile.current = profile;
  }, [profile]);
  useEffect(() => {
    if (viewing !== undefined && conversations?.some(entry => entry.current && entry.conversationId === viewing) === true) {
      setViewing(undefined);
    }
  }, [conversations, viewing]);
  // The profile's conversations, current and earlier (Hub #2029), read while Details is open or an earlier one is shown,
  // and again at each change of the assistant's state meanwhile.
  const listed = detailsOpen || viewing !== undefined;
  useEffect(() => {
    setConversations(undefined);
    if (!connected || historyApi !== api || !listed) return;
    const controller = new AbortController();
    void readConversationList(path => api.read(path), profile, controller.signal).then(list => {
      if (!controller.signal.aborted) {setConversations(list.conversations); setOlderConversations(list.older);}
    }, () => {if (!controller.signal.aborted) setConversations(undefined);});
    return () => {controller.abort();};
  }, [api, connected, historyApi, listed, profile, state?.revision]);
  const showOlderConversations = (): void => {
    const after = olderConversations;
    if (after === null || conversations === undefined) return;
    void readConversationList(path => api.read(path), profile, new AbortController().signal, after).then(list => {
      setConversations(prior => prior === undefined ? prior : [...prior, ...list.conversations.filter(next => !prior.some(value => value.conversationId === next.conversationId))]);
      setOlderConversations(list.older);
    }, () => {setOlderConversations(after);});
  };
  // The rail marks a conversation that needs the owner. The page shares the kind of question it has already read.
  useEffect(() => {
    const task = history?.currentTask;
    if (history !== undefined && task?.question != null) conversationRail.learn(history.profile, {taskId: task.taskId, questionId: task.question.id, kind: task.question.kind});
  }, [history]);
  const live = connected && !unavailable && state !== undefined && state.available;
  const spend = useSpend(api, connected && historyApi === api, state?.revision);
  // The current conversation's queued messages (Hub #2030), read again at each assistant-state revision, and an earlier
  // conversation's messages that an earlier release left behind.
  const queue = useQueue(api, connected && historyApi === api && viewing === undefined, profile, state?.revision);
  const leftover = useQueue(api, connected && historyApi === api && viewing !== undefined, profile, state?.revision, viewing);
  // Every profile's new message meets the shared spend limits on a paid provider (Hub #2026); the synthetic one costs nothing.
  const spendLimit = spendNotice(spend);
  // A profile whose persona's audio is not speech shows why in place of Read aloud (Hub #2026).
  const unspoken = unspokenNote(profile);
  const task = state?.tasks.find(value => value.profile === profile);
  const open = task !== undefined && !finished(task.status);
  // Every conversation with an unfinished task: the one switch stays on until each finishes or is cancelled.
  const unfinished = state?.tasks.filter(value => !finished(value.status)).map(value => value.profile) ?? [];
  const visibleHistory = history?.profile === profile && history.earlier === (viewing !== undefined) &&
    (viewing === undefined || history.conversationId === viewing) ? history : undefined;
  const earlier = viewing === undefined ? undefined : conversations?.find(value => value.conversationId === viewing);
  const visibleMessageIds = new Set(visibleHistory?.windows.flatMap(window => window.messages.map(message => message.id)));
  const hasArt = visibleHistory?.windows.some(window => window.messages.some(message => message.attachment !== undefined)) ?? false;
  const art = useConversationArt(context.api, connected && hasArt);
  const savedTask = visibleHistory?.currentTask;
  const currentQuestion = task !== undefined && savedTask?.taskId === task.taskId && savedTask.question?.id === task.questionId ? savedTask.question : undefined;
  const pendingQuestion = task !== undefined && task.questionId !== null && !task.hasAnswer && ['waiting', 'paused'].includes(task.status);
  const activeClarification = pendingQuestion && currentQuestion?.kind === 'clarification' ? currentQuestion : undefined;
  let cue = task === undefined ? undefined : taskCue[task.status];
  if (task?.status === 'waiting' && pendingQuestion) cue = activeClarification && 'Needs your answer';
  const {Command, Facts} = context.ui;
  // The conversation's session title as the core publishes it (Hub #2025): written by the model, the owner's name, or the persona.
  const conversationId = task?.conversationId ?? (visibleHistory?.earlier === false ? visibleHistory.conversationId : undefined)
    ?? conversations?.find(value => value.current)?.conversationId ?? null;
  const session = conversationId === null ? undefined
    : context.core?.sessions.find(view => view.identity.provider === 'bunny' && view.identity.sessionId === conversationId);
  const title: ConversationTitle | undefined = session?.title === undefined ? undefined : {value: session.title.value, source: session.title.source};
  return <section aria-label="B.U.N.N.Y. conversation" className="conversation-page">
    <Command context={context} target="assistant">{command => {
      const locked = command.locked || !live || !context.control || !context.operationsLive;
      const stopJob = (jobId: string, operationId: string): void => {stopCodingJob(command, jobId, operationId);};
      const continueJob = (commandData: Parameters<typeof continueCodingJob>[1]): void => {continueCodingJob(command, commandData);};
      const speakReceipt = speakRequest !== undefined && command.requestId === speakRequest;
      const operation = context.operations.find(value => value.target === 'assistant' && value.requestId === command.requestId);
      const routineReceipt = !speakReceipt && !command.locked && (command.requestId === undefined || (
        context.operationsLive && operation?.status === 'completed' && operation.result === 'succeeded'
      ));
      const present = (action: 'enable' | 'disable'): void => {
        if (state === undefined || locked || (action === 'disable' && unfinished.length > 0)) return;
        void command.run({family: 'assistant-control', target: 'assistant', requestId: crypto.randomUUID(),
          data: {action, expectedRevision: state.revision}});
      };
      // New conversation (Hub #2029): the module refuses it while this conversation's task is unfinished, so the page does too.
      // An empty current conversation has nothing to leave behind, so New conversation waits for its first message.
      const empty = viewing === undefined && visibleHistory !== undefined && !visibleHistory.earlier && task === undefined &&
        !visibleHistory.windows.some(window => window.messages.length > 0);
      const held = viewing !== undefined ? undefined : open ? 'Finish or cancel this conversation\'s task first.'
        : (queue?.messages.length ?? 0) > 0 ? 'Start or withdraw the queued messages first.' : empty ? 'This conversation is empty. Send a message first.' : undefined;
      const canStartNew = state !== undefined && !locked && held === undefined && viewing === undefined;
      const startNew = (): void => {
        if (!canStartNew) return;
        void command.run({family: 'assistant-input', target: 'assistant', requestId: crypto.randomUUID(),
          upload: {name: 'input.json', file: new Blob([JSON.stringify({action: 'new-conversation', profile, expectedRevision: state.revision})], {type: 'application/json'})}});
      };
      return <div className="conversation-layout">
        <div className="conversation-main">
          <div className="conversation-context">
            <header className="conversation-header">
              <h2>{profiles[profile].name}</h2>
              {/* A phone header shows a plus sign; the button's name stays "New conversation". */}
              <button type="button" className="secondary conversation-new" disabled={!canStartNew} aria-label="New conversation" title="New conversation"
                aria-describedby={held === undefined ? undefined : `${detailsId}-new-held`} onClick={startNew}>
                <span className="conversation-new-wide" aria-hidden="true">New conversation</span><span className="conversation-new-narrow" aria-hidden="true">+</span></button>
              <button type="button" className="secondary conversation-details-trigger" ref={detailsTrigger}
                aria-expanded={detailsOpen} aria-controls={detailsId} onClick={() => {
                  if (detailsOpen) closeDetails();
                  else setPanel('details');
                }}>Details</button>
            </header>
            {held !== undefined && <p id={`${detailsId}-new-held`} className="conversation-new-held">{held}</p>}
            {viewing !== undefined && <div className="conversation-earlier" role="note">
              <p>{earlier === undefined ? '' : <><strong>{earlier.title.value}</strong> · </>}Earlier conversation, read only. New messages go to the current conversation.</p>
              <button type="button" className="secondary" onClick={() => {setViewing(undefined);}}>Back to current conversation</button>
            </div>}
            {!connected ? <p role="status">Disconnected. Saved history remains readable. Last known task state.</p>
              : !live && <p role="status">Stale. Current conversation state is unavailable. Saved history remains readable.</p>}
            {!context.control && <p>Read-only access. Controls require operator authority.</p>}
            {context.control && !context.operationsLive && <p>Tracked operations are unavailable. Conversation controls are locked.</p>}
          </div>
          <ConversationTranscript key={`${profile}:${viewing ?? 'current'}`} history={visibleHistory} status={!connected && historyStatus === 'loading' ? 'unavailable' : historyStatus}
            live={live} canStart={!locked && state?.enabled === true && !open && viewing === undefined}
            readLocked={!connected || historyStatus === 'loading'} loadEarlier={before => {readHistory(before);}} retry={() => {readHistory(failedCursor.current);}}
            renderToolEvidence={message => {
              const operation = context.operations.find(value => value.requestId === message.id && value.requestedBy === 'bunny/modules/companions');
              if (operation === undefined) return null;
              return <p>Tracked operation {operation.result ?? operation.status}
                {operation.evidence !== undefined && operation.evidence !== 'none' ? ` · evidence ${operation.evidence}` : ''}
                {operation.error !== undefined ? ` · ${operation.error.code}` : ''}{!context.operationsLive ? ' (Last known)' : ''}</p>;
            }}
            renderMessage={message => {
              const jobReceipt = message.role === 'assistant' && /^.+-step-\d+-job$/u.test(message.id);
              return <article aria-label={`${message.role} message`}>
                <strong className="conversation-speaker">{message.role === 'owner' ? 'You' : profiles[profile].name}</strong>
                {/* A steer joined the running turn, and a reply it superseded was saved but not spoken (Hub #2031). */}
                {steerMessage(message) && <small className="conversation-steer-note">Sent while working</small>}
                {supersededReply(message) && <small className="conversation-steer-note">Earlier reply, before your next message</small>}
                {message.follows !== undefined && (visibleMessageIds.has(message.follows)
                  ? <a href={`#conversation-message-${message.follows}`} onClick={event => {
                    event.preventDefault();
                    document.getElementById(`conversation-message-${message.follows}`)?.focus();
                  }}>Update to earlier reply</a>
                  : <small>Update to an earlier reply. Load earlier messages to see it.</small>)}
                <p className="conversation-message-text" dir="auto">{message.text}</p>
                {jobReceipt && <ConversationCodingJob jobId={message.id} revision={coding?.revision}
                  read={readCodingJobs} locked={locked} stop={stopJob} continueJob={continueJob} operations={context.operations}
                  message={(job, text, requestId) => {messageCodingJob(command, job, text, requestId);}}/>}
                {message.attachment !== undefined && <ArtworkAttachment key={message.attachment.requestId} context={context}
                  connected={connected} allowShow={live && state?.enabled === true && state.tools.includes('control_art_show')} attachment={message.attachment}
                  artRevision={art?.revision}/>}
                {message.role === 'assistant' && (unspoken !== undefined
                  ? <small className="conversation-voice-note">{unspoken}</small>
                  : message.text.length > LIMITS.spokenChars
                  ? <small className="conversation-voice-note">Written only. Read aloud supports up to {LIMITS.spokenChars} characters.</small>
                  : state !== undefined && <button type="button" aria-label={`Read aloud message ${message.seq}`}
                  className="secondary conversation-read-aloud" disabled={locked}
                  onClick={() => {
                    const requestId = crypto.randomUUID();
                    setSpeakRequest(requestId);
                    void command.run({family: 'assistant-control', target: 'assistant', requestId,
                      data: {action: 'speak', expectedRevision: state.revision, taskId: message.taskId, messageId: message.id}});
                  }}>Read aloud</button>)}
              </article>;
            }}/>
          {viewing === undefined && <div className="conversation-compose">
            {state !== undefined && !state.enabled && <p>Conversation is off. <button type="button" disabled={locked} onClick={() => {present('enable');}}>Enable conversation</button></p>}
            {cue !== undefined && <p role="status" className={live && task?.status === 'succeeded' ? 'conversation-completed' : undefined}>
              {cue}{!live ? ' (Last known)' : ''}
            </p>}
            {task?.code != null && <p>Task code: {task.code}</p>}
            {spendLimit !== undefined && <p role="status">{spendLimit}</p>}
            {state?.enabled === true && task?.status === 'running' && <p>This task is working. Send steers it at its next step; Queue saves a message for after it.</p>}
            {state?.enabled === true && task?.status === 'uncertain' && <p>Resume or cancel this task before sending another message. Queued messages wait until it ends.</p>}
            {activeClarification !== undefined && <SavedQuestionContext question={activeClarification}/>}
            <TaskControls context={context} command={command} state={state} profile={profile} live={live} question={currentQuestion} coding={connected ? coding : undefined} queue={queue}
              drafts={drafts} setDraft={(key, value) => {setDrafts(prior => ({...prior, [key]: value}));}}
              refreshHistory={() => {readHistory();}} historyBusy={historyStatus === 'loading'}
              voice={<ConversationVoice context={context} speech={speech} open={panel === 'voice'} onOpenChange={setVoiceOpen}
                stopSpeaking={stopInDrawer ? null : stopSpeaking}/>}/>
            {!routineReceipt && <p role="status">{speakReceipt ? 'Read aloud receipt' : 'Command receipt'}: {command.text}</p>}
          </div>}
          {viewing !== undefined && leftover !== undefined && <div className="conversation-compose">
            <QueuedMessages context={context} command={command} queue={leftover} profile={profile} waiting={false} locked={locked} enabled={state?.enabled === true}/>
          </div>}
          {viewing !== undefined && !routineReceipt && <p role="status">{speakReceipt ? 'Read aloud receipt' : 'Command receipt'}: {command.text}</p>}
        </div>
        <ConversationDetails id={detailsId} open={detailsOpen} overlay={detailsOverlay} onClose={closeDetails}
          codingJobs={<><a href="#/module/companions/jobs">Open Jobs</a>
            {coding?.counts !== undefined && detailsOpen && <CodingJobs revision={coding.revision}
              read={readCodingJobs} stop={stopJob} continueJob={continueJob} locked={locked} operations={context.operations}
              message={(job, text, requestId) => {messageCodingJob(command, job, text, requestId);}}/>}</>}
          stopSpeaking={stopInDrawer ? stopSpeaking : null} Facts={Facts} profile={profile} profileName={profiles[profile].name} state={state} task={task}
          coding={connected ? coding : undefined} live={live} spend={spend}
          savedQuestion={currentQuestion === undefined ? null : <SavedQuestionContext question={currentQuestion}/>}
          receipt={routineReceipt ? command.text : undefined} locked={locked} unfinished={unfinished} goTo={owner => {
            // The chosen conversation shows at once; the narrow Details overlay would hide it, so it closes, as the rail's choice is made with it closed.
            conversationRail.select(owner);
            if (detailsOverlay) closeDetails();
          }} setEnabled={present}
          conversations={conversations} viewing={viewing} showOlder={olderConversations === null ? undefined : showOlderConversations} openConversation={id => {
            setViewing(conversations?.find(value => value.conversationId === id)?.current === true ? undefined : id);
            if (detailsOverlay) closeDetails();
          }}
          title={title} rename={value => {
            if (state === undefined || locked) return;
            void command.run({family: 'assistant-control', target: 'assistant', requestId: crypto.randomUUID(),
              data: {action: 'rename', expectedRevision: state.revision, profile, title: value}});
          }}/>
      </div>;
    }}</Command>
  </section>;
}
