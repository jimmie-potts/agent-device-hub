#!/usr/bin/env node
// The host-local VOLCANO HYBRID collector (Hub #615): `node volcano-collector.mjs <collector.json>`. The logic is
// `@jimmie-potts/runtime/volcano-collector`, and the Bluetooth binding is the separate `apps/volcano-collector` package; this
// entry owns the process's streams, signals and exit. Diagnostic contract records go to stderr as JSON lines through the
// runtime's `LogWriter`; stdout stays empty. Exit 0 after SIGTERM or SIGINT, 2 when a file or the binding is unusable, 1 for
// an unexpected fault. macOS ends a process whose responsible app has no Bluetooth usage description, so a launchd launch
// needs the wrapper #617 qualifies; see apps/volcano-collector/README.md.
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

/** How long a stop may take before the process is ended regardless: the native binding may hold it open. */
const STOP_BUDGET_MS = 900;

async function main() {
  if (process.argv.length !== 3) {
    process.stderr.write('volcano-collector: usage: volcano-collector.mjs <collector.json>\n');
    process.exit(2);
  }
  const controller = new AbortController();
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    controller.abort();
    setTimeout(() => { process.exit(0); }, STOP_BUDGET_MS);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  const {loadCollector, runCollector, REFUSAL_TEXT} = await import('@jimmie-potts/runtime/volcano-collector');
  const collector = await loadCollector(process.argv[2]);
  if (typeof collector === 'string') {
    process.stderr.write(`${REFUSAL_TEXT[collector]}\n`);
    process.exit(2);
  }
  // Only after both private files check out does anything load the native binding, which may reach the radio when it loads.
  let transport;
  try {
    const {loadTransport} = await import('../../volcano-collector/dist/src/index.js');
    transport = await loadTransport();
  } catch (error) {
    // Only a package that was never built or installed is a missing binding; any other fault ends with the exit below.
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  }
  if (transport === undefined) {
    process.stderr.write(`${REFUSAL_TEXT.binding}\n`);
    process.exit(2);
  }
  // Records are the diagnostic contract's, written by the runtime's own writer as JSON lines on stderr. The contract
  // registers operation and device events in the module scope only, so the collector logs as the module it feeds.
  const [{INSTANCE_ID, LogWriter, stderrSink}, {runtimeResource, MODULE_SCOPE}] = await Promise.all([import('../dist/src/log.js'), import('../dist/src/record.js')]);
  const log = new LogWriter(stderrSink, 'info', {now: () => Date.now()}, runtimeResource('production', INSTANCE_ID))
    .logger(MODULE_SCOPE, {'bunny.module': 'volcano'});
  await runCollector(collector, {signal: controller.signal, log, transport});
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(() => {
    process.stderr.write('volcano-collector: an unexpected fault ended the collector\n');
    process.exit(1);
  });
}
