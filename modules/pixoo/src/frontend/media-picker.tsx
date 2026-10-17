import React, {useEffect, useId, useRef, useState} from 'react';
import type {FrontendContext, FrontendApi} from '@jimmie-potts/sdk/frontend';
import {PreviewFrame, previewOf} from './preview.js';

export type PickerMedia = {renditionId: string; name: string; frameCount: number; compatible?: boolean};
type Page = {items: PickerMedia[]; total: number};
export const PICKER_PAGE_SIZE = 6;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
function pageOf(value: unknown): Page {
  if (!object(value) || !Number.isSafeInteger(value.total) || (value.total as number) < 0 || !Array.isArray(value.items)
    || value.items.length > PICKER_PAGE_SIZE || !value.items.every((item: unknown) => object(item)
      && typeof item.renditionId === 'string' && /^[a-f0-9]{64}$/.test(item.renditionId) && typeof item.name === 'string'
      && item.name.length <= 120 && Number.isSafeInteger(item.frameCount) && (item.frameCount as number) >= 1 && (item.frameCount as number) <= 1000
      && (item.compatible === undefined || typeof item.compatible === 'boolean'))) throw new Error('invalid catalog');
  return value as Page;
}

/** Keeps only decoded frames for a visible tile. Pausing releases animation frames and keeps a still. */
export function AnimatedMedia({api, renditionId, label, active, animate = true}: {
  api: FrontendApi; renditionId: string; label: string; active: boolean; animate?: boolean;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false), [foreground, setForeground] = useState(!document.hidden);
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [bitmap, setBitmap] = useState<ImageBitmap>(), [frame, setFrame] = useState(0);
  const [status, setStatus] = useState('still');
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const motion = (): void => { setReduced(media.matches); };
    const visibility = (): void => { setForeground(!document.hidden); };
    const observer = new IntersectionObserver(entries => { setVisible(entries.some(entry => entry.isIntersecting)); });
    if (ref.current !== null) observer.observe(ref.current);
    media.addEventListener('change', motion); document.addEventListener('visibilitychange', visibility);
    return () => { observer.disconnect(); media.removeEventListener('change', motion); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  const playing = active && animate && !reduced;
  useEffect(() => {
    let disposed = false, timer: number | undefined;
    const frames: ImageBitmap[] = [];
    setBitmap(undefined); setFrame(0); setStatus('still');
    if (!active || !visible || !foreground) return;
    setStatus('loading');
    void (async () => {
      const preview = previewOf(await api.read(`/modules/pixoo/content/preview.${renditionId}`), renditionId);
      if (disposed) return;
      const count = playing ? preview.frameCount : 1;
      // A visible page has at most six tiles; each rendition has at most 1,000 64 × 64 frames.
      for (let index = 0; index < count; index++) {
        const blob = await api.image(`/modules/pixoo/content/frame.${renditionId}.${index}`);
        if (disposed) return;
        const image = await createImageBitmap(blob);
        if (disposed) { image.close(); return; }
        frames.push(image);
        if (index === 0) setBitmap(image);
      }
      if (disposed) return;
      setStatus(count > 1 ? 'animating' : 'still');
      const show = (index: number): void => {
        setBitmap(frames[index]); setFrame(index);
        timer = window.setTimeout(() => { show((index + 1) % count); }, preview.frames[index]?.delayMs ?? 100);
      };
      if (count > 1) show(0);
    })().catch(() => { if (!disposed) { setStatus('unavailable'); frames.forEach(image => { image.close(); }); setBitmap(undefined); } });
    return () => { disposed = true; window.clearTimeout(timer); frames.forEach(image => { image.close(); }); };
  }, [api, renditionId, active, visible, foreground, playing]);
  return <div ref={ref} className="pixoo-thumbnail" data-preview-state={status} data-preview-frame={frame}>
    <PreviewFrame bitmap={bitmap} label={label}/>
    {status === 'unavailable' && <span className="hint">Preview unavailable</span>}
  </div>;
}

/** Selection belongs to the caller, so it survives search and page changes. This component never dispatches. */
export function MediaPicker({context, active, selected, onSelect, disabled = false}: {
  context: FrontendContext; active: boolean; selected: ReadonlyMap<string, PickerMedia>;
  onSelect: (media: PickerMedia) => void; disabled?: boolean;
}): React.JSX.Element {
  const id = useId();
  const [query, setQuery] = useState(''), [offset, setOffset] = useState(0), [paused, setPaused] = useState(false);
  const [page, setPage] = useState<Page>(), [error, setError] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    let disposed = false;
    setPage(undefined); setError(false);
    if (!context.connected) return;
    const params = new URLSearchParams({q: query, offset: String(offset), limit: String(PICKER_PAGE_SIZE)});
    void context.api.read(`/modules/pixoo/content/catalog-media?${params}`).then(value => {
      const next = pageOf(value); if (!disposed) setPage(next);
    }).catch(() => { if (!disposed) setError(true); });
    return () => { disposed = true; };
  }, [context.api, context.connected, query, offset, retry]);
  return <section className="pixoo-picker" aria-label="Media picker">
    <label htmlFor={id}>Search GIFs and images</label>
    <input id={id} type="search" maxLength={120} value={query} onChange={event => { setQuery(event.target.value); setOffset(0); }}/>
    <div className="actions"><button type="button" className="secondary" onClick={() => { setPaused(value => !value); }}>{paused ? 'Animate GIFs' : 'Pause GIFs'}</button></div>
    {error ? <p role="alert">Media unavailable. <button type="button" onClick={() => { setRetry(value => value + 1); }}>Retry media</button></p>
      : page === undefined ? <p role="status">Loading media…</p> : <>
        <div className="pixoo-media-grid">{page.items.map(media => <button key={media.renditionId} type="button" className="pixoo-media-tile"
          aria-pressed={selected.has(media.renditionId)} disabled={disabled || media.compatible === false} onClick={() => { onSelect(media); }}>
          <AnimatedMedia api={context.api} renditionId={media.renditionId} label={`${media.name} preview`} active={active && context.connected} animate={!paused}/>
          <span>{media.name}</span><small>{media.renditionId.slice(0, 10)}{media.compatible === false ? ' · Incompatible' : ''}</small>
        </button>)}</div>
        {page.total === 0 && <p>No matching media.</p>}
        <div className="actions">
          <button type="button" className="secondary" disabled={offset === 0} onClick={() => { setOffset(Math.max(0, offset - PICKER_PAGE_SIZE)); }}>Previous media</button>
          <span>{page.total === 0 ? '0 results' : `${offset + 1}–${Math.min(offset + PICKER_PAGE_SIZE, page.total)} of ${page.total}`}</span>
          <button type="button" className="secondary" disabled={offset + PICKER_PAGE_SIZE >= page.total} onClick={() => { setOffset(offset + PICKER_PAGE_SIZE); }}>Next media</button>
        </div>
      </>}
  </section>;
}
