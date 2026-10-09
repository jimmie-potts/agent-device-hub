// API 1.3 content reads reuse the library's catalog and immutable preview readers. GET never validates hosted frames.
import {errorBody, type ErrorBody, type ErrorCode} from '@jimmie-potts/event-contracts/v2';
import type {ModuleContent, ModuleContentRequest} from '@jimmie-potts/sdk';
import {LibraryError, type Library} from '../library/index.js';
import {hashSchema, idSchema} from '../library/contracts.js';
import {MediaError, type MediaProfile} from '../media/index.js';
import {z} from 'zod';

export const MAX_JSON_BYTES = 256 * 1024;
const MAX_PNG_BYTES = 64 * 1024;
const decimal = z.string().regex(/^(0|[1-9][0-9]*)$/).transform(Number).pipe(z.number().int().max(Number.MAX_SAFE_INTEGER));
const pageQuery = z.object({q: z.string().max(120).default(''), offset: decimal.default(0), limit: decimal.pipe(z.number().min(1).max(100)).default(25)}).strict();
const emptyQuery = z.object({}).strict();
const refuse = (code: ErrorCode): ErrorBody => errorBody(code, {detail: 'the Pixoo content read was refused'});
const json = (value: unknown): ModuleContent | ErrorBody => {
  const bytes = Buffer.from(JSON.stringify(value));
  return bytes.byteLength > MAX_JSON_BYTES ? refuse('too-large') : {type: 'application/json', bytes};
};
function domainRefusal(error: LibraryError | MediaError): ErrorBody {
  const codes: Partial<Record<LibraryError['code'] | MediaError['code'], ErrorCode>> = {
    'invalid-input': 'invalid-request', 'not-found': 'not-found', cancelled: 'cancelled',
    timeout: 'unavailable', closed: 'unavailable', busy: 'capacity',
  };
  return refuse(codes[error.code] ?? 'internal');
}

/** Closed flat references on the existing content route, with expected domain errors returned rather than thrown. */
export async function readPixooContent(library: Library, profile: Readonly<MediaProfile>, ref: string,
  request?: ModuleContentRequest, stillDelayMs = 100): Promise<ModuleContent | ErrorBody> {
  const query = request?.query ?? {};
  const signal = request?.signal;
  if (signal?.aborted === true) return refuse((signal.reason as {name?: unknown} | undefined)?.name === 'TimeoutError' ? 'unavailable' : 'cancelled');
  try {
    if (ref === 'catalog-media' || ref === 'catalog-playlists') {
      const parsed = pageQuery.safeParse(query);
      if (!parsed.success) return refuse('invalid-request');
      return json(ref === 'catalog-media' ? await library.queryMediaCached(parsed.data, profile, stillDelayMs, signal)
        : await library.queryPlaylists(parsed.data, true, signal));
    }
    if (!emptyQuery.safeParse(query).success) return refuse('invalid-request');
    const [kind, id, index, ...extra] = ref.split('.');
    if (kind === 'playlist' || kind === 'asset') {
      if (!idSchema.safeParse(id).success || index !== undefined || extra.length > 0) return refuse('invalid-request');
      return json(kind === 'playlist' ? await library.catalogPlaylist(id as string, signal) : await library.catalogAsset(id as string, signal));
    }
    if (kind === 'rendition' || kind === 'preview' || kind === 'frame' || kind === 'thumbnail') {
      if (!hashSchema.safeParse(id).success || extra.length > 0) return refuse('invalid-request');
      if (kind === 'frame' ? index === undefined || !/^(0|[1-9][0-9]{0,3})$/.test(index) : index !== undefined) return refuse('invalid-request');
      const loaded = await library.preview(id as string, kind === 'frame' ? Number(index) : kind === 'thumbnail' ? 0 : null, signal);
      const rendition = loaded.rendition;
      if (kind === 'rendition') return json(rendition);
      if (kind === 'preview') return json({renditionId: rendition.id, width: 64, height: 64, frameCount: rendition.frames.length,
        durationMs: rendition.effectiveDurationMs, frames: rendition.frames.map(({index, delayMs}) => ({index, delayMs})), warnings: rendition.warnings});
      const bytes = loaded.bytes;
      return bytes === undefined || bytes.byteLength > MAX_PNG_BYTES ? refuse('internal') : {type: 'image/png', bytes};
    }
    return refuse('not-found');
  } catch (error) {
    if (error instanceof LibraryError || error instanceof MediaError) return domainRefusal(error);
    throw error;
  }
}
