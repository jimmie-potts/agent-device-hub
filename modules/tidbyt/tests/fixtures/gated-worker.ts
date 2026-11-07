// A render worker that holds the now-playing card (Hub #1527). It draws every tile as the module's worker does. Once the
// card is drawn, it says `drawn` on the `tidbyt-render-gate` channel and answers only after the channel says `go`. A test
// can then order the card's push after another write. Other tiles answer at once.
import {BroadcastChannel, parentPort, workerData} from 'node:worker_threads';
import {renderArtworkTile} from '../../src/tiles.js';

const frame = await renderArtworkTile(workerData);
if ((workerData as {tile?: unknown}).tile === 'now-playing') {
  const gate = new BroadcastChannel('tidbyt-render-gate');
  await new Promise<void>(resolve => {
    gate.onmessage = message => { if (message.data === 'go') resolve(); };
    gate.postMessage('drawn');
  });
  gate.close();
}
parentPort?.postMessage(frame);
