import React, {useState} from 'react';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {FrontendCommand, FrontendContext} from '@jimmie-potts/sdk/frontend';
import type {PlaylistRecord, Policy} from '../module/schemas.js';
import {AnimatedMedia, MediaPicker, PICKER_PAGE_SIZE, type PickerMedia} from './media-picker.js';
import {useCardCommand} from './card-command.js';

type Item = {key: string; id?: string; renditionId: string; playback?: Policy};
const draftItems = (saved?: PlaylistRecord): Item[] => saved?.items.map(item => ({...item, key: item.id})) ?? [];
const body = (items: readonly Item[]): {id?: string; renditionId: string; playback?: Policy}[] => items.map(({key: _key, ...item}) => item);

/** An owner revision is captured once. A changed owner never silently replaces a draft. */
export function PlaylistEditor({context, device, live, command, playlists, saved, active, close}: {
  context: FrontendContext; device: DeviceRecord; live: boolean; command: FrontendCommand;
  active: boolean; playlists: readonly PlaylistRecord[]; saved?: PlaylistRecord | undefined; close: () => void;
}): React.JSX.Element {
  const [identity] = useState(() => saved?.id ?? crypto.randomUUID());
  const [revision, setRevision] = useState(saved?.playlistRevision);
  const [name, setName] = useState(saved?.name ?? '');
  const [items, setItems] = useState<Item[]>(() => draftItems(saved));
  const [selected, setSelected] = useState(''), [offset, setOffset] = useState(0), [adding, setAdding] = useState(false);
  const [media, setMedia] = useState<ReadonlyMap<string, PickerMedia>>(new Map());
  const {blocked, failure, send} = useCardCommand(context, device, live, command);
  const owner = playlists.find(playlist => playlist.id === identity);
  const stale = revision !== undefined && owner?.playlistRevision !== revision;
  const created = revision === undefined && owner !== undefined;
  const dirty = JSON.stringify(body(items)) !== JSON.stringify(owner?.items ?? []);
  const trimmed = name.trim(), validName = trimmed.length > 0 && trimmed.length <= 120 && Array.from(trimmed).every(character => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127);
  const disabled = blocked !== undefined || stale || created;
  const current = items.findIndex(item => item.key === selected);
  const move = (delta: number): void => {
    const next = current + delta;
    if (disabled || current < 0 || next < 0 || next >= items.length) return;
    const reordered = [...items], item = reordered.splice(current, 1)[0];
    if (item === undefined) return;
    reordered.splice(next, 0, item); setItems(reordered); setOffset(Math.floor(next / PICKER_PAGE_SIZE) * PICKER_PAGE_SIZE);
  };
  const discard = (): boolean => !dirty && revision !== undefined || items.length === 0 && revision === undefined || window.confirm('Discard unsaved playlist edits?');
  return <section aria-label="Playlist editor" className="pixoo-editor">
    <div className="actions"><h4>{revision === undefined ? 'New playlist' : owner?.name ?? 'Playlist'}</h4>
      <button type="button" className="secondary" disabled={command.locked} onClick={() => { if (created || discard()) close(); }}>Back to content</button></div>
    {revision === undefined && <label>Playlist name<input type="text" value={name} maxLength={120} disabled={disabled} autoComplete="off"
      onChange={event => { setName(event.target.value); }}/></label>}
    {created ? <p role="status">Playlist created. {owner.items.length} items · Loops automatically.</p> : <>
      <div className="pixoo-media-grid">{items.slice(offset, offset + PICKER_PAGE_SIZE).map((item, index) => <button type="button" className="pixoo-media-tile" key={item.key}
        aria-pressed={selected === item.key} aria-label={`Select playlist item ${offset + index + 1}`} onClick={() => { setSelected(item.key); }}>
        <AnimatedMedia api={context.api} renditionId={item.renditionId} label={`Playlist item ${offset + index + 1} preview`} active={active && context.connected}/>
        <span>{offset + index + 1}</span>
      </button>)}</div>
      {items.length === 0 && <p>Add GIFs or images to begin.</p>}
      <div className="actions" aria-label="Selected item controls">
        <button type="button" className="secondary" disabled={disabled || current <= 0} onClick={() => { move(-1); }}>Move earlier</button>
        <button type="button" className="secondary" disabled={disabled || current < 0 || current === items.length - 1} onClick={() => { move(1); }}>Move later</button>
        <button type="button" className="secondary" disabled={disabled || current < 0} onClick={() => {
          const remaining = items.filter(item => item.key !== selected); setItems(remaining); setSelected('');
          setOffset(Math.min(offset, Math.max(0, Math.floor((remaining.length - 1) / PICKER_PAGE_SIZE) * PICKER_PAGE_SIZE)));
        }}>Remove item</button>
      </div>
      {items.length > PICKER_PAGE_SIZE && <div className="actions">
        <button type="button" className="secondary" disabled={offset === 0} onClick={() => { setOffset(Math.max(0, offset - PICKER_PAGE_SIZE)); }}>Previous items</button>
        <span>{offset + 1}–{Math.min(offset + PICKER_PAGE_SIZE, items.length)} of {items.length}</span>
        <button type="button" className="secondary" disabled={offset + PICKER_PAGE_SIZE >= items.length} onClick={() => { setOffset(offset + PICKER_PAGE_SIZE); }}>Next items</button>
      </div>}
      {context.control && <div className="actions">
        <button type="button" className="secondary" disabled={disabled || items.length >= 1000} onClick={() => { setAdding(value => !value); }}>{adding ? 'Close media picker' : 'Add GIFs'}</button>
        <button type="button" disabled={disabled || items.length === 0 || (revision === undefined ? !validName : !dirty)} onClick={() => {
          if (disabled) return;
          if (revision === undefined && validName && items.length > 0) send('pixoo-playlist-change', {change: {operation: 'create', name: trimmed, playlistId: identity, repeat: true, items: body(items)}});
          else if (revision !== undefined && dirty && items.length > 0) send('pixoo-playlist-change', {change: {operation: 'items', playlistId: identity, revision, items: body(items)}});
        }}>{revision === undefined ? 'Create playlist' : 'Save playlist'}</button>
      </div>}
      {adding && <>
        <MediaPicker context={context} active={active && context.connected} selected={media} disabled={disabled} onSelect={item => {
          setMedia(previous => { const next = new Map(previous); if (next.has(item.renditionId)) next.delete(item.renditionId); else next.set(item.renditionId, item); return next; });
        }}/>
        <button type="button" disabled={disabled || media.size === 0 || items.length + media.size > 1000} onClick={() => {
          if (disabled || items.length + media.size > 1000) return;
          setItems(previous => [...previous, ...[...media.values()].map(item => ({key: crypto.randomUUID(), renditionId: item.renditionId}))]);
          setMedia(new Map()); setAdding(false);
        }}>Add selected ({media.size})</button>
      </>}
      {stale && <p role="status">The saved playlist changed. Reload before saving.</p>}
      {revision !== undefined && <button type="button" className="secondary" disabled={command.locked || owner === undefined} onClick={() => {
        if (owner !== undefined && discard()) { setItems(draftItems(owner)); setRevision(owner.playlistRevision); setOffset(0); setSelected(''); setAdding(false); setMedia(new Map()); }
      }}>Reload saved playlist</button>}
      <p className="light-note">{items.length} items · {dirty || revision === undefined ? 'Unsaved' : 'Saved'}. Saving leaves active playback unchanged.</p>
    </>}
    {blocked !== undefined && <p className="hint">{blocked}</p>}
    {failure !== undefined && <p role="alert">{failure}</p>}
  </section>;
}
