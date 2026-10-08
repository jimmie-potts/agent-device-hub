import React, {useState} from 'react';
import type {InboxItem} from '@jimmie-potts/event-contracts/v2/families';
import {sendAction} from './actions.ts';

function InboxRow({item, live, control}: {item: InboxItem; live: boolean; control: boolean}): React.JSX.Element {
  const [pending, setPending] = useState(false), [answer, setAnswer] = useState('');
  const handle = async (action: 'dismiss' | 'send-again'): Promise<void> => {
    if (!live || !control || pending) return;
    setPending(true); setAnswer(action === 'send-again' ? 'Requesting a new command…' : 'Requesting dismissal…');
    const result = await sendAction({family: 'inbox-handle', target: item.id, requestId: crypto.randomUUID(), data: {action, expectedRevision: item.revision}});
    setPending(false);
    setAnswer('error' in result ? `${result.error.code}. Nothing was automatically sent again.` : 'Accepted. Waiting for the shared item removal.');
  };
  return <article className="session" data-inbox={item.id}>
    <h3>{item.item.target} · {item.item.result}</h3>
    <p>{item.item.command}</p><p className="hint">Request {item.item.requestId}. Evidence: {item.item.evidence ?? 'none'}{item.item.error === undefined ? '' : ` · ${item.item.error.code}`}.</p>
    {item.item.outcomes?.map(outcome => <p className="hint" key={`${outcome.source}:${outcome.id}`}>{outcome.result} · {outcome.evidence} · {outcome.source}</p>)}
    <p className="hint">Display dismissals: {item.dismissedBy.length === 0 ? 'none' : item.dismissedBy.join(', ')}. Handling keeps device holds unchanged.</p>
    {control && <div className="actions"><button disabled={!live || pending} onClick={() => { void handle('send-again'); }}>Send again</button>
      <button disabled={!live || pending} onClick={() => { void handle('dismiss'); }}>Dismiss</button></div>}
    {answer !== '' && <p role="status">{answer}</p>}
  </article>;
}
export function InboxPanel({items, live, control}: {items: readonly InboxItem[]; live: boolean; control: boolean}): React.JSX.Element {
  return <div data-inbox-panel><p className="hint">Failed, uncertain and conflicting commands stay here until handled.</p>
    {!live && <p role="status">Inbox records are stale. Actions wait for current evidence.</p>}
    {!control && <p className="hint">Your session is read-only.</p>}
    {items.length === 0 ? <p>No commands need handling.</p> : items.map(item => <InboxRow key={item.id} item={item} live={live} control={control}/>)}
  </div>;
}
