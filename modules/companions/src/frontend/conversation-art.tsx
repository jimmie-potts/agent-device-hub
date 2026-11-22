import React, {useEffect, useRef, useState} from 'react';
import {isErrorCode} from '@jimmie-potts/event-contracts/v2/errors';
import type {ArtRecord, ArtTarget} from '@jimmie-potts/event-contracts/v2/art-state';
import type {FrontendApi, FrontendContext} from '@jimmie-potts/sdk/frontend';
import {followCopy} from '@jimmie-potts/sdk/remote';
import type {ConversationAttachment} from '../assistant/history-contract.js';
import {AttachmentDisplay} from './attachment-display.js';

export function useConversationArt(api: FrontendApi, live: boolean): ArtRecord | undefined {
  const [art, setArt] = useState<ArtRecord>();
  useEffect(() => {
    if (!live) return;
    return followCopy<ArtRecord>((changed, options) => api.sync(['art'], changed, options), {
      changed: change => {
        if (change.type === 'updated') setArt(change.message.data);
        if (change.type === 'removed') setArt(undefined);
      },
      current: copy => {setArt(copy.states().find(message => message.data.id === 'art')?.data);},
      refused: () => {setArt(undefined);},
    });
  }, [api, live]);
  return live ? art : undefined;
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
type Media = {status: 'ready'; path: string; bytes: number; format: 'webp' | 'gif'; artworkId: string; usableKinds: ArtTarget[]};
type Result = Media | {status: 'loading' | 'pending' | 'unavailable'} | {status: 'finished'; text: string};
function resultOf(value: unknown): Result {
  if (!record(value)) return {status: 'unavailable'};
  if (value.status === 'pending') return {status: 'pending'};
  if (value.status === 'finished') {
    const outcome = value.outcome === 'uncertain' ? 'Generation outcome is uncertain'
      : value.outcome === 'cancelled' ? 'Generation was cancelled' : 'Artwork could not be created';
    return {status: 'finished', text: isErrorCode(value.code) ? `${outcome} (${value.code}).` : `${outcome}.`};
  }
  const rendition = value.rendition;
  if (value.status !== 'ready' || !record(rendition) || (rendition.format !== 'gif' && rendition.format !== 'webp') ||
    typeof rendition.renditionId !== 'string' || !/^[a-f0-9]{64}$/.test(rendition.renditionId) ||
    typeof rendition.bytes !== 'number' || !Number.isSafeInteger(rendition.bytes) || rendition.bytes < 1) return {status: 'unavailable'};
  if (typeof value.artworkId !== 'string') return {status: 'unavailable'};
  const kinds = value.usableKinds;
  const usableKinds = Array.isArray(kinds) && kinds.every((kind): kind is ArtTarget => kind === 'ui' || kind === 'pixoo' || kind === 'tidbyt') ? kinds : [];
  return {status: 'ready', path: `/modules/art/content/rendition.${rendition.renditionId}`, bytes: rendition.bytes, format: rendition.format, artworkId: value.artworkId, usableKinds};
}

function ConversationImage({api, media, description}: {api: FrontendApi; media: Media; description: string}): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState(false), [failed, setFailed] = useState(false), [playing, setPlaying] = useState(false);
  const {path, format, bytes} = media;
  useEffect(() => {
    let live = true;
    void api.image(path).then(blob => {
      if (blob.size !== bytes || blob.type !== `image/${format}`) throw new Error('invalid-image');
      return createImageBitmap(blob);
    }).then(bitmap => {
      try {
        if (!live || canvas.current === null) return;
        const node = canvas.current;
        node.width = bitmap.width; node.height = bitmap.height;
        const ctx = node.getContext('2d');
        if (ctx === null) throw new Error('image-unavailable');
        ctx.drawImage(bitmap, 0, 0);
        setLoaded(true);
      } finally {bitmap.close();}
    }).catch(() => {if (live) setFailed(true);});
    return () => {live = false;};
  }, [api, path, bytes, format]);
  return <figure className="conversation-artwork">
    <canvas ref={canvas} role="img" aria-label={description} hidden={!loaded || failed || playing}/>
    {loaded && !failed && playing && <img src={path} alt={description} onError={() => {setPlaying(false); setFailed(true);}}/>}
    {loaded && !failed && format === 'gif' && <button type="button" className="secondary" onClick={() => {setPlaying(value => !value);}}>
      {playing ? 'Pause animation' : 'Play animation'}
    </button>}
    {failed && <figcaption role="status">Artwork attachment is unavailable.</figcaption>}
  </figure>;
}

export function ArtworkAttachment({context, connected, allowShow, attachment, artRevision}: {
  context: FrontendContext; connected: boolean; allowShow: boolean; attachment: ConversationAttachment; artRevision: number | undefined;
}): React.JSX.Element {
  const {api} = context;
  const [result, setResult] = useState<Result>({status: 'loading'});
  const {requestId, description, admission, code} = attachment;
  // An older job can fall out of the recent list while still running. Until the
  // private read settles, try it again on a publication, even if the list omits it.
  const follow = result.status === 'pending' || result.status === 'loading' || (result.status === 'unavailable' && admission !== 'accepted');
  const pendingRevision = follow ? artRevision : undefined;
  useEffect(() => {
    if (!connected || admission === 'refused') return;
    let current = true;
    void api.read(`/modules/art/content/conversation.${requestId}`).then(value => {
      if (current) setResult(resultOf(value));
    }).catch(() => {if (current) setResult({status: 'unavailable'});});
    return () => {current = false;};
  }, [api, requestId, connected, admission, pendingRevision]);
  if (admission === 'refused') return <p role="status">Artwork request was refused{code === undefined ? '.' : ` (${code}).`}</p>;
  if (connected && result.status === 'unavailable' && admission === 'uncertain') return <p role="status">Artwork request outcome is uncertain.</p>;
  if (connected && result.status === 'unavailable' && admission === 'pending') return <p role="status">Waiting for artwork…</p>;
  if (!connected || result.status === 'unavailable') return <p role="status">Artwork attachment is unavailable.</p>;
  if (result.status === 'ready') return <>
    <ConversationImage key={result.path} api={api} media={result} description={description}/>
    {allowShow && <AttachmentDisplay context={context} artworkId={result.artworkId} usableKinds={result.usableKinds} attachment={attachment}/>}
  </>;
  return <p role="status">{result.status === 'finished' ? result.text : 'Waiting for artwork…'}</p>;
}
