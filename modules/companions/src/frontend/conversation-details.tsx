import React, {useEffect, useId, useRef, useLayoutEffect, useState, useSyncExternalStore} from 'react';
import type {AssistantProfile, AssistantState, AssistantTaskSummary} from '@jimmie-potts/event-contracts/v2/assistant';
import type {CodingState} from '@jimmie-potts/event-contracts/v2/coding';
import type {FrontendUi} from '@jimmie-potts/sdk/frontend';
import {LIMITS} from '../assistant/limits.js';
import type {SpendView} from '../assistant/spend-contract.js';
import type {ConversationListEntry} from '../assistant/history-contract.js';
import {priceText, spendText} from './conversation-spend.js';
import {profiles} from './conversation-rail.js';
import {profileTools} from '../assistant/tool-scope.js';

/** The longest owner title, as the session label bound (Hub #2025). */
const TITLE_CHARS = 80;
/** The conversation's published session title and its source, or undefined while the session is not shown. */
export type ConversationTitle = {value: string; source: 'provider' | 'user'};

const detailsOverlay = '(width < 1120px)';

function subscribeDetailsLayout(change: () => void): () => void {
  const query = window.matchMedia(detailsOverlay);
  query.addEventListener('change', change);
  return () => {query.removeEventListener('change', change);};
}

export function useDetailsOverlay(): boolean {
  return useSyncExternalStore(subscribeDetailsLayout, () => window.matchMedia(detailsOverlay).matches);
}

const catalog = ['read_sessions', 'set_mode', 'delegate_coding'];

function workerAvailability(coding: CodingState | undefined): string {
  switch (coding?.availability) {
    case 'available': return coding.active === null ? 'Connected and idle' : `Running task ${coding.active.taskId.slice(0, 8)} (${coding.active.status})`;
    case 'unavailable': return 'Lost. Start it again on your computer.';
    case 'off': return 'Not connected';
    case undefined: return 'Unknown';
  }
}

function toolList(names: readonly string[] | undefined): string {
  if (names === undefined) return 'Unknown';
  return names.length === 0 ? 'None' : names.join(', ');
}

/**
 * Where a session title came from (Hub #2025): the owner's name, the persona name, which stands until a title model
 * writes one and always for a profile without a title model, or a model's title. A synthetic profile has no title model,
 * so a title on it is a test's fixed title.
 */
function titleOrigin(title: ConversationTitle, profileName: string, synthetic: boolean): string {
  if (title.source === 'user') return 'your name';
  if (title.value === profileName) return synthetic ? 'persona name; this profile has no title model' : 'persona name until a title is written';
  return synthetic ? 'fixed synthetic title' : 'written by the model';
}

