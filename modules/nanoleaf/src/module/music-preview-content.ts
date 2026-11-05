import {errorBody, type ErrorBody} from '@jimmie-potts/event-contracts/v2';
import type {ModuleContent, ModuleContentRequest} from '@jimmie-potts/sdk';
import {MUSIC_PREVIEW_LIMITS} from '../music-preview-data.js';
import {prepareMusicPreview} from '../music-preview.js';

const invalid = (): ErrorBody => errorBody('invalid-request', {detail: 'Choose a supported Music effect, palette, intensity and example model.'});
const cancelled = (): ErrorBody => errorBody('cancelled', {detail: 'The Music preview read ended.'});

/** Existing authenticated module content; the query selects no source, file or device. */
export function musicPreviewContent(request?: ModuleContentRequest): ModuleContent | ErrorBody {
  if (request === undefined) return invalid();
  if (request.signal.aborted) return cancelled();
  const text = request.query.request;
  if (Object.keys(request.query).length !== 1 || typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MUSIC_PREVIEW_LIMITS.requestBytes)
    return invalid();
  let value: unknown;
  try {value = JSON.parse(text);} catch {return invalid();}
  try {
    const bytes = Buffer.from(JSON.stringify(prepareMusicPreview(value)));
    if (request.signal.aborted) return cancelled();
    if (bytes.byteLength > MUSIC_PREVIEW_LIMITS.responseBytes) throw new Error('Music preview exceeded its bound.');
    return {type: 'application/json', bytes};
  } catch (error) {
    return error instanceof TypeError ? invalid() : errorBody('unavailable', {detail: 'The synthetic Music preview is unavailable.'});
  }
}
