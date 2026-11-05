import React, {useEffect, useId, useRef, useState} from 'react';
import type {ArtState, ArtTarget, ArtworkSummary} from '@jimmie-potts/event-contracts/v2/art-state';
import type {FrontendCommand, FrontendContext, FrontendContribution} from '@jimmie-potts/sdk/frontend';
import {ArtImage} from './image.js';
import {useArt, useGalleryPage} from './hooks.js';
import {ART_TARGETS, TARGET_LABELS, browserArt, latestBrowserArt, money, reasonText} from './model.js';
export {ArtPresentationProvider, useArtPresentation} from './presentation.js';
export type {ArtPresentation, PresentedArt} from './presentation.js';
import './style.css';

function ArtStatus({live, error, refresh}: {live: boolean; error: string | undefined; refresh: () => void}): React.JSX.Element | null {
  if (live && error === undefined) return null;
  return <p role="status" className="hint">{error ?? 'Art records are unavailable or stale. Controls are read-only.'} <button type="button" className="secondary" onClick={refresh}>Refresh art records</button></p>;
}
function Allowance({state}: {state: ArtState | undefined}): React.JSX.Element {
  return <section className="art-allowance" aria-label="Art allowance"><h2>Allowance</h2>{state === undefined ? <p>Allowance is unavailable.</p>
    : <><div className="art-provider-grid">{state.providers.map(provider => <div key={provider.provider}>
      <h3>{provider.provider === 'openai' ? 'OpenAI images' : 'Anthropic ideas'}</h3>
      <p>{provider.available ? `${money(provider.remainingMicros)} remaining this month` : 'Provider is not configured'}</p>
      <dl><div><dt>Spent</dt><dd>{money(provider.spentMicros)}</dd></div><div><dt>Reserved</dt><dd>{money(provider.reservedMicros)}</dd></div>
        <div><dt>Uncertain</dt><dd>{money(provider.uncertainMicros)}</dd></div><div><dt>Monthly limit</dt><dd>{money(provider.ceilingMicros)}</dd></div></dl>
      <p className="hint">Automatic daily pace {money(provider.paceMicros)}; {money(provider.todayMicros)} held today. Owner requests still respect the monthly limit.</p>
      {provider.earlierUncertainMicros > 0 && <p className="hint">Earlier uncertain spend: {money(provider.earlierUncertainMicros)}.</p>}
      {provider.excessMicros > 0 && <p role="alert">Reported cost exceeded its reservation by {money(provider.excessMicros)}.</p>}
    </div>)}</div><p className="hint">A lost response remains uncertain spend. Requests are never repeated automatically.</p></>}</section>;
}
function Jobs({state}: {state: ArtState | undefined}): React.JSX.Element | null {
  if (state === undefined || state.jobs.length === 0) return null;
  return <section className="art-jobs" aria-label="Art requests"><h2>Recent requests</h2><p className="hint">Command acceptance saves a job. Its generation result appears here.</p>
    <ol>{[...state.jobs].sort((a, b) => b.createdAtMs - a.createdAtMs).slice(0, 6).map(job => <li key={job.requestId} data-art-job={job.requestId}>
      <strong>{job.purpose === 'variation' ? 'Variation' : 'Art request'}: {job.status === 'finished' ? job.outcome : job.status}</strong>
      <span>{job.targets.map(target => `${TARGET_LABELS[target.target]}: ${target.outcome}${target.reason === null ? '' : ` (${reasonText[target.reason] ?? 'Unavailable'})`}`).join(' · ')}</span>
    </li>)}</ol></section>;
}
const mayChange = (context: FrontendContext, live: boolean, command: FrontendCommand): boolean => live && context.connected && context.control && context.operationsLive && !command.locked;

