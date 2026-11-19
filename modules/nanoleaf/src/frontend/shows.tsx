import React, {useEffect, useRef, useState} from 'react';
import type {FrontendApi, FrontendCommand, FrontendContext} from '@jimmie-potts/sdk/frontend';
import {MUSIC_AUTHORING_MODEL, SHOW_LIMITS, SHOW_TARGET, type ShowCatalog, type ShowSave} from '../music-show-data.js';
import {MAX_MUSIC_CUES, MAX_MUSIC_DURATION_MS, MIN_MUSIC_CUE_MS, selectMusicCue, type MusicCue, type MusicTimeline} from '../music-timeline-data.js';
import {DIRECTION_CHOICES, draftProblem, generatedDraft, measuredDraft, PATTERN_CHOICES, showVersion, spatial, SPEED_CHOICES, starter, STARTERS} from './show-model.js';
import {followShows, type CatalogView} from './show-feed.js';
import './shows.css';

function useShows(api: FrontendApi): CatalogView & {refresh: () => void} {
  const [state, setState] = useState<CatalogView>({value: undefined, live: false, pending: true, failed: false});
  const [attempt, setAttempt] = useState(0);
  const retained = useRef<ShowCatalog | undefined>(undefined);
  useEffect(() => followShows((changed, options) => api.sync<ShowCatalog>(['nanoleaf-shows'], changed, options), view => {
    retained.current = view.value; setState(view);
  }, retained.current), [api, attempt]);
  return {...state, refresh: () => {setAttempt(value => value + 1);}};
}

const seconds = (ms: number): string => `${Number((ms / 1000).toFixed(1)).toString()} s`;
function Palette({colors}: {colors: readonly string[]}): React.JSX.Element {
  return <span className="show-palette">{colors.map((color, index) => <span key={index} className="show-color"><i aria-hidden="true" style={{backgroundColor: color}}/>{color}</span>)}</span>;
}
function Storyboard({timeline, measured}: {timeline: MusicTimeline; measured: boolean}): React.JSX.Element {
  const title = measured ? 'Measured cue storyboard' : 'Decorative cue storyboard';
  const [position, setPosition] = useState(0);
  const current = Math.min(position, timeline.durationMs), selected = selectMusicCue(timeline, current);
  const parts: React.ReactNode[] = [];
  let end = 0;
  for (const cue of timeline.cues) {
    if (cue.offsetMs > end) parts.push(<li className="show-gap" key={`gap-${cue.id}`}>{seconds(end)}–{seconds(cue.offsetMs)} · Gap: no cue</li>);
    parts.push(<li key={cue.id}><button type="button" className="secondary show-cue" aria-pressed={selected.kind === 'cue' && selected.cue.id === cue.id}
      onClick={() => {setPosition(cue.offsetMs);}}><strong>{seconds(cue.offsetMs)}–{seconds(cue.offsetMs + cue.durationMs)} · {cue.recipe.pattern}</strong>
      <Palette colors={cue.recipe.colors}/><span>Intensity {Math.round(cue.intensity * 100)}%</span></button></li>);
    end = cue.offsetMs + cue.durationMs;
  }
  if (end < timeline.durationMs) parts.push(<li className="show-gap" key="trailing-gap">{seconds(end)}–{seconds(timeline.durationMs)} · Gap: no cue</li>);
  return <section className="show-storyboard" aria-label={title}><h3>{title}</h3>
    <p>Timing, palette and effect names only. This does not show rendered frames, play music or control lights.</p>
    <ol>{parts}</ol>
    <label>Inspect position: {seconds(current)}<input type="range" min="0" max={timeline.durationMs} step={measured ? 1 : 100} value={current}
      onChange={event => {setPosition(Number(event.target.value));}}/></label>
    <p role="status">{selected.kind === 'cue' ? `${selected.cue.recipe.pattern} cue · ${seconds(selected.elapsedMs)} into this cue`
      : selected.kind === 'gap' ? 'Gap: no cue. No blackout or return behavior is implied.' : 'End of show. No output behavior is implied.'}</p>
  </section>;
}

