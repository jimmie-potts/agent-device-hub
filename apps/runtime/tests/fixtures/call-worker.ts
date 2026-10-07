// A worker for the runtime's worker call tests (Hub #919). Its request names what it does: answer with the request's
// text in capitals, stay silent until it is terminated, throw, or end without an answer.
import {parentPort, workerData} from 'node:worker_threads';

const {act, text} = workerData as {act: 'answer' | 'silent' | 'throw' | 'end'; text?: string};
switch (act) {
  case 'answer':
    parentPort?.postMessage({text: (text ?? '').toUpperCase(), env: process.env.NODE_OPTIONS ?? null});
    break;
  case 'silent':
    setInterval(() => {}, 1000);
    break;
  case 'throw':
    throw new Error('the worker failed, quoting tok_SYNTHETIC919');
  case 'end':
    break;
}
