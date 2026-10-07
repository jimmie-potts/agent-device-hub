// A worker that answers with the NODE_OPTIONS its environment holds, through which a verification run's network guard
// loads into every worker thread (Hub #920, #919).
import {parentPort} from 'node:worker_threads';

parentPort?.postMessage(process.env.NODE_OPTIONS ?? null);
