import {parentPort, workerData} from 'node:worker_threads';
import sharp from 'sharp';
import {decodeArtwork} from './artwork-decode.js';
import {artworkFailure} from './artwork-fetch.js';
sharp.cache(false);
sharp.concurrency(1);
const request: unknown = workerData;
const reply = request instanceof Uint8Array ? await decodeArtwork(request) : artworkFailure('invalid-response');
parentPort?.postMessage(reply);