function CueEditor({cue, index, measured, disabled, update, remove}: {
  cue: MusicCue; index: number; measured: boolean; disabled: boolean; update: (cue: MusicCue) => void; remove: () => void;
}): React.JSX.Element {
  return <fieldset className="show-cue-edit" disabled={disabled}><legend>Cue {index + 1}</legend>
    <div className="show-fields"><label>Start (ms)<input type="number" min="0" max={MAX_MUSIC_DURATION_MS} step={measured ? 1 : 100} value={cue.offsetMs}
      onChange={event => {update({...cue, offsetMs: Number(event.target.value)});}}/></label>
    <label>Duration (ms)<input type="number" min={MIN_MUSIC_CUE_MS} max={MAX_MUSIC_DURATION_MS} step={measured ? 1 : 100} value={cue.durationMs}
      onChange={event => {update({...cue, durationMs: Number(event.target.value)});}}/></label>
    <label>Effect<select aria-label="Effect" value={cue.recipe.pattern} onChange={event => {
      const pattern = PATTERN_CHOICES.find(value => value === event.target.value); if (pattern === undefined) return;
      const {direction: _direction, ...recipe} = cue.recipe;
      update({...cue, recipe: {...recipe, pattern, ...(spatial(pattern) ? {direction: 'right'} : {})}});
    }}>{PATTERN_CHOICES.map(value => <option key={value}>{value}</option>)}</select></label>
    <label>Speed<select aria-label="Speed" value={cue.recipe.speed} onChange={event => {
      const speed = SPEED_CHOICES.find(value => value === event.target.value); if (speed !== undefined) update({...cue, recipe: {...cue.recipe, speed}});
    }}>{SPEED_CHOICES.map(value => <option key={value}>{value}</option>)}</select></label>
    {spatial(cue.recipe.pattern) && <label>Direction<select aria-label="Direction" value={cue.recipe.direction} onChange={event => {
      const direction = DIRECTION_CHOICES.find(value => value === event.target.value); if (direction !== undefined) update({...cue, recipe: {...cue.recipe, direction}});
    }}>{DIRECTION_CHOICES.map(value => <option key={value}>{value}</option>)}</select></label>}
    <label>Intensity (%)<input type="number" min="0" max="100" step={measured ? 'any' : 1} value={measured ? Math.round(cue.intensity * 10000) / 100 : cue.intensity * 100}
      onChange={event => {update({...cue, intensity: Number(event.target.value) / 100});}}/></label>
    <label className="show-check"><input type="checkbox" checked={cue.recipe.loop} onChange={event => {update({...cue, recipe: {...cue.recipe, loop: event.target.checked}});}}/>Repeat effect within cue</label></div>
    <div className="show-colors">{cue.recipe.colors.map((color, colorIndex) => <label key={colorIndex}>Color {colorIndex + 1}<input type="color" value={color}
      onChange={event => {update({...cue, recipe: {...cue.recipe, colors: cue.recipe.colors.map((value, offset) => offset === colorIndex ? event.target.value : value)}});}}/></label>)}
      <button type="button" className="secondary" disabled={cue.recipe.colors.length >= 8} onClick={() => {update({...cue, recipe: {...cue.recipe, colors: [...cue.recipe.colors, '#ffffff']}});}}>Add color</button>
      <button type="button" className="secondary" disabled={cue.recipe.colors.length <= 1} onClick={() => {update({...cue, recipe: {...cue.recipe, colors: cue.recipe.colors.slice(0, -1)}});}}>Remove last color</button>
    </div><button type="button" className="secondary" onClick={remove}>Remove cue {index + 1}</button>
  </fieldset>;
}

