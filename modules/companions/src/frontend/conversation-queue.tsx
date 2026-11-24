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
  /**
   * An edit that could not be saved because its message started, left the queue or was changed on another page first:
   * its text and why, so it is not lost and never overwrites the other change.
   */
  onLost?: (text: string, reason: 'started' | 'changed') => void;
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
  // Each newer read of the queue moves an open edit on. While its message keeps the text the edit opened with, the edit
  // names the newer revision, so another message queued, moved or started meanwhile never refuses it. A message that
  // started, was withdrawn or was changed on another page takes the editor with it, and changed text goes back to the
  // owner instead of being dropped or written over the other change.
  useEffect(() => {
    if (editing === undefined || editing.requestId !== undefined || queue.revision <= editing.revision) return;
    const message = queue.messages.find(entry => entry.id === editing.id);
    const typed = editing.text.trim() !== '' && editing.text !== editing.original;
    if (message !== undefined && message.text === editing.original) {
      setEditing({...editing, revision: queue.revision, refused: editing.refused === 'revision-conflict' ? undefined : editing.refused});
      return;
    }
    if (message !== undefined && !typed) {setEditing({...editing, original: message.text, text: message.text, revision: queue.revision, refused: undefined}); return;}
    if (typed) onLost?.(editing.text, message === undefined ? 'started' : 'changed');
    setEditing(undefined);
  }, [editing, onLost, queue]);
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
      <h3>Queued {count === 1 ? 'message' : 'messages'}{!earlier && <> <span className="conversation-queue-count">{count > LIMITS.queuedMessages
        ? `${String(count)}, over the limit of ${String(LIMITS.queuedMessages)}` : `${String(count)} of ${String(LIMITS.queuedMessages)}`}</span></>}</h3>
      {/* Steers a stopped turn returned may take the queue past its limit (Hub #2031); a new message waits until it is below it. */}
      {!earlier && count > LIMITS.queuedMessages && <p>Your unread messages came back from the stopped task. Queue takes a new message once fewer than {LIMITS.queuedMessages} wait.</p>}
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
              ? 'The queue changed. Your text is kept here while the page reads the queue again.' : 'Your text is kept here.'}</p>}
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

/**
 * The running task's unread steers (Hub #2031): messages the owner sent while it worked, which it reads at its next model
 * call, after its last call's tool results or the coding worker's result. They show above the composer until then; a
 * read one shows in the transcript where the model read it.
 */
export function PendingSteers({queue, waitsOnWorker}: {queue: QueueView; waitsOnWorker: boolean}): React.JSX.Element | null {
  if (!queue.current || queue.steers.length === 0) return null;
  return <section aria-label="Messages for the next step" className="conversation-queue conversation-steers">
    <header className="conversation-queue-header">
      <h3>Steering this task</h3>
      <p>{waitsOnWorker ? 'The task reads these after the coding worker\'s result.' : 'The task reads these at its next step.'} Cancel task moves them to the queue.</p>
    </header>
    <ol className="conversation-queue-list">
      {queue.steers.map((steer, index) => <li key={steer.id} className="conversation-queue-item">
        <p className="conversation-queue-text" dir="auto"><span className="vh">Steering message {index + 1}: </span>{steer.text}</p>
      </li>)}
    </ol>
  </section>;
}
