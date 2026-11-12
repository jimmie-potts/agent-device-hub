import React, {useId, useState} from 'react';
import type {FrontendPresentation} from '@jimmie-potts/sdk/frontend';
import type {TidbytView} from './records.js';

/** `shape` is the Home shape the shell places the card in (#1672 PR B); without it the card shows its full content. */
export type TidbytCardProps = {view: TidbytView; connected: boolean; retry: () => void; shape?: FrontendPresentation['shape']};
const tabs = ['Status', 'Content'] as const;

const display = <>
  <rect width="64" height="32" fill="#090c15"/>
  <path d="M23 13v-7h4v7h6V6h4v7h4v11h-4v3H27v-3h-4z" fill="#c5d8e6"/>
  <path d="M28 17h2v2h-2zm7 0h2v2h-2z" fill="#172333"/>
  <path d="M7 7h4v4H7zm44 14h4v4h-4z" fill="#7ac5ca"/>
</>;
function Artwork(): React.JSX.Element {
  return <div className="tidbyt-device">
    <svg viewBox="0 0 64 32" role="img" aria-label="Illustrative Tidbyt display, 64 by 32 pixels" shapeRendering="crispEdges">{display}</svg>
  </div>;
}
/** In a Home shape the frame is drawn inside the picture, so the whole device keeps its proportions at any size. */
function FramedArtwork(): React.JSX.Element {
  return <div className="tidbyt-compact-frame">
    <svg viewBox="-6 -6 76 44" role="img" aria-label="Illustrative Tidbyt display, 64 by 32 pixels" shapeRendering="crispEdges">
      <rect x="-6" y="-6" width="76" height="44" rx="4" fill="#7b5644"/><rect x="-2" y="-2" width="68" height="36" rx="1" fill="#22262e"/>{display}
    </svg>
  </div>;
}

/** A pure presentation: no transport, command, storage or physical-display claim. */
export function TidbytCard({view, connected, retry, shape}: TidbytCardProps): React.JSX.Element {
  const id = useId();
  const [tab, setTab] = useState<typeof tabs[number]>('Status');
  const current = connected && view.live;
  const transmission = view.device?.lastTransmission;
  const date = transmission?.status === 'known' ? new Date(transmission.transmittedAtMs) : undefined;
  const timestamp = date === undefined || Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  // A selected Tronbyt server declares controls the cloud never offers, so the record names the backend without a new field.
  const server = view.device?.capabilities.brightness.supported === true;
  const backend = server ? 'server' : 'cloud';
  const evidence = current ? `Current ${backend} evidence` : view.device === undefined ? view.pending ? 'Loading cloud evidence…' : 'Cloud evidence unavailable' : `Saved ${backend} evidence · stale`;
  const accepted = transmission?.status === 'known' ? <>
    {transmission.operationIds.includes('push') ? 'Push accepted' : transmission.operationIds.includes('remove') ? 'Removal accepted' : 'Update accepted'}
    {timestamp === undefined ? ' · time unknown' : <time dateTime={timestamp}>{date?.toLocaleString()}</time>}
  </> : 'No transmission recorded';
  const links = <nav className="tidbyt-links" aria-label="Tidbyt pages">{view.device !== undefined && <a href={`#/component/${encodeURIComponent(view.device.id)}`}>Device details</a>}<a href="#/module/tidbyt/display">Tidbyt page</a></nav>;
  // In a Home shape (#1672 PR B): one unit shows the artwork and the evidence line; larger shapes add the availability,
  // the latest acceptance and the pages. The Content face and Retry records stay one step away on those pages.
  if (shape !== undefined) return <article className="light-card tidbyt-card tidbyt-compact" aria-label="Tidbyt display" data-tidbyt-shape={shape}>
    <header className="light-card-heading"><div><h3 title={view.device?.label ?? 'Tidbyt'}>{view.device?.label ?? 'Tidbyt'}</h3><p>Read only</p></div></header>
    <figure className="tidbyt-artwork" data-tidbyt-artwork="true"><FramedArtwork/>{shape !== 'square' && <figcaption>64 × 32 · Illustration</figcaption>}</figure>
    <div className="tidbyt-compact-body">
      <p className="light-note" role="status" title={view.error === undefined ? evidence : `${evidence} (${view.error})`}>{evidence}</p>
      {shape !== 'square' && <dl className="tidbyt-facts"><dt>{server ? 'Server' : 'Cloud'} availability</dt><dd>{view.device?.availability ?? 'unknown'}</dd>
        <dt>Latest {backend} acceptance</dt><dd>{accepted}</dd></dl>}
      {(shape === 'tall' || shape === 'large-square') && <p className="light-note">Physical display unobserved.</p>}
      {links}
    </div>
  </article>;
  return <article className="light-card tidbyt-card" aria-label="Tidbyt display">
    <header className="light-card-heading"><div><h3>{view.device?.label ?? 'Tidbyt'}</h3><p>Read only</p></div></header>
    <figure className="tidbyt-artwork" data-tidbyt-artwork="true"><Artwork/><figcaption>64 × 32 · Illustration</figcaption></figure>
    <div className="light-tabs tidbyt-tabs" role="tablist" aria-label="Tidbyt information">{tabs.map((name, index) => <button key={name} type="button" role="tab"
      id={`${id}-${name}`} aria-controls={`${id}-${name}-face`} aria-selected={tab === name} tabIndex={tab === name ? 0 : -1}
      onClick={() => { setTab(name); }} onKeyDown={event => {
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : ['ArrowRight', 'ArrowLeft'].includes(event.key) ? 1 - index : undefined;
        if (next === undefined) return;
        event.preventDefault(); setTab(tabs[next] ?? 'Status'); event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus();
      }}>{name}</button>)}</div>
    <div className="tidbyt-face-space">
      <div className="light-face" hidden={tab !== 'Status'} id={`${id}-Status-face`} role="tabpanel" aria-labelledby={`${id}-Status`} tabIndex={0}>
        <p className="light-note" role="status">{evidence}</p>
        <dl className="tidbyt-facts"><dt>{server ? 'Server' : 'Cloud'} availability</dt><dd>{view.device?.availability ?? 'unknown'}</dd>
          <dt>Latest {backend} acceptance</dt><dd>{accepted}</dd></dl>
        <p className="light-note">Physical display unobserved.</p>
        {view.device === undefined && current && <p className="light-note">No Tidbyt device record.</p>}
        {view.error !== undefined && <p role="alert" className="light-note">{server ? 'Server' : 'Cloud'} records unavailable ({view.error}). <button type="button" className="secondary" disabled={!connected || view.pending} onClick={retry}>Retry records</button></p>}
      </div>
      <div className="light-face" hidden={tab !== 'Content'} id={`${id}-Content-face`} role="tabpanel" aria-labelledby={`${id}-Content`} tabIndex={0}>
        <h4>Automatic tiles</h4><ul className="tidbyt-tiles"><li>Agent status</li><li>Now playing · optional</li></ul>
        <p className="light-note">{server ? 'Rotation is managed on the Tronbyt server.' : 'Rotation is managed in the Tidbyt app.'}</p>
      </div>
    </div>
    {links}
  </article>;
}
