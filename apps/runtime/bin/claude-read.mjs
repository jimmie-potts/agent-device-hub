#!/usr/bin/env node
// One explicit terminal UI operation. No output goes to the model or the lifecycle hook protocol.
const unavailable = {status: 'unavailable', error: {code: 'invalid-request', retryable: false}};
let ended = false;
const finish = result => {
  if (ended) return;
  ended = true;
  process.stdout.write(JSON.stringify(result), () => { process.exit(0); });
};
// A stalled native filesystem/DNS worker can prevent process.exit; the outer deadline must still end this helper.
setTimeout(() => {
  finish({status: 'unconfirmed', error: {code: 'uncertain-result', retryable: false}});
  setTimeout(() => { process.kill(process.pid, 'SIGKILL'); }, 20);
}, Math.max(1, 2700 - performance.now()));
process.on('uncaughtException', () => { finish(unavailable); });
process.on('unhandledRejection', () => { finish(unavailable); });
try {
  if (process.argv.length !== 3) finish(unavailable);
  else {
    const {runReadHelper} = await import('@jimmie-potts/runtime/read-receipts');
    const chunks = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
      bytes += chunk.length;
      if (bytes > 8192) { finish(unavailable); break; }
      chunks.push(chunk);
    }
    if (!ended) finish(await runReadHelper(process.argv[2], JSON.parse(Buffer.concat(chunks).toString('utf8')), Math.max(1, Math.floor(2550 - performance.now()))));
  }
} catch { finish(unavailable); }