function RequestForm({context, live, command, variation, clearVariation}: {
  context: FrontendContext; live: boolean; command: FrontendCommand; variation: ArtworkSummary | undefined; clearVariation: () => void;
}): React.JSX.Element {
  const [text, setText] = useState(''), [targets, setTargets] = useState<ArtTarget[]>([...ART_TARGETS]);
  const input = useRef<HTMLTextAreaElement>(null), inputId = useId();
  useEffect(() => {if (variation !== undefined) input.current?.focus();}, [variation]);
  const disabled = !mayChange(context, live, command);
  return <form className="art-request" onSubmit={event => {
    event.preventDefault();if (disabled || targets.length === 0) return;
    const requestId = crypto.randomUUID();
    void command.run({family: 'art-request', target: 'art', requestId, data: {action: 'start', origin: {kind: 'owner'},
      purpose: variation === undefined ? 'request' : 'variation', targets, ...(variation === undefined ? {} : {variationOf: variation.artworkId}), ...(text.trim() === '' ? {} : {text: text.trim()})}});
  }}><h2>{variation === undefined ? 'Request art' : 'Request a variation'}</h2>
    {variation !== undefined && <p>Based on the selected saved artwork. <button type="button" className="secondary" onClick={clearVariation}>Cancel variation</button></p>}
    <label htmlFor={inputId}>What would you like to see?</label><textarea id={inputId} ref={input} value={text} maxLength={2000} rows={3} disabled={disabled} onChange={event => {setText(event.target.value);}} placeholder={variation === undefined ? 'An idea, or leave blank for inspiration' : 'Describe the change you want'}/>
    <fieldset disabled={disabled}><legend>Create compositions for</legend><div className="art-targets">{ART_TARGETS.map(target => <label key={target}><input type="checkbox" checked={targets.includes(target)} onChange={event => {
      setTargets(previous => event.target.checked ? [...previous, target] : previous.filter(value => value !== target));
    }}/>{TARGET_LABELS[target]}</label>)}</div></fieldset>
    <p className="hint">This spends the selected providers' allowance and prepares the selected compositions. It does not start a display moment.</p>
    <button type="submit" disabled={disabled || targets.length === 0}>{variation === undefined ? 'Create art' : 'Create variation'}</button>
  </form>;
}

