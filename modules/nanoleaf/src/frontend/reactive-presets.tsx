import React, {useEffect, useRef, useState} from 'react';
import type {FrontendCommand, FrontendContext} from '@jimmie-potts/sdk/frontend';
import {REACTIVE_LIMITS, REACTIVE_TARGET, validReactiveName, type ReactiveCatalog} from '../music-preset-data.js';
import type {MusicRecipeV1} from '../music-recipe-data.js';
import {canSaveReactive, followReactivePresets, type ReactiveCatalogView} from './reactive-preset-model.js';

function PresetLibrary({context, recipe, load, command}: {context: FrontendContext; recipe: MusicRecipeV1;
  load: (recipe: MusicRecipeV1) => void; command: FrontendCommand}): React.JSX.Element {
  const [catalog, setCatalog] = useState<ReactiveCatalogView>({value: undefined, live: false, pending: true, failed: false});
  const retained = useRef<ReactiveCatalog | undefined>(undefined), [refresh, setRefresh] = useState(0);
  const [name, setName] = useState(''), [selection, setSelection] = useState(''), [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState<{requestId: string; fingerprint: string}>(), [saved, setSaved] = useState<string>();
  const busy = useRef(false), mounted = useRef(true);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
  useEffect(() => followReactivePresets((changed, options) => context.api.sync<ReactiveCatalog>(['nanoleaf-reactive-presets'], changed, options), view => {
    retained.current = view.value; setCatalog(view);
  }, retained.current), [context.api, refresh]);
  const fingerprint = JSON.stringify({name, recipe});
  const operation = context.operations.find(value => value.requestId === submitted?.requestId
    && value.family === 'nanoleaf-reactive-preset-save' && value.target === REACTIVE_TARGET);
  useEffect(() => {
    if (submitted !== undefined && operation?.status === 'completed' && operation.result === 'succeeded' && operation.evidence === 'observed') {
      setSaved(submitted.fingerprint); setSubmitted(undefined);
    }
  }, [submitted, operation]);
  const full = (catalog.value?.presets.length ?? 0) >= REACTIVE_LIMITS.presets;
  const canSave = canSaveReactive({control: context.control, connected: context.connected, catalogLive: catalog.live,
    operationsLive: context.operationsLive, locked: command.locked, sending, valid: validReactiveName(name), full, unchanged: saved === fingerprint});
  const selected = catalog.value?.presets.find(preset => preset.presetId === selection) ?? catalog.value?.presets[0];
  const save = (): void => {
    if (!canSave || busy.current || catalog.value === undefined) return;
    busy.current = true; setSending(true);
    const requestId = crypto.randomUUID(); setSubmitted({requestId, fingerprint});
    void command.run({family: 'nanoleaf-reactive-preset-save', target: REACTIVE_TARGET, requestId,
      data: {presetId: `preset-${crypto.randomUUID()}`, expectedRevision: catalog.value.revision, name, recipe}})
      .finally(() => {busy.current = false; if (mounted.current) setSending(false);});
  };
  return <section className="reactive-preset-library" aria-label="Saved reactive presets"><h3>Saved reactive presets</h3>
    <p>{catalog.value === undefined ? 'No library snapshot is available.' : `${catalog.value.presets.length} of ${REACTIVE_LIMITS.presets} saved presets.`}
      {' '}Loading changes only this preview draft.</p>
    {selected !== undefined && <div className="music-preview-fields"><label>Saved preset<select value={selected.presetId}
      disabled={command.locked || sending} onChange={event => {setSelection(event.currentTarget.value);}}>
      {catalog.value?.presets.map(preset => <option key={preset.presetId} value={preset.presetId}>{preset.name}</option>)}</select></label>
      <button type="button" className="secondary" disabled={command.locked || sending} onClick={() => {load(selected.recipe); setName(selected.name);}}>Load into draft</button></div>}
    <button type="button" className="secondary" disabled={catalog.pending} onClick={() => {setRefresh(value => value + 1);}}>Refresh preset library</button>
    {(!context.connected || !catalog.live) && <p role="status">{catalog.failed ? 'The preset library is unavailable.' : 'The preset library is stale or still loading.'} Saving is disabled.</p>}
    {!context.control && <p>Read-only access. You can load saved presets; saving requires control access.</p>}
    <div className="music-preview-fields"><label>New preset name<input value={name} maxLength={160} disabled={!context.control || command.locked || sending}
      onChange={event => {setName(event.currentTarget.value);}}/></label>
      <button type="button" disabled={!canSave} onClick={save}>Save new preset</button></div>
    {name !== '' && !validReactiveName(name) && <p role="alert">Use a name of 1–80 characters, without control characters.</p>}
    {full && <p role="status">The private library is full. Earlier presets are preserved.</p>}
    <p role="status">{command.text.replace('The module observed the result.', 'The preset save was observed.')}</p>
    {saved === fingerprint && <p role="status">This named draft was saved. Change its name or recipe to save another preset.</p>}
  </section>;
}

export function ReactivePresets({context, recipe, load}: {context: FrontendContext; recipe: MusicRecipeV1; load: (recipe: MusicRecipeV1) => void}): React.JSX.Element {
  const Command = context.ui.Command;
  return <Command context={context} target={REACTIVE_TARGET} attemptKey="nanoleaf/reactive-presets/save">
    {command => <PresetLibrary context={context} recipe={recipe} load={load} command={command}/>}</Command>;
}
