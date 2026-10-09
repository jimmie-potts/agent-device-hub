// Adapted from divoom-app-upgrade apps/web/src/library.tsx; runtime reads and shared tracked commands replace its local API.
import React, {useEffect, useId, useRef, useState} from 'react';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {FrontendCommand, FrontendContext} from '@jimmie-potts/sdk/frontend';
import {MediaEditor} from './media-editor.js';

type Media = {assetId: string; renditionId: string; name: string; format: string; frameCount: number; compatible?: boolean};
type Catalog = {items: Media[]; total: number; offset: number; limit: number; catalogRevision: number};
const LIMIT = 25;
const MAX_BYTES = 10 * 1024 * 1024;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
function catalogOf(value: unknown): Catalog {
  if (!object(value) || !Array.isArray(value.items) || value.items.length > LIMIT
    || !['total', 'offset', 'limit', 'catalogRevision'].every(key => Number.isSafeInteger(value[key]) && (value[key] as number) >= 0)
    || !value.items.every((item: unknown) => object(item) && typeof item.assetId === 'string' && typeof item.renditionId === 'string'
      && typeof item.name === 'string' && typeof item.format === 'string' && Number.isSafeInteger(item.frameCount)
      && (item.compatible === undefined || typeof item.compatible === 'boolean'))) throw new Error('invalid catalog');
  return value as Catalog;
}

function AddMedia({context, device, live, command}: {
  context: FrontendContext; device: DeviceRecord; live: boolean; command: FrontendCommand;
}): React.JSX.Element {
  const id = useId();
  const submitting = useRef(false);
  const [file, setFile] = useState<File>();
  const [name, setName] = useState('');
  const [failure, setFailure] = useState<string>();
  const trimmed = name.trim();
  const blocked = !context.connected || !live ? 'Device records are stale.'
    : !context.operationsLive ? 'Command records are stale.'
    : command.locked ? 'Wait for the current command result.'
    : file === undefined ? 'Choose a PNG, JPEG or GIF.'
    : file.size === 0 || file.size > MAX_BYTES ? 'Choose a nonempty file up to 10 MiB.'
    : trimmed.length === 0 || trimmed.length > 120 || Array.from(trimmed).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
      ? 'Use a name of 1 to 120 characters without control characters.' : undefined;
  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!context.control || blocked !== undefined || submitting.current || file === undefined) return;
    submitting.current = true;
    setFailure(undefined);
    void command.run({family: 'pixoo-asset-change', target: device.id, requestId: crypto.randomUUID(), upload: {name: trimmed, file}})
      .catch(() => { setFailure('The request has no confirmed reply. It was not sent again.'); })
      .finally(() => { submitting.current = false; });
  };
  return <>
    {context.control ? <form onSubmit={submit}>
      <label htmlFor={`${id}-file`}>Media file</label>
      <input id={`${id}-file`} type="file" accept="image/png,image/jpeg,image/gif" disabled={command.locked}
        onChange={event => { const selected = event.target.files?.[0]; setFile(selected); setName(selected?.name ?? ''); }}/>
      <label htmlFor={`${id}-name`}>Media name</label>
      <input id={`${id}-name`} value={name} maxLength={120} disabled={command.locked} autoComplete="off"
        onChange={event => { setName(event.target.value); }}/>
      <div className="actions"><button type="submit" disabled={blocked !== undefined}>Add media</button></div>
      {blocked !== undefined && <p className="hint">{blocked}</p>}
    </form> : <p className="hint">Read-only access.</p>}
    <p role="status">{failure ?? command.text}</p>
  </>;
}

export function LibraryPage({context, device, live}: {
  context: FrontendContext; device: DeviceRecord | undefined; live: boolean;
}): React.JSX.Element {
  const {Command} = context.ui;
  return device === undefined ? <section className="widget" aria-label="Pixoo library"><h2>Library</h2><p role="status">The Pixoo owner has no device record.</p></section>
    : <Command context={context} target={device.id} key={device.id}>{command =>
      <LibraryContents context={context} device={device} live={live} command={command}/>
    }</Command>;
}

