import type {MediaAction} from '@jimmie-potts/event-contracts/v2/devices';
import type {DisplayRecord} from '../module/schemas.js';
import type {Reading} from './player.js';

/**
 * Whether a playback control stays live while the card re-reads its player (#2124). The card then shows the read it
 * holds, while the display record it already has is newer. The server checks only the device record's guards, which
 * publish with that newer display record, so a press is admitted against the newer state. A control stays live only
 * when the command it would send is still the right one for the newer record:
 *
 * | Control                 | Live during a re-read when                                                         |
 * | ----------------------- | ---------------------------------------------------------------------------------- |
 * | Pause                   | always: it names an absolute state and repeating it changes nothing               |
 * | Resume                  | the record's player neither plays nor starts (intent not active), shows the same   |
 * |                         | playlist, item and rendition as the read, and has the same last error              |
 * | Next, Previous          | the record shows the same playlist, item and rendition as the read                 |
 * | Restart with changes    | never: the record carries no session identity or playlist revision to compare     |
 * | Stop, Clear             | never                                                                              |
 *
 * Screen on and off and brightness send absolute values guarded by the device record, and Play playlist and Play
 * selected media send what the person selected; none of them is decided here. A control this refuses stays disabled
 * under the label the card shows until the read lands, when its label, its command and this decision change together.
 */
export function liveDuringRefresh(action: MediaAction, reading: Reading, player: DisplayRecord['player']): boolean {
  const {state, session} = reading;
  const playlistId = session === null || session.source?.kind === 'media' ? null : session.playlist.id;
  const renditionId = session?.playlist.items.find(item => item.id === state.itemId)?.renditionId ?? null;
  const sameItem = player.playlistId === playlistId && player.itemId === state.itemId && player.renditionId === renditionId;
  switch (action) {
    case 'pause': return true;
    case 'resume': return player.intent !== 'active' && player.state !== 'playing' && sameItem && player.lastError === (state.lastError?.code ?? null);
    case 'next': case 'previous': return sameItem;
    case 'restart-with-changes': case 'stop': case 'clear': return false;
  }
}
