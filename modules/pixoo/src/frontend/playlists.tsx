// Adapted from divoom-app-upgrade apps/web/src/playlists.tsx (0777479c): local drafts, revision guards and saved sequences.
import React, {useEffect, useId, useRef, useState} from 'react';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {FrontendCommand, FrontendContext} from '@jimmie-potts/sdk/frontend';
import type {PlaylistChangeRequest, PlaylistRecord, Policy} from '../module/schemas.js';
import {Preview, PreviewFrame} from './preview.js';

type Change = PlaylistChangeRequest['change'];
type Item = {id?: string; key: string; renditionId: string; playback: Policy};
type Draft = {id: string; revision: number; name: string; repeat: boolean; shuffle: boolean; items: Item[]};
type Media = {renditionId: string; name: string; frameCount: number; compatible?: boolean};
type MediaPage = {items: Media[]; total: number};
type Props = {context: FrontendContext; device: DeviceRecord | undefined; live: boolean; playlists: readonly PlaylistRecord[]};
const LIMIT = 25;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const codeOf = (error: unknown): string => object(error) && object(error.body) && object(error.body.error) && typeof error.body.error.code === 'string'
  ? error.body.error.code : 'unavailable';
const validName = (name: string): boolean => name.length > 0 && name.length <= 120
  && Array.from(name).every(character => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127);
const itemsBody = (items: readonly Item[]): {id?: string; renditionId: string; playback: Policy}[] =>
  items.map(({id, renditionId, playback}) => ({...(id === undefined ? {} : {id}), renditionId, playback}));
const draftOf = (saved: PlaylistRecord): Draft => ({id: saved.id, revision: saved.playlistRevision, name: saved.name,
  repeat: saved.repeat, shuffle: saved.shuffle, items: saved.items.map(item => ({...item, playback: {...item.playback}, key: item.id}))});

function mediaPage(value: unknown): MediaPage {
  if (!object(value) || !Number.isSafeInteger(value.total) || (value.total as number) < 0 || !Array.isArray(value.items)
    || value.items.length > LIMIT || !value.items.every((item: unknown) => object(item)
      && typeof item.renditionId === 'string' && /^[a-f0-9]{64}$/.test(item.renditionId) && typeof item.name === 'string'
      && Number.isSafeInteger(item.frameCount) && (item.frameCount as number) > 0
      && (item.compatible === undefined || typeof item.compatible === 'boolean'))) throw new Error('invalid catalog');
  return value as MediaPage;
}

function mediaLabel(media: Media, items: readonly Media[]): string {
  let length = 10;
  while (length < media.renditionId.length && items.some(item => item.renditionId !== media.renditionId
    && item.renditionId.startsWith(media.renditionId.slice(0, length)))) length++;
  return `${media.name} · rendition ${media.renditionId.slice(0, length)}`;
}

function MediaPicker({context, disabled, add}: {context: FrontendContext; disabled: boolean; add: (media: Media) => void}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [catalog, setCatalog] = useState<MediaPage>();
  const [selected, setSelected] = useState('');
  const [previewReady, setPreviewReady] = useState(false);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const id = useId();
  useEffect(() => {
    let disposed = false;
    setLoading(true); setError(undefined); setCatalog(undefined); setSelected(''); setPreviewReady(false);
    const params = new URLSearchParams({q: query, offset: String(offset), limit: String(LIMIT)});
    void context.api.read(`/modules/pixoo/content/catalog-media?${params}`).then(value => {
      const page = mediaPage(value);
      if (!disposed) { setCatalog(page); setLoading(false); }
    }).catch((error: unknown) => { if (!disposed) { setError(codeOf(error)); setLoading(false); } });
    return () => { disposed = true; };
  }, [context.api, query, offset]);
  const media = catalog?.items.find(item => item.renditionId === selected);
  const {Select} = context.ui;
  return <fieldset disabled={disabled}>
    <legend>Add media</legend>
    <label htmlFor={id}>Search media to add</label>
    <input id={id} type="search" value={query} maxLength={120} onChange={event => { setQuery(event.target.value); setOffset(0); }}/>
    {loading && <p role="status">Loading media…</p>}
    {error !== undefined && <p role="status">Media unavailable ({error}). Change the search to try again.</p>}
    <Select label="Media to add" value={selected} onChange={value => { setPreviewReady(false); setSelected(value); }}
      options={[{value: '', label: 'Choose…'}, ...(catalog?.items ?? []).map(item => ({value: item.renditionId, label: mediaLabel(item, catalog?.items ?? [])}))]}/>
    {media !== undefined && <div role="group" aria-label="Selected rendition to add">
      <p>{media.name}</p><p>{media.renditionId}</p>
      <Preview key={media.renditionId} api={context.api} renditionId={media.renditionId} active={context.connected} onReady={setPreviewReady}/>
    </div>}
    <div className="actions">
      <button type="button" disabled={loading || media === undefined || media.compatible === false || !previewReady}
        onClick={() => { if (media !== undefined && media.compatible !== false && previewReady) add(media); }}>Add selected media</button>
      <button type="button" className="secondary" disabled={loading || offset === 0} onClick={() => { setOffset(Math.max(0, offset - LIMIT)); }}>Previous media to add</button>
      <button type="button" className="secondary" disabled={loading || catalog === undefined || offset + LIMIT >= catalog.total}
        onClick={() => { setOffset(offset + LIMIT); }}>Next media to add</button>
    </div>
    {catalog !== undefined && <p>{catalog.total} matching renditions</p>}
    {media?.compatible === false && <p className="hint">This rendition is incompatible.</p>}
    <p className="hint">Adding media changes this draft only. Save items to update the saved sequence.</p>
  </fieldset>;
}

