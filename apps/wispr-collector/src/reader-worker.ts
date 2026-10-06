import { scanNumeric } from './reader-engine.js';
import { SourceError, sourceLimits, type SourceLimits } from './reader-types.js';

// eslint-disable-next-line @typescript-eslint/no-misused-promises -- the worker entry reports its own failures, and any rejection ends the worker process
process.once('message', async raw => {
  try {
    const input = raw as { path: string; limits: SourceLimits };
    const result = await scanNumeric(input.path, sourceLimits(input.limits), async (rows, rss) => {
      const ack = new Promise<void>(resolve => process.once('message', () => resolve()));
      process.send!({type: 'batch', rows, rss}); await ack;
    });
    process.send!({type: 'done', ...result});
  } catch (error) {
    const sqliteCode = (error as { errcode?: number }).errcode;
    const code = error instanceof SourceError ? error.code : sqliteCode === 5 ? 'source-busy' : sqliteCode === 7 ? 'source-capacity' : 'source-read';
    process.send!({ type: 'error', code });
  } finally { process.disconnect(); }
});
