// Preloaded into each lint shard by lint-shards.mjs (Hub #1636): reports the process's peak resident memory in
// kilobytes on file descriptor 3 when it exits, so the runner can print it beside the shard's time. As a preload it
// leaves process.argv untouched, so ESLint's own path stays argv[1].
import {writeSync} from 'node:fs';

process.on('exit', () => {
  try {
    writeSync(3, `${process.resourceUsage().maxRSS}\n`);
  } catch {
    // Without the runner's pipe there is nowhere to report; lint itself is unaffected.
  }
});
