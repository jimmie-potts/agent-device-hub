import React, {useEffect, useRef} from 'react';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {InboxItem} from '@jimmie-potts/event-contracts/v2/families';
import {sendSaveAction, useSaveLifecycle} from './save-lifecycle.ts';
import {InboxCard, InboxItemCard} from './inbox-card.tsx';
import {PagedList} from './paged-list.tsx';
import {fitRows, listFit, listPageSize} from './paging.ts';
import {useHomeCardBox} from './home-shape-context.ts';

function InboxRow({item, label, live, control, hidden}: {item: InboxItem; label: string; live: boolean; control: boolean; hidden: boolean}): React.JSX.Element {
  type Attempt = {revision: number; action: 'dismiss' | 'send-again'};
  // Both replies lock this revision. A changed item can be handled explicitly;
  // removal unmounts the row.
  const sameRevision = (attempt: Attempt): boolean => attempt.revision === item.revision;
  const save = useSaveLifecycle<Attempt>({accepted: sameRevision, uncertain: sameRevision});
  const handle = (action: Attempt['action']): void => {
    if (!live || !control) return;
    void save.run({action, revision: item.revision}, () => sendSaveAction({
      family: 'inbox-handle', target: item.id, requestId: crypto.randomUUID(), data: {action, expectedRevision: item.revision},
    }));
  };
  const phase = save.state;
  let answer = '';
  switch (phase.kind) {
    case 'sending': answer = phase.input.action === 'send-again' ? 'Requesting a new command…' : 'Requesting dismissal…'; break;
    case 'accepted': answer = 'Accepted. Waiting for the shared item removal.'; break;
    case 'refused': answer = `${phase.code}. Nothing was automatically sent again.`; break;
    case 'uncertain': answer = 'uncertain-result. Nothing was automatically sent again.'; break;
    case 'idle': case 'confirmed': break;
  }
  return <InboxItemCard item={item} label={label} control={control} disabled={!live || save.blocked} answer={answer} hidden={hidden} onHandle={handle}/>;
}

export type InboxFocus = {id: string; serial: number};

/** Command adapter over existing Inbox records. Disclosure, paging and focus never handle an item. */
export function InboxPanel({items, live, control, devices = [], focus, headingId}: {
  items: readonly InboxItem[]; live: boolean; control: boolean; devices?: readonly DeviceRecord[]; focus?: InboxFocus | undefined; headingId?: string;
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null), box = useHomeCardBox();
  // In a Home shape (#1672) a page holds the closed items that fit below the heading and any notice lines.
  const {frame, inbox: fit} = listFit, notices = (live ? 0 : 1) + (control ? 0 : 1);
  const pageSize = box === undefined ? listPageSize.inbox : fitRows(box.height - frame - fit.heading - notices * fit.notice, fit.row, items.length);
  useEffect(() => {
    if (focus === undefined) return;
    const row = [...(host.current?.querySelectorAll<HTMLElement>('[data-inbox]') ?? [])].find(item => item.dataset.inbox === focus.id);
    const disclosure = row?.querySelector<HTMLDetailsElement>('details.inbox-entry');
    if (disclosure === null || disclosure === undefined) return;
    disclosure.open = true;
    disclosure.querySelector('summary')?.focus();
    disclosure.scrollIntoView({block: 'nearest'});
  }, [focus]);
  // The heading keeps the total count on every page; the item to check is first given its page.
  return <div ref={host}><InboxCard count={items.length} live={live} control={control} headingId={headingId}>
    <PagedList keys={items.map(item => item.id)} pageSize={pageSize} label="Inbox" reveal={focus === undefined ? undefined : {key: focus.id, serial: focus.serial}}>
      {shown => items.map(item => <InboxRow key={item.id} item={item} label={devices.find(device => device.id === item.item.target)?.label ?? item.item.target} live={live} control={control} hidden={!shown(item.id)}/>)}
    </PagedList></InboxCard></div>;
}