function PlaylistItem({context, item, index, length, disabled, edit, move, remove}: {
  context: FrontendContext; item: Item; index: number; length: number; disabled: boolean;
  edit: (playback: Policy) => void; move: (delta: number) => void; remove: () => void;
}): React.JSX.Element {
  const [preview, setPreview] = useState<ImageBitmap>();
  const [animated, setAnimated] = useState(false);
  const [unavailable, setUnavailable] = useState<string>();
  const id = useId();
  useEffect(() => {
    let disposed = false;
    let bitmap: ImageBitmap | undefined;
    setPreview(undefined); setAnimated(false); setUnavailable(undefined);
    void Promise.all([context.api.read(`/modules/pixoo/content/preview.${item.renditionId}`),
      context.api.image(`/modules/pixoo/content/thumbnail.${item.renditionId}`)]).then(async ([value, image]) => {
      if (!object(value) || value.renditionId !== item.renditionId || !Number.isSafeInteger(value.frameCount)
        || (value.frameCount as number) < 1 || (value.frameCount as number) > 1000) throw new Error('invalid preview');
      const loaded = await createImageBitmap(image);
      if (disposed) loaded.close();
      else { bitmap = loaded; setPreview(loaded); setAnimated((value.frameCount as number) > 1); }
    }).catch((error: unknown) => { if (!disposed) setUnavailable(codeOf(error)); });
    return () => { disposed = true; bitmap?.close(); };
  }, [context.api, item.renditionId]);
  const plays = item.playback.mode === 'plays';
  const value = item.playback.mode === 'plays' ? item.playback.totalPlays : item.playback.durationMs / 1000;
  return <li aria-label={`Item ${index + 1}`}>
    <h3>Item {index + 1}</h3>
    <PreviewFrame bitmap={preview} label={`Item ${index + 1} preview`}/>
    {unavailable !== undefined && <p className="hint">The referenced preview is unavailable ({unavailable}).</p>}
    {context.control ? <fieldset disabled={disabled}>
      <legend>Item {index + 1} timing</legend>
      {animated && <label>Timing mode<select aria-label={`Item ${index + 1} timing mode`} value={item.playback.mode}
        onChange={event => { edit(event.target.value === 'plays' ? {mode: 'plays', totalPlays: 3} : {mode: 'duration', durationMs: 30000}); }}>
        <option value="plays">Total plays</option><option value="duration">Duration</option>
      </select></label>}
      <label htmlFor={id}>{plays ? 'Total plays' : 'Duration (seconds)'}</label>
      <input id={id} aria-label={`Item ${index + 1} ${plays ? 'total plays' : 'seconds'}`} type="number" required
        min={plays ? 1 : 0.001} step={plays ? 1 : 0.001} max={plays ? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER / 1000}
        value={Number.isFinite(value) ? value : ''} onChange={event => {
          edit(plays ? {mode: 'plays', totalPlays: event.target.valueAsNumber} : {mode: 'duration', durationMs: Math.round(event.target.valueAsNumber * 1000)});
        }}/>
      <div className="actions">
        <button type="button" className="secondary" aria-label={`Move item ${index + 1} up`} disabled={index === 0} onClick={() => { move(-1); }}>Move up</button>
        <button type="button" className="secondary" aria-label={`Move item ${index + 1} down`} disabled={index === length - 1} onClick={() => { move(1); }}>Move down</button>
        <button type="button" className="secondary" aria-label={`Remove item ${index + 1}`} onClick={remove}>Remove</button>
      </div>
    </fieldset> : <p>{plays ? `${value} total plays` : `${value} seconds`}</p>}
  </li>;
}

