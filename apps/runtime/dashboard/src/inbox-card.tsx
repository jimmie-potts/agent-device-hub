import React, {useId} from 'react';
import type {InboxItem} from '@jimmie-potts/event-contracts/v2/families';
import './hub-control-cards.css';

export function inboxCommandName(command: string): string {
  const names: Readonly<Record<string, string>> = {
    'org.bunny.mode.set.requested': 'Change Hub mode', 'org.bunny.device-mode.set.requested': 'Change mode',
    'org.bunny.power.set.requested': 'Set power', 'org.bunny.brightness.set.requested': 'Set brightness',
    'org.bunny.scene.activate.requested': 'Set scene', 'org.bunny.zone-power.set.requested': 'Set zone power',
    'org.bunny.media.start.requested': 'Play media', 'org.bunny.media.control.requested': 'Control media',
    'org.bunny.playback.control.requested': 'Control playback',
  };
  return names[command] ?? command;
}
const resultName = (result: InboxItem['item']['result']): string => ({succeeded: 'Succeeded', failed: 'Failed', uncertain: 'Uncertain', conflict: 'Conflict'})[result];

/** Shared Inbox frame; it acquires no state and performs no action itself. */
export function InboxCard({count, live, control, children, headingId}: {count: number; live: boolean; control: boolean; children: React.ReactNode; headingId?: string | undefined}): React.JSX.Element {
  const uid = useId();
  return <div className="inbox-card" data-inbox-panel data-attention={count > 0}>
    <header className="hub-control-heading"><h2 id={headingId ?? uid}>Inbox <span className="inbox-count">{count}</span></h2>
      {count > 0 && <span className="inbox-review"><span className="hub-control-mark" aria-hidden="true">!</span> Review</span>}</header>
    {!live && <p className="hub-control-status" role="status">Inbox records are stale. Actions wait for current evidence.</p>}
    {!control && <p className="hub-control-status">Your session is read-only.</p>}
    <div className="inbox-entries">{children}</div>
    {count === 0 && <p className="inbox-empty">{live ? 'No commands need handling.' : 'Waiting for current Inbox.'}</p>}
  </div>;
}

/** Stable native disclosure retains evidence and keyboard focus across record updates. */
export function InboxItemCard({item, label, disabled, control, answer, onHandle}: {
  item: InboxItem; label: string; disabled: boolean; control: boolean; answer: string;
  onHandle: (action: 'dismiss' | 'send-again') => void;
}): React.JSX.Element {
  return <article className="inbox-item" data-inbox={item.id}>
    <details className="inbox-entry"><summary><span className="inbox-item-mark" aria-hidden="true">!</span><span className="inbox-item-face"><span className="inbox-item-name">{label}</span><span className="inbox-item-sub">{inboxCommandName(item.item.command)} · {resultName(item.item.result)}</span></span><span className="inbox-caret" aria-hidden="true">›</span></summary>
      <div className="inbox-item-detail">
        <p>{item.item.result === 'conflict' ? 'Both success and failure were reported.' : item.item.result === 'uncertain' ? 'Delivery was not confirmed.' : item.item.result === 'failed' ? 'The request failed.' : 'Later success was reported. This item still needs handling.'}</p>
        {item.item.result === 'uncertain' && <p className="hint">A new send may repeat an effect.</p>}
        {control && <div className="actions"><button type="button" disabled={disabled} onClick={() => {onHandle('send-again');}}>Send again</button><button type="button" className="secondary" disabled={disabled} onClick={() => {onHandle('dismiss');}}>Dismiss</button></div>}
        {answer !== '' && <p role="status">{answer}</p>}
        <details className="inbox-evidence"><summary>Command evidence</summary>
          <p className="hint">Request {item.item.requestId}. Evidence: {item.item.evidence ?? 'none'}{item.item.error === undefined ? '' : ` · ${item.item.error.code}`}.</p>
          <p className="hint">{item.item.command}</p>
          {item.item.outcomes?.map(outcome => <p className="hint" key={`${outcome.source}:${outcome.id}`}>{outcome.result} · {outcome.evidence} · {outcome.source}</p>)}
          <p className="hint">Display dismissals: {item.dismissedBy.length === 0 ? 'none' : item.dismissedBy.join(', ')}. Handling keeps device holds unchanged.</p>
        </details>
      </div>
    </details>
  </article>;
}
