// Existing player facts for the module's bounded read-only content route (Hub #932).
import {errorBody, type ErrorBody} from '@jimmie-potts/event-contracts/v2';
import type {ModuleContent} from '@jimmie-potts/sdk';
import type {Player} from '../playback/index.js';
import {MAX_JSON_BYTES} from './content.js';

export function playerContent(player: Player, sampledAtMs: number, simulated: boolean): ModuleContent | ErrorBody {
  if (!Number.isFinite(sampledAtMs) || sampledAtMs < 0) return errorBody('invalid-request', {detail: 'the Pixoo player read was refused'});
  const bytes = Buffer.from(JSON.stringify({state: player.getState(), session: player.getSession(), sampledAtMs, simulated}));
  return bytes.byteLength > MAX_JSON_BYTES ? errorBody('too-large', {detail: 'the Pixoo player read was refused'})
    : {type: 'application/json', bytes};
}
