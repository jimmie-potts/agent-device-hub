// The dashboard's shared pieces (Hub #922): badges, fact lists, the informational tip and the command status, adapted
// from `apps/dashboard/src/controls.tsx` and `main.tsx` at main 5abbae9. The command status follows ADR 0012: a refusal
// says nothing changed, an uncertain answer says the change may have happened and is never sent again by the page.
import React, {useEffect, useId, useLayoutEffect, useRef, useState} from 'react';
import type {CommandEnd} from './connection.ts';

export function Badge({children, warning = false}: {children: React.ReactNode; warning?: boolean}): React.JSX.Element {
  return <span className={warning ? 'badge warning' : 'badge'}>{children}</span>;
}

/** Label and value pairs. `strip` lays them out as one wrapping line; `facts` as the two-column list. */
export function Facts({items, className = 'facts'}: {items: readonly (readonly [string, React.ReactNode])[]; className?: string}): React.JSX.Element {
  return <dl className={className}>{items.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

/** Noninteractive supporting information, available to pointer, keyboard and touch; Escape or lost focus dismisses it. */
export function InfoTip({label, children, warning = false}: {label: React.ReactNode; children: React.ReactNode; warning?: boolean}): React.JSX.Element {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const host = useRef<HTMLSpanElement>(null);
  const popup = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = (): void => {
      if (host.current === null || popup.current === null) return;
      const left = host.current.getBoundingClientRect().left + popup.current.offsetLeft;
      const width = popup.current.getBoundingClientRect().width;
      setShift(Math.max(12 - left, Math.min(0, window.innerWidth - 12 - left - width)));
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: KeyboardEvent): void => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', dismiss);
    return () => { window.removeEventListener('keydown', dismiss); };
  }, [open]);
  return <span ref={host} className="info-tip" onMouseEnter={() => { setOpen(true); }}
    onMouseLeave={() => { if (host.current?.contains(document.activeElement) !== true) setOpen(false); }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button type="button" className={warning ? 'secondary status-indicator warning' : 'secondary status-indicator'} aria-describedby={open ? id : undefined}
      onFocus={() => { setOpen(true); }} onClick={() => { setOpen(true); }}>{label}</button>
    {open && <span ref={popup} id={id} role="tooltip" className="info-popover" style={{transform: `translateX(${shift}px)`}}>{children}</span>}
  </span>;
}

/** A labelled select for a filter, which changes only what the page shows. */
export function Select({label, value, onChange, options}: {
  label: string; value: string; onChange: (value: string) => void; options: readonly {value: string; label: string}[];
}): React.JSX.Element {
  return <label>{label}<select value={value} onChange={event => { onChange(event.target.value); }}>
    {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select></label>;
}

/**
 * One command a person sends, and what the page says of it: sending, accepted, refused with nothing changed, or
 * uncertain. An uncertain command stays locked, so the page never sends it again, until the evidence it may have
 * changed arrives: `evidence` is a value that changes when it does, such as the record's revision.
 */
export type CommandStatus = {state: 'idle' | 'sending' | 'accepted' | 'rejected' | 'uncertain'; text: string};

export function useCommand(evidence: unknown): {status: CommandStatus; busy: boolean; locked: boolean; run: (send: () => Promise<CommandEnd>, done: string) => void} {
  const [status, setStatus] = useState<CommandStatus>({state: 'idle', text: ''});
  const running = useRef(false);
  // The evidence when an uncertain answer came. Once the evidence moves, the record says what happened, and the lock lifts.
  const [lockedOn, setLockedOn] = useState<{evidence: unknown} | undefined>(undefined);
  const locked = lockedOn !== undefined && Object.is(lockedOn.evidence, evidence);
  const run = (send: () => Promise<CommandEnd>, done: string): void => {
    // A second activation while one runs sends nothing.
    if (running.current || locked) return;
    running.current = true;
    const sentWith = evidence;
    setStatus({state: 'sending', text: 'Sending…'});
    void send().then(end => {
      switch (end.status) {
        case 'accepted':
          setStatus({state: 'accepted', text: done});
          return;
        case 'rejected':
          setStatus({state: 'rejected', text: `Not sent: ${end.error.error.code}. Nothing changed.`});
          return;
        case 'uncertain':
          setLockedOn({evidence: sentWith});
          setStatus({state: 'uncertain', text: 'Result unknown: this may have taken effect. It is not sent again; the session record will show it.'});
          return;
      }
    }).finally(() => { running.current = false; });
  };
  return {status, busy: status.state === 'sending', locked, run};
}