function ShowAuthoring({context, generate, cancel, reading, canOpen, open, dirty}: {
  context: FrontendContext; generate: FrontendCommand; cancel: FrontendCommand; reading: boolean; canOpen: boolean;
  open: (requestId?: string) => void; dirty: boolean;
}): React.JSX.Element {
  const [style, setStyle] = useState('');
  const [source, setSource] = useState<'measured' | 'generic'>('measured');
  const requestId = generate.requestId;
  const operation = context.operations.find(value => value.requestId === requestId && value.family === 'nanoleaf-show-generate' && value.target === SHOW_TARGET);
  const ready = operation?.status === 'completed' && operation.result === 'succeeded' && operation.evidence === 'observed';
  const active = operation?.status === 'accepted';
  const settledUncertain = operation?.status === 'completed' && operation.result === 'uncertain';
  const online = context.connected && context.control && context.operationsLive;
  const disabled = !online || (generate.locked && !settledUncertain) || reading;
  return <section aria-label="Claude show generation">
    <h2>Draft a show with Claude</h2>
    <p>Each request makes one paid Anthropic API attempt with {MUSIC_AUTHORING_MODEL}. Music has its own
      spending limits of $3 USD per day and $20 USD per month.</p>
    <p>Claude receives your style request and the current Music track’s title and artist. Measured mode also sends
      derived energy and onset measurements. Audio stays on your Mac.</p>
    <p>Anthropic keeps prompts and completions for at least 30 days. Safety investigations and legal obligations
      can extend retention. <a href="https://support.claude.com/en/articles/15425695-covered-models" target="_blank" rel="noreferrer">Anthropic retention policy</a></p>
    <div className="show-fields">
      <label>Timing source<select aria-label="Timing source" value={source} disabled={disabled} onChange={event => {setSource(event.target.value === 'generic' ? 'generic' : 'measured');}}>
        <option value="measured">Measured excerpt</option>
        <option value="generic">Generic sequence</option>
      </select></label>
      <label>Mood or style<input placeholder="Slow amber pulses with a bright finish" value={style} maxLength={500} disabled={disabled}
        onChange={event => {setStyle(event.target.value);}}/></label>
    </div>
    <div className="show-actions">
      <button type="button" className="secondary" disabled={disabled} onClick={() => {setStyle('Ocean drift with slow blue and teal waves');}}>Use ocean drift style</button>
      <button type="button" className="secondary" disabled={disabled} onClick={() => {setStyle('Warm rise with amber pulses and a bright gold finish');}}>Use warm rise style</button>
    </div>
    <p>{source === 'measured'
      ? <>Start measuring the current track on the <a href="#/audio">Audio page</a>. The cues follow the available excerpt measurements.</>
      : 'Generic cues use decorative timing. Use this option when track measurements are unavailable.'}</p>
    <div className="show-actions">
      <button type="button" disabled={disabled || style.trim() === ''} onClick={() => {
        void generate.run({family: 'nanoleaf-show-generate', target: SHOW_TARGET, requestId: crypto.randomUUID(), data: {style: style.trim(), source}});
      }}>{settledUncertain ? 'Generate new paid draft' : 'Generate paid draft'}</button>
      {active && requestId !== undefined && <button type="button" className="secondary" disabled={!online || cancel.locked} onClick={() => {
        void cancel.run({family: 'nanoleaf-show-generate-cancel', target: SHOW_TARGET, requestId: crypto.randomUUID(), data: {generationRequestId: requestId}});
      }}>Cancel generation</button>}
      <button type="button" className="secondary" disabled={!canOpen || reading} onClick={() => {open(ready ? requestId : undefined);}}>
        {reading ? 'Opening draft…' : ready ? 'Open generated draft' : 'Open latest generated draft'}</button>
    </div>
    {dirty && <p className="hint">Opening a generated draft replaces the current unsaved draft.</p>}
    {ready && !dirty && <p className="hint">Open the result to preview and edit it before saving.</p>}
    {requestId !== undefined && <p role="status">{ready ? 'Generated draft ready to open.' : generate.text}</p>}
    {settledUncertain && <p>A charge may apply to the previous request. A new request makes a separate paid attempt.</p>}
    {active && cancel.requestId !== undefined && <p role="status">{cancel.text}</p>}
    {!ready && operation?.error !== undefined && <p role="alert">{operation.error.detail ?? 'Generation did not produce a draft.'} Your current draft is retained.</p>}
  </section>;
}

