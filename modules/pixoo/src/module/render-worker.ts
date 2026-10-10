// Card PNG decoding and dashboard drawing stay in the existing runtime worker.
import {parentPort, workerData} from 'node:worker_threads';
import {renderRequest, type RenderRequest} from './render-request.js';
export type {RenderRequest, RenderReply} from './render-request.js';
const request = workerData as RenderRequest;
const reply = await renderRequest(request);
// Existing callers still receive arrays. Artwork-aware callers receive the safe refusal code as well.
parentPort?.postMessage(request.kind === 'card' && request.artwork !== undefined ? reply : reply.frames);
