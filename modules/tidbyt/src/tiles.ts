// What the render worker draws (Hub #930): one tile's view as its 64x32 frame, encoded as lossless WebP. The module
// sends the view to a worker thread (`render-worker.ts`) so drawing and encoding stay off the runtime's event loop; the
// same function runs in process in the tests.
import {nowPlayingFrame, type CardView} from './nowplaying.js';
import {renderFrame, type Frame} from './render.js';
import {statusFrame, type StatusView} from './status.js';

/** One render: the status tile's view, or a now-playing card. */
export type TileRequest = {tile: 'status'; view: StatusView} | {tile: 'now-playing'; view: CardView};
/** The worker's one reply. */
export type TileReply = {ok: true; webp: Uint8Array} | {ok: false};

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
