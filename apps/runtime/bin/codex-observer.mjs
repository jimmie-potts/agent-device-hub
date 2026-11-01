#!/usr/bin/env node
// Selected only by codex-with-read. It delegates every native command and never writes its own protocol frames.
import {spawn, spawnSync} from 'node:child_process';

const native = process.env.BUNNY_CODEX_NATIVE;
const args = process.argv.slice(2);
if (!native || native === process.argv[1]) process.exit(2);

const finish = (code, signal) => {
  if (signal) {process.kill(process.pid, signal); return;}
  const deadline = performance.now() + 250;
  const exit = () => {
    let pending = true;
    try {pending = process.getActiveResourcesInfo().some(name => name.startsWith('FSReq') || name === 'GetAddrInfoReqWrap');}
    catch { /* An unknown native-work state cannot justify an unbounded shutdown. */ }
    if (!pending) {process.exit(code ?? 1); return;}
    // Node's process.exit waits for native filesystem/DNS workers. Native output is already forwarded.
    if (performance.now() >= deadline) process.kill(process.pid, 'SIGKILL');
    else setTimeout(exit, 10);
  };
  exit();
};
const delegate = () => {
  const child = spawn(native, args, {stdio: 'inherit'});
  const terminate = () => {child.kill('SIGTERM');}, interrupt = () => {child.kill('SIGINT');};
  process.on('SIGTERM', terminate); process.on('SIGINT', interrupt);
  child.once('error', () => {process.exit(1);});
  child.once('exit', (code, signal) => {
    process.removeListener('SIGTERM', terminate); process.removeListener('SIGINT', interrupt);
    finish(code, signal);
  });
};

let proxy;
let producer;
try {
  const {qualifiedCodexVersions, isCodexStdioServer} = await import('../dist/src/read-receipts/qualification.js');
  if (isCodexStdioServer(args)) {
    const version = spawnSync(native, ['--version'], {encoding: 'utf8', timeout: 1500, maxBuffer: 4096, stdio: ['ignore', 'pipe', 'ignore']});
    if (version.status === 0 && qualifiedCodexVersions(process.env.BUNNY_CODEX_DESKTOP_VERSION ?? '',
      process.env.BUNNY_CODEX_DESKTOP_BUILD ?? '', version.stdout.trim())) {
      ({runCodexProxy: proxy} = await import('../dist/src/read-receipts/codex-proxy.js'));
      producer = process.env.BUNNY_CODEX_RECEIPT_PRODUCER;
    }
  }
} catch { /* A missing or unsupported collector leaves native startup available. */ }
if (proxy === undefined) delegate();
else {
  const result = await proxy({native, args, input: process.stdin, output: process.stdout, errors: process.stderr,
    ...(producer === undefined ? {} : {producer})}).catch(() => ({code: 1, signal: null}));
  finish(result.code, result.signal);
}
