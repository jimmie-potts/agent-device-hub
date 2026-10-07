// A render worker that answers late (Hub #930): it draws the tile as the module's worker does, after 300 ms of real time,
// so a test can move the manual clock while the render runs.
import {parentPort, workerData} from 'node:worker_threads';
import {renderTile} from '../../src/tiles.js';

setTimeout(() => { parentPort?.postMessage(renderTile(workerData)); }, 300);
