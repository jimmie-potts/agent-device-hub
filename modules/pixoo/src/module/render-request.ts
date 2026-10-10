import type {ErrorCode} from '@jimmie-potts/event-contracts/v2';
import type {PlaybackArtwork} from '@jimmie-potts/event-contracts/v2/families';
import type {NowPlayingView} from '../core/index.js';
import type {DashboardLayout} from '../presentation/agent-dashboard.js';
import {renderDashboard} from '../presentation/dashboard-pixels.js';
import {renderArtworkCard} from '../presentation/artwork-card.js';
export type RenderRequest = {kind: 'dashboard'; layout: DashboardLayout}
  | {kind: 'card'; view: Extract<NowPlayingView, {card: true}>; artwork?: PlaybackArtwork};
export type RenderReply = {frames: Uint8Array[]; artworkCode?: ErrorCode};
export async function renderRequest(request: RenderRequest): Promise<RenderReply> {
  if (request.kind === 'dashboard') return {frames: renderDashboard(request.layout)};
  const card = await renderArtworkCard(request.view, request.artwork);
  return {frames: [card.frame], ...(card.artworkCode === undefined ? {} : {artworkCode: card.artworkCode})};
}
