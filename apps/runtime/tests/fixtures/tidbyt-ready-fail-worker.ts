// Test-only worker: public normal text/status renderer; fail only a selected ready-image request.
import {parentPort, workerData} from 'node:worker_threads';
import {renderTile, type TileRequest} from '@jimmie-potts/tidbyt';
const request = workerData as TileRequest;
if (request.tile === 'now-playing' && request.artwork?.status === 'ready') {
  throw new Error('synthetic-ready-artwork-render-failure');
}
parentPort?.postMessage(renderTile(request));
