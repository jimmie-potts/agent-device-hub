import {isAbsolute} from 'node:path';
import {Ajv2020} from 'ajv/dist/2020.js';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {SdkError} from '@jimmie-potts/sdk';
import {privateText} from './configuration.js';

type PlaybackConfiguration = {schema: 'music-playback-producer/1.0'; edgeOrigin: string; tokenFile: string; helper: string; libraryScopeId: string};
const validate = new Ajv2020({strict: true}).compile<PlaybackConfiguration>({type: 'object', additionalProperties: false,
  required: ['schema', 'edgeOrigin', 'tokenFile', 'helper', 'libraryScopeId'], properties: {
    schema: {const: 'music-playback-producer/1.0'}, edgeOrigin: {type: 'string', minLength: 1, maxLength: 2048},
    tokenFile: {type: 'string', minLength: 1, maxLength: 4096}, helper: {type: 'string', minLength: 1, maxLength: 4096},
    libraryScopeId: {type: 'string', pattern: '^[a-z0-9]+(-[a-z0-9]+)*$', maxLength: 128},
  }});
export async function loadPlaybackConfiguration(file: string): Promise<PlaybackConfiguration & {token: string}> {
  try {
    const value: unknown = JSON.parse(await privateText(file, 8192));
    if (!validate(value) || !isAbsolute(value.tokenFile) || !isAbsolute(value.helper)) throw new Error();
    const origin = new URL(value.edgeOrigin);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username !== '' || origin.password !== '' || origin.pathname !== '/' ||
      origin.search !== '' || origin.hash !== '') throw new Error();
    const token = (await privateText(value.tokenFile, 512)).replace(/\r?\n$/, '');
    if (!/^[\x21-\x7e]{16,512}$/.test(token)) throw new Error();
    return {...value, edgeOrigin: origin.origin, token};
  } catch {throw new SdkError(errorBody('invalid-request', {detail: 'Music playback producer configuration is invalid.'}));}
}
