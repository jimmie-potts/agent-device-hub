// Hold the composition's adapter barrier until the wrapper and its process
// group have stopped. A killed compose process cannot leave a late reseed
// racing the next operation. Application user units remain the core's concern.
import {spawn} from 'node:child_process';
import {readFile, readdir} from 'node:fs/promises';
import {DirectoryLock} from './lock.mjs';

/** @param {number} pid */
export async function processIdentity(pid) {
  try {
    const value = await readFile(`/proc/${pid}/stat`, 'utf8');
    const fields = value.slice(value.lastIndexOf(')') + 2).split(' ');
    return fields[0] === 'Z' || fields[0] === 'X' ? undefined : fields[19];
  } catch { return undefined; }
}
/** @param {number} group */
async function groupAlive(group) {
  for (const entry of await readdir('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const value = await readFile(`/proc/${entry}/stat`, 'utf8');
      const fields = value.slice(value.lastIndexOf(')') + 2).split(' ');
      if (Number(fields[2]) === group && fields[0] !== 'Z' && fields[0] !== 'X') return true;
    } catch { /* A process can exit during the scan. */ }
  }
  return false;
}
const pause = (/** @type {number} */ ms) => new Promise(resolve => setTimeout(resolve, ms));

/** @param {string} service */
export function adapterLock(service) {
  if (typeof service !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(service)) throw new Error('invalid adapter service identity');
  return `.adapter-${service}.lock`;
}

/** @param {{directory: string, service: string, parent: number, started: string, timeoutMs: number, argv: string[]}} config */
export async function runAdapter(config) {
  return new DirectoryLock(config.directory, adapterLock(config.service)).run(async () => {
    // Check inside the barrier: a runner scheduled after recovery must not start.
    if (await processIdentity(config.parent) !== config.started) return 1;
    const [program, ...args] = config.argv;
    const child = spawn(program, args, {stdio: 'inherit', detached: true});
    let done = false, code = 1, stopped = false;
    const finished = new Promise(resolve => {
      child.once('error', () => { done = true; resolve(undefined); });
      child.once('exit', value => { code = value ?? 1; done = true; resolve(undefined); });
    });
    const kill = () => {
      if (stopped) return;
      stopped = true;
      if (child.pid) try { process.kill(-child.pid, 'SIGKILL'); } catch (error) {
        if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ESRCH') throw error;
      }
    };
    const interrupt = () => { kill(); };
    process.on('SIGTERM', interrupt); process.on('SIGINT', interrupt);
    try {
      const deadline = Date.now() + config.timeoutMs;
      while (!done) {
        if (Date.now() >= deadline || await processIdentity(config.parent) !== config.started) kill();
        await pause(25);
      }
      // A wrapper can exit with a helper still alive. No helper outlives the barrier.
      kill(); await finished;
      while (child.pid && await groupAlive(child.pid)) await pause(25);
      return code;
    } finally {
      process.off('SIGTERM', interrupt); process.off('SIGINT', interrupt);
    }
  });
}
if (process.argv[2] === '--run-adapter') {
  try { process.exitCode = await runAdapter(JSON.parse(process.argv[3])); }
  catch { process.stderr.write('composition adapter barrier failed\n'); process.exitCode = 1; }
}
