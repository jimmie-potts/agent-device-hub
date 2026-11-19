import React from 'react';
import {companionsOverview} from './companions-overview.ts';
import {NavLink} from './navigation.tsx';
import type {RuntimeData} from './runtime-feeds.ts';

/** Companions (`#/companions`, Hub #1950): links to Habitat and the companion features. It only navigates. */
export function CompanionsPage({runtime}: {runtime: RuntimeData}): React.JSX.Element {
  const {sections, note} = companionsOverview(runtime);
  return <section aria-label="Companions"><header className="page"><h1>Companions</h1></header>
    {note !== undefined && <p className={runtime.catalogFailed ? 'warning' : 'hint'} role={runtime.catalogFailed ? 'alert' : undefined}>{note}</p>}
    <div className="settings-grid">{sections.map(section => <article key={section.id} className="card companions-card" aria-labelledby={`companions-${section.id}`}>
      <h2 id={`companions-${section.id}`}>{section.title}</h2><p className="hint">{section.hint}</p>
      <nav aria-label={section.title}>{section.links.map(link => <NavLink key={link.label} route={link.route}>{link.label}</NavLink>)}</nav>
    </article>)}</div>
  </section>;
}
