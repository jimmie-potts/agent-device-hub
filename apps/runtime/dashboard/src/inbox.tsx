import React, {useEffect, useRef, useState} from 'react';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {InboxItem} from '@jimmie-potts/event-contracts/v2/families';
import {sendAction} from './actions.ts';
import {InboxCard, InboxItemCard} from './inbox-card.tsx';

function InboxRow({item, label, live, control}: {item: InboxItem; label: string; live: boolean; control: boolean}): React.JSX.Element {
  const [attempt, setAttempt] = useState<{revision: number; locked: boolean}>();
  const [answer, setAnswer] = useState('');
  const inFlight = useRef(false), alive = useRef(true);
  useEffect(() => {alive.current = true; return () => {alive.current = false;};}, []);
  const locked = attempt?.revision === item.revision && attempt.locked;
  const handle = async (action: 'dismiss' | 'send-again'): Promise<void> => {
    if (!live || !control || inFlight.current || locked === true) return;
    const revision = item.revision;
    inFlight.current = true; setAttempt({revision, locked: true});
    setAnswer(action === 'send-again' ? 'Requesting a new command…' : 'Requesting dismissal…');
    const result = await sendAction({family: 'inbox-handle', target: item.id, requestId: crypto.randomUUID(), data: {action, expectedRevision: revision}});
    inFlight.current = false;
    if (!alive.current) return;
    setAttempt({revision, locked: !('error' in result) || result.error.code === 'uncertain-result'});
    setAnswer('error' in result ? `${result.error.code}. Nothing was automatically sent again.` : 'Accepted. Waiting for the shared item removal.');
  };
  return <InboxItemCard item={item} label={label} control={control} disabled={!live || inFlight.current || locked === true} answer={answer} onHandle={action => {void handle(action);}}/>;
}

export type InboxFocus = {id: string; serial: number};

/** Command adapter over existing Inbox records. Disclosure and focus never handle an item. */
export function InboxPanel({items, live, control, devices = [], focus, headingId}: {
  items: readonly InboxItem[]; live: boolean; control: boolean; devices?: readonly DeviceRecord[]; focus?: InboxFocus | undefined; headingId?: string;
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus === undefined) return;
    const row = [...(host.current?.querySelectorAll<HTMLElement>('[data-inbox]') ?? [])].find(item => item.dataset.inbox === focus.id);
    const disclosure = row?.querySelector<HTMLDetailsElement>('details.inbox-entry');
    if (disclosure === null || disclosure === undefined) return;
    disclosure.open = true;
    disclosure.querySelector('summary')?.focus();
    disclosure.scrollIntoView({block: 'nearest'});
  }, [focus]);
  return <div ref={host}><InboxCard count={items.length} live={live} control={control} headingId={headingId}>
    {items.map(item => <InboxRow key={item.id} item={item} label={devices.find(device => device.id === item.item.target)?.label ?? item.item.target} live={live} control={control}/>)}</InboxCard></div>;
}
