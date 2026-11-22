import React, {useEffect, useRef, useState, type ReactNode} from 'react';
import {isErrorCode, type ErrorCode} from '@jimmie-potts/event-contracts/v2/errors';
import {ART_ATTACHMENT_FAMILY, MAX_ART_ATTACHMENT_BYTES, uploadArtworkId, artShowSurfaces, type ArtShowEffects, type ArtShowSurface} from '@jimmie-potts/event-contracts/v2/art-show';
import type {FrontendAction, FrontendContext, FrontendUpload} from '@jimmie-potts/sdk/frontend';
import {childOf, followCopy} from '@jimmie-potts/sdk/remote';
import {ConversationImage, readConversationArtwork, type Media} from './conversation-art.js';

type Attempt = {id: string; error?: ErrorCode};
type Result = {kind: 'pending' | 'succeeded' | 'failed' | 'uncertain'; code?: ErrorCode};
type Target = {id: string; label: string; formats: readonly string[]; unavailable?: ErrorCode};
type Shows = {attempt: Attempt; surfaces: ArtShowSurface[]};
type Operation = FrontendContext['operations'][number];

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
function parseTargets(value: unknown): Target[] {
  if (!object(value) || value.schema !== 'automation/2.0' || !Array.isArray(value.targets)) throw new Error('invalid-targets');
  return value.targets.flatMap((item: unknown): Target[] => {
    if (!object(item) || typeof item.target !== 'string' || (item.kind !== 'pixoo' && item.kind !== 'tidbyt') || !Array.isArray(item.formats)) return [];
    const unavailable = isErrorCode(item.unavailable) ? item.unavailable : undefined;
    return [{id: item.target, label: item.kind === 'pixoo' ? 'Pixoo' : 'Tidbyt',
      formats: item.formats.filter((format: unknown): format is string => typeof format === 'string'),
      ...(unavailable === undefined ? {} : {unavailable})}];
  });
}

function outcome(operation: Operation | undefined, error?: ErrorCode): Result {
  const code = operation?.error?.code ?? error;
  if (operation?.status === 'completed' && operation.result === 'succeeded') return {kind: 'succeeded'};
  if (operation?.status === 'rejected' || operation?.status === 'expired' || (operation?.status === 'completed' && operation.result === 'failed')) {
    return {kind: 'failed', ...(code === undefined ? {} : {code})};
  }
  if (operation?.status === 'uncertain' || operation?.status === 'conflict' || code === 'uncertain-result') return {kind: 'uncertain'};
  if (error !== undefined) return {kind: 'failed', code: error};
  return {kind: 'pending'};
}

function text(result: Result, success: string): string {
  if (result.kind === 'succeeded') return success;
  if (result.kind === 'pending') return 'In progress';
  if (result.kind === 'uncertain') return 'Outcome uncertain. The request was not sent again.';
  if (result.code === 'too-large') return 'The attachment exceeds the byte, pixel or frame limit.';
  if (result.code === 'invalid-request' || result.code === 'unsupported-capability') return 'This image or animation could not be used.';
  return result.code === undefined ? 'Failed' : `Failed (${result.code})`;
}

