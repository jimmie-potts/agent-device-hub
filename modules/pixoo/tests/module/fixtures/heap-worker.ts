// A media child process stand-in that answers whether its heap is capped as the module's fork asks: 256 MiB of old space,
// which V8 reports as a limit of about 304 MiB with the young generation, against several GiB uncapped.
import {getHeapStatistics} from 'node:v8';

process.once('message', () => {
  const capped = getHeapStatistics().heap_size_limit <= 512 * 1024 * 1024;
  process.send?.(capped ? {ok: true} : {ok: false, code: 'invalid-input'}, () => { process.disconnect(); });
});