function ShowEditor({context, catalog, command, generate, cancel}: {
  context: FrontendContext; catalog: ReturnType<typeof useShows>; command: FrontendCommand; generate: FrontendCommand; cancel: FrontendCommand;
}): React.JSX.Element {
  const [draft, setDraft] = useState<ShowSave>();
  const [dirty, setDirty] = useState(false);
  const [selectedShow, setSelectedShow] = useState('');
  const [selectedVersion, setSelectedVersion] = useState('');
  const [reading, setReading] = useState(false), [readFailed, setReadFailed] = useState(false);
  const [preparing, setPreparing] = useState(false), [prepareFailed, setPrepareFailed] = useState(false);
  const [pendingRead, setPendingRead] = useState(false), [readCancelled, setReadCancelled] = useState(false);
  const [openingGenerated, setOpeningGenerated] = useState(false);
  const [generatedProblem, setGeneratedProblem] = useState<string>();
  const [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState<{requestId: string; draft: ShowSave}>();
  const readSequence = useRef(0), readActive = useRef(false), sendingRef = useRef(false), mounted = useRef(true);
  useEffect(() => {mounted.current = true; readSequence.current++; return () => {mounted.current = false;};}, []);
  const operation = context.operations.find(value => value.requestId === submitted?.requestId && value.family === 'nanoleaf-show-save' && value.target === SHOW_TARGET);
  useEffect(() => {
    if (submitted === undefined || operation?.status !== 'completed' || operation.result !== 'succeeded' || operation.evidence !== 'observed') return;
    if (draft !== submitted.draft) {setSubmitted(undefined); return;}
    setDraft(current => {
      if (current !== submitted.draft) return current;
      const {measurementProof: _measurementProof, authoringProof: _authoringProof, ...saved} = current;
      return {...saved, expectedVersion: saved.expectedVersion + 1};
    });
    setDirty(false); setSelectedShow(submitted.draft.showId); setSelectedVersion(String(submitted.draft.expectedVersion + 1)); setSubmitted(undefined);
  }, [submitted, operation, draft]);
  const currentShow = catalog.value?.shows.find(show => show.id === selectedShow) ?? catalog.value?.shows[0];
  const version = currentShow?.versions.find(value => String(value.version) === selectedVersion)?.version ?? currentShow?.version;
  const head = catalog.value?.shows.find(show => show.id === draft?.showId);
  const conflict = draft !== undefined && (head?.version ?? 0) !== draft.expectedVersion;
  const live = context.connected && catalog.live && catalog.value !== undefined;
  const locked = command.locked || sending;
  const editable = context.control && !locked && !reading && !preparing && !openingGenerated;
  const problem = draft === undefined ? undefined : draftProblem(draft);
  const change = (next: ShowSave): void => {setDraft(next); setDirty(true);};
  const load = (): void => {
    if (currentShow === undefined || version === undefined || locked || readActive.current) return;
    const sequence = ++readSequence.current, id = currentShow.id;
    readActive.current = true; setPendingRead(true); setReading(true); setReadFailed(false); setReadCancelled(false);
    void context.api.read(`/modules/nanoleaf/content/show-version?showId=${encodeURIComponent(id)}&version=${String(version)}`).then(value => {
      if (!mounted.current || sequence !== readSequence.current) return;
      const saved = showVersion(value, id, version);
      setDraft({showId: saved.showId, expectedVersion: saved.version, name: saved.name, versionName: saved.versionName, timeline: saved.timeline,
        ...(saved.kind === 'measured' ? {measurement: saved.measurement} : {}),
        ...(saved.provenance === undefined ? {} : {provenance: saved.provenance})});
      setSelectedShow(id); setSelectedVersion(String(version)); setDirty(false); setReading(false);
    }).catch(() => {if (mounted.current && sequence === readSequence.current) {setReadFailed(true); setReading(false);}})
      .finally(() => {readActive.current = false; if (mounted.current) setPendingRead(false);});
  };
  const prepare = (): void => {
    if (!context.connected || !editable || readActive.current) return;
    const sequence = ++readSequence.current;
    readActive.current = true; setPreparing(true); setPrepareFailed(false); setReadFailed(false); setReadCancelled(false);
    void context.api.read('/modules/nanoleaf/content/measured-show-draft').then(value => {
      if (mounted.current && sequence === readSequence.current) change(measuredDraft(value, `show-${crypto.randomUUID()}`));
    }).catch(() => {if (mounted.current && sequence === readSequence.current) setPrepareFailed(true);})
      .finally(() => {readActive.current = false; if (mounted.current) setPreparing(false);});
  };
  const openGenerated = (requestId?: string): void => {
    if (!context.connected || !editable || readActive.current) return;
    const sequence = ++readSequence.current;
    readActive.current = true; setOpeningGenerated(true); setGeneratedProblem(undefined);
    const ref = requestId === undefined ? 'latest-generated-show-draft' : `generated-show-draft?requestId=${encodeURIComponent(requestId)}`;
    void context.api.read(`/modules/nanoleaf/content/${ref}`).then(value => {
      if (!mounted.current || sequence !== readSequence.current) return;
      change(generatedDraft(value, `show-${crypto.randomUUID()}`));
      setReadFailed(false); setReadCancelled(false); setPrepareFailed(false);
    }).catch(() => {
      if (mounted.current && sequence === readSequence.current) setGeneratedProblem(requestId === undefined
        ? 'No generated draft is available to open right now.' : 'The generated cues could not be opened.');
    })
      .finally(() => {readActive.current = false; if (mounted.current) setOpeningGenerated(false);});
  };
  const save = (): void => {
    if (draft === undefined || !editable || !live || !context.operationsLive || problem !== undefined || conflict || !dirty || sendingRef.current) return;
    sendingRef.current = true; setSending(true);
    const requestId = crypto.randomUUID(); setSubmitted({requestId, draft});
    void command.run({family: 'nanoleaf-show-save', target: SHOW_TARGET, requestId, data: draft}).finally(() => {sendingRef.current = false; if (mounted.current) setSending(false);});
  };
  return <>
    <section className="show-library" aria-label="Saved shows"><h2>Saved shows</h2>
      <p>{catalog.value === undefined ? 'No library snapshot is available.' : `${catalog.value.shows.length} of ${SHOW_LIMITS.shows} shows · ${catalog.value.shows.reduce((sum, show) => sum + show.versions.length, 0)} of ${SHOW_LIMITS.versions} saved versions`}</p>
      {catalog.value?.shows.length === 0 && <p>Your private library is empty. Choose a starter to prepare a draft.</p>}
      {currentShow !== undefined && <div className="show-fields"><label>Show<select aria-label="Show" value={currentShow.id} disabled={locked || reading} onChange={event => {setSelectedShow(event.target.value); setSelectedVersion('');}}>
        {catalog.value?.shows.map(show => <option key={show.id} value={show.id}>{show.name}</option>)}</select></label>
        <label>Saved version<select aria-label="Saved version" value={String(version)} disabled={locked || reading} onChange={event => {setSelectedVersion(event.target.value);}}>
          {currentShow.versions.map(item => <option key={item.version} value={item.version}>v{item.version} · {item.versionName}</option>)}</select></label>
        <button type="button" className="secondary" disabled={!context.connected || locked || pendingRead || preparing || openingGenerated} onClick={load}>{reading ? 'Reading version…' : pendingRead ? 'Read still pending' : 'Open saved version'}</button></div>}
      {reading && <button type="button" className="secondary" onClick={() => {readSequence.current++; setReading(false); setReadCancelled(true);}}>Cancel version read</button>}
      {readCancelled && <p role="status">Version read cancelled. Your draft is retained.</p>}
      {dirty && <p className="hint">Opening a saved version, opening a starter or preparing an excerpt replaces this unsaved draft.</p>}
      {readFailed && <p role="alert">That saved version is unavailable. Any earlier draft below is retained; it is not the requested version.</p>}
      <button type="button" className="secondary" disabled={catalog.pending} onClick={catalog.refresh}>Refresh show library</button>
    </section>
    <section className="show-starters" aria-label="Starter shows"><h2>Start a decorative show</h2><p>These starters need no song or audio analysis. Nothing is saved or played when you open one.</p>
      <div className="show-actions">{STARTERS.map(item => <button type="button" className="secondary" key={item.id} disabled={!editable}
        onClick={() => {readSequence.current++; setReadFailed(false); setReadCancelled(false); setPrepareFailed(false); change(starter(item.id, `show-${crypto.randomUUID()}`));}}>Use {item.name}</button>)}</div>
    </section>
    {context.control && <section className="show-starters" aria-label="Measured shows"><h2>Prepare a measured show</h2>
      <p>While the desired track plays, choose Start measuring Music on the <a href="#/audio">Audio page</a>, then prepare an excerpt here.</p>
      <button type="button" className="secondary" disabled={!context.connected || !editable || pendingRead} onClick={prepare}>
        {preparing ? 'Preparing measured show…' : 'Prepare measured show'}
      </button>
      {prepareFailed && <p role="alert">No measured excerpt is available for the current Mac Music item. Any earlier draft is retained.</p>}
    </section>}
    {context.control && <ShowAuthoring context={context} generate={generate} cancel={cancel} reading={openingGenerated}
      canOpen={context.connected && editable && !pendingRead} open={openGenerated} dirty={dirty}/>}
    {generatedProblem !== undefined && <p role="alert">{generatedProblem} Your current draft is retained.</p>}
    {!context.control && <p>Read-only access. You can inspect saved versions; editing requires control access.</p>}
    {!live && <p role="status">{catalog.failed ? 'The show library is unavailable.' : 'The show library is stale or still loading.'} Saving is disabled.</p>}
    <p role="status" aria-live="polite">{command.text.replace('The module observed the result.', 'The library save was observed.')}</p>
    {draft !== undefined && <section className="show-draft" aria-label="Show draft"><h2>{dirty ? 'Unsaved draft' : `Saved version ${draft.expectedVersion}`}</h2>
      {draft.measurement !== undefined && <p>Captured excerpt for a scoped Mac Music library item. Replay uses the matching item and its current playback position.</p>}
      {draft.provenance !== undefined && <p>Generated with {draft.provenance.model} via the Anthropic API.
        {' '}{draft.provenance.confidence === 'measured-excerpt' ? 'Claude drafted from a measured excerpt. Edits can change cue timing.' : 'Claude drafted a generic sequence with decorative timing.'}
        {' '}Recorded generation cost estimate is {draft.provenance.costUsd.toLocaleString('en-US', {style: 'currency', currency: 'USD', maximumFractionDigits: 6})} USD.
        {draft.provenance.costBasis === 'conservative-region' ? ' The estimate uses the highest published regional rate because the billing region was unconfirmed.' : ''}</p>}
      <div className="show-fields"><label>Show name<input value={draft.name} maxLength={160} disabled={!editable} onChange={event => {change({...draft, name: event.target.value});}}/></label>
      <label>Version name<input value={draft.versionName} maxLength={160} disabled={!editable} onChange={event => {change({...draft, versionName: event.target.value});}}/></label>
      <label>Show duration (ms)<input type="number" min={MIN_MUSIC_CUE_MS} max={MAX_MUSIC_DURATION_MS} step={draft.measurement === undefined ? 100 : 1} value={draft.timeline.durationMs} disabled={!editable}
        onChange={event => {change({...draft, timeline: {...draft.timeline, durationMs: Number(event.target.value)}});}}/></label></div>
      {draft.timeline.cues.map((cue, index) => <CueEditor key={cue.id} cue={cue} index={index} measured={draft.measurement !== undefined} disabled={!editable}
        update={next => {change({...draft, timeline: {...draft.timeline, cues: draft.timeline.cues.map(value => value.id === cue.id ? next : value)}});}}
        remove={() => {change({...draft, timeline: {...draft.timeline, cues: draft.timeline.cues.filter(value => value.id !== cue.id)}});}}/>)}
      <button type="button" className="secondary" disabled={!editable || draft.timeline.cues.length >= MAX_MUSIC_CUES} onClick={() => {
        const end = draft.timeline.cues.reduce((last, cue) => Math.max(last, cue.offsetMs + cue.durationMs), 0);
        change({...draft, timeline: {...draft.timeline, durationMs: Math.max(draft.timeline.durationMs, end + 1000), cues: [...draft.timeline.cues,
          {id: crypto.randomUUID(), offsetMs: end, durationMs: 1000, intensity: 0.5, recipe: {pattern: 'breathe', colors: ['#00b4d8'], speed: 'slow', loop: true}}]}});
      }}>Add cue</button>
      {problem !== undefined ? <p role="alert">{problem}</p> : <Storyboard timeline={draft.timeline} measured={draft.measurement !== undefined}/>}
      {conflict && <p role="alert">The saved head differs from this draft. Open the latest saved version before saving; your draft has not been overwritten.</p>}
      <button type="button" disabled={!editable || !live || !context.operationsLive || !dirty || problem !== undefined || conflict} onClick={save}>Save new version</button>
    </section>}
  </>;
}

export function Shows({context}: {context: FrontendContext}): React.JSX.Element {
  const catalog = useShows(context.api), Command = context.ui.Command;
  return <div className="nanoleaf-shows"><p>Private cue plans for Nanoleaf. Save a version here, then choose it on the <a href="#/audio">Audio page</a> to start playback.</p>
    <Command context={context} target={SHOW_TARGET} attemptKey="nanoleaf/shows/save">{command =>
      <Command context={context} target={SHOW_TARGET} attemptKey="nanoleaf/shows/generate">{generate =>
        <Command context={context} target={SHOW_TARGET} attemptKey="nanoleaf/shows/cancel">{cancel =>
          <ShowEditor context={context} catalog={catalog} command={command} generate={generate} cancel={cancel}/>
        }</Command>}
      </Command>}
    </Command>
  </div>;
}
