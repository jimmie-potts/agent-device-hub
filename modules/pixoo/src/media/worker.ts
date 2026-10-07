// The media child process: it decodes and renders one source, writes the rendition's frames and manifest to the staging
// folder it was given, and answers `{ok}` or `{ok: false, code}`. `runWorker` forks it with a 256 MiB heap and kills it
// with SIGKILL on abort. It logs nothing: the module records each job's result.
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {renderMedia} from './render.js';
import {MediaError, RENDERER_VERSION, type Rendition} from './contracts.js';
import type {WorkerRequest} from './worker-client.js';

const hash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

async function render(request: WorkerRequest): Promise<void> {
  const bytes = await readFile(request.input);
  if (hash(bytes) !== request.sourceHash) throw new MediaError('invalid-input');
  const result = await renderMedia(bytes, request.transform, request.profile, request.limits);
  const delays = result.frames.map(frame => frame.delayMs);
  const manifest: Rendition = {
    id: request.id, sourceHash: request.sourceHash, renderer: RENDERER_VERSION, transform: request.transform, profile: request.profile,
    source: result.source, warnings: result.warnings,
    effectiveDurationMs: delays.every((delay): delay is number => delay !== null) ? delays.reduce((total, delay) => total + delay, 0) : null,
    frames: [],
  };
  for (const [index, frame] of result.frames.entries()) {
    await writeFile(join(request.output, `${index}.rgb`), frame.rgb, {flag: 'wx'});
    await writeFile(join(request.output, `${index}.png`), frame.preview, {flag: 'wx'});
    manifest.frames.push({index, delayMs: frame.delayMs, rgbHash: hash(frame.rgb), previewHash: hash(frame.preview)});
  }
  await writeFile(join(request.output, 'manifest.json'), JSON.stringify(manifest), {flag: 'wx'});
}

process.once('message', (request: WorkerRequest) => {
  void render(request).then(
    () => ({ok: true}),
    (error: unknown) => ({ok: false, code: error instanceof MediaError ? error.code : 'decode-failed'}),
  ).then(response => {
    process.send?.(response, () => { process.disconnect(); });
  });
});