function Editor({context, device, live, playlists, command}: Props & {device: DeviceRecord; command: FrontendCommand}): React.JSX.Element {
  const id = useId();
  const submitting = useRef(false);
  const [draft, setDraft] = useState<Draft>();
  const [newName, setNewName] = useState('');
  const [failure, setFailure] = useState<string>();
  const saved = playlists.find(playlist => playlist.id === draft?.id);
  const base = !context.control ? 'Read-only access.' : !context.connected || !live ? 'Playlist records are stale.'
    : !context.operationsLive ? 'Command records are stale.' : command.locked ? 'Wait for the current command result.' : undefined;
  const stale = saved === undefined || draft?.revision !== saved.playlistRevision;
  const blocked = base ?? (stale ? 'The saved playlist changed. Load its saved name before editing again.' : undefined);
  const dirty = draft !== undefined && saved !== undefined && JSON.stringify(itemsBody(draft.items)) !== JSON.stringify(saved.items);
  const discard = (): boolean => !dirty || window.confirm('Discard unsaved item edits?');
  const load = (playlist: PlaylistRecord): void => { setDraft(draftOf(playlist)); setFailure(undefined); };
  const send = (change: Change): void => {
    if (base !== undefined || submitting.current || (change.operation !== 'create' && stale)) return;
    const action = {family: 'pixoo-playlist-change', target: device.id, requestId: crypto.randomUUID(), data: {change}};
    if (new TextEncoder().encode(JSON.stringify(action)).byteLength > 15 * 1024) {
      setFailure('This edit exceeds the command size limit. The saved playlist was not changed.'); return;
    }
    submitting.current = true; setFailure(undefined);
    void command.run(action).catch(() => { setFailure('The request has no confirmed reply. It was not sent again.'); })
      .finally(() => { submitting.current = false; });
  };
  const {Select, Facts} = context.ui;
  const name = draft?.name.trim() ?? '';
  const nameBlocked = blocked ?? (!validName(name) ? 'Use a name of 1 to 120 characters without control characters.'
    : name === saved?.name ? 'The name is unchanged.' : undefined);
  const itemValid = draft?.items.every(item => {
    const value = item.playback.mode === 'plays' ? item.playback.totalPlays : item.playback.durationMs;
    return Number.isSafeInteger(value) && value > 0;
  }) === true;
  return <>
    {context.control ? <form onSubmit={event => { event.preventDefault(); if (validName(newName.trim()) && discard()) send({operation: 'create', name: newName.trim()}); }}>
      <label htmlFor={`${id}-new`}>New playlist name</label>
      <input id={`${id}-new`} value={newName} maxLength={120} disabled={base !== undefined} autoComplete="off" onChange={event => { setNewName(event.target.value); }}/>
      <div className="actions"><button type="submit" disabled={base !== undefined || !validName(newName.trim())}>Create playlist</button></div>
    </form> : <p className="hint">Read-only access.</p>}
    <Select label="Playlist" value={draft?.id ?? ''} onChange={value => {
      if (command.locked || !discard()) return;
      const playlist = playlists.find(item => item.id === value);
      if (playlist === undefined) setDraft(undefined); else load(playlist);
    }} options={[{value: '', label: 'Choose…'}, ...playlists.map(playlist => ({value: playlist.id, label: playlist.name}))]}/>
    {draft !== undefined && saved === undefined && <p role="status">The selected playlist is no longer saved.</p>}
    {draft !== undefined && saved !== undefined && <>
      <Facts items={[
        ['Saved name', saved.name], ['Saved revision', saved.playlistRevision], ['Items', saved.items.length],
        ['Playback', `${saved.repeat ? 'Repeats' : 'Once'} · ${saved.shuffle ? 'Shuffle' : 'Saved order'}`],
      ]}/>
      {context.control && <>
        <form onSubmit={event => { event.preventDefault(); if (nameBlocked === undefined) send({operation: 'rename', playlistId: draft.id, revision: draft.revision, name}); }}>
          <label htmlFor={`${id}-name`}>Playlist name</label>
          <input id={`${id}-name`} value={draft.name} maxLength={120} disabled={base !== undefined} autoComplete="off"
            onChange={event => { setDraft({...draft, name: event.target.value}); }}/>
          <div className="actions">
            <button type="submit" disabled={nameBlocked !== undefined}>Save name</button>
            <button type="button" className="secondary" disabled={command.locked} onClick={() => { if (discard()) load(saved); }}>Load saved name</button>
            <button type="button" className="secondary" disabled={blocked !== undefined} onClick={() => {
              const duplicateName = window.prompt('Name for duplicate', `${saved.name} copy`);
              if (duplicateName !== null && validName(duplicateName.trim())) send({operation: 'duplicate', playlistId: draft.id, revision: draft.revision, name: duplicateName.trim()});
            }}>Duplicate playlist</button>
            <button type="button" className="secondary" disabled={blocked !== undefined} onClick={() => {
              if (window.confirm(`Delete playlist ${saved.name}?`)) send({operation: 'delete', playlistId: draft.id, revision: draft.revision});
            }}>Delete playlist</button>
          </div>
          {nameBlocked !== undefined && <p className="hint">{nameBlocked}</p>}
        </form>
        <fieldset disabled={base !== undefined}>
          <legend>Playlist options</legend>
          <label><input type="checkbox" aria-label="Repeat playlist" checked={draft.repeat}
            onChange={event => { setDraft({...draft, repeat: event.target.checked}); }}/>Repeat playlist</label>
          <label><input type="checkbox" aria-label="Shuffle" checked={draft.shuffle}
            onChange={event => { setDraft({...draft, shuffle: event.target.checked}); }}/>Shuffle</label>
          <div className="actions"><button type="button" disabled={blocked !== undefined || (draft.repeat === saved.repeat && draft.shuffle === saved.shuffle)}
            onClick={() => { send({operation: 'options', playlistId: draft.id, revision: draft.revision, repeat: draft.repeat, shuffle: draft.shuffle}); }}>Save options</button></div>
        </fieldset>
        <MediaPicker context={context} disabled={base !== undefined || draft.items.length >= 1000} add={media => {
          setDraft({...draft, items: [...draft.items, {key: crypto.randomUUID(), renditionId: media.renditionId,
            playback: media.frameCount > 1 ? {mode: 'plays', totalPlays: 3} : {mode: 'duration', durationMs: 30000}}]});
        }}/>
      </>}
      <ol>{draft.items.map((item, index) => <PlaylistItem key={item.key} context={context} item={item} index={index} length={draft.items.length}
        disabled={base !== undefined} edit={playback => { setDraft({...draft, items: draft.items.map((value, at) => at === index ? {...value, playback} : value)}); }}
        move={delta => { const items = [...draft.items]; const other = items[index + delta]; if (other === undefined) return;
          items[index] = other; items[index + delta] = item; setDraft({...draft, items}); }}
        remove={() => { setDraft({...draft, items: draft.items.filter((_, at) => at !== index)}); }}/>)}</ol>
      {draft.items.length === 0 && <p>No items yet. Choose media from the library.</p>}
      {context.control && <div className="actions">
        <button type="button" disabled={blocked !== undefined || !dirty || !itemValid}
          onClick={() => { send({operation: 'items', playlistId: draft.id, revision: draft.revision, items: itemsBody(draft.items)}); }}>Save items</button>
        <button type="button" className="secondary" disabled={command.locked} onClick={() => { if (discard()) load(saved); }}>Reload saved playlist</button>
        <span>{dirty ? 'Unsaved item edits' : `${draft.items.length} saved items`}</span>
      </div>}
      <p className="hint">Edits apply to the next session. Saved facts above come from the Pixoo owner.</p>
    </>}
    {base !== undefined && context.control && <p className="hint">{base}</p>}
    <p role="status">{failure ?? command.text}</p>
  </>;
}

export function PlaylistsPage(props: Props): React.JSX.Element {
  const {context, device, live} = props;
  const {Badge, Command} = context.ui;
  return <section className="widget" aria-label="Pixoo playlists">
    <header className="widget-head"><h2>Playlists</h2><Badge warning={!live}>{live ? 'Current' : 'Stale'}</Badge></header>
    <p className="hint">Arrange saved media without starting playback.</p>
    {live && props.playlists.length === 0 && <p>No saved playlists.</p>}
    {device === undefined ? <p role="status">The Pixoo owner has no device record.</p>
      : <Command context={context} target={device.id} key={device.id}>{command => <Editor {...props} device={device} command={command}/>}</Command>}
  </section>;
}
