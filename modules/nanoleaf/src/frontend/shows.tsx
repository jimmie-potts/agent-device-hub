import React, {useEffect, useRef, useState} from 'react';
import type {FrontendApi, FrontendCommand, FrontendContext} from '@jimmie-potts/sdk/frontend';
import type {SyncedCopy} from '@jimmie-potts/sdk/remote';
import {SHOW_LIMITS, SHOW_TARGET, type ShowCatalog, type ShowSave} from '../music-show-data.js';
import {MAX_MUSIC_CUES, MAX_MUSIC_DURATION_MS, MIN_MUSIC_CUE_MS, selectMusicCue, type MusicCue, type MusicTimeline} from '../music-timeline-data.js';
import {DIRECTION_CHOICES, draftProblem, PATTERN_CHOICES, showVersion, spatial, SPEED_CHOICES, starter, STARTERS} from './show-model.js';
import './shows.css';

type Catalog = {value: ShowCatalog | undefined; live: boolean; pending: boolean; failed: boolean};
function useShows(api: FrontendApi): Catalog & {refresh: () => void} {
  const [state, setState] = useState<Catalog>({value: undefined, live: false, pending: true, failed: false});
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let disposed = false;
    let copy: SyncedCopy<ShowCatalog> | undefined;
    const stale = (): void => {if (!disposed) setState(previous => ({...previous, live: false, pending: true}));};
    const failed = (): void => {if (!disposed) setState(previous => ({...previous, live: false, pending: false, failed: true}));};
    stale();
    void api.sync<ShowCatalog>(['nanoleaf-shows'], change => {
      if (disposed) return;
      if (change.type === 'failed') {failed(); return;}
      if (change.type === 'updated' && change.message.data.id === SHOW_TARGET) setState(previous => ({...previous, value: change.message.data}));
      if (change.type === 'removed') setState({value: undefined, live: false, pending: false, failed: true});
      if (change.type === 'synced') setState(previous => ({...previous, live: true, pending: false, failed: false}));
    }, {onRestarted: stale}).then(result => {
      if (result.status === 'rejected') {failed(); return;}
      if (disposed) {void result.copy.close(); return;}
      copy = result.copy;
      const value = [...copy.states()].find(message => message.data.id === SHOW_TARGET)?.data;
      setState({value, live: value !== undefined, pending: false, failed: value === undefined});
    }).catch(failed);
    return () => {disposed = true; void copy?.close();};
  }, [api, attempt]);
  return {...state, refresh: () => {setAttempt(value => value + 1);}};
}

const seconds = (ms: number): string => `${Number((ms / 1000).toFixed(1)).toString()} s`;
function Palette({colors}: {colors: readonly string[]}): React.JSX.Element {
  return <span className="show-palette">{colors.map((color, index) => <span key={index} className="show-color"><i aria-hidden="true" style={{backgroundColor: color}}/>{color}</span>)}</span>;
}
function Storyboard({timeline}: {timeline: MusicTimeline}): React.JSX.Element {
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
  return <section className="show-storyboard" aria-label="Decorative cue storyboard"><h3>Decorative cue storyboard</h3>
    <p>Timing, palette and effect names only. This does not show rendered frames, play music or control lights.</p>
    <ol>{parts}</ol>
    <label>Inspect position: {seconds(current)}<input type="range" min="0" max={timeline.durationMs} step="100" value={current}
      onChange={event => {setPosition(Number(event.target.value));}}/></label>
    <p role="status">{selected.kind === 'cue' ? `${selected.cue.recipe.pattern} cue · ${seconds(selected.elapsedMs)} into this cue`
      : selected.kind === 'gap' ? 'Gap: no cue. No blackout or return behavior is implied.' : 'End of show. No output behavior is implied.'}</p>
  </section>;
}

function CueEditor({cue, index, disabled, update, remove}: {
  cue: MusicCue; index: number; disabled: boolean; update: (cue: MusicCue) => void; remove: () => void;
}): React.JSX.Element {
  return <fieldset className="show-cue-edit" disabled={disabled}><legend>Cue {index + 1}</legend>
    <div className="show-fields"><label>Start (ms)<input type="number" min="0" max={MAX_MUSIC_DURATION_MS} step="100" value={cue.offsetMs}
      onChange={event => {update({...cue, offsetMs: Number(event.target.value)});}}/></label>
    <label>Duration (ms)<input type="number" min={MIN_MUSIC_CUE_MS} max={MAX_MUSIC_DURATION_MS} step="100" value={cue.durationMs}
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
    <label>Intensity (%)<input type="number" min="0" max="100" step="1" value={cue.intensity * 100}
      onChange={event => {update({...cue, intensity: Number(event.target.value) / 100});}}/></label>
    <label className="show-check"><input type="checkbox" checked={cue.recipe.loop} onChange={event => {update({...cue, recipe: {...cue.recipe, loop: event.target.checked}});}}/>Repeat effect within cue</label></div>
    <div className="show-colors">{cue.recipe.colors.map((color, colorIndex) => <label key={colorIndex}>Color {colorIndex + 1}<input type="color" value={color}
      onChange={event => {update({...cue, recipe: {...cue.recipe, colors: cue.recipe.colors.map((value, offset) => offset === colorIndex ? event.target.value : value)}});}}/></label>)}
      <button type="button" className="secondary" disabled={cue.recipe.colors.length >= 8} onClick={() => {update({...cue, recipe: {...cue.recipe, colors: [...cue.recipe.colors, '#ffffff']}});}}>Add color</button>
      <button type="button" className="secondary" disabled={cue.recipe.colors.length <= 1} onClick={() => {update({...cue, recipe: {...cue.recipe, colors: cue.recipe.colors.slice(0, -1)}});}}>Remove last color</button>
    </div><button type="button" className="secondary" onClick={remove}>Remove cue {index + 1}</button>
  </fieldset>;
}

