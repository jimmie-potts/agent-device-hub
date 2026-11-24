import React, {useEffect, useState, useSyncExternalStore} from 'react';
import type {AssistantProfile, AssistantState} from '@jimmie-potts/event-contracts/v2/assistant';
import type {FrontendContext} from '@jimmie-potts/sdk/frontend';
import type {SyncedCopy} from '@jimmie-potts/sdk';
import {refreshConversationHistory} from './conversation-history.js';
import {conversationRail, pendingQuestions, profiles, questionToRead, waitingElsewhere, waitingProfiles} from './conversation-rail.js';

/** The Conversation page's address in the dashboard, as the companion cards already link to their pages. */
const CONVERSATION = '#/module/companions/assistant';

/**
 * Whether a conversation other than the open one needs the owner's answer (Hub #1890), for the dashboard's phone
 * menu button. It reads the shared store only, so it is false whenever the rail group is not mounted or has no live
 * state to go by.
 */
export const useConversationWaiting = (): boolean => useSyncExternalStore(conversationRail.subscribe, () => waitingElsewhere(conversationRail.getSnapshot()));

/**
 * The rail's conversation group (Hub #1890): one link for each chat profile, on every page. The dashboard mounts it
 * in its own module scope and draws it with the rail's own classes. A link chooses the profile in the shared store
 * and opens the Conversation page; it sends nothing. The group holds no command control and no speech session, so the
 * Conversation page stays the one owner of both.
 *
 * The marker says a conversation needs the owner's answer or approval. The group follows `assistant-state` through
 * its own read-only copy, and reads a profile's recent history once to learn what kind of question is pending, unless
 * the open Conversation page has already read it. A wait on the coding worker shows no marker. Without a live copy,
 * or while the kind is unknown, there is no marker.
 */
export function ConversationRail({context}: {context: FrontendContext}): React.JSX.Element {
  const {api, connected} = context;
  const rail = useSyncExternalStore(conversationRail.subscribe, conversationRail.getSnapshot);
  const [state, setState] = useState<AssistantState>();
  const [current, setCurrent] = useState(false);
  useEffect(() => {
    setCurrent(false);
    if (!connected) return;
    let active = true;
    let copy: SyncedCopy<AssistantState> | undefined;
    const show = (): void => {
      const found = copy?.states().find(message => message.data.id === 'assistant');
      if (found !== undefined) setState(found.data);
      setCurrent(found !== undefined);
    };
    void api.sync<AssistantState>(['assistant-state'], change => {
      if (!active) return;
      if (change.type === 'updated' && change.message.data.id === 'assistant') {setState(change.message.data); setCurrent(true);}
      else if (change.type === 'failed' || change.type === 'removed') setCurrent(false);
      else if (change.type === 'synced' && copy !== undefined) show();
    }, {onRestarted: () => {if (active) setCurrent(false);}}).then(result => {
      if (result.status !== 'synced') return;
      if (!active) {void result.copy.close(); return;}
      copy = result.copy;
      show();
    }, () => {/* No copy: no marker. The rows stay links. */});
    return () => {active = false; void copy?.close();};
  }, [api, connected]);
  const live = connected && current && state?.available === true;
  const pending = pendingQuestions(state, live);
  const waiting = waitingProfiles(pending, rail.questions);
  const waitingKey = waiting.join(' ');
  useEffect(() => {conversationRail.setWaiting(waitingKey === '' ? [] : waitingKey.split(' ') as AssistantProfile[]);}, [waitingKey]);
  useEffect(() => () => {conversationRail.setWaiting([]);}, []);
  // One bounded read of the recent history tells a question for the owner from a wait on the coding worker. It is
  // never repeated on a timer. A read that fails, or that returns another question, is made again when the state copy
  // next changes or is live again, or when the open Conversation page stops showing that profile: each of those
  // changes what this effect depends on, and nothing else does.
  const reading = questionToRead(pending, rail);
  const readProfile = reading?.profile, readTask = reading?.taskId, readQuestion = reading?.questionId, revision = state?.revision;
  useEffect(() => {
    if (readProfile === undefined) return;
    const controller = new AbortController();
    void refreshConversationHistory(path => api.read(path), readProfile, controller.signal).then(history => {
      const task = history.currentTask;
      if (task?.question != null) conversationRail.learn(readProfile, {taskId: task.taskId, questionId: task.question.id, kind: task.question.kind});
    }, () => {/* No kind: no marker for this question. */});
    return () => {controller.abort();};
  }, [api, readProfile, readTask, readQuestion, revision]);
  return <>
    <p className="rail-label"><span>Conversations</span></p>
    <nav aria-label="Conversations">
      {(Object.entries(profiles) as [AssistantProfile, {name: string}][]).map(([id, {name}]) => {
        const needs = waiting.includes(id);
        return <a key={id} href={CONVERSATION} data-profile={id} aria-current={rail.open && rail.profile === id ? 'page' : undefined} onClick={event => {
          // A modified click opens the page elsewhere, as any link does, and chooses nothing here.
          if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          conversationRail.select(id);
          window.scrollTo(0, 0);
        }}>
          <span className="rail-mono" aria-hidden="true">{name.slice(0, 1)}{needs && <span className="rail-attention"/>}</span>
          <span className="rail-text"><span>{name}</span>{needs && <span className="rail-need">Needs your answer</span>}</span>
        </a>;
      })}
    </nav>
  </>;
}
