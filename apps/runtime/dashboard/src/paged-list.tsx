import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {clampPage, pageCount, pageKeys, pageOf} from './paging.ts';
import {useHomeShape} from './home-shape-context.ts';
import './paged-list.css';

/** Asks the list to show one row, as the Hub mode card's "check Inbox" does; a new serial asks again. */
export type PageReveal = {key: string; serial: number};

const CONTROLS = 'summary, button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled)';
const shownOnScreen = (element: Element): boolean => element.isConnected && element.getClientRects().length > 0;

/**
 * The shared pager for list cards (#1658): Inbox, Agent status and Timeline. It pages rows the dashboard already holds,
 * in the browser, and sends no request. Every row stays mounted so open evidence and unsent drafts survive a page change;
 * the caller hides a row when `shown(key)` is false and marks it with `data-paged-key`. Inside a shaped Home card
 * (#1672), opening a row's first disclosure gives that row the whole page and hides the pager, so its controls stay
 * inside the card; closing it brings the page back. Elsewhere rows open in place beside the others. A new `resetKey`,
 * such as a changed filter, returns to the first page; `reveal` shows the page holding one row; `note` adds to the page
 * label; `pager: false` shows the first page only, for a shape whose list continues on the card's own page. When focus
 * is inside the list and a page change or a removed row would leave it on the document body, focus moves to a control
 * in the list. Focus that has already left the list is never pulled back. In a Home shape the caller calculates
 * `pageSize` from the card's known size (#1672); the list never measures itself.
 */
export function PagedList({keys, pageSize, label, reveal, resetKey, note, pager = true, children}: {
  keys: readonly string[]; pageSize: number; label: string; reveal?: PageReveal | undefined;
  resetKey?: string; note?: string | undefined; pager?: boolean; children: (shown: (key: string) => boolean) => React.ReactNode;
}): React.JSX.Element {
  const expandAlone = useHomeShape() !== undefined;
  const host = useRef<HTMLDivElement>(null), last = useRef<Element | null>(null);
  const previous = useRef<HTMLButtonElement>(null), next = useRef<HTMLButtonElement>(null);
  // The rows whose disclosure is open, oldest first, kept in step with the rows themselves in every mode, so a card
  // moving between a shape and its content height always renders the open row it actually has (#1665 F11).
  const [page, setPage] = useState(0), [opened, setOpened] = useState<readonly string[]>([]);
  const alone = useRef(expandAlone);alone.current = expandAlone;
  const [revealed, setRevealed] = useState<number>(), pagerFocus = useRef<HTMLButtonElement | null>(null);
  const [reset, setReset] = useState(resetKey), size = pageSize, [sized, setSized] = useState(pageSize);
  if (resetKey !== reset) {setReset(resetKey);setPage(0);}
  // A new page size (the card changed shape or the window width) keeps the same rows in view: the page holding the
  // opened row, or else the first row the page showed.
  if (size !== sized) {
    setSized(size);
    const held = opened.filter(key => keys.includes(key)).at(-1), anchor = held === undefined ? page * sized : keys.indexOf(held);
    setPage(pageOf(anchor, size));
  }
  // Check Inbox: show the item's page, with no other row holding it; the caller then opens the item, and its toggle
  // records it like any other.
  if (reveal !== undefined && reveal.serial !== revealed) {
    setRevealed(reveal.serial);
    const index = keys.indexOf(reveal.key);
    if (index >= 0) {setPage(pageOf(index, size));setOpened(previous => previous.filter(key => key === reveal.key));}
  }
  const pages = pager ? pageCount(keys.length, size) : 1, current = pager ? clampPage(page, keys.length, size) : 0;
  // Removing the last row of the last page moves back to the page before it.
  if (current !== page) setPage(current);
  const open = expandAlone ? opened.filter(key => keys.includes(key)).at(-1) : undefined;
  const visible = new Set(open === undefined ? pageKeys(keys, current, size) : [open]);
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
    // A row's disclosure toggles without bubbling; the capture phase still passes through this list. Every toggle
    // re-reads which rows are open, whether or not this card is in a shape now.
    const toggled = (event: Event): void => {
      const details = event.target;if (!(details instanceof HTMLDetailsElement)) return;
      const row = details.closest<HTMLElement>('[data-paged-key]'), key = row?.dataset.pagedKey;
      if (row === null || key === undefined || !node.contains(row) || row.querySelector('details') !== details) return;
      const rows = [...node.querySelectorAll<HTMLElement>('[data-paged-key]')];
      // Closing the row that held the page restores the page, so no hidden open row takes its place.
      if (!details.open && alone.current) for (const other of rows) {const disclosure = other.querySelector('details');if (other !== row && disclosure?.open === true) disclosure.open = false;}
      const now = rows.filter(value => value.querySelector('details')?.open === true).flatMap(value => value.dataset.pagedKey ?? []);
      setOpened(previous => [...previous.filter(value => value !== key && now.includes(value)), ...now.filter(value => value !== key && !previous.includes(value)), ...(details.open ? [key] : [])]);
    };
    node.addEventListener('focusin', focused);node.addEventListener('focusout', left);node.addEventListener('toggle', toggled, true);
    return () => {node.removeEventListener('focusin', focused);node.removeEventListener('focusout', left);node.removeEventListener('toggle', toggled, true);};
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
    const value = clampPage(target, keys.length, size);
    setPage(value);
    // A pager button that becomes disabled would drop focus, so focus passes to the other one.
    if (value === 0) pagerFocus.current = next.current;else if (value === pages - 1) pagerFocus.current = previous.current;
  };
  return <div className="paged-list" ref={host} tabIndex={-1} data-paged-list={label} data-page={current + 1} data-pages={pages} data-held={open !== undefined}>
    {children(key => visible.has(key))}
    {pages > 1 && open === undefined && <div className="paged-list-pager" role="group" aria-label={`${label} pages`}>
      <button type="button" className="secondary" ref={previous} disabled={current === 0} aria-label={expandAlone ? 'Previous' : undefined} onClick={() => {go(current - 1);}}>{expandAlone ? '‹' : 'Previous'}</button>
      {/* A shaped card shows the short form on one line; the full label stays for assistive technology. */}
      <span className="paged-list-position" aria-live="polite">{expandAlone ? <><span aria-hidden="true">{current + 1} / {pages}</span><span className="vh">Page {current + 1} of {pages}{note === undefined ? '' : ` · ${note}`}</span></>
        : <>Page {current + 1} of {pages}{note === undefined ? '' : ` · ${note}`}</>}</span>
      <button type="button" className="secondary" ref={next} disabled={current === pages - 1} aria-label={expandAlone ? 'Next' : undefined} onClick={() => {go(current + 1);}}>{expandAlone ? '›' : 'Next'}</button>
    </div>}
  </div>;
}
