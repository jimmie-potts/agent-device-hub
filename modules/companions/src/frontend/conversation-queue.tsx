// Queued messages above the Conversation composer (Hub #2030): the current conversation's waiting messages in the order
// they start, each of which the owner can edit, withdraw or move, and the queue's hold with the control that releases
// it. Each change is a tracked command that names the revision the shown queue was read at, or that an edit opened at,
// so an edit left open never overwrites a change made elsewhere and a move never acts on an order the page no longer
// shows. The list shows what the module saved. An earlier conversation shows only messages an earlier release left
// there, which never start and can only be withdrawn.
import React, {useEffect, useState} from 'react';
import type {AssistantProfile} from '@jimmie-potts/event-contracts/v2/assistant';
import type {FrontendCommand, FrontendContext} from '@jimmie-potts/sdk/frontend';
import {LIMITS} from '../assistant/limits.js';
import {holdText, type QueueView} from './conversation-queue-read.js';

type Props = {
  context: FrontendContext; command: FrontendCommand; queue: QueueView; profile: AssistantProfile;
  /** Whether a task of this conversation is unfinished, so the next message waits for it. */
  waiting: boolean; locked: boolean; enabled: boolean;
  /** An edit whose message started or left the queue before it was saved: its text, so it is not lost. */
  onLost?: (text: string) => void;
};
type Editing = {id: string; original: string; text: string; revision: number; requestId?: string | undefined; refused?: string | undefined};

/** The tracked command with this request ID once it completed: whether it succeeded, or its refusal code. */
const outcome = (context: FrontendContext, requestId: string): {ok: true} | {ok: false; code: string} | undefined => {
  const operation = context.operations.find(value => value.requestId === requestId);
  if (operation === undefined || operation.status === 'sent' || operation.status === 'accepted') return undefined;
  return operation.status === 'completed' && operation.result === 'succeeded' ? {ok: true} : {ok: false, code: operation.error?.code ?? operation.result ?? operation.status};
};

export function QueuedMessages({context, command, queue, profile, waiting, locked, enabled, onLost}: Props): React.JSX.Element | null {
  const [editing, setEditing] = useState<Editing>();
  // An edit closes once its command succeeded; a refused one stays open with its text and says why, and Save works again.
  useEffect(() => {
    if (editing?.requestId === undefined) return;
    const done = outcome(context, editing.requestId);
    if (done === undefined) return;
    if (done.ok) setEditing(undefined);
    else setEditing({...editing, requestId: undefined, refused: done.code});
  }, [context, editing]);
  // A message that started or was withdrawn while open for editing takes its editor with it; changed text goes back to
  // the owner instead of being dropped.
  useEffect(() => {
    if (editing === undefined || queue.messages.some(message => message.id === editing.id)) return;
    if (editing.text.trim() !== '' && editing.text !== editing.original) onLost?.(editing.text);
    setEditing(undefined);
  }, [editing, onLost, queue.messages]);
  if (queue.messages.length === 0) return null;
  const earlier = !queue.current;
  const control = (data: Record<string, unknown>): void => {
    void command.run({family: 'assistant-control', target: 'assistant', requestId: crypto.randomUUID(), data: {expectedRevision: queue.revision, profile, ...data}});
  };
  const save = (open: Editing): void => {
    const requestId = crypto.randomUUID();
    setEditing({...open, requestId, refused: undefined});
    void command.run({family: 'assistant-input', target: 'assistant', requestId, upload: {name: 'input.json', file: new Blob([JSON.stringify({action: 'edit-queued', profile,
      queuedId: open.id, text: open.text, expectedRevision: open.revision})], {type: 'application/json'})}});
  };
  const held = queue.held === null || earlier ? undefined : holdText(queue.held);
  const count = queue.messages.length;
  return <section aria-label="Queued messages" className="conversation-queue">
    <header className="conversation-queue-header">
      <h3>Queued {count === 1 ? 'message' : 'messages'}{!earlier && <> <span className="conversation-queue-count">{count} of {LIMITS.queuedMessages}</span></>}</h3>
      {earlier ? <p>Left in this conversation by an earlier release. They never start; withdraw them.</p>
        : held === undefined && <p>{waiting ? 'Each starts as its own turn, in this order, after the current task ends.' : 'The next one starts now.'}</p>}
    </header>
    {held !== undefined && <div className="conversation-queue-held" role="status">
      <p>{held.text}</p>
      <button type="button" disabled={locked || !enabled} onClick={() => {control({action: 'resume-queue'});}}>{held.action}</button>
    </div>}
    <ol className="conversation-queue-list">
      {queue.messages.map((message, index) => {
        const position = index + 1, open = editing?.id === message.id ? editing : undefined, draft = open?.text ?? message.text;
        const bytes = new TextEncoder().encode(draft).byteLength, tooLong = bytes > LIMITS.inputBytes;
        return <li key={message.id} className="conversation-queue-item">
          {open !== undefined ? <form className="conversation-queue-edit" onSubmit={event => {event.preventDefault(); if (!locked && draft.trim() !== '' && !tooLong) save(open);}}>
            <label htmlFor={`queued-${message.id}`}>Edit queued message {position}</label>
            <textarea id={`queued-${message.id}`} rows={2} value={draft} dir="auto" aria-invalid={tooLong || undefined}
              onChange={event => {setEditing({...open, text: event.target.value, refused: undefined});}}/>
            {tooLong && <p role="alert">Shorten the text to {LIMITS.inputBytes.toLocaleString('en-US')} UTF-8 bytes.</p>}
            {open.refused !== undefined && <p role="alert">Not saved ({open.refused}). {open.refused === 'revision-conflict'
              ? 'The queue changed since you opened this edit. Cancel the edit to see it, then edit again.' : 'Your text is kept here.'}</p>}
            <div className="conversation-queue-actions">
              <button type="submit" disabled={locked || draft.trim() === '' || tooLong || draft === message.text || open.requestId !== undefined}>Save</button>
              <button type="button" className="secondary" onClick={() => {setEditing(undefined);}}>Cancel edit</button>
            </div>
          </form> : <>
            <span className="conversation-queue-position" aria-hidden="true">{position}.</span>
            <p className="conversation-queue-text" dir="auto"><span className="vh">Queued message {position}: </span>{message.text}</p>
            <div className="conversation-queue-actions">
              {!earlier && <>
                <button type="button" className="secondary" disabled={locked} aria-label={`Edit queued message ${position}`}
                  onClick={() => {setEditing({id: message.id, original: message.text, text: message.text, revision: queue.revision});}}>Edit</button>
                <button type="button" className="secondary" disabled={locked || index === 0} aria-label={`Move queued message ${position} up`}
                  onClick={() => {control({action: 'reorder', queuedId: message.id, beforeId: queue.messages[index - 1]?.id ?? null});}}>Move up</button>
                <button type="button" className="secondary" disabled={locked || index === count - 1} aria-label={`Move queued message ${position} down`}
                  onClick={() => {control({action: 'reorder', queuedId: message.id, beforeId: queue.messages[index + 2]?.id ?? null});}}>Move down</button>
              </>}
              <button type="button" className="secondary" disabled={locked} aria-label={`Withdraw queued message ${position}`}
                onClick={() => {control({action: 'withdraw', queuedId: message.id});}}>Withdraw</button>
            </div>
          </>}
        </li>;
      })}
    </ol>
  </section>;
}
