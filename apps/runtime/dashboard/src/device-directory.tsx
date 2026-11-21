import React from 'react';
import {DEVICE_CATEGORIES, directoryEntries, type DeviceCategory, type DirectoryEntry} from './directory.ts';
import {NavLink} from './navigation.tsx';
import {RailIcon} from './rail.tsx';
import type {RuntimeData} from './runtime-feeds.ts';

const ICONS: Readonly<Record<DeviceCategory, 'automation' | 'devices' | 'settings'>> = {Lighting: 'automation', Displays: 'devices', Appliances: 'settings'};

/** A module's name with a line under it, as a card shows them. */
function Name({entry, under}: {entry: DirectoryEntry; under: string}): React.JSX.Element {
  return <><span className="inventory-icon"><RailIcon name={ICONS[entry.category]} size={20}/></span>
    <span className="inventory-name"><strong>{entry.label}</strong>{under !== '' && <small>{under}</small>}</span></>;
}

/**
 * All devices (`#/devices`): the configured hardware in Displays, Lighting and Appliances sections, as the owner's
 * selected device-only prototype lays it out (Hub #1950). A lighting brand's card leads to its overview and lists its
 * lights directly under it, the same lights the Devices menu lists. A module with one destination is one card that
 * opens it; one with several devices lists them. Each device opens its own page, where its task pages are. It reads
 * nothing and sends nothing.
 */
export function DeviceDirectory({runtime, connected, active}: {runtime: RuntimeData; connected: boolean; active: boolean}): React.JSX.Element {
  const entries = directoryEntries(runtime);
  // Each card is one panel on the glass layer (#1950), and the text on the wash between them has a veil.
  const card = (entry: DirectoryEntry): React.JSX.Element => <div key={entry.id} className="inventory-panel" data-glass-panel={entry.id}>{surface(entry)}</div>;
  const surface = (entry: DirectoryEntry): React.JSX.Element => {
    const first = entry.links[0];
    const warning = entry.state !== 'running' ? <p className="warning">{entry.state}. Device observations are unavailable.</p>
      : entry.stale ? <p className="warning">Device observations are stale or unavailable.</p> : null;
    if (entry.overview === undefined && entry.links.length === 1 && first !== undefined && warning === null) {
      // The card is named for its module; the device's own name and its availability are shown beside it.
      return <NavLink route={first.route} className="card inventory-card" label={entry.label}><Name entry={entry} under={first.label === entry.label ? '' : first.label}/>
        <span className="inventory-state"><span className="inventory-dot" data-off={entry.available ? undefined : ''}/>{entry.status}</span></NavLink>;
    }
    return <article className="card inventory-group" aria-label={entry.label}>
      {entry.overview === undefined ? <div className="inventory-card"><Name entry={entry} under={entry.status}/></div>
        : <NavLink route={entry.overview.route} className="inventory-card" label={entry.overview.label}><Name entry={entry} under={entry.status}/><RailIcon name="chevron" size={14}/></NavLink>}
      {warning}
      {entry.links.length > 0 && <nav className="inventory-links" aria-label={entry.overview === undefined ? `${entry.label} devices` : `${entry.label} lights`}>{entry.links.map(link =>
        <NavLink key={JSON.stringify(link.route)} route={link.route}>{link.label}<RailIcon name="chevron" size={14}/></NavLink>)}</nav>}
      {entry.overview === undefined && entry.links.length === 0 && <p className="hint">No device pages or observations are available.</p>}
    </article>;
  };
  return <section aria-label="Devices" hidden={!active}>
    <header className="page"><h1 data-glass-veil>Devices</h1></header>
    {runtime.catalogFailed && <p role="alert" className="warning" data-glass-veil>The module catalog is unavailable. Retrying the read; no new capabilities are assumed.</p>}
    {!connected && <p className="warning" data-glass-veil>Connection unavailable. These are the last declarations the page had.</p>}
    {runtime.modules === undefined && !runtime.catalogFailed && <p className="hint" data-glass-veil>Loading device pages.</p>}
    {runtime.modules !== undefined && !runtime.catalogFailed && entries.length === 0 && <p className="hint" data-glass-veil>No devices are currently declared.</p>}
    <div className="inventory">{DEVICE_CATEGORIES.map(category => {
      const shown = entries.filter(entry => entry.category === category);
      return shown.length === 0 ? null : <section key={category} className="inventory-section" aria-labelledby={`inventory-${category}`}>
        <h2 id={`inventory-${category}`} data-glass-veil>{category}</h2><div className="inventory-grid">{shown.map(card)}</div></section>;
    })}</div>
  </section>;
}
