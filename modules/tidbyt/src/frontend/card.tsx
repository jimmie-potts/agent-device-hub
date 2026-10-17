import React, {useId, useState} from 'react';
import type {TidbytView} from './records.js';

export type TidbytCardProps = {view: TidbytView; connected: boolean; retry: () => void};
const tabs = ['Status', 'Content'] as const;

/** A pure presentation: no transport, command, storage or physical-display claim. */
export function TidbytCard({view, connected, retry}: TidbytCardProps): React.JSX.Element {
  const id = useId();
  const [tab, setTab] = useState<typeof tabs[number]>('Status');
  const current = connected && view.live;
  const transmission = view.device?.lastTransmission;
  const date = transmission?.status === 'known' ? new Date(transmission.transmittedAtMs) : undefined;
  const timestamp = date === undefined || Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  return <article className="light-card tidbyt-card" aria-label="Tidbyt display">
    <header className="light-card-heading"><div><h3>{view.device?.label ?? 'Tidbyt'}</h3><p>Read only</p></div></header>
    <figure className="tidbyt-artwork" data-tidbyt-artwork="true"><div className="tidbyt-device">
      <svg viewBox="0 0 64 32" role="img" aria-label="Illustrative Tidbyt display, 64 by 32 pixels" shapeRendering="crispEdges">
        <rect width="64" height="32" fill="#090c15"/>
        <path d="M23 13v-7h4v7h6V6h4v7h4v11h-4v3H27v-3h-4z" fill="#c5d8e6"/>
        <path d="M28 17h2v2h-2zm7 0h2v2h-2z" fill="#172333"/>
        <path d="M7 7h4v4H7zm44 14h4v4h-4z" fill="#7ac5ca"/>
      </svg>
    </div><figcaption>64 × 32 · Illustration</figcaption></figure>
    <div className="light-tabs tidbyt-tabs" role="tablist" aria-label="Tidbyt information">{tabs.map((name, index) => <button key={name} type="button" role="tab"
      id={`${id}-${name}`} aria-controls={`${id}-${name}-face`} aria-selected={tab === name} tabIndex={tab === name ? 0 : -1}
      onClick={() => { setTab(name); }} onKeyDown={event => {
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : ['ArrowRight', 'ArrowLeft'].includes(event.key) ? 1 - index : undefined;
        if (next === undefined) return;
        event.preventDefault(); setTab(tabs[next] ?? 'Status'); event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus();
      }}>{name}</button>)}</div>
    <div className="tidbyt-face-space">
      <div className="light-face" hidden={tab !== 'Status'} id={`${id}-Status-face`} role="tabpanel" aria-labelledby={`${id}-Status`} tabIndex={0}>
        <p className="light-note" role="status">{current ? 'Current cloud evidence' : view.device === undefined ? view.pending ? 'Loading cloud evidence…' : 'Cloud evidence unavailable' : 'Saved cloud evidence · stale'}</p>
        <dl className="tidbyt-facts"><dt>Cloud availability</dt><dd>{view.device?.availability ?? 'unknown'}</dd>
          <dt>Latest cloud acceptance</dt><dd>{transmission?.status === 'known' ? <>
            {transmission.operationIds.includes('push') ? 'Push accepted' : transmission.operationIds.includes('remove') ? 'Removal accepted' : 'Update accepted'}
            {timestamp === undefined ? ' · time unknown' : <time dateTime={timestamp}>{date?.toLocaleString()}</time>}
          </> : 'No transmission recorded'}</dd></dl>
        <p className="light-note">Physical display unobserved.</p>
        {view.device === undefined && current && <p className="light-note">No Tidbyt device record.</p>}
        {view.error !== undefined && <p role="alert" className="light-note">Cloud records unavailable ({view.error}). <button type="button" className="secondary" disabled={!connected || view.pending} onClick={retry}>Retry records</button></p>}
      </div>
      <div className="light-face" hidden={tab !== 'Content'} id={`${id}-Content-face`} role="tabpanel" aria-labelledby={`${id}-Content`} tabIndex={0}>
        <h4>Automatic tiles</h4><ul className="tidbyt-tiles"><li>Agent status</li><li>Now playing · optional</li></ul>
        <p className="light-note">Rotation is managed in the Tidbyt app.</p>
      </div>
    </div>
    <nav className="tidbyt-links" aria-label="Tidbyt pages">{view.device !== undefined && <a href={`#/component/${encodeURIComponent(view.device.id)}`}>Device details</a>}<a href="#/module/tidbyt/display">Tidbyt page</a></nav>
  </article>;
}
