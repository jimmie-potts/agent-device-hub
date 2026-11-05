import {errorBody, type ErrorBody} from '@jimmie-potts/event-contracts/v2';
import type {ModuleContent, ModuleContentRequest} from '@jimmie-potts/sdk';
import {readShowVersion, ShowFailure, SHOW_ERRORS} from '../music-shows.js';
import {SHOW_LIMITS, validShowId} from '../music-show-data.js';
import type {Db} from '../sqlite.js';

/** Authenticated immutable plan reads; the request selects no file, device, media or transport. */
export function showContent(db: Db, request?: ModuleContentRequest): ModuleContent | ErrorBody {
  const id = request?.query.showId, version = request?.query.version;
  if (request === undefined || Object.keys(request.query).length !== 2 || !validShowId(id)
      || typeof version !== 'string' || !/^[1-9][0-9]{0,2}$/.test(version) || Number(version) > SHOW_LIMITS.versions) {
    return errorBody('invalid-request', {detail: SHOW_ERRORS['invalid-request']});
  }
  if (request.signal.aborted) return errorBody('cancelled', {detail: 'The show read ended.'});
  try {
    const saved = readShowVersion(db, id, Number(version));
    return {type: 'application/json', bytes: Buffer.from(JSON.stringify(saved))};
  } catch (error) {
    if (error instanceof ShowFailure) return errorBody(error.code, {detail: SHOW_ERRORS[error.code]});
    return errorBody('unavailable', {detail: 'The private show library cannot be read.'});
  }
}
