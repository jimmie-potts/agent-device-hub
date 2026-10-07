// Starts a runtime verification run's supervisor directly, without a user manager (Hub #920), as CI hosts must. Each run
// gets its own seeded data directory under the system temporary directory, which must be outside every Git checkout.
import {spawn, type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {mkdir, mkdtemp, realpath, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import {fileURLToPath} from 'node:url';
import plugin from '../plugin.js';

export const SUPERVISOR = fileURLToPath(new URL('../supervisor.js', import.meta.url));
export const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));

export type Started = {
  url: string; harness: string; dataDir: string; runtimeDir: string; supervisor: ChildProcess;
  stderr: () => string; stop: () => Promise<{code: number | null; signal: NodeJS.Signals | null}>;
};

/** A private base directory removed after the test. */
export async function base(context: TestContext): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'rv-')));
  context.after(() => rm(dir, {recursive: true, force: true}));
  return dir;
}

let runs = 0;
/** Seeds `scenario` into a new run directory under `at` and starts the supervisor on it, as a run's unit would. */
export async function startRun(context: TestContext, at: string, scenario: string): Promise<Started> {
  runs += 1;
  const runtimeDir = join(at, `r${runs}`), dataDir = join(runtimeDir, 'data');
  await mkdir(dataDir, {recursive: true, mode: 0o700});
  const seed = plugin.scenarios[scenario];
  if (seed === undefined) throw new Error(`no run scenario ${scenario}`);
  await seed.seed({runId: `runtime-unmanaged-r${runs}`, root: ROOT, runtimeDir, dataDir, scenario, inputs: {}});
  const supervisor = spawn(process.execPath, [SUPERVISOR, '--data', dataDir, '--port', '0', '--harness-port', '0'], {
    cwd: ROOT, env: {...process.env, TMPDIR: runtimeDir}, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(supervisor, 'exit').then(([code, signal]) => ({code: code as number | null, signal: signal as NodeJS.Signals | null}));
  context.after(() => { if (supervisor.exitCode === null && supervisor.signalCode === null) supervisor.kill('SIGKILL'); });
  let stderr = '';
  supervisor.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
  const ready = await new Promise<{url: string; endpoints: {harness: string}}>((resolve, reject) => {
    let text = '';
    supervisor.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      text += chunk;
      const line = text.split('\n').find(candidate => candidate.includes('"runtime.ready"'));
      if (line !== undefined) resolve(JSON.parse(line) as {url: string; endpoints: {harness: string}});
    });
    void exited.then(exit => { reject(new Error(`the supervisor exited ${JSON.stringify(exit)} before ready: ${stderr.slice(-2000)}`)); });
  });
  return {
    url: new URL(ready.url).href, harness: ready.endpoints.harness, dataDir, runtimeDir, supervisor, stderr: () => stderr,
    stop: async () => {
      if (supervisor.exitCode === null && supervisor.signalCode === null) supervisor.kill('SIGTERM');
      return exited;
    },
  };
}

/** Whether something accepts connections on a loopback port. */
export async function listening(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, {signal: AbortSignal.timeout(2000)});
    await response.body?.cancel();
    return true;
  } catch {
    return false;
  }
}

/** Whether a process with this PID is alive. */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
