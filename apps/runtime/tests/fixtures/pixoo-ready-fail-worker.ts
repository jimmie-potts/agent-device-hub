// Test-only worker: public normal text/dashboard renderers; fail only a selected ready-image request.
import {parentPort, workerData} from 'node:worker_threads';
import {renderDashboard, renderNowPlaying} from '@jimmie-potts/pixoo';
type Request = {kind: 'dashboard'; layout: Parameters<typeof renderDashboard>[0]}
  | {kind: 'card'; view: Parameters<typeof renderNowPlaying>[0]; artwork?: {status: string}};
const request = workerData as Request;
if (request.kind === 'card' && request.artwork?.status === 'ready') {
  throw new Error('synthetic-ready-artwork-render-failure');
}
const frames = request.kind === 'dashboard' ? renderDashboard(request.layout) : [renderNowPlaying(request.view)];
parentPort?.postMessage(request.kind === 'card' && request.artwork !== undefined ? {frames} : frames);
