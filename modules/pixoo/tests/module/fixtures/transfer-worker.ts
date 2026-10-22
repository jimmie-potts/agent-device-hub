import {getHeapStatistics} from 'node:v8';
const header = {source: {format: 'png', width: 1, height: 1, frameCount: 1, delaysMs: [null], durationMs: null as number | null}, warnings: []};
const frame = {index: 0, rgb: Buffer.alloc(12288, 17), preview: Buffer.from('preview'), delayMs: null};
function finish(code = 0): void { process.exitCode = code; if (process.connected) process.disconnect(); }
process.once('message', (request: {input: string; output?: string; id?: string}) => {
  const mode = request.input;
  if (request.output !== undefined || request.id !== undefined || getHeapStatistics().heap_size_limit > 512 * 1024 * 1024) {
    process.send?.({ok: false, code: 'invalid-input'}, () => { finish(); }); return;
  }
  if (mode === 'early-success') { process.send?.({ok: true}, () => { finish(); }); return; }
  if (mode === 'bad-header') header.source.frameCount = 1001;
  if (mode === 'bad-duration') header.source.durationMs = 5;
  if (mode === 'bad-pixels') header.source.width = 100_000_001;
  if (mode === 'extra-header') Object.assign(header, {extra: Buffer.alloc(20)});
  if (mode === 'extra-source') Object.assign(header.source, {extra: Buffer.alloc(20)});
  if (mode === 'aggregate-pixels') Object.assign(header.source, {format: 'gif', width: 4096, height: 4096, frameCount: 4, delaysMs: [100,100,100,100], durationMs: 400});
  process.send?.({header});
  if (mode === 'duplicate-header') process.send?.({header});
  process.once('message', () => {
    if (mode === 'aggregate-pixels') {
      const sendFrame = (index: number): void => {
        process.once('message', () => {
          if (index < 3) sendFrame(index + 1);
          else process.send?.({ok: true}, () => { finish(); });
        });
        process.send?.({frame: {...frame, index, delayMs: 100}});
      };
      sendFrame(0); return;
    }
    if (mode === 'missing-frame') { process.send?.({ok: true}, () => { finish(); }); return; }
    if (mode === 'oversize') frame.preview = Buffer.alloc(65537);
    if (mode === 'bad-rgb') frame.rgb = Buffer.alloc(1);
    if (mode === 'bad-index') frame.index = 1;
    if (mode === 'extra-frame') Object.assign(frame, {extra: Buffer.alloc(20)});
    process.send?.({frame});
    if (mode === 'duplicate-frame') process.send?.({frame});
    process.once('message', () => {
      process.send?.({ok: true}, () => {
        if (mode === 'duplicate-final') process.send?.({ok: true}, () => { finish(); });
        else if (mode === 'delayed-close') setTimeout(() => { finish(); }, 250);
        else finish(mode === 'nonzero' ? 1 : 0);
      });
    });
  });
});
