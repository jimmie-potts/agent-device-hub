#!/usr/bin/env node
// The host-local Codex Desktop collector (Hub #567): `node codex-desktop-collector.mjs <collector.json>`. The logic is
// `@jimmie-potts/runtime/codex-desktop-collector`; this entry owns the process's streams, signals and exit. Diagnostic
// contract records go to stderr as JSON lines through the runtime's `LogWriter`; stdout stays empty. Exit 0 after SIGTERM
// or SIGINT, 2 when the collector or producer file is unusable, 1 for an unexpected fault.
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

/** How long a stop may take before a read stuck in native file system work is ended by SIGKILL. */
const STOP_BUDGET_MS = 900;

const nativeWorkPending = () => {
  try {
    return process.getActiveResourcesInfo().some(name => name.startsWith('FSReq') || name === 'GetAddrInfoReqWrap');
  } catch {
    return false;
  }
};

/** When a stop must be over, on `performance.now()`'s clock: set by the first signal. */
let deadline;

/** Exits with `code` once no native work is pending; a stuck read on a stalled mount must not hold the process. */
function finish(code) {
  const until = deadline ?? performance.now() + STOP_BUDGET_MS;
  const attempt = () => {
    if (!nativeWorkPending()) process.exit(code);
    else if (performance.now() >= until) process.kill(process.pid, 'SIGKILL');
    else setTimeout(attempt, 10);
  };
  attempt();
}

async function main() {
  if (process.argv.length !== 3) {
    process.stderr.write('codex-desktop-collector: usage: codex-desktop-collector.mjs <collector.json>\n');
    process.exit(2);
  }
  const controller = new AbortController();
  const stop = () => {
    if (deadline !== undefined) return;
    deadline = performance.now() + STOP_BUDGET_MS;
    controller.abort();
    // A stop never waits for the loop past its budget, whatever the loop is waiting on.
    setTimeout(() => { finish(0); }, STOP_BUDGET_MS / 2);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  const {loadCollector, runCollector, REFUSAL_TEXT} = await import('@jimmie-potts/runtime/codex-desktop-collector');
  const collector = await loadCollector(process.argv[2]);
  if (typeof collector === 'string') {
    process.stderr.write(`${REFUSAL_TEXT[collector]}\n`);
    process.exit(2);
  }
  // Records are the diagnostic contract's, written by the runtime's own writer as JSON lines on stderr. The contract
  // registers operation and device events in the module scope only, so the collector logs as the module it feeds.
  const [{INSTANCE_ID, LogWriter, stderrSink}, {runtimeResource, MODULE_SCOPE}] = await Promise.all([import('../dist/src/log.js'), import('../dist/src/record.js')]);
  const log = new LogWriter(stderrSink, 'info', {now: () => Date.now()}, runtimeResource('production', INSTANCE_ID))
    .logger(MODULE_SCOPE, {'bunny.module': 'codex-desktop'});
  await runCollector(collector, {signal: controller.signal, log});
  finish(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(() => {
    process.stderr.write('codex-desktop-collector: an unexpected fault ended the collector\n');
    finish(1);
  });
}
