import React, {useEffect, useMemo, useSyncExternalStore} from 'react';
import type {FrontendContext} from '@jimmie-potts/sdk/frontend';
import {MUSIC_PREVIEW_MODELS, MUSIC_PREVIEW_PRESETS} from '../music-preview-data.js';
import {MusicPreviewDraft, musicPreviewProblem} from './music-preview-model.js';
import {ReactivePresets} from './reactive-presets.js';
import './music-preview.css';

export function MusicPreview({context}: {context: FrontendContext}): React.JSX.Element {
  const api = context.api;
  const model = useMemo(() => new MusicPreviewDraft(path => api.read(path)), [api]);
  const view = useSyncExternalStore(model.subscribe, model.snapshot), draft = view.draft;
  useEffect(() => {
    model.setConnected(context.connected);
    return () => {model.setConnected(false);};
  }, [model, context.connected]);
  const recipe = model.recipe();
  const problem = musicPreviewProblem(draft), sample = view.result?.samples[view.sample];
  const example = MUSIC_PREVIEW_MODELS.find(value => value.id === view.result?.model);
  const stride = example?.kind === 'lines' ? 2 : 1;
  const groups = sample === undefined ? [] : Array.from({length: 6}, (_, index) => sample.zones.slice(index * stride, (index + 1) * stride));
  const color = (index: number, value: string): void => {
    model.edit({palette: model.snapshot().draft.palette.map((current, at) => at === index ? value : current)});
  };
  return <section className="nanoleaf-music-preview" aria-label="Music effect preview"><details>
    <summary>Music effect preview</summary>
    <p>Generated input · example geometry · unsaved draft</p>
    <p className="hint">Compare effect colors on an example arrangement. Palette and intensity edits last for this page until you explicitly save a named preset.</p>
    <div className="music-preview-fields">
      <label>Built-in effect<select value={draft.preset} onChange={event => {
        const preset = MUSIC_PREVIEW_PRESETS.find(value => value.id === event.currentTarget.value);
        if (preset !== undefined) model.edit({preset: preset.id});
      }}>{MUSIC_PREVIEW_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></label>
      <label>Example layout<select value={draft.model} onChange={event => {
        const example = MUSIC_PREVIEW_MODELS.find(value => value.id === event.currentTarget.value);
        if (example !== undefined) model.edit({model: example.id});
      }}>{MUSIC_PREVIEW_MODELS.map(example => <option key={example.id} value={example.id}>{example.label}</option>)}</select></label>
      <label>Intensity <span aria-hidden="true">{Math.round(draft.intensity * 100)}%</span>
        <input type="range" aria-label="Intensity" min="0" max="100" step="1" value={Math.round(draft.intensity * 100)}
          onChange={event => {model.edit({intensity: Number(event.currentTarget.value) / 100});}}/></label>
    </div>
    <fieldset><legend>Palette</legend><div className="music-preview-palette">
      {draft.palette.map((value, index) => <div key={index}>
        <label>Color {index + 1}<input type="color" value={value} onChange={event => {color(index, event.currentTarget.value);}}/></label>
        <span>{value}</span>
        <button type="button" className="secondary" aria-label={`Remove color ${index + 1}`} disabled={draft.palette.length <= 1}
          onClick={() => {model.edit({palette: model.snapshot().draft.palette.filter((_, at) => at !== index)});}}>Remove</button>
      </div>)}
    </div><button type="button" className="secondary" disabled={draft.palette.length >= 8}
      onClick={() => {model.edit({palette: [...model.snapshot().draft.palette, '#ffffff']});}}>Add color</button></fieldset>
    <p className="hint">Renderer V{recipe.rendererVersion} · Sensitivity {recipe.sensitivity} · Renderer smoothing {recipe.smoothingMs} ms
      {'direction' in recipe && <> · Direction {recipe.direction}</>}{'halfLifeMs' in recipe && <> · Pulse half-life {recipe.halfLifeMs} ms</>}
      {'periodMs' in recipe && <> · Wave period {recipe.periodMs} ms</>}. These frozen renderer values are read-only here; capture calibration is separate.</p>
    <ReactivePresets context={context} recipe={recipe} load={saved => {model.load(saved);}}/>
    <div className="music-preview-actions">
      <button type="button" disabled={!view.connected || view.pending || problem !== undefined} onClick={() => {void model.preview();}}>
        {view.pending ? 'Preparing preview…' : 'Preview'}</button>
      <button type="button" className="secondary" onClick={() => {model.reset();}}>Reset draft</button>
    </div>
    {problem !== undefined && <p role="alert">{problem}</p>}
    {view.error !== undefined ? <p role="alert">{view.error}</p> : <p role="status">{!view.connected ? 'Connect to request an example.'
      : view.pending ? 'Preparing example colors.' : sample === undefined ? 'Choose Preview to inspect this draft.' : 'Example colors are ready for this draft.'}</p>}
    {sample !== undefined && example !== undefined && <figure className={`music-preview-result music-preview-${example.kind}`}>
      <figcaption>{example.label} · Generated sample {view.sample + 1} of 20 · {(sample.offsetMs / 1000).toFixed(1)} seconds</figcaption>
      <ol className="music-preview-elements">{groups.map((zones, index) => <li key={index}>
        <div className="music-preview-swatches">{zones.map(zone => <span key={zone.id} className="music-preview-zone" role="img"
          aria-label={`Zone ${zone.id}, RGB ${zone.rgb.join(', ')}`} style={{backgroundColor: `rgb(${zone.rgb.join(' ')})`}}/>)}</div>
        <span>{example.kind === 'lines' ? 'Line' : 'Panel'} {index + 1}</span>
      </li>)}</ol>
      <label>Sample<input type="range" min="0" max="19" step="1" value={view.sample}
        aria-valuetext={`${(sample.offsetMs / 1000).toFixed(1)} seconds in the generated example`}
        onChange={event => {model.selectSample(Number(event.currentTarget.value));}}/></label>
      <p className="hint">Fixed generated input and a 3 × 2 example arrangement.</p>
    </figure>}
  </details></section>;
}
