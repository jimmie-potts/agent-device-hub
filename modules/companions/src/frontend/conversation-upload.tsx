import React, {useEffect, useRef, useState, type ReactNode} from 'react';
import type {ErrorCode} from '@jimmie-potts/event-contracts/v2/errors';
import {ART_ATTACHMENT_FAMILY, MAX_ART_ATTACHMENT_BYTES} from '@jimmie-potts/event-contracts/v2/art-show';
import type {FrontendContext} from '@jimmie-potts/sdk/frontend';
import {childOf} from '@jimmie-potts/sdk/remote';
import {ConversationImage, readConversationArtwork, type Media} from './conversation-art.js';

type Draft = {requestId: string; parent: ReturnType<typeof childOf>};
type Stage = {draft: Draft; error?: ErrorCode};
type ComposerArtwork = {attach: ReactNode; draft?: Draft; hasAttachment: boolean; submitted: (requestId: string) => void};

function failure(code: ErrorCode | undefined): string {
  if (code === 'too-large') return 'The attachment exceeds the byte, pixel or frame limit.';
  if (code === 'invalid-request' || code === 'unsupported-capability') return 'This image or animation could not be used.';
  if (code === 'uncertain-result') return 'Couldn’t confirm the upload. Choose the file again to retry.';
  return code === undefined ? 'The attachment is unavailable. Choose the file again.' : `Couldn’t load the attachment (${code}).`;
}

export function ConversationUpload({context, locked, commandLocked, onSent, children}: {
  context: FrontendContext; locked: boolean; commandLocked: boolean; onSent: () => void; children: (artwork: ComposerArtwork) => ReactNode;
}): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const active = useRef<string | undefined>(undefined);
  const [stage, setStage] = useState<Stage>();
  const [media, setMedia] = useState<Media>();
  const [previewReady, setPreviewReady] = useState(false);
  const [message, setMessage] = useState<string>();
  const [submission, setSubmission] = useState<string>();
  const uploadId = stage?.draft.requestId;
  const staged = context.operations.find(item => item.requestId === uploadId);
  const sent = context.operations.find(item => item.requestId === submission);
  const sending = submission !== undefined && (sent === undefined ? commandLocked
    : sent.status !== 'rejected' && sent.status !== 'expired' && !(sent.status === 'completed' && sent.result === 'failed'));

  const clear = (): void => {
    active.current = undefined;
    setStage(undefined);
    setMedia(undefined);
    setPreviewReady(false);
    setMessage(undefined);
    setSubmission(undefined);
  };
  useEffect(() => {
    if (sent?.status !== 'completed' || sent.result !== 'succeeded') return;
    clear();
    onSent();
  }, [sent?.status, sent?.result, onSent]);

  const ready = staged?.status === 'completed' && staged.result === 'succeeded';
  useEffect(() => {
    if (uploadId === undefined || !ready || !context.connected) return;
    let current = true;
    void readConversationArtwork(context.api, {requestId: uploadId}).then(result => {
      if (!current) return;
      if (result.status === 'ready') setMedia(result);
      else setMessage(failure(undefined));
    }).catch(() => {if (current) setMessage(failure(undefined));});
    return () => {current = false;};
  }, [context.api, context.connected, ready, uploadId]);

  const attachFiles = (files: FileList): void => {
    if (locked || sending || files.length === 0) return;
    clear();
    const file = files[0];
    if (files.length !== 1 || file === undefined) {setMessage('Select one image or GIF.'); return;}
    if (file.size === 0 || file.size > MAX_ART_ATTACHMENT_BYTES) {setMessage('Select a nonempty image or GIF up to 4 MB.'); return;}
    const requestId = crypto.randomUUID();
    const draft = {requestId, parent: childOf(undefined)};
    active.current = requestId;
    setStage({draft});
    void context.api.upload({family: ART_ATTACHMENT_FAMILY, target: 'art', requestId, parent: draft.parent,
      upload: {name: 'attachment', file}}).then(result => {
      if (active.current === requestId && 'error' in result) setStage({draft, error: result.error.code});
    }).catch(() => {
      if (active.current === requestId) setStage({draft, error: 'uncertain-result'});
    });
  };
  const rejected = staged?.status === 'rejected' || staged?.status === 'uncertain' || staged?.status === 'expired' ||
    (staged?.status === 'completed' && staged.result !== 'succeeded');
  const error = stage?.error ?? (rejected ? staged.error?.code ?? (staged.status === 'uncertain' ? 'uncertain-result' : 'unavailable') : undefined);
  const attach = <button type="button" className="secondary" disabled={locked || sending} onClick={() => {input.current?.click();}}>
    {stage === undefined ? 'Attach' : 'Replace attachment'}
  </button>;
  return <div className="conversation-input-surface" onDragOver={event => {
    if (event.dataTransfer.types.includes('Files')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = locked || sending ? 'none' : 'copy';
    }
  }} onDrop={event => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    attachFiles(event.dataTransfer.files);
  }}>
    <input ref={input} type="file" accept="image/png,image/jpeg,image/gif" hidden onChange={event => {
      if (event.currentTarget.files !== null) attachFiles(event.currentTarget.files);
      event.currentTarget.value = '';
    }}/>
    {children({attach, hasAttachment: stage !== undefined,
      ...(stage === undefined || !previewReady || sending ? {} : {draft: stage.draft}), submitted: setSubmission})}
    {message !== undefined && <p role="alert">{message}</p>}
    {stage !== undefined && <section className="conversation-upload" aria-label="Artwork attachment">
      {media === undefined ? <p role="status">{error === undefined ? 'Loading preview…' : failure(error)}</p>
        : <ConversationImage key={uploadId} api={context.api} media={media} description="Attached artwork" onReady={setPreviewReady}/>}
      <button type="button" className="secondary" onClick={clear} disabled={sending}>Remove attachment</button>
    </section>}
  </div>;
}
