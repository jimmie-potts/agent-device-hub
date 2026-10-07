// The sign's render worker (Hub #919): turns the configured greeting into the frame a sign shows, off the event loop, as
// Tidbyt and Pixoo render theirs. It answers its one request once.
import {parentPort, workerData} from 'node:worker_threads';

const {greeting} = workerData as {greeting: string};
parentPort?.postMessage(greeting.toUpperCase());
