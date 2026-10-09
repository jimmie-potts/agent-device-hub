// Adapted from divoom-app-upgrade apps/web/src/preview.tsx; frames use the shared authenticated content reader.
import React, {useEffect, useRef, useState} from 'react';
import type {FrontendApi} from '@jimmie-potts/sdk/frontend';

type PreviewData = {renditionId: string; frameCount: number; durationMs: number | null;
  frames: {index: number; delayMs: number | null}[];
  warnings: {frame: number; code: 'missing-delay' | 'zero-delay'; effectiveDelayMs: number}[]};
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
function previewOf(value: unknown, id: string): PreviewData {
  if (!object(value) || value.renditionId !== id || value.width !== 64 || value.height !== 64
    || !positive(value.frameCount) || value.frameCount > 1000 || !(value.durationMs === null || positive(value.durationMs))
    || !Array.isArray(value.frames) || value.frames.length !== value.frameCount
    || !value.frames.every((frame: unknown, index) => object(frame) && frame.index === index && (frame.delayMs === null || positive(frame.delayMs)))
    || !Array.isArray(value.warnings) || !value.warnings.every((warning: unknown) => object(warning)
      && Number.isSafeInteger(warning.frame) && typeof warning.frame === 'number' && warning.frame >= 0 && warning.frame < (value.frameCount as number)
      && (warning.code === 'missing-delay' || warning.code === 'zero-delay') && positive(warning.effectiveDelayMs))) throw new Error('invalid preview');
  return value as PreviewData;
}
function codeOf(error: unknown): string {
  return object(error) && object(error.body) && object(error.body.error) && typeof error.body.error.code === 'string'
    ? error.body.error.code : 'unavailable';
}

/** Reuses the Pixoo dashboard's canvas renderer; no object URL or relaxed image policy is needed. */
export function PreviewFrame({bitmap, label}: {bitmap: ImageBitmap | undefined; label: string}): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (context === null || context === undefined) return;
    context.clearRect(0, 0, 64, 64); context.imageSmoothingEnabled = false;
    if (bitmap !== undefined) context.drawImage(bitmap, 0, 0);
  }, [bitmap]);
  return <canvas ref={canvas} width={64} height={64} role="img" aria-label={label} className="pixoo-frame"/>;
}

/** The preview is local and illustrative. Loading or animating it never sends a device command. */
export function Preview({api, renditionId, active, onReady}: {
  api: FrontendApi; renditionId: string; active: boolean; onReady?: (ready: boolean) => void;
}): React.JSX.Element {
  const [preview, setPreview] = useState<PreviewData>();
  const [frame, setFrame] = useState(0);
  const [animate, setAnimate] = useState(false);
  const [image, setImage] = useState<ImageBitmap>();
  const [failure, setFailure] = useState<string>();
  useEffect(() => {
    let disposed = false;
    if (!/^[a-f0-9]{64}$/.test(renditionId)) { setFailure('invalid-request'); return; }
    void api.read(`/modules/pixoo/content/preview.${renditionId}`).then(value => {
      const data = previewOf(value, renditionId);
      if (!disposed) setPreview(data);
    }).catch((error: unknown) => { if (!disposed) setFailure(codeOf(error)); });
    return () => { disposed = true; };
  }, [api, renditionId]);
  useEffect(() => {
    if (preview === undefined) return;
    let disposed = false, bitmap: ImageBitmap | undefined;
    void api.image(`/modules/pixoo/content/frame.${renditionId}.${frame}`).then(async blob => {
      const decoded = await createImageBitmap(blob);
      if (disposed) { decoded.close(); return; }
      bitmap = decoded;
      setImage(bitmap);
    }).catch((error: unknown) => { if (!disposed) setFailure(codeOf(error)); });
    return () => { disposed = true; bitmap?.close(); };
  }, [api, renditionId, preview, frame]);
  useEffect(() => {
    if (!active || !animate || failure !== undefined || preview === undefined || preview.frameCount < 2) return;
    const timer = window.setTimeout(() => { setFrame(value => (value + 1) % preview.frameCount); }, preview.frames[frame]?.delayMs ?? 100);
    return () => { window.clearTimeout(timer); };
  }, [active, animate, failure, frame, preview]);
  useEffect(() => { onReady?.(image !== undefined && failure === undefined); }, [image, failure, onReady]);
  return <div>
    {image === undefined ? failure === undefined && <p role="status">Loading preview…</p>
      : <PreviewFrame bitmap={image} label="Effective preview"/>}
    {failure !== undefined && <p role="alert">Preview unavailable ({failure}). Close and reopen this media to retry.</p>}
    {preview !== undefined && <>
      <p>64 × 64 · {preview.frameCount} {preview.frameCount === 1 ? 'frame' : 'frames'}</p>
      {preview.frameCount > 1 && <>
        <button type="button" className="secondary" disabled={!active || failure !== undefined} onClick={() => { setAnimate(value => !value); }}>{animate ? 'Pause preview' : 'Animate preview'}</button>
        <p className="hint">Effective loop: {preview.durationMs} ms. Preview timing is illustrative.</p>
      </>}
      {preview.warnings.map((warning, index) => <p key={index}>Frame {warning.frame + 1}: {warning.code}, normalized to {warning.effectiveDelayMs} ms.</p>)}
    </>}
  </div>;
}