function GalleryBody({context, state, live, command}: {context: FrontendContext; state: ArtState | undefined; live: boolean; command: FrontendCommand}): React.JSX.Element {
  const [cursors, setCursors] = useState<number[]>([0]), [selected, setSelected] = useState<ArtworkSummary>(), [variation, setVariation] = useState<ArtworkSummary>();
  const revision = JSON.stringify(state?.artworks.map(art => [art.artworkId, art.favorite, art.feedback, art.compositions.map(value => value.compositionId)]) ?? []);
  const gallery = useGalleryPage(context.api, live, cursors.at(-1) ?? 0, revision);
  const current = selected === undefined ? latestBrowserArt(gallery.page?.artworks ?? state?.artworks ?? [])
    : gallery.page?.artworks.find(value => value.artworkId === selected.artworkId) ?? state?.artworks.find(value => value.artworkId === selected.artworkId) ?? selected;
  const disabled = !mayChange(context, live, command);
  const edit = (data: {action: 'favorite'; artworkId: string; favorite: boolean} | {action: 'feedback'; artworkId: string; signal: 'more' | 'less' | 'dismiss'}): void => {
    if (disabled) return;
    void command.run({family: 'art-catalog-edit', target: 'art', requestId: crypto.randomUUID(), data});
  };
  return <><div className="art-gallery-top"><section className="card art-selected" aria-label="Selected artwork"><h2>Selected artwork</h2>
      <ArtImage api={context.api} artwork={current} live={live} presented/>
      {current?.variationOf !== null && current?.variationOf !== undefined && <p className="hint">Variation of saved art.</p>}
    </section><section className="card"><RequestForm context={context} live={live} command={command} variation={variation} clearVariation={() => {setVariation(undefined);}}/>
      <p role="status" className="hint">{command.text}</p></section></div>
    <section className="card art-library" aria-label="Saved art"><header><h2>Recent gallery</h2><button type="button" className="secondary" disabled={!live || gallery.loading} onClick={gallery.refresh}>Refresh gallery</button></header>
      {gallery.loading && <p role="status">Loading gallery…</p>}
      {gallery.error && <p role="alert">Gallery content is unavailable. Refresh to try the read again.</p>}
      <div className="art-gallery-grid">{gallery.page?.artworks.map(art => <article className="art-tile" key={art.artworkId} data-gallery-art={art.artworkId}>
        <button type="button" className="art-open secondary" aria-pressed={current?.artworkId === art.artworkId} onClick={() => {setSelected(art);}}>
          <ArtImage api={context.api} artwork={art} live={live} compact/>
          <span>Open artwork from {new Date(art.createdAtMs).toLocaleString()}</span>
        </button>
        <p className="hint">{art.favorite ? 'Favorite' : 'Recent artwork'}{art.feedback === null ? '' : ` · Feedback: ${art.feedback}`}{browserArt(art) === undefined ? ' · Browser composition unavailable' : ''}</p>
        <div className="art-tile-actions"><button type="button" className="secondary" disabled={disabled} aria-pressed={art.favorite} onClick={() => {edit({action: 'favorite', artworkId: art.artworkId, favorite: !art.favorite});}}>{art.favorite ? 'Unfavorite' : 'Favorite'}</button>
          <button type="button" className="secondary" disabled={disabled} onClick={() => {setVariation(art);}}>Vary</button>
          <button type="button" className="secondary" disabled={disabled} onClick={() => {edit({action: 'feedback', artworkId: art.artworkId, signal: 'more'});}}>More like this</button>
          <button type="button" className="secondary" disabled={disabled} onClick={() => {edit({action: 'feedback', artworkId: art.artworkId, signal: 'less'});}}>Less like this</button>
          <button type="button" className="secondary" disabled={disabled} onClick={() => {edit({action: 'feedback', artworkId: art.artworkId, signal: 'dismiss'});}}>Dismiss artwork</button></div>
      </article>)}</div>
      {gallery.page?.artworks.length === 0 && <p>No saved art yet. Create a composition to begin.</p>}
      <nav className="actions" aria-label="Gallery pages"><button type="button" className="secondary" disabled={!live || gallery.loading || cursors.length === 1} onClick={() => {setCursors(value => value.slice(0, -1));}}>Previous art</button>
        <span>Page {cursors.length}</span><button type="button" className="secondary" disabled={!live || gallery.loading || gallery.page?.nextAfter == null} onClick={() => {
          const next = gallery.page?.nextAfter;if (next != null) setCursors(value => [...value, next]);
        }}>Next art</button></nav>
    </section><section className="card"><Allowance state={state}/><Jobs state={state}/></section></>;
}

export function ArtGallery({context}: {context: FrontendContext}): React.JSX.Element {
  const catalog = useArt(context.api, context.connected), {Command} = context.ui;
  return <div className="art-gallery"><p className="hint">Shared ideas, rich browser compositions and a private saved collection.</p>
    <ArtStatus live={catalog.live} error={catalog.error} refresh={catalog.refresh}/>
    <Command context={context} target="art" attemptKey="art/catalog">{command => <GalleryBody context={context} state={catalog.state} live={catalog.live} command={command}/>}</Command>
  </div>;
}
export function ArtWidget({context}: {context: FrontendContext}): React.JSX.Element {
  const catalog = useArt(context.api, context.connected), artwork = latestBrowserArt(catalog.state?.artworks ?? []);
  return <article className="card art-widget" aria-label="Art"><header><h2>Art</h2><a href="#/module/art/gallery">Open Gallery</a></header>
    <ArtImage api={context.api} artwork={artwork} live={catalog.live} compact presented/>
    {catalog.error !== undefined && <p className="hint">{catalog.error}</p>}
  </article>;
}
export const frontend: FrontendContribution = {module: 'art', pages: [{id: 'gallery', Component: ArtGallery}]};
