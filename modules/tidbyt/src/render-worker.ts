// The render worker (Hub #930): the module's `workers.call` runs this file in a new worker thread with one tile's view
// as its `workerData`, and it answers with one message, the tile's WebP or `{ok: false}`. The runtime ends the worker
// when the call ends, so a stop of the module cancels a render in progress.
import {parentPort, workerData} from 'node:worker_threads';
import {renderTile} from './tiles.js';

parentPort?.postMessage(renderTile(workerData));
