import type {ErrorCode} from '@jimmie-potts/event-contracts/v2';
import type {PlaybackArtwork} from '@jimmie-potts/event-contracts/v2/families';
// What the render worker draws (Hub #930): one tile's view as its 64x32 frame, encoded as lossless WebP. The module
// sends the view to a worker thread (`render-worker.ts`) so drawing and encoding stay off the runtime's event loop; the
// same function runs in process in the tests.
import {nowPlayingFrame, type CardView} from './nowplaying.js';
import {renderFrame, type Frame} from './render.js';
import {statusFrame, type StatusView} from './status.js';

/** One render: the status tile's view, or a now-playing card. */
export type TileRequest = {tile: 'status'; view: StatusView} | {tile: 'now-playing'; view: CardView; artwork?: PlaybackArtwork};
/** The worker's one reply. */
export type TileReply = {ok: true; webp: Uint8Array; artworkCode?: ErrorCode} | {ok: false};

/** The frame a tile's view draws. */
export function tileFrame(request: TileRequest): Frame {
  switch (request.tile) {
    case 'status':
      return statusFrame(request.view);
    case 'now-playing':
      return nowPlayingFrame(request.view);
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Draws and encodes one tile. A request that is not a tile's view gets `{ok: false}`. */
export function renderTile(request: unknown): TileReply {
  if (!isObject(request) || (request.tile !== 'status' && request.tile !== 'now-playing') || !isObject(request.view)) return {ok: false};
  const rendered = renderFrame(tileFrame(request as TileRequest));
  return rendered.ok ? {ok: true, webp: rendered.webp} : {ok: false};
}

/** The worker's asynchronous artwork path; the old synchronous text path is unchanged. */
export async function renderArtworkTile(request: unknown): Promise<TileReply> {
  if (!isObject(request) || request.tile !== 'now-playing') return renderTile(request);
  if (!isObject(request.view)) return {ok: false};
  // The public package exports text helpers too; native decoding loads only when this worker path runs.
  const {renderArtworkCard} = await import('./artwork-card.js');
  const card = await renderArtworkCard(request.view as CardView, request.artwork as PlaybackArtwork | undefined);
  const rendered = renderFrame(card.frame);
  return rendered.ok ? {ok: true, webp: rendered.webp, ...(card.artworkCode === undefined ? {} : {artworkCode: card.artworkCode})} : {ok: false};
}