function ShowEditor({context, catalog, command}: {context: FrontendContext; catalog: ReturnType<typeof useShows>; command: FrontendCommand}): React.JSX.Element {
  const [draft, setDraft] = useState<ShowSave>();
  const [dirty, setDirty] = useState(false);
  const [selectedShow, setSelectedShow] = useState('');
  const [selectedVersion, setSelectedVersion] = useState('');
  const [reading, setReading] = useState(false), [readFailed, setReadFailed] = useState(false);
  const [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState<{requestId: string; draft: ShowSave}>();
  const readSequence = useRef(0), sendingRef = useRef(false);
  useEffect(() => () => {readSequence.current++;}, []);
  const operation = context.operations.find(value => value.requestId === submitted?.requestId && value.family === 'nanoleaf-show-save');
  useEffect(() => {
    if (submitted === undefined || operation?.status !== 'completed' || operation.result !== 'succeeded' || operation.evidence !== 'observed') return;
    if (draft !== submitted.draft) {setSubmitted(undefined); return;}
    setDraft(current => current === submitted.draft ? {...current, expectedVersion: current.expectedVersion + 1} : current);
    setDirty(false); setSelectedShow(submitted.draft.showId); setSelectedVersion(String(submitted.draft.expectedVersion + 1)); setSubmitted(undefined);
  }, [submitted, operation, draft]);
  const currentShow = catalog.value?.shows.find(show => show.id === selectedShow) ?? catalog.value?.shows[0];
  const version = currentShow?.versions.find(value => String(value.version) === selectedVersion)?.version ?? currentShow?.version;
  const head = catalog.value?.shows.find(show => show.id === draft?.showId);
  const conflict = draft !== undefined && (head?.version ?? 0) !== draft.expectedVersion;
  const live = context.connected && catalog.live && catalog.value !== undefined;
  const locked = command.locked || sending;
  const editable = context.control && !locked && !reading;
  const problem = draft === undefined ? undefined : draftProblem(draft);
  const change = (next: ShowSave): void => {setDraft(next); setDirty(true);};
  const load = (): void => {
    if (currentShow === undefined || version === undefined || locked) return;
    const sequence = ++readSequence.current, id = currentShow.id;
    setReading(true); setReadFailed(false);
    void context.api.read(`/modules/nanoleaf/content/show-version?showId=${encodeURIComponent(id)}&version=${String(version)}`).then(value => {
      if (sequence !== readSequence.current) return;
      const saved = showVersion(value, id, version);
      setDraft({showId: saved.showId, expectedVersion: saved.version, name: saved.name, versionName: saved.versionName, timeline: saved.timeline});
      setDirty(false); setReading(false);
    }).catch(() => {if (sequence === readSequence.current) {setReadFailed(true); setReading(false);}});
  };
  const save = (): void => {
    if (draft === undefined || !editable || !live || !context.operationsLive || problem !== undefined || conflict || !dirty || sendingRef.current) return;
    sendingRef.current = true; setSending(true);
    const requestId = crypto.randomUUID(); setSubmitted({requestId, draft});
    void command.run({family: 'nanoleaf-show-save', target: SHOW_TARGET, requestId, data: draft}).finally(() => {sendingRef.current = false; setSending(false);});
  };
  return <>
    <section className="show-library" aria-label="Saved decorative shows"><h2>Saved shows</h2>
      <p>{catalog.value === undefined ? 'No library snapshot is available.' : `${catalog.value.shows.length} of ${SHOW_LIMITS.shows} shows · ${catalog.value.shows.reduce((sum, show) => sum + show.versions.length, 0)} of ${SHOW_LIMITS.versions} saved versions`}</p>
      {catalog.value?.shows.length === 0 && <p>Your private library is empty. Choose a starter to prepare a draft.</p>}
      {currentShow !== undefined && <div className="show-fields"><label>Show<select aria-label="Show" value={currentShow.id} disabled={locked || reading} onChange={event => {setSelectedShow(event.target.value); setSelectedVersion('');}}>
        {catalog.value?.shows.map(show => <option key={show.id} value={show.id}>{show.name}</option>)}</select></label>
        <label>Saved version<select aria-label="Saved version" value={String(version)} disabled={locked || reading} onChange={event => {setSelectedVersion(event.target.value);}}>
          {currentShow.versions.map(item => <option key={item.version} value={item.version}>v{item.version} · {item.versionName}</option>)}</select></label>
        <button type="button" className="secondary" disabled={!context.connected || locked || reading} onClick={load}>{reading ? 'Reading version…' : 'Open saved version'}</button></div>}
      {dirty && <p className="hint">Opening a saved version or a starter replaces this unsaved draft.</p>}
      {readFailed && <p role="alert">That saved version is unavailable. Any earlier draft below is retained; it is not the requested version.</p>}
      <button type="button" className="secondary" disabled={catalog.pending} onClick={catalog.refresh}>Refresh show library</button>
    </section>
    <section className="show-starters" aria-label="Starter shows"><h2>Start a decorative show</h2><p>These starters need no song or audio analysis. Nothing is saved or played when you open one.</p>
      <div className="show-actions">{STARTERS.map(item => <button type="button" className="secondary" key={item.id} disabled={!editable}
        onClick={() => {readSequence.current++; setReadFailed(false); change(starter(item.id, `show-${crypto.randomUUID()}`));}}>Use {item.name}</button>)}</div>
    </section>
    {!context.control && <p>Read-only access. You can inspect saved versions; editing requires control access.</p>}
    {!live && <p role="status">{catalog.failed ? 'The show library is unavailable.' : 'The show library is stale or still loading.'} Saving is disabled.</p>}
    <p role="status" aria-live="polite">{command.text.replace('The module observed the result.', 'The library save was observed.')}</p>
    {draft !== undefined && <section className="show-draft" aria-label="Show draft"><h2>{dirty ? 'Unsaved draft' : `Saved version ${draft.expectedVersion}`}</h2>
      <div className="show-fields"><label>Show name<input value={draft.name} maxLength={160} disabled={!editable} onChange={event => {change({...draft, name: event.target.value});}}/></label>
      <label>Version name<input value={draft.versionName} maxLength={160} disabled={!editable} onChange={event => {change({...draft, versionName: event.target.value});}}/></label>
      <label>Show duration (ms)<input type="number" min={MIN_MUSIC_CUE_MS} max={MAX_MUSIC_DURATION_MS} step="100" value={draft.timeline.durationMs} disabled={!editable}
        onChange={event => {change({...draft, timeline: {...draft.timeline, durationMs: Number(event.target.value)}});}}/></label></div>
      {draft.timeline.cues.map((cue, index) => <CueEditor key={cue.id} cue={cue} index={index} disabled={!editable}
        update={next => {change({...draft, timeline: {...draft.timeline, cues: draft.timeline.cues.map(value => value.id === cue.id ? next : value)}});}}
        remove={() => {change({...draft, timeline: {...draft.timeline, cues: draft.timeline.cues.filter(value => value.id !== cue.id)}});}}/>)}
      <button type="button" className="secondary" disabled={!editable || draft.timeline.cues.length >= MAX_MUSIC_CUES} onClick={() => {
        const end = draft.timeline.cues.reduce((last, cue) => Math.max(last, cue.offsetMs + cue.durationMs), 0);
        change({...draft, timeline: {...draft.timeline, durationMs: Math.max(draft.timeline.durationMs, end + 1000), cues: [...draft.timeline.cues,
          {id: crypto.randomUUID(), offsetMs: end, durationMs: 1000, intensity: 0.5, recipe: {pattern: 'breathe', colors: ['#00b4d8'], speed: 'slow', loop: true}}]}});
      }}>Add cue</button>
      {problem !== undefined ? <p role="alert">{problem}</p> : <Storyboard timeline={draft.timeline}/>}
      {conflict && <p role="alert">The saved head differs from this draft. Open the latest saved version before saving; your draft has not been overwritten.</p>}
      <button type="button" disabled={!editable || !live || !context.operationsLive || !dirty || problem !== undefined || conflict} onClick={save}>Save new version</button>
    </section>}
  </>;
}

export function Shows({context}: {context: FrontendContext}): React.JSX.Element {
  const catalog = useShows(context.api), Command = context.ui.Command;
  return <div className="nanoleaf-shows"><p>Private cue plans for Nanoleaf. This editor prepares versions only; replay and music synchronization are unavailable.</p>
    <Command context={context} target={SHOW_TARGET} attemptKey="nanoleaf/shows/save">{command => <ShowEditor context={context} catalog={catalog} command={command}/>}</Command>
  </div>;
}
