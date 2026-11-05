import type {ErrorCode} from '@jimmie-potts/event-contracts/v2';
import type {PlaybackArtwork} from '@jimmie-potts/event-contracts/v2/families';
import type {NowPlayingView} from '../core/index.js';
import type {DashboardLayout} from '../presentation/agent-dashboard.js';
import {renderDashboard} from '../presentation/dashboard-pixels.js';
import {renderArtworkCard} from '../presentation/artwork-card.js';
import {renderMomentContent, type MomentContent} from '../presentation/moment-content.js';
import {artNoticeFrames} from '../presentation/art-notice.js';
import type {RainNotice} from '@jimmie-potts/event-contracts/v2/art-notice';
export type RenderRequest = {kind: 'dashboard'; layout: DashboardLayout}
  | {kind: 'card'; view: Extract<NowPlayingView, {card: true}>; artwork?: PlaybackArtwork}
  | {kind: 'moment'; content: MomentContent | {kind: 'art-notice'; frames: readonly Uint8Array[]; notice: RainNotice}};
export type RenderReply = {frames: Uint8Array[]; artworkCode?: ErrorCode};
export async function renderRequest(request: RenderRequest): Promise<RenderReply> {
  if (request.kind === 'dashboard') return {frames: renderDashboard(request.layout)};
  if (request.kind === 'moment') return {frames: request.content.kind === 'art-notice' ? artNoticeFrames(request.content.frames, request.content.notice) : renderMomentContent(request.content)};
  const card = await renderArtworkCard(request.view, request.artwork);
  return {frames: [card.frame], ...(card.artworkCode === undefined ? {} : {artworkCode: card.artworkCode})};
}
