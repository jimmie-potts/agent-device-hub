// A worker that answers each message with its workerData and the message.
import {parentPort, workerData} from 'node:worker_threads';

const prefix = String(workerData);
parentPort?.on('message', (message: unknown) => { parentPort?.postMessage(`${prefix} ${String(message)}`); });
