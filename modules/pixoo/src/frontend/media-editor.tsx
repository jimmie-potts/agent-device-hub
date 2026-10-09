// The source Library's saved renditions and render/delete controls, adapted to existing runtime commands.
import React, {useEffect, useRef, useState} from 'react';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {FrontendCommand, FrontendContext} from '@jimmie-potts/sdk/frontend';
import {Preview} from './preview.js';

type Transform = {fit: 'fit' | 'crop'; scaling: 'nearest' | 'smooth'; background: [number, number, number]};
type Rendition = {id: string; transform: Transform; frameCount: number};
type Detail = {asset: {id: string; name: string; source: {format: string; width: number; height: number}}; renditions: Rendition[]};
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const codeOf = (error: unknown): string => object(error) && object(error.body) && object(error.body.error) && typeof error.body.error.code === 'string'
  ? error.body.error.code : 'unavailable';
function detailOf(value: unknown, assetId: string): Detail {
  if (!object(value) || !object(value.asset) || value.asset.id !== assetId || typeof value.asset.name !== 'string'
    || !object(value.asset.source) || typeof value.asset.source.format !== 'string'
    || !Number.isSafeInteger(value.asset.source.width) || !Number.isSafeInteger(value.asset.source.height)
    || !Array.isArray(value.renditions) || value.renditions.length === 0 || !value.renditions.every((item: unknown) =>
      object(item) && typeof item.id === 'string' && /^[a-f0-9]{64}$/.test(item.id) && Number.isSafeInteger(item.frameCount)
      && object(item.transform) && (item.transform.fit === 'fit' || item.transform.fit === 'crop')
      && (item.transform.scaling === 'nearest' || item.transform.scaling === 'smooth') && Array.isArray(item.transform.background)
      && item.transform.background.length === 3 && item.transform.background.every((channel: unknown) => typeof channel === 'number'
        && Number.isInteger(channel) && channel >= 0 && channel <= 255))) throw new Error('invalid asset');
  return value as Detail;
}
const sameTransform = (left: Transform, right: Transform): boolean => left.fit === right.fit && left.scaling === right.scaling
  && left.background.every((value, index) => value === right.background[index]);

export function MediaEditor({context, device, live, assetId, renditionId, completions, command, close}: {
  context: FrontendContext; device: DeviceRecord; live: boolean; assetId: string; renditionId: string; completions: string;
  command: FrontendCommand; close: () => void;
}): React.JSX.Element {
  const [detail, setDetail] = useState<Detail>();
  const [selected, setSelected] = useState(renditionId);
  const [draft, setDraft] = useState<Transform>({fit: 'fit', scaling: 'nearest', background: [0, 0, 0]});
  const [error, setError] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const [loading, setLoading] = useState(true);
  const pending = useRef<Transform | undefined>(undefined);
  const initialized = useRef(false);
  const submitting = useRef(false);
  const closeCurrent = useRef(close); closeCurrent.current = close;
  useEffect(() => {
    let disposed = false;
    setLoading(true); setError(undefined);
    void context.api.read(`/modules/pixoo/content/asset.${encodeURIComponent(assetId)}`).then(value => {
      const loaded = detailOf(value, assetId);
      if (disposed) return;
      setDetail(loaded); setLoading(false);
      const rendered = pending.current === undefined ? undefined : loaded.renditions.find(item => sameTransform(item.transform, pending.current as Transform));
      const chosen = rendered ?? (initialized.current ? undefined : loaded.renditions.find(item => item.id === renditionId) ?? loaded.renditions[0]);
      if (chosen !== undefined) { setSelected(chosen.id); setDraft(chosen.transform); }
      initialized.current = true;
      pending.current = undefined;
    }).catch((error: unknown) => {
      if (disposed) return;
      const code = codeOf(error); setLoading(false);
      if (code === 'not-found') closeCurrent.current(); else setError(code);
    });
    return () => { disposed = true; };
  }, [context.api, assetId, renditionId, completions]);
  const blocked = !context.control || !context.connected || !live || !context.operationsLive || command.locked || loading || detail === undefined;
  const send = (operation: 'render' | 'delete'): void => {
    if (blocked || submitting.current || detail === undefined) return;
    if (operation === 'delete' && !window.confirm(`Delete ${detail.asset.name}? Referenced media will be preserved.`)) return;
    submitting.current = true; setFailure(undefined);
    pending.current = operation === 'render' ? structuredClone(draft) : undefined;
    void command.run({family: 'pixoo-asset-change', target: device.id, requestId: crypto.randomUUID(),
      data: {change: {operation, assetId, ...(operation === 'render' ? {transform: draft} : {})}}})
      .catch(() => { setFailure('The request has no confirmed reply. It was not sent again.'); })
      .finally(() => { submitting.current = false; });
  };
  const {Select, Facts} = context.ui;
  const color = `#${draft.background.map(value => value.toString(16).padStart(2, '0')).join('')}`;
  return <aside aria-label="Selected media">
    {loading && <p role="status">Loading saved renditions…</p>}
    {error !== undefined && <p role="alert">Media unavailable ({error}). Close and reopen it to retry.</p>}
    {detail !== undefined && <>
      <h3>{detail.asset.name}</h3>
      <Facts items={[
        ['Original', `${detail.asset.source.format} · ${detail.asset.source.width} × ${detail.asset.source.height}`],
        ['Saved renditions', detail.renditions.length],
      ]}/>
      <Select label="Saved rendition" value={selected} onChange={id => {
        const next = detail.renditions.find(item => item.id === id);
        if (next !== undefined) { setSelected(next.id); setDraft(next.transform); }
      }} options={detail.renditions.map((item, index) => ({value: item.id, label: `${index + 1}: ${item.transform.fit} / ${item.transform.scaling}`}))}/>
      <Preview key={selected} api={context.api} renditionId={selected} active={context.connected}/>
      {context.control && <fieldset disabled={blocked}>
        <legend>Render a saved preview</legend>
        <Select label="Fit" value={draft.fit} onChange={fit => { if (fit === 'fit' || fit === 'crop') setDraft({...draft, fit}); }}
          options={[{value: 'fit', label: 'Fit with padding'}, {value: 'crop', label: 'Center crop'}]}/>
        <Select label="Scaling" value={draft.scaling} onChange={scaling => { if (scaling === 'nearest' || scaling === 'smooth') setDraft({...draft, scaling}); }}
          options={[{value: 'nearest', label: 'Nearest neighbor'}, {value: 'smooth', label: 'Smooth'}]}/>
        <label>Padding color<input type="color" value={color} onChange={event => {
          const hex = event.target.value;
          setDraft({...draft, background: [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16)]});
        }}/></label>
        <div className="actions">
          <button type="button" onClick={() => { send('render'); }}>Render preview</button>
          <button type="button" className="secondary" onClick={() => { send('delete'); }}>Delete media</button>
        </div>
      </fieldset>}
      <p className="hint">Rendering preserves the original and saved renditions. Playlist items keep their selected rendition.</p>
      <a href="#/module/pixoo/playlists">Use in playlist</a>
      <p className="hint">On Playlists, choose the exact saved rendition and inspect its preview before adding it, then save its items.</p>
    </>}
    {failure !== undefined && <p role="alert">{failure}</p>}
    <button type="button" className="secondary" onClick={close}>Close preview</button>
  </aside>;
}
