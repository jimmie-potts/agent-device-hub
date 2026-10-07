// The Codex Desktop marker reader's own process (Hub #926), which `folderReader` forks: each message names a Codex home
// and the last stamp, and the answer is one `MarkerRead`. It reads synchronously, so a stalled Windows mount blocks this
// process alone, never the runtime's threads; the module kills it at its stop. It ends when its parent goes.
import {readMarker} from './marker.js';

process.on('message', (request: unknown) => {
  const {id, home, stamp} = typeof request === 'object' && request !== null ? request as {id?: unknown; home?: unknown; stamp?: unknown} : {};
  if (typeof id !== 'number' || typeof home !== 'string' || typeof stamp !== 'string') return;
  process.send?.({id, result: readMarker(home, stamp)});
});
process.on('disconnect', () => { process.exit(0); });
