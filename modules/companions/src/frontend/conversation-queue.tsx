// Queued messages above the Conversation composer (Hub #2030): the current conversation's waiting messages in the order
// they start, each of which the owner can edit, withdraw or move, and the queue's hold with the control that releases
// it. Every change is a tracked command checked against the queue's own revision; the list shows what the module saved.
import React, {useEffect, useState} from 'react';
import type {AssistantProfile} from '@jimmie-potts/event-contracts/v2/assistant';
import type {FrontendCommand, FrontendContext} from '@jimmie-potts/sdk/frontend';
import {LIMITS} from '../assistant/limits.js';
import {holdText, type QueueView} from './conversation-queue-read.js';

type Props = {
  context: FrontendContext; command: FrontendCommand; queue: QueueView; profile: AssistantProfile; revision: number;
  /** Whether a task of this conversation is unfinished, so the next message waits for it. */
  waiting: boolean; locked: boolean; enabled: boolean;
};

/** Whether the tracked command with this request ID completed successfully. */
const succeeded = (context: FrontendContext, requestId: string): boolean =>
  context.operations.some(operation => operation.requestId === requestId && operation.status === 'completed' && operation.result === 'succeeded');

export function QueuedMessages({context, command, queue, profile, revision, waiting, locked, enabled}: Props): React.JSX.Element | null {
  const [editing, setEditing] = useState<{id: string; text: string; requestId?: string}>();
  // An edit closes once its command succeeded, so a refused edit keeps the owner's text.
  useEffect(() => {
    if (editing?.requestId !== undefined && succeeded(context, editing.requestId)) setEditing(undefined);
  }, [context, editing]);
  if (queue.messages.length === 0) return null;
  const control = (data: Record<string, unknown>): void => {
    void command.run({family: 'assistant-control', target: 'assistant', requestId: crypto.randomUUID(), data: {expectedRevision: revision, profile, ...data}});
  };
  const save = (id: string, text: string): void => {
    const requestId = crypto.randomUUID();
    setEditing({id, text, requestId});
    void command.run({family: 'assistant-input', target: 'assistant', requestId,
      upload: {name: 'input.json', file: new Blob([JSON.stringify({action: 'edit-queued', profile, queuedId: id, text, expectedRevision: revision})], {type: 'application/json'})}});
  };
  const held = queue.held === null ? undefined : holdText(queue.held);
  const count = queue.messages.length;
  return <section aria-label="Queued messages" className="conversation-queue">
    <header className="conversation-queue-header">
      <h3>Queued {count === 1 ? 'message' : 'messages'} <span className="conversation-queue-count">{count} of {LIMITS.queuedMessages}</span></h3>
      {held === undefined && <p>{waiting ? 'Each starts as its own turn, in this order, after the current task ends.' : 'The next one starts now.'}</p>}
    </header>
    {held !== undefined && <div className="conversation-queue-held" role="status">
      <p>{held.text}</p>
      <button type="button" disabled={locked || !enabled} onClick={() => {control({action: 'resume-queue'});}}>{held.action}</button>
    </div>}
    <ol className="conversation-queue-list">
      {queue.messages.map((message, index) => {
        const position = index + 1, open = editing?.id === message.id, draft = open ? editing.text : message.text;
        const bytes = new TextEncoder().encode(draft).byteLength, tooLong = bytes > LIMITS.inputBytes;
        return <li key={message.id} className="conversation-queue-item">
          {open ? <form className="conversation-queue-edit" onSubmit={event => {event.preventDefault(); if (!locked && draft.trim() !== '' && !tooLong) save(message.id, draft);}}>
            <label htmlFor={`queued-${message.id}`}>Edit queued message {position}</label>
            <textarea id={`queued-${message.id}`} rows={2} value={draft} dir="auto" aria-invalid={tooLong || undefined}
              onChange={event => {setEditing({id: message.id, text: event.target.value});}}/>
            {tooLong && <p role="alert">Shorten the text to {LIMITS.inputBytes.toLocaleString('en-US')} UTF-8 bytes.</p>}
            <div className="conversation-queue-actions">
              <button type="submit" disabled={locked || draft.trim() === '' || tooLong || draft === message.text || editing.requestId !== undefined}>Save</button>
              <button type="button" className="secondary" onClick={() => {setEditing(undefined);}}>Cancel edit</button>
            </div>
          </form> : <>
            <span className="conversation-queue-position" aria-hidden="true">{position}.</span>
            <p className="conversation-queue-text" dir="auto"><span className="vh">Queued message {position}: </span>{message.text}</p>
            <div className="conversation-queue-actions">
              <button type="button" className="secondary" disabled={locked} aria-label={`Edit queued message ${position}`}
                onClick={() => {setEditing({id: message.id, text: message.text});}}>Edit</button>
              <button type="button" className="secondary" disabled={locked || index === 0} aria-label={`Move queued message ${position} up`}
                onClick={() => {control({action: 'reorder', queuedId: message.id, beforeId: queue.messages[index - 1]?.id ?? null});}}>Move up</button>
              <button type="button" className="secondary" disabled={locked || index === count - 1} aria-label={`Move queued message ${position} down`}
                onClick={() => {control({action: 'reorder', queuedId: message.id, beforeId: queue.messages[index + 2]?.id ?? null});}}>Move down</button>
              <button type="button" className="secondary" disabled={locked} aria-label={`Withdraw queued message ${position}`}
                onClick={() => {control({action: 'withdraw', queuedId: message.id});}}>Withdraw</button>
            </div>
          </>}
        </li>;
      })}
    </ol>
  </section>;
}
