// Preloaded with `node --import` into a migration tool's real entry point by migration-signals.test.ts (Hub #1003). It
// adds no signal listener, so a signal the entry point no longer listens for still ends the process. Once the entry
// point has set its exit code, so every statement after its line has run, it writes `settled` to stderr; and it keeps
// the process up until its stdin ends, so the test can send a signal in the moment between the line and the exit.
process.stdin.resume();
const poll = setInterval(() => {
  if (process.exitCode === undefined) return;
  clearInterval(poll);
  process.stderr.write('settled\n');
}, 5);
