import React, {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import type {FrontendApi} from '@jimmie-potts/sdk/frontend';
import type {ArtworkSummary} from '@jimmie-potts/event-contracts/v2/art-state';
import {artworkOf, browserArt} from './model.js';
import {usePresentArt, type PresentedArt} from './presentation.js';

type Decoded = {bitmap: ImageBitmap; evidence: PresentedArt; label: string};
/** A still is complete only after authenticated bytes decode. Obsolete selections release their bitmap. */
export function ArtImage({api, artwork, live, compact = false, presented = false}: {
  api: FrontendApi; artwork: ArtworkSummary | undefined; live: boolean; compact?: boolean; presented?: boolean;
}): React.JSX.Element {
  const frame = useRef<HTMLElement>(null), [visible, setVisible] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null), kept = useRef<Decoded | undefined>(undefined);
  const [drawn, setDrawn] = useState<string>();
  const [decoded, setDecoded] = useState<Decoded>(), [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const publish = usePresentArt();
  useEffect(() => {
    if (!presented || frame.current === null) return;
    const observer = new IntersectionObserver(entries => {setVisible(entries.some(entry => entry.isIntersecting && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0));});
    observer.observe(frame.current);return () => {observer.disconnect();};
  }, [presented]);
  // The dependency contains only image-relevant values; catalog edits do not trigger a new decode.
  const imageKey = artwork === undefined ? '' : JSON.stringify({artworkId: artwork.artworkId, palette: artwork.palette, provenance: artwork.provenance, compositions: artwork.compositions});
  const selected = useMemo(() => {
    if (imageKey === '') return undefined;
    const value: unknown = JSON.parse(imageKey);
    const art = artworkOf({...((typeof value === 'object' && value !== null) ? value : {}), createdAtMs: 0, favorite: false, feedback: null, variationOf: null});
    return art === undefined ? undefined : browserArt(art, compact);
  }, [imageKey, compact]);
  useEffect(() => {
    let disposed = false;
    if (!live) return;
    if (selected === undefined) {kept.current?.bitmap.close();kept.current = undefined;setDecoded(undefined);setStatus('unavailable');return;}
    const {rendition, compositionId, artwork: value} = selected;
    setStatus('loading');
    void api.image(`/modules/art/content/${rendition.ref}`).then(async blob => {
      if (disposed) return;
      if (blob.size !== rendition.bytes || blob.type !== `image/${rendition.format}`) throw new Error('invalid-image');
      const bitmap = await createImageBitmap(blob);
      if (disposed) {bitmap.close();return;}
      if (bitmap.width !== rendition.width || bitmap.height !== rendition.height) {bitmap.close();throw new Error('invalid-dimensions');}
      const next: Decoded = {bitmap, evidence: {artworkId: value.artworkId, compositionId, renditionId: rendition.renditionId, palette: [...value.palette]},
        label: `Generated art by ${value.provenance.generatedBy === 'openai' ? 'OpenAI' : 'local rendering'}. Fictional composition.`};
      kept.current?.bitmap.close();kept.current = next;setDecoded(next);setStatus('ready');
    }).catch(() => {if (!disposed) setStatus('unavailable');});
    return () => {disposed = true;};
    // Immutable rendition identity owns the image load; favorite and budget updates cannot restart it.
  }, [api, live, selected]);
  useEffect(() => () => {kept.current?.bitmap.close();kept.current = undefined;}, []);
  useLayoutEffect(() => {
    const element = canvas.current;
    if (element === null || decoded === undefined) {setDrawn(undefined);return;}
    try {
      element.width = decoded.bitmap.width;element.height = decoded.bitmap.height;
      const drawing = element.getContext('2d');if (drawing === null) throw new Error('canvas-unavailable');
      drawing.drawImage(decoded.bitmap, 0, 0);setDrawn(decoded.evidence.renditionId);
    } catch {setDrawn(undefined);setStatus('unavailable');}
  }, [decoded]);
  useEffect(() => {
    if (presented) publish(visible ? {presented: decoded !== undefined && drawn === decoded.evidence.renditionId ? decoded.evidence : null, status: !live ? 'stale' : status} : {presented: null, status: 'idle'});
  }, [decoded, drawn, live, status, presented, visible, publish]);
  useEffect(() => () => {if (presented) publish({presented: null, status: 'idle'});}, [presented, publish]);
  return <figure ref={frame} className="art-image" data-art-image-state={!live ? 'stale' : status} data-artwork={decoded?.evidence.artworkId ?? ''}>
    <div className="art-image-frame">{decoded !== undefined && <canvas ref={canvas} role="img" aria-label={decoded.label}/>}
      {decoded === undefined && <span className="hint">{!live ? 'Art is unavailable or stale.' : status === 'loading' ? 'Loading artwork…' : 'No browser image is available.'}</span>}
    </div>
    <figcaption>{decoded?.label ?? 'Generated artwork.'}{!live ? ' Stale.' : status === 'loading' ? ' Loading selected artwork.' : status === 'unavailable' ? ' Selected artwork is unavailable.' : ''}</figcaption>
  </figure>;
}
