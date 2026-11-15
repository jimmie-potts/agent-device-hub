import React, {Fragment, useCallback, useLayoutEffect, useRef, useState} from 'react';
import type {ConversationMessage} from '../assistant/history-contract.js';
import type {ConversationHistory} from './conversation-history.js';

type Position = {follow: boolean; anchor?: {id: string; offset: number}};

export function ConversationTranscript({history, status, readLocked, loadEarlier, retry, renderMessage}: {
  history: ConversationHistory | undefined;
  status: 'loading' | 'ready' | 'failed';
  readLocked: boolean;
  loadEarlier: (before: string) => void;
  retry: () => void;
  renderMessage: (message: ConversationMessage) => React.ReactNode;
}): React.JSX.Element {
  const scroll = useRef<HTMLDivElement>(null);
  const position = useRef<Position>({follow: true});
  const pagingFocus = useRef<{button: HTMLButtonElement; anchor: string | undefined}>(undefined);
  const previous = useRef<{id: string | null | undefined; latest: number | undefined}>(undefined);
  const [newMessages, setNewMessages] = useState(false);
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
    if (node !== null) node.scrollTop = node.scrollHeight;
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
    <div className="conversation-transcript" ref={scroll} tabIndex={-1} onScroll={remember}>
      {history?.windows.map((window, index) => <Fragment key={window.messages[0]?.seq ?? 'empty'}>
        {window.older !== null && <div className="conversation-gap">
          {index > 0 && <span>Earlier messages have not been loaded.</span>}
          <button type="button" disabled={readLocked} onClick={event => {
            if (window.older === null) return;
            remember();
            if (document.activeElement === event.currentTarget) {
              pagingFocus.current = {button: event.currentTarget, anchor: position.current.anchor?.id};
            }
            loadEarlier(window.older);
          }}>Load earlier</button>
        </div>}
        {window.messages.length > 0 && <ol aria-label="Saved conversation messages">
          {window.messages.map(message => <li key={message.id} tabIndex={-1} data-message={message.id} data-role={message.role}>
            {message.role === 'tool' ? <article aria-label="tool message">
              <details className="conversation-tool-result" onToggle={remember}>
                <summary>Tool result</summary>
                <p dir="auto">{message.text}</p>
              </details>
            </article> : renderMessage(message)}
          </li>)}
        </ol>}
      </Fragment>)}
      {!hasMessages && status !== 'loading' && <p>{status === 'failed' ? 'No saved text is available here.' : 'No saved messages for this profile yet.'}</p>}
    </div>
    <div className="conversation-history-actions">
      {status === 'loading' && <p role="status">Loading saved conversation.</p>}
      {status === 'failed' && <><p role="status">Saved conversation could not be refreshed. Previously loaded text remains readable.</p>
        <button type="button" disabled={readLocked} onClick={retry}>Retry history</button></>}
      {newMessages && <button type="button" onClick={showLatest}>New messages</button>}
    </div>
  </div>;
}
