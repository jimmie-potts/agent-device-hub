import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {Ajv2020} from 'ajv/dist/2020.js';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {CAPTURE_MICROPHONE_ID} from '@jimmie-potts/event-contracts/v2/music-capture';
import {SdkError} from '@jimmie-potts/sdk';

export type ConfiguredMicrophone = {id: string; uid: string};
type Configuration = {edgeOrigin: string; tokenFile: string; helper: string} &
  ({schema: 'music-producer/1.0'; microphone?: never} | {schema: 'music-producer/1.1'; microphone?: ConfiguredMicrophone});
const properties = {edgeOrigin: {type: 'string', minLength: 1, maxLength: 2048},
  tokenFile: {type: 'string', minLength: 1, maxLength: 4096}, helper: {type: 'string', minLength: 1, maxLength: 4096}};
const validate = new Ajv2020({allErrors: false}).compile<Configuration>({oneOf: ['1.0', '1.1'].map(version => ({
  type: 'object', additionalProperties: false, required: ['schema', 'edgeOrigin', 'tokenFile', 'helper'],
  properties: {...properties, schema: {const: `music-producer/${version}`}, ...(version === '1.0' ? {} : {
    microphone: {type: 'object', additionalProperties: false, required: ['id', 'uid'], properties: {
      id: {type: 'string', pattern: CAPTURE_MICROPHONE_ID.source}, uid: {type: 'string', minLength: 1, maxLength: 1024},
    }},
  })},
}))});
const refusal = (): SdkError => new SdkError(errorBody('invalid-request', {detail: 'Music producer configuration is invalid.'}));

/** Read once from an owner-only regular file; a growing file cannot expand the allocation. */
async function privateText(file: string, maximum: number): Promise<string> {
  if (!isAbsolute(file)) throw refusal();
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0 || stat.size > maximum) throw refusal();
    const bytes = Buffer.alloc(maximum + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const {bytesRead} = await handle.read(bytes, offset, bytes.length - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > maximum) throw refusal();
    return new TextDecoder('utf-8', {fatal: true}).decode(bytes.subarray(0, offset));
  } finally {await handle.close();}
}

export async function loadConfiguration(file: string): Promise<Configuration & {token: string}> {
  try {
    const value: unknown = JSON.parse(await privateText(file, 8192));
    if (!validate(value) || !isAbsolute(value.tokenFile) || !isAbsolute(value.helper)) throw refusal();
    if (value.microphone !== undefined && Buffer.byteLength(value.microphone.uid, 'utf8') > 1024) throw refusal();
    const origin = new URL(value.edgeOrigin);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username !== '' || origin.password !== '' ||
      origin.pathname !== '/' || origin.search !== '' || origin.hash !== '') throw refusal();
    const token = (await privateText(value.tokenFile, 512)).replace(/\r?\n$/, '');
    if (!/^[\x21-\x7e]{16,512}$/.test(token)) throw refusal();
    return {...value, edgeOrigin: origin.origin, token};
  } catch {throw refusal();}
}
