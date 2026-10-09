// Cached Monitor and Now Playing reads adapt the existing legacy Monitor view without activating its presentation (Hub #932).
import {errorBody, type ErrorBody, type ErrorCode} from '@jimmie-potts/event-contracts/v2';
import type {SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {ModuleContent, ModuleContentRequest} from '@jimmie-potts/sdk';
import sharp from 'sharp';
import {z} from 'zod';
import type {MonitorPresentation} from '../presentation/monitor-presentation.js';
import {monitorSession, type MonitorSession, type PlaybackSourceStatus} from '../presentation/sources.js';
import {MAX_JSON_BYTES} from './content.js';

export type MonitorContentInput = {monitor: MonitorPresentation; sessions: readonly SessionRecord[]; playback: PlaybackSourceStatus};
export type MonitorSessionRow = MonitorSession & {id: string};
export type MonitorReading = {
  status: ReturnType<MonitorPresentation['status']>;
  rendition: {state: 'closed' | 'error' | 'current' | 'pending'; generation: number | null; frameCount: number; frameDelayMs: number | null; frames: string[]};
  playback: PlaybackSourceStatus & {frame: string | null};
};
export type MonitorSessionPage = {items: MonitorSessionRow[]; total: number; offset: number; limit: number};
const decimal = z.string().regex(/^(0|[1-9][0-9]*)$/).transform(Number).pipe(z.number().int().max(Number.MAX_SAFE_INTEGER));
const pageQuery = z.object({q: z.string().max(120).default(''), offset: decimal.default(0), limit: decimal.pipe(z.number().min(1).max(100)).default(25)}).strict();
const emptyQuery = z.object({}).strict();
const refuse = (code: ErrorCode): ErrorBody => errorBody(code, {detail: 'the Pixoo Monitor read was refused'});
const json = (data: unknown): ModuleContent | ErrorBody => {
  const bytes = Buffer.from(JSON.stringify(data));
  return bytes.byteLength > MAX_JSON_BYTES ? refuse('too-large') : {type: 'application/json', bytes};
};
const cancelled = (signal: AbortSignal | undefined): ErrorBody | undefined => signal?.aborted === true
  ? refuse((signal.reason as {name?: unknown} | undefined)?.name === 'TimeoutError' ? 'unavailable' : 'cancelled') : undefined;

/** Closed references encode only cached pixels. Session pages project at most the requested number of existing records. */
export async function readMonitorContent({monitor, sessions, playback}: MonitorContentInput, ref: string,
  request?: ModuleContentRequest): Promise<ModuleContent | ErrorBody> {
  const aborted = cancelled(request?.signal); if (aborted !== undefined) return aborted;
  const query = request?.query ?? {};
  if (ref === 'monitor-sessions') {
    const parsed = pageQuery.safeParse(query); if (!parsed.success) return refuse('invalid-request');
    const {q, offset, limit} = parsed.data, needle = q.trim().toLocaleLowerCase();
    const matches = needle === '' ? sessions : sessions.filter(record => [record.label?.value, record.title?.value, record.project, record.identity.sessionId]
      .some(value => value?.toLocaleLowerCase().includes(needle) === true));
    return json({items: matches.slice(offset, offset + limit).map(record => ({id: record.id, ...monitorSession(record)})), total: matches.length, offset, limit} satisfies MonitorSessionPage);
  }
  if (!emptyQuery.safeParse(query).success) return refuse('invalid-request');
  if (ref === 'monitor') {
    const cached = monitor.rendition(), rendition = cached.rendition;
    const state = cached.state;
    if (state !== 'closed' && state !== 'error' && state !== 'current' && state !== 'pending') return refuse('internal');
    return json({status: monitor.status(), rendition: {state, generation: rendition?.generation ?? null,
      frameCount: rendition?.frames.length ?? 0, frameDelayMs: rendition?.frameDelayMs ?? null,
      frames: rendition?.frames.map((_, index) => `monitor-frame.${rendition.generation}.${index}`) ?? []},
    playback: {...structuredClone(playback), frame: monitor.cachedCard() === null ? null : 'now-playing-frame'}} satisfies MonitorReading);
  }
  let rgb: Uint8Array | undefined;
  if (ref === 'now-playing-frame') rgb = monitor.cachedCard() ?? undefined;
  else if (ref.startsWith('monitor-frame.')) {
    const match = /^monitor-frame\.(0|[1-9][0-9]*)\.([01])$/.exec(ref);
    if (match === null) return refuse('invalid-request');
    const rendition = monitor.rendition().rendition;
    if (rendition?.generation === Number(match[1])) {
      const frame = rendition.frames[Number(match[2])];
      if (frame !== undefined) rgb = Uint8Array.from(frame);
    }
  } else return refuse('not-found');
  if (rgb === undefined) return refuse('not-found');
  if (rgb.byteLength !== 12288) return refuse('internal');
  const bytes = await sharp(rgb, {raw: {width: 64, height: 64, channels: 3}}).png().toBuffer();
  const ended = cancelled(request?.signal); if (ended !== undefined) return ended;
  return bytes.byteLength <= 64 * 1024 ? {type: 'image/png', bytes} : refuse('too-large');
}