export function ConversationDetails({
  id, open, overlay, onClose, stopSpeaking,
  Facts, profile, profileName, state, task, coding, live, spend, savedQuestion, receipt, locked, unfinished, goTo, setEnabled, title, rename,
  conversations, viewing, openConversation,
}: {
  id: string; open: boolean; overlay: boolean; onClose: () => void; stopSpeaking: React.JSX.Element | null;
  Facts: FrontendUi['Facts']; profile: AssistantProfile; profileName: string;
  state: AssistantState | undefined; task: AssistantTaskSummary | undefined; coding: CodingState | undefined; live: boolean;
  spend: SpendView | undefined;
  savedQuestion: React.ReactNode; receipt: string | undefined; locked: boolean;
  /**
   * The profiles whose conversation has an unfinished task, which keep the one switch from turning off (Hub #2027).
   * `goTo` opens another of them; the open conversation is named, not linked.
   */
  unfinished: readonly AssistantProfile[]; goTo: (profile: AssistantProfile) => void;
  setEnabled: (action: 'enable' | 'disable') => void;
  title: ConversationTitle | undefined; rename: (title: string) => void;
  /**
   * The profile's conversations, newest first (Hub #2029), or undefined while unread. `viewing` is the earlier one the page
   * shows, if any; `openConversation` shows one, the current one included.
   */
  conversations: readonly ConversationListEntry[] | undefined; viewing: string | undefined; openConversation: (conversationId: string) => void;
}): React.JSX.Element {
  const renameId = useId();
  const [draftTitle, setDraftTitle] = useState('');
  const proposed = draftTitle.trim().replace(/\s+/gu, ' ');
  const canRename = !locked && state !== undefined && proposed !== '' && [...proposed].length <= TITLE_CHARS && proposed !== title?.value;
  const panelRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (panel === null) return;
    if (!open) {
      panel.close();
      return;
    }
    const focus = document.activeElement;
    // Change how the same dialog opens when the viewport crosses the breakpoint.
    // Keep the disclosures and their scroll container mounted in both modes.
    if (panel.open) panel.close();
    if (overlay) panel.showModal();
    else panel.show();
    const target = focus instanceof HTMLElement && panel.contains(focus) ? focus : closeRef.current;
    target?.focus({preventScroll: true});
  }, [open, overlay]);
  useEffect(() => {
    if (!open || overlay) return;
    function escape(event: KeyboardEvent): void {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    }
    document.addEventListener('keydown', escape);
    return () => {document.removeEventListener('keydown', escape);};
  }, [open, overlay, onClose]);

  // Every profile uses the configured provider and model (Hub #2026).
  const synthetic = state?.provider === 'synthetic';
  const unit = synthetic ? 'units' : 'tokens';
  // The tools this profile's model is offered: device and catalog tools stay B.U.N.N.Y.'s (Hub #2026).
  const allowed = state === undefined ? undefined : profileTools(state.tools, profile);
  const withheld = state === undefined || allowed === undefined ? [] : state.tools.filter(name => !allowed.includes(name));
  const unavailable = state === undefined ? undefined : catalog.filter(name => !state.tools.includes(name));
  const lastKnown = state !== undefined && !live;
  const enabled = state?.enabled;
  return <dialog id={id} ref={panelRef} className="conversation-details" aria-labelledby={`${id}-title`}
    onCancel={event => {event.preventDefault(); onClose();}}
    onPointerDown={event => {
      if (!overlay || event.button !== 0 || event.target !== event.currentTarget) return;
      const {left, top, right, bottom} = event.currentTarget.getBoundingClientRect();
      if (event.clientX >= left && event.clientX <= right && event.clientY >= top && event.clientY <= bottom) return;
      event.preventDefault();
      onClose();
    }}>
    <header className="conversation-details-header">
      <h2 id={`${id}-title`}>Conversation details</h2>
      <button type="button" className="secondary" ref={closeRef} onClick={onClose} aria-label="Close details">Close</button>
    </header>
    <div className="conversation-details-sections">
      <p className="conversation-details-profile"><strong>{profileName}</strong></p>
      <details>
        <summary>Capabilities</summary>
        {lastKnown && <p>Last known provider and tools.</p>}
        <Facts items={[
          ['Provider', synthetic ? 'Synthetic (no paid calls)' : state?.provider === 'anthropic' ? 'Anthropic' : 'Unknown'],
          ['Model', state?.model ?? 'Unknown'],
          ['Allowed tools', toolList(allowed)],
          ...(withheld.length === 0 ? [] : [['B.U.N.N.Y. only', toolList(withheld)] as const]),
          ['Unavailable tools', toolList(unavailable)],
          ['Coding worker', workerAvailability(coding)],
        ]}/>
        <p>Reads need no approval. Proposed changes need your approval in the conversation.</p>
      </details>
      <details>
        <summary>Task activity</summary>
        {lastKnown && <p>Last known task activity.</p>}
        {task === undefined
          ? <p>{state === undefined ? 'Task activity is unavailable.' : `No task saved for ${profileName}.`}</p>
          : <Facts items={[
            ['Task', task.taskId], ['Conversation', task.conversationId], ['Run', task.runId ?? 'Not active'],
            ['Status', task.status === 'uncertain' ? 'Uncertain outcome' : task.status],
            ['Model calls', `${task.modelCalls} / ${LIMITS.modelCalls}`], ['Tool calls', `${task.toolCalls} / ${LIMITS.toolCalls}`],
            ['Questions', `${task.questions} / ${LIMITS.questions}`], ['Active time', `${(task.activeMs / 60_000).toFixed(1)} / ${LIMITS.activeMs / 60_000} minutes`],
            ...(task.code === null ? [] : [['Task code', task.code] as const]),
          ]}/>}
        {savedQuestion}
        {receipt !== undefined && <Facts items={[[lastKnown ? 'Last known command receipt' : 'Command receipt', receipt]]}/>}
        <p>A successful command receipt confirms the control was saved. Task completion and playback are reported separately.</p>
      </details>
      <details>
        <summary>Usage</summary>
        {lastKnown && <p>Last known usage.</p>}
        {task === undefined ? <p>Usage is unavailable without a saved task.</p> : <Facts items={[
          [synthetic ? 'Synthetic model usage' : 'Model usage', task.usageUnits === null ? 'Unknown' : `${task.usageUnits} ${unit}`],
          ['Reserved usage', `${task.reservedUnits} / ${LIMITS.units} ${unit}`],
          ['Paid cost', synthetic ? '0 (synthetic calls)' : 'Unknown (provider billing)'],
        ]}/>}
        <Facts items={[
          ['Spend today', spend === undefined ? 'Unknown' : spendText(spend.day)],
          ['Spend this month (estimate)', spend === undefined ? 'Unknown' : spendText(spend.month)],
          ['Prices', priceText(spend)],
        ]}/>
        <p>Spend counts every profile's paid model calls from reported usage at the configured or built-in prices, by the runtime host's local day and month. A call without reported usage counts its reservation. Coding-worker runs are not counted.</p>
        <p>This month's figure is a local estimate. The Anthropic Console holds the real monthly limit and spend.</p>
      </details>
      <details>
        <summary>Conversations</summary>
        {conversations === undefined ? <p>The list of conversations is unavailable.</p> : conversations.length === 0 ? <p>No conversation saved for {profileName} yet.</p>
          : <ul className="conversation-list" aria-label={`${profileName} conversations`}>{conversations.map(value => {
            const shown = value.current ? viewing === undefined : viewing === value.conversationId;
            const when = value.lastAtMs === null ? 'No messages yet' : `${String(value.messages)} ${value.messages === 1 ? 'message' : 'messages'}, last ${new Date(value.lastAtMs).toLocaleString()}`;
            return <li key={value.conversationId}>
              <span className="conversation-list-title">{value.title.value}</span>
              <small>{value.current ? 'Current. ' : 'Earlier, read only. '}{when}</small>
              {shown ? <small aria-current="true">Shown now</small>
                : <button type="button" className="secondary" onClick={() => {openConversation(value.conversationId);}}>{value.current ? 'Show current conversation' : 'Open'}</button>}
            </li>;
          })}</ul>}
        <p>New conversation starts a fresh conversation with its own session and title. Earlier conversations stay readable here, and their messages no longer reach the model.</p>
      </details>
      <details>
        <summary>Conversation settings</summary>
        {enabled === undefined ? <p>Conversation settings are unavailable.</p> : <>
          <p>{lastKnown ? 'Last known setting: ' : 'Conversation is '}{enabled ? 'on' : 'off'}.</p>
          <button type="button" className="secondary" disabled={locked || (enabled && unfinished.length > 0)}
            onClick={() => {setEnabled(enabled ? 'disable' : 'enable');}}>{enabled ? 'Disable conversation' : 'Enable conversation'}</button>
          {enabled && unfinished.length > 0 && <div className="conversation-unfinished">
            <p>Disabling turns off every conversation, so every unfinished task must be finished or cancelled first.</p>
            {unfinished.includes(profile) && <p>This conversation has an unfinished task.</p>}
            {unfinished.some(owner => owner !== profile) && <ul aria-label="Other unfinished conversations">{unfinished.filter(owner => owner !== profile).map(owner => <li key={owner}>
              <button type="button" className="secondary" onClick={() => {goTo(owner);}}>Go to {profiles[owner].name} task</button>
            </li>)}</ul>}
          </div>}
        </>}
        <Facts items={[['Session title', title === undefined ? 'Not shown on the status devices now'
          : `${title.value} (${titleOrigin(title, profileName, synthetic)})`]]}/>
        <form className="conversation-rename" onSubmit={event => {
          event.preventDefault();
          if (!canRename) return;
          rename(proposed);
          setDraftTitle('');
        }}>
          <label htmlFor={renameId}>Rename conversation</label>
          <input id={renameId} type="text" value={draftTitle} maxLength={TITLE_CHARS} disabled={locked} placeholder="#1896 Session tracking"
            onChange={event => {setDraftTitle(event.target.value);}}/>
          <button type="submit" className="secondary" disabled={!canRename}>Rename</button>
        </form>
        <p>{synthetic ? 'This profile has no title model, so it keeps its persona name until you rename it.'
          : 'The title model writes a short title after the first message and checks it after each finished task and major event, such as an approval or a coding hand-off. Your name replaces it, and the model keeps your name unless the topic clearly changes.'}</p>
        <p>Submitted messages and answers are saved in private Conversation history. {synthetic
          ? 'The synthetic provider answers them locally and makes no paid calls.'
          : 'They are passed to the configured model, which B.U.N.N.Y., Reachy and MicroDuck share, with the recent messages and tool results of this conversation as context, and every conversation\'s calls count toward the same spend limits.'} The Companion knowledge page previews that context.</p>
        <p>Unsent drafts stay in this page until reload. Submitted drafts also stay in the composer. Review saved history before sending the same text again.</p>
        <ul className="conversation-settings-links">
          <li><a href="#/module/companions/preferences">Preferences</a></li>
          <li><a href="#/module/companions/knowledge">Companion knowledge</a></li>
        </ul>
      </details>
    </div>
    {stopSpeaking !== null && <footer className="conversation-details-footer">{stopSpeaking}</footer>}
  </dialog>;
}
