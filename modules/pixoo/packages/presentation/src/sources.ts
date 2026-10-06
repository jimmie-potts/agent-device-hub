// The two source views the presentation reads, copied verbatim from apps/server/src/monitor-source.ts
// and now-playing-source.ts at the provenance commit (modules/pixoo/README.md). The sources themselves
// stay in divoom-app-upgrade: the runtime's core state replaces them.
import type {Snapshot} from '@jimmie-potts/agent-state';
import type {NowPlayingView} from './now-playing.js';
export type MonitorView={apiVersion:'1.0';ownerId:string;connection:'current'|'stale'|'unavailable';snapshot:Snapshot|null;admissionRejected:number;nextRequestId:string|null};
export type PlaybackSourceStatus={source:'current'|'stale'|'unavailable';view:NowPlayingView};