function LibraryContents({context, device, live, command}: {
  context: FrontendContext; device: DeviceRecord; live: boolean; command: FrontendCommand;
}): React.JSX.Element {
  const {Badge} = context.ui;
  const id = useId();
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [catalog, setCatalog] = useState<Catalog>();
  const [selected, setSelected] = useState<Media>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const completions = context.operations.filter(operation => operation.family === 'pixoo-asset-change' && operation.status === 'completed')
    .map(operation => `${operation.requestId}:${operation.revision}`).sort().join(',');
  useEffect(() => {
    let disposed = false;
    setLoading(true); setError(undefined);
    const params = new URLSearchParams({q: query, offset: String(offset), limit: String(LIMIT)});
    void context.api.read(`/modules/pixoo/content/catalog-media?${params}`).then(value => {
      const next = catalogOf(value);
      if (!disposed) { setCatalog(next); setLoading(false); }
    }).catch((error: unknown) => { if (!disposed) {
      const body = object(error) && object(error.body) ? error.body : undefined;
      const code = body !== undefined && object(body.error) && typeof body.error.code === 'string' ? body.error.code : 'unavailable';
      setError(code); setLoading(false);
    } });
    return () => { disposed = true; };
  }, [context.api, query, offset, refresh, completions]);
  return <section className="widget" aria-label="Pixoo library">
    <header className="widget-head"><h2>Library</h2><Badge warning={!live}>{live ? 'Current' : 'Stale'}</Badge></header>
    <p className="hint">Add an original and its default rendition to the library. This does not start playback.</p>
    <AddMedia context={context} device={device} live={live} command={command}/>
    <label htmlFor={id}>Search media</label>
    <input id={id} type="search" value={query} maxLength={120} onChange={event => { setQuery(event.target.value); setOffset(0); }}/>
    <div className="actions"><button type="button" className="secondary" disabled={loading} onClick={() => { setRefresh(value => value + 1); }}>Refresh library</button></div>
    {loading && <p role="status">Loading library…</p>}
    {error !== undefined && <p role="status" className="warning">Library unavailable ({error}). Refresh to try again.</p>}
    {!loading && error === undefined && catalog !== undefined && <>
      {catalog.items.length === 0 ? <p>No matching media.</p> : <table>
        <caption>Saved media</caption>
        <thead><tr><th scope="col">Name</th><th scope="col">Format</th><th scope="col">Frames</th><th scope="col">Compatibility</th><th scope="col">Preview</th></tr></thead>
        <tbody>{catalog.items.map(item => <tr key={item.renditionId}>
          <td>{item.name}</td><td>{item.format}</td><td>{item.frameCount}</td>
          <td>{item.compatible === undefined ? 'Not checked' : item.compatible ? 'Compatible' : 'Incompatible'}</td>
          <td><button type="button" className="secondary" aria-label={`Inspect ${item.name}`} onClick={() => { setSelected(item); }}>Inspect</button></td>
        </tr>)}</tbody>
      </table>}
      <p>{catalog.total === 0 ? '0 items' : `${catalog.offset + 1}–${catalog.offset + catalog.items.length} of ${catalog.total}`}</p>
      <div className="actions">
        <button type="button" className="secondary" disabled={offset === 0} onClick={() => { setOffset(Math.max(0, offset - LIMIT)); }}>Previous media</button>
        <button type="button" className="secondary" disabled={offset + LIMIT >= catalog.total} onClick={() => { setOffset(offset + LIMIT); }}>Next media</button>
      </div>
    </>}
    {selected !== undefined && <MediaEditor key={selected.renditionId} context={context} device={device} live={live}
      assetId={selected.assetId} renditionId={selected.renditionId} completions={completions} command={command} close={() => { setSelected(undefined); }}/>}
  </section>;
}
