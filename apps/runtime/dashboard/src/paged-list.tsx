import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {clampPage, pageCount, pageKeys, pageOf} from './paging.ts';
import './paged-list.css';

/** Asks the list to show one row, as the Hub mode card's "check Inbox" does; a new serial asks again. */
export type PageReveal = {key: string; serial: number};

const CONTROLS = 'summary, button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled)';
const shownOnScreen = (element: Element): boolean => element.isConnected && element.getClientRects().length > 0;

/**
 * The shared pager for list cards (#1658): Inbox, Agent status and Timeline. It pages rows the dashboard already holds,
 * in the browser, and sends no request. Every row stays mounted so open evidence and unsent drafts survive a page change;
 * the caller hides a row when `shown(key)` is false and marks it with `data-paged-key`. Rows open in place. A new
 * `resetKey`, such as a changed filter, returns to the first page; `reveal` shows the page holding one row; `note` adds
 * to the page label. When focus is inside the list and a page change or a removed row would leave it on the document
 * body, focus moves to a control in the list. Focus that has already left the list is never pulled back.
 */
export function PagedList({keys, pageSize, label, reveal, resetKey, note, children}: {
  keys: readonly string[]; pageSize: number; label: string; reveal?: PageReveal | undefined;
  resetKey?: string; note?: string | undefined; children: (shown: (key: string) => boolean) => React.ReactNode;
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null), last = useRef<Element | null>(null);
  const previous = useRef<HTMLButtonElement>(null), next = useRef<HTMLButtonElement>(null);
  const [page, setPage] = useState(0), [revealed, setRevealed] = useState<number>(), pagerFocus = useRef<HTMLButtonElement | null>(null);
  const [reset, setReset] = useState(resetKey);
  if (resetKey !== reset) {setReset(resetKey);setPage(0);}
  // Check Inbox: show the page holding the item before the caller opens and focuses it.
  if (reveal !== undefined && reveal.serial !== revealed) {
    setRevealed(reveal.serial);
    const index = keys.indexOf(reveal.key);
    if (index >= 0) setPage(pageOf(index, pageSize));
  }
  const pages = pageCount(keys.length, pageSize), current = clampPage(page, keys.length, pageSize);
  // Removing the last row of the last page moves back to the page before it.
  if (current !== page) setPage(current);
  const visible = new Set(pageKeys(keys, current, pageSize));
  useEffect(() => {
    const node = host.current;if (node === null) return;
    const focused = (event: FocusEvent): void => {last.current = event.target instanceof Element ? event.target : null;};
    // Forget focus that leaves the list. Focus can also drop to nothing because its control was disabled, removed or
    // hidden, as when Dismiss waits for its reply; those keep their claim, and a click elsewhere does not.
    const left = (event: FocusEvent): void => {
      const target = event.target, related = event.relatedTarget;
      if (related instanceof Node && node.contains(related)) return;
      if (related instanceof Node) {last.current = null;return;}
      setTimeout(() => {
        if (last.current === target && target instanceof Element && shownOnScreen(target) && !target.matches(':disabled') && document.activeElement !== target) last.current = null;
      }, 0);
    };
    node.addEventListener('focusin', focused);node.addEventListener('focusout', left);
    return () => {node.removeEventListener('focusin', focused);node.removeEventListener('focusout', left);};
  }, []);
  useLayoutEffect(() => {
    const node = host.current;if (node === null) return;
    if (pagerFocus.current !== null) {pagerFocus.current.focus();pagerFocus.current = null;return;}
    const before = last.current, active = document.activeElement;
    if (before === null || shownOnScreen(before)) return;
    last.current = null;
    if (active !== null && active !== document.body && active !== before) return;
    // The focused row went away or off the page; Chromium would otherwise leave focus on the body.
    const target = [...node.querySelectorAll<HTMLElement>(CONTROLS)].find(shownOnScreen) ?? node;
    target.focus({preventScroll: true});
  });
  const go = (target: number): void => {
    const value = clampPage(target, keys.length, pageSize);
    setPage(value);
    // A pager button that becomes disabled would drop focus, so focus passes to the other one.
    if (value === 0) pagerFocus.current = next.current;else if (value === pages - 1) pagerFocus.current = previous.current;
  };
  return <div className="paged-list" ref={host} tabIndex={-1} data-paged-list={label} data-page={current + 1} data-pages={pages}>
    {children(key => visible.has(key))}
    {pages > 1 && <div className="paged-list-pager" role="group" aria-label={`${label} pages`}>
      <button type="button" className="secondary" ref={previous} disabled={current === 0} onClick={() => {go(current - 1);}}>Previous</button>
      <span className="paged-list-position" aria-live="polite">Page {current + 1} of {pages}{note === undefined ? '' : ` · ${note}`}</span>
      <button type="button" className="secondary" ref={next} disabled={current === pages - 1} onClick={() => {go(current + 1);}}>Next</button>
    </div>}
  </div>;
}
