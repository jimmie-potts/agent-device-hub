import React, {useCallback, useLayoutEffect, useRef, useState} from 'react';
import type {ConversationMessage} from '../assistant/history-contract.js';
import type {ConversationHistory} from './conversation-history.js';

type Position = {follow: boolean; anchor?: {id: string; offset: number}};

export function ConversationTranscript({history, status, live, canStart, readLocked, loadEarlier, retry, renderMessage, renderToolEvidence}: {
  history: ConversationHistory | undefined;
  status: 'loading' | 'ready' | 'failed' | 'unavailable';
  live: boolean;
  canStart: boolean;
  readLocked: boolean;
  loadEarlier: (before: string) => void;
  retry: () => void;
  renderToolEvidence: (message: ConversationMessage) => React.ReactNode;
  renderMessage: (message: ConversationMessage) => React.ReactNode;
}): React.JSX.Element {
  const scroll = useRef<HTMLDivElement>(null);
  const position = useRef<Position>({follow: true});
  const pagingFocus = useRef<{button: HTMLButtonElement; anchor: string | undefined}>(undefined);
  const previous = useRef<{id: string | null | undefined; latest: number | undefined}>(undefined);
  const [newMessages, setNewMessages] = useState(false);
  // Where the last jump to the latest message left the scroll, so its own scroll event, which can arrive after the
  // composer above grew and shrank the transcript, such as when queued messages load (Hub #2030), does not count as the
  // owner scrolling away from the latest message.
  const jumped = useRef<number>(undefined);
  const latest = history?.windows.at(-1)?.messages.at(-1)?.seq;
  const id = history?.conversationId;
  const remember = useCallback((): void => {
    const node = scroll.current;
    if (node === null) return;
    const top = node.getBoundingClientRect().top;
    const anchor = Array.from(node.querySelectorAll<HTMLElement>('[data-message]')).find(row => row.getBoundingClientRect().bottom > top);
    const id = anchor?.dataset.message;
    position.current = {follow: node.scrollHeight - node.scrollTop - node.clientHeight < 24,
      ...(anchor === undefined || id === undefined ? {} : {anchor: {id, offset: anchor.getBoundingClientRect().top - top}})};
    if (position.current.follow) setNewMessages(false);
  }, []);
  const showLatest = useCallback((): void => {
    const node = scroll.current;
    if (node !== null) {node.scrollTop = node.scrollHeight; jumped.current = node.scrollTop;}
    remember();
  }, [remember]);
  const scrolled = useCallback((): void => {
    const node = scroll.current;
    if (node !== null && jumped.current !== undefined && node.scrollTop === jumped.current) return;
    jumped.current = undefined;
    remember();
  }, [remember]);
  const restoreAnchor = useCallback((): void => {
    const node = scroll.current;
    const anchor = position.current.anchor;
    if (node === null || anchor === undefined) return;
    const row = Array.from(node.querySelectorAll<HTMLElement>('[data-message]')).find(value => value.dataset.message === anchor.id);
    if (row === undefined) return;
    const rect = row.getBoundingClientRect();
    const offset = Math.max(anchor.offset, 1 - rect.height);
    node.scrollTop += rect.top - node.getBoundingClientRect().top - offset;
  }, []);
  useLayoutEffect(() => {
    const node = scroll.current;
    if (node === null) return;
    const prior = previous.current;
    previous.current = {id, latest};
    const paging = pagingFocus.current;
    pagingFocus.current = undefined;
    if (paging !== undefined && !paging.button.isConnected && document.activeElement === document.body) {
      const row = Array.from(node.querySelectorAll<HTMLElement>('[data-message]')).find(value => value.dataset.message === paging.anchor);
      (row ?? node).focus({preventScroll: true});
    }
    if (prior?.id !== id || position.current.follow) {
      showLatest();
      return;
    }
    restoreAnchor();
    if (latest !== undefined && prior?.latest !== undefined && latest > prior.latest) setNewMessages(true);
  }, [history, id, latest, restoreAnchor, showLatest]);
  useLayoutEffect(() => {
    const node = scroll.current;
    if (node === null) return;
    const observer = new ResizeObserver(() => {
      if (position.current.follow) showLatest();
      else restoreAnchor();
    });
    observer.observe(node);
    return () => {observer.disconnect();};
  }, [restoreAnchor, showLatest]);
  const hasMessages = history?.windows.some(window => window.messages.length > 0) ?? false;
  return <div className="conversation-reading">
    <div className="conversation-transcript" ref={scroll} tabIndex={-1} onScroll={scrolled}>
      {hasMessages && <ol key={id} aria-label="Saved conversation messages">
        {history?.windows.flatMap((window, index) => {
          const messages = window.messages.map(message => <li key={`message:${message.id}`} tabIndex={-1} id={`conversation-message-${message.id}`} data-message={message.id} data-role={message.role}>
            {message.role === 'tool' ? <article aria-label="tool message">
              <details className="conversation-tool-result" onToggle={remember}>
                <summary>Tool result</summary>
                <p className="conversation-message-text" dir="auto">{message.text}</p>
                {renderToolEvidence(message)}
              </details>
            </article> : renderMessage(message)}
          </li>);
          const before = window.older;
          if (before === null) return messages;
          return [<li key={`gap:${before}`} className="conversation-gap" role="presentation">
            {index > 0 && <span>Earlier messages have not been loaded.</span>}
            <button type="button" disabled={readLocked} onClick={event => {
              remember();
              if (document.activeElement === event.currentTarget) {
                pagingFocus.current = {button: event.currentTarget, anchor: position.current.anchor?.id};
              }
              loadEarlier(before);
            }}>Load earlier</button>
          </li>, ...messages];
        })}
      </ol>}
      {!hasMessages && status !== 'loading' && (status === 'ready' && live && history !== undefined
        ? canStart ? <div className="conversation-empty">
          <h3>What’s on your mind?</h3>
          <p>Send a message to start the conversation.</p>
        </div> : <p className="conversation-empty-note">No saved messages for this profile yet.</p>
        : <p className="conversation-empty-note">No saved text is available here.</p>)}
    </div>
    <div className="conversation-history-actions">
      {status === 'loading' && <p role="status">Loading saved conversation.</p>}
      {status === 'failed' && <><p role="status">Saved conversation could not be refreshed.{hasMessages && ' Previously loaded text remains readable.'}</p>
        <button type="button" disabled={readLocked} onClick={retry}>Retry history</button></>}
      {newMessages && <button type="button" onClick={showLatest}>New messages</button>}
    </div>
  </div>;
}