export function ConversationUpload({context, locked, children}: {
  context: FrontendContext; locked: boolean; children: (attach: ReactNode) => ReactNode;
}): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null), active = useRef(false);
  const selected = useRef<{id: string; trace: ReturnType<typeof childOf>}>(undefined);
  const [inFlight, setInFlight] = useState(false), [previewReady, setPreviewReady] = useState(false);
  const [upload, setUpload] = useState<Attempt>(), [preview, setPreview] = useState<Media>();
  const [message, setMessage] = useState<string>(), [targets, setTargets] = useState<Target[]>();
  const [picked, setPicked] = useState<string[]>([]), [saved, setSaved] = useState<Attempt>();
  const [shows, setShows] = useState<Shows[]>([]), [effects, setEffects] = useState<ArtShowEffects[]>([]);
  const canAct = !locked && !inFlight;
  const operation = (id: string | undefined) => context.operations.find(item => item.requestId === id);
  const staging = upload === undefined ? undefined : outcome(operation(upload.id), upload.error);
  const saving = saved === undefined ? undefined : outcome(operation(saved.id), saved.error);
  const uploadId = upload?.id;

  const refreshTargets = (): void => {
    const id = selected.current;
    void context.api.read('/api/v2/automation/art/display-availability').then(parseTargets).then(value => {
      if (selected.current === id) setTargets(value);
    }).catch(() => {if (selected.current === id) setTargets(undefined);});
  };

  useEffect(() => () => {selected.current = undefined;}, []);
  useEffect(() => {
    if (uploadId === undefined || staging?.kind !== 'succeeded' || !context.connected) return;
    let current = true;
    void readConversationArtwork(context.api, {requestId: uploadId}).then(result => {
      if (!current) return;
      if (result.status === 'ready') setPreview(result);
      else setMessage('The attachment is unavailable. Select it again to continue.');
    }).catch(() => {if (current) setMessage('The attachment is unavailable. Select it again to continue.');});
    return () => {current = false;};
  }, [context.api, context.connected, staging?.kind, uploadId]);
  const hasShows = shows.length > 0;
  useEffect(() => {
    if (!context.connected || !hasShows) return;
    return followCopy<ArtShowEffects>((changed, options) => context.api.sync(['art-show-effects'], changed, options), {
      current: copy => {setEffects(copy.states().map(item => item.data));},
      changed: change => {
        if (change.type === 'updated') setEffects(values => [...values.filter(item => item.id !== change.message.data.id), change.message.data]);
        if (change.type === 'removed') setEffects(values => values.filter(item => item.id !== change.entity.id));
      },
      refused: () => {setEffects([]);},
    });
  }, [context.api, context.connected, hasShows]);

  const clear = (): void => {
    selected.current = undefined;
    setUpload(undefined); setPreview(undefined); setPreviewReady(false); setSaved(undefined); setShows([]); setEffects([]);
    setPicked([]); setTargets(undefined); setMessage(undefined);
  };
  const begin = (): void => {active.current = true; setInFlight(true);};
  const end = (): void => {active.current = false; setInFlight(false);};
  const stage = (files: FileList | readonly File[]): void => {
    if (!canAct || active.current) return;
    const file = files[0];
    if (file === undefined) return;
    clear();
    if (files.length !== 1) {setMessage('Select one image or GIF.'); return;}
    if (file.size === 0 || file.size > MAX_ART_ATTACHMENT_BYTES) {setMessage('Select a nonempty image or GIF up to 4 MB.'); return;}
    const requestId = crypto.randomUUID();
    const trace = childOf(undefined);
    selected.current = {id: requestId, trace};
    const action: FrontendUpload = {family: ART_ATTACHMENT_FAMILY, target: 'art', requestId, parent: trace, upload: {name: 'attachment', file}};
    setUpload({id: requestId});
    begin();
    refreshTargets();
    void context.api.upload(action).then(reply => {
      if (selected.current?.id === requestId && 'error' in reply) setUpload({id: requestId, error: reply.error.code});
    }).catch(() => {
      if (selected.current?.id === requestId) setUpload({id: requestId, error: 'uncertain-result'});
    }).finally(end);
  };
  const send = async (action: FrontendAction): Promise<Attempt> => {
    try {
      const reply = await context.api.command(action);
      return {id: action.requestId, ...('error' in reply ? {error: reply.error.code} : {})};
    } catch {
      return {id: action.requestId, error: 'uncertain-result'};
    }
  };
  const confirm = async (save: boolean, displays: string[]): Promise<void> => {
    if (!canAct || active.current || selected.current === undefined || !previewReady) return;
    const upload = selected.current, artworkId = uploadArtworkId(upload.id);
    begin();
    try {
      if (save) {
        const requestId = crypto.randomUUID();
        setSaved({id: requestId});
        const attempt = await send({family: ART_ATTACHMENT_FAMILY, target: 'art', requestId, data: {action: 'save', artworkId}, parent: upload.trace});
        if (selected.current === upload) setSaved(attempt);
      }
      if (displays.length > 0 && selected.current === upload) {
        const requestId = crypto.randomUUID(), surfaces = await artShowSurfaces(requestId, displays);
        if (selected.current !== upload) return;
        setShows(values => [...values, {attempt: {id: requestId}, surfaces}]);
        const attempt = await send({family: 'art-show', target: 'hub', requestId, data: {artworkId, targets: displays}, parent: upload.trace});
        if (selected.current === upload) setShows(values => values.map(item => item.attempt.id === requestId ? {attempt, surfaces} : item));
      }
    } finally {end();}
  };

  const targetReason = (target: Target): string | undefined => {
    if (target.unavailable !== undefined) return `Unavailable (${target.unavailable})`;
    if (preview !== undefined && !target.formats.includes(preview.displayFormat)) return 'This display does not support the attachment format.';
    return undefined;
  };
  const currentShows = new Map(shows.flatMap(show => show.surfaces.map(surface => [surface.target, {attempt: show.attempt, surface}] as const)));
  function displayResult(target: string): {result: Result; success: string} | undefined {
    const show = currentShows.get(target);
    if (show === undefined || show.surface.kind !== 'display') return undefined;
    const {attempt, surface} = show;
    const moment = operation(surface.momentRequestId), prep = operation(surface.prepareRequestId);
    const parent = outcome(operation(attempt.id), attempt.error);
    if (moment !== undefined) return {result: outcome(moment), success: moment.evidence === 'observed' ? 'Display reported the artwork' : 'Sent to the display'};
    const skipped = effects.find(entry => entry.requestId === attempt.id)?.skipped.find(entry => entry.target === target);
    if (skipped !== undefined) return {result: outcome(undefined, skipped.code), success: ''};
    const result = prep === undefined ? parent : outcome(prep);
    return {result: result.kind === 'succeeded' ? {kind: 'pending'} : result, success: ''};
  }
  const eligible = (targets ?? []).filter(target => targetReason(target) === undefined && !currentShows.has(target.id));
  const displayTargets = eligible.filter(target => picked.includes(target.id)).map(target => target.id);
  const canSave = previewReady && saved === undefined;
  const canDisplay = previewReady && displayTargets.length > 0;
  const fileDrop = (event: React.DragEvent): void => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    stage(event.dataTransfer.files);
  };

  return <div className="conversation-input-surface" onDragOver={event => {
    if (event.dataTransfer.types.includes('Files')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = canAct ? 'copy' : 'none';
    }
  }} onDrop={fileDrop}>
    <input ref={input} type="file" accept="image/png,image/jpeg,image/gif" hidden onChange={event => {
      if (event.currentTarget.files !== null) stage(event.currentTarget.files);
      event.currentTarget.value = '';
    }}/>
    {children(<button type="button" className="secondary" disabled={!canAct} onClick={() => {input.current?.click();}}>
      {upload === undefined ? 'Attach' : 'Replace attachment'}
    </button>)}
    {message !== undefined && <p role="alert">{message}</p>}
    {uploadId !== undefined && <section className="conversation-upload" aria-label="Artwork attachment">
      {preview !== undefined
        ? <ConversationImage key={uploadId} api={context.api} media={preview} description="Attached artwork" onReady={setPreviewReady}/>
        : staging !== undefined && <p role="status">{text(staging, 'Loading preview…')}</p>}
      <button type="button" className="secondary" onClick={clear} disabled={inFlight && (saved !== undefined || shows.length > 0)}>Remove attachment</button>
      {preview !== undefined && <>
        <fieldset disabled={!canAct}><legend>Display on</legend>
          {targets === undefined && <p role="status">Display availability is unknown.</p>}
          {targets?.length === 0 && <p role="status">No displays are configured for artwork.</p>}
          {targets?.map(target => {
            const reason = targetReason(target), result = displayResult(target.id);
            return <div key={target.id}><label>
              <input type="checkbox" checked={picked.includes(target.id)} disabled={reason !== undefined || result !== undefined}
                onChange={event => setPicked(previous => event.target.checked ? [...previous, target.id] : previous.filter(id => id !== target.id))}/>
              {target.label}
            </label>
            {reason !== undefined && <span> {reason}</span>}
            {result !== undefined && <span role="status"> {text(result.result, result.success)}</span>}
            {result?.result.kind === 'failed' && <button type="button" className="secondary" disabled={reason !== undefined}
              onClick={() => {void confirm(false, [target.id]);}}>Retry display on {target.label}</button>}</div>;
          })}
          <button type="button" className="secondary" onClick={refreshTargets}>Check displays</button>
        </fieldset>
        <div className="conversation-task-actions">
          <button type="button" disabled={!canAct || !canSave} onClick={() => {void confirm(true, []);}}>Save to library</button>
          <button type="button" disabled={!canAct || !canDisplay} onClick={() => {void confirm(false, displayTargets);}}>Display now</button>
          <button type="button" disabled={!canAct || !canSave || !canDisplay} onClick={() => {void confirm(true, displayTargets);}}>Display and save</button>
        </div>
        {saving !== undefined && <p role="status">Library. {text(saving, 'Saved to library.')}</p>}
        {saving?.kind === 'failed' && <button type="button" className="secondary" disabled={!canAct} onClick={() => {void confirm(true, []);}}>Retry save</button>}
      </>}
    </section>}
  </div>;
}
