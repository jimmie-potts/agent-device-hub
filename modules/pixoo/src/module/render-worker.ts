// The Pixoo module's render worker (Hub #843): one Monitor dashboard or Now Playing card per call, through the runtime's
// worker call, so drawing never blocks the runtime's event loop. It gets the request as its `workerData` and answers
// with the picture's 64x64 RGB frames.
import {parentPort, workerData} from 'node:worker_threads';
import type {NowPlayingView} from '../core/index.js';
import type {DashboardLayout} from '../presentation/agent-dashboard.js';
import {renderDashboard} from '../presentation/dashboard-pixels.js';
import {renderNowPlaying} from '../presentation/now-playing.js';

/** What the module asks the worker to draw. */
export type RenderRequest = {kind: 'dashboard'; layout: DashboardLayout} | {kind: 'card'; view: Extract<NowPlayingView, {card: true}>};

const request = workerData as RenderRequest;
const frames = request.kind === 'dashboard' ? renderDashboard(request.layout) : [renderNowPlaying(request.view)];
parentPort?.postMessage(frames);
