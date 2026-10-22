// The decoder reads one original and returns bounded frames. Only its parent writes installation state.
// It logs nothing: the module records each job's result.
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {renderMedia} from './render.js';
import {MediaError} from './contracts.js';
import {invalidTransfer, readFrame, readHeader} from './worker-transfer.js';
import type {WorkerRequest} from './worker-client.js';

type DecodeRequest = Omit<WorkerRequest, 'output' | 'id'>;
const disconnected = (): never => process.exit(1);
process.once('disconnect', disconnected);

function exchange(message: object, index: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const ack = (value: unknown): void => {
      const reply = value as {ack?: number} | null;
      if (reply?.ack === index) resolve(); else reject(invalidTransfer());
    };
    process.once('message', ack);
    process.send?.(message, error => {
      if (error !== null) { process.removeListener('message', ack); reject(invalidTransfer()); }
    });
  });
}
async function render(request: DecodeRequest): Promise<void> {
  const bytes = await readFile(request.input);
  if (createHash('sha256').update(bytes).digest('hex') !== request.sourceHash) throw new MediaError('invalid-input');
  const result = await renderMedia(bytes, request.transform, request.profile, request.limits);
  const header = readHeader({source: result.source, warnings: result.warnings}, request.profile, request.limits);
  await exchange({header}, -1);
  for (const [index, frame] of result.frames.entries()) {
    await exchange({frame: readFrame({index, ...frame}, header, index)}, index);
  }
}
process.once('message', (request: DecodeRequest) => {
  void render(request).then(
    () => ({ok: true}),
    (error: unknown) => ({ok: false, code: error instanceof MediaError ? error.code : 'decode-failed'}),
  ).then(response => {
    process.send?.(response, error => {
      if (error !== null) process.exitCode = 1;
      process.removeListener('disconnect', disconnected);
      if (process.connected) process.disconnect();
    });
  });
});
