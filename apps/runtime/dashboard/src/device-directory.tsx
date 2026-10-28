import React, {useState} from 'react';
import {DEVICE_CATEGORIES, directoryEntries, type DeviceCategory} from './directory.ts';
import {NavLink} from './navigation.tsx';
import type {RuntimeData} from './runtime-feeds.ts';

export function DeviceDirectory({runtime, connected, active}: {runtime: RuntimeData; connected: boolean; active: boolean}): React.JSX.Element {
  const [category, setCategory] = useState<DeviceCategory>('Lighting');
  const entries = directoryEntries(runtime).filter(entry => entry.category === category);
  return <section aria-label="Devices" hidden={!active}>
    <header className="page"><h1>Devices</h1></header>
    <div className="directory-categories" role="group" aria-label="Device categories">{DEVICE_CATEGORIES.map(value =>
      <button type="button" key={value} aria-pressed={category === value} onClick={() => {setCategory(value);}}>{value}</button>)}</div>
    {runtime.catalogFailed && <p role="alert" className="warning">The module catalog is unavailable. Retrying the read; no new capabilities are assumed.</p>}
    {!connected && <p className="warning">Connection unavailable. These are the last declarations the page had.</p>}
    {runtime.modules === undefined && !runtime.catalogFailed && <p className="hint">Loading device pages.</p>}
    <div className="directory-grid">{entries.map(entry => <article key={entry.id} className="directory-card">
      <header><h2>{entry.label}</h2>{entry.state !== 'running' && <p className="warning">{entry.state}. Device observations are unavailable.</p>}</header>
      {entry.stale && <p className="warning">Device observations are stale or unavailable.</p>}
      <nav aria-label={`${entry.label} destinations`}>{entry.links.map(link => <NavLink key={JSON.stringify(link.route)} route={link.route}>{link.label}</NavLink>)}</nav>
      {entry.links.length === 0 && <p className="hint">No device pages or observations are available.</p>}
    </article>)}</div>
    {runtime.modules !== undefined && !runtime.catalogFailed && entries.length === 0 && <p className="hint">No {category.toLowerCase()} pages are currently declared.</p>}
  </section>;
}
