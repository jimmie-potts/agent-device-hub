import {parentPort} from 'node:worker_threads';
// Synthetic processing stall: no file, network, settings or database access.
parentPort.on('message',()=>{Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10000);});
