#!/usr/bin/env node
// The B.U.N.N.Y. 2.0 agent hook (Hub #926): `node monitor-hook.mjs <producer.json>`, with the hook's JSON on stdin, as
// the clients' hook settings run it. It publishes one lifecycle observation to the runtime in one bounded call, as the
// producer's credential (`runHook` in src/hook/hook.ts). Observational only: no output protocol, permission decision,
// retry, device or child process. Every path ends within 2.9 s of the process's start, whatever the runtime does, and
// exits 0 unless native filesystem or DNS work is still stuck then.
// The cutover (#840, through #935) installs this file as `bin/monitor-hook.mjs` behind the hook link, where the old
// Hub's hook is today, so personal hook settings keep their command. It imports only by package name, so it runs there.
const BUDGET_MS = 2900;
/**
 * Whether native filesystem or DNS work is still under way. On Node 24 `process.exit` can wait for these worker jobs,
 * and nothing runs after a blocked exit, so the hook decides first.
 * A check that cannot tell, because the call throws, counts as none, so the hook still exits 0: it stays fail-open.
 */
const nativeWorkPending = () => {
  try {
    return process.getActiveResourcesInfo().some(name => name.startsWith('FSReq') || name === 'GetAddrInfoReqWrap');
  } catch {
    return false;
  }
};
/** The deadline: exit 0, or use a signal that cannot wait for a stuck native worker. */
const end = () => {
  if (nativeWorkPending()) process.kill(process.pid, 'SIGKILL');
  else process.exit(0);
};
/** Exit once native work is finished, or let the hard deadline end it. */
const finish = () => {
  if (nativeWorkPending()) setTimeout(finish, 10);
  else process.exit(0);
};
process.on('uncaughtException', finish);
process.on('unhandledRejection', finish);
// The deadline is armed before anything loads, so a slow start cannot delay the agent either.
setTimeout(end, Math.max(1, BUDGET_MS - performance.now()));
try {
  if (process.argv.length === 3) {
    const {runHook} = await import('@jimmie-potts/runtime/hook');
    await runHook({producer: process.argv[2], input: process.stdin, deadline: BUDGET_MS});
  }
} catch {
  // Fail open: nothing is reported and nothing is retried.
}
finish();
