import React, {useEffect, useId, useMemo, useRef, useState} from 'react';
import {filterJump, type JumpEntry} from './jump.ts';
import {RailIcon} from './rail.tsx';
import {routeHash, type Route} from './routes.ts';

/**
 * The jump palette (Hub #1888): a modal list of places, narrowed as the owner types. It only navigates: opening,
 * typing and closing read nothing and send nothing. The shell makes the page behind it inert while it is open.
 */
export function JumpPalette({entries, onOpen, onClose}: {
  entries: readonly JumpEntry[]; onOpen: (route: Route) => void; onClose: () => void;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState(0);
  const shown = useMemo(() => filterJump(entries, query), [entries, query]);
  const input = useRef<HTMLInputElement>(null), list = useRef<HTMLDivElement>(null);
  const id = useId();
  const active = Math.min(chosen, Math.max(0, shown.length - 1));
  const grouped = query.trim() === '';
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { list.current?.querySelector('[aria-selected=true]')?.scrollIntoView({block: 'nearest'}); }, [active, shown]);
  return <>
    <div className="jump-scrim" onClick={onClose}/>
    <div className="jump-palette" role="dialog" aria-modal="true" aria-label="Jump to a page" onKeyDown={event => {
      if (event.key === 'Escape') {
        // The palette owns Escape while it is open, so nothing behind it also reacts.
        event.preventDefault(); event.stopPropagation(); onClose();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (shown.length > 0) setChosen((active + (event.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const entry = shown[active];
        if (entry !== undefined) onOpen(entry.route);
      }
    }}>
      <div className="jump-search"><RailIcon name="search"/>
        <input ref={input} type="text" role="combobox" aria-label="Jump to a page" aria-expanded="true" aria-controls={`${id}-list`}
          aria-activedescendant={shown.length > 0 ? `${id}-${String(active)}` : undefined} autoComplete="off" autoCapitalize="none" spellCheck={false}
          enterKeyHint="go" placeholder="Jump to a page…" value={query} onChange={event => { setQuery(event.target.value); setChosen(0); }}/></div>
      <div ref={list} id={`${id}-list`} className="jump-list" role="listbox" aria-label="Pages">
        {shown.map((entry, position) => <React.Fragment key={`${entry.group}:${routeHash(entry.route)}`}>
          {grouped && shown[position - 1]?.group !== entry.group && <p className="jump-group" role="presentation">{entry.group}</p>}
          <div id={`${id}-${String(position)}`} className="jump-option" role="option" aria-selected={position === active}
            onMouseMove={() => { if (position !== active) setChosen(position); }} onClick={() => { onOpen(entry.route); }}>
            <span className="jump-name">{entry.label}</span>{entry.hint !== '' && <span className="jump-hint">{entry.hint}</span>}
          </div>
        </React.Fragment>)}
        {shown.length === 0 && <p className="jump-empty">No page matches “{query.trim()}”.</p>}
      </div>
      <p className="jump-foot" aria-hidden="true"><kbd>↑</kbd><kbd>↓</kbd> move <kbd>↵</kbd> open <kbd>esc</kbd> close</p>
    </div>
  </>;
}
