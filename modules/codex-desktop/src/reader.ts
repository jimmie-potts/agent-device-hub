// The Codex Desktop marker reader's own process (Hub #926), which `folderReader` forks: each message names a Codex home
// and the last stamp, and the answer is one `MarkerRead` (serve.ts). A stalled Windows mount holds this process alone,
// never the runtime's threads; the module kills it at its stop, and it ends itself when its parent goes.
import {readMarker} from './marker.js';
import {serveReads} from './serve.js';

serveReads(readMarker);
