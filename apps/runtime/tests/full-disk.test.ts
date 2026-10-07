// A real full disk (Hub #972): the runtime's state directory on a 2 MiB private tmpfs, in a user and mount namespace
// (`unshare -rm`), so SQLite meets ENOSPC as on a full disk rather than a page limit. A full disk at the start never
// fails the core (bunny-runtime "Core store transactions and failures"): restarted after a clean stop, or started for
// the first time, it runs and refuses intake with `capacity`, and takes it once there is room. Module databases use
// exclusive locking, so opening one needs no new space. A host that refuses unprivileged user namespaces, as some CI
// runners do, skips this test and says why.
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {it} from './support.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/full-disk.js', import.meta.url));
const MOUNT = 'mount -t tmpfs -o size=2m,mode=700 tmpfs "$1" && exec "$2" "$3" "$1"';

/** Why this host cannot run the test, or undefined when it can mount a private tmpfs in a user namespace. */
function unavailable(): string | undefined {
  const probe = spawnSync('unshare', ['-rm', 'sh', '-c', 'mount -t tmpfs -o size=64k tmpfs /mnt'], {encoding: 'utf8'});
  if (probe.error !== undefined) return `unshare could not run (${probe.error.message}), so no private tmpfs can be mounted`;
  if (probe.status !== 0) return `this host refuses an unprivileged user namespace with a tmpfs mount (unshare -rm exited ${String(probe.status)}: ${probe.stderr.trim()})`;
  return undefined;
}

type Run = {core: string; taken: string[]; sync: string};
type Step = Partial<Run> & {step: string; restarted?: Run; started?: Run};

it('a full disk at the start never fails the core: restarted or started for the first time, it refuses intake with capacity and takes it once there is room', async context => {
  const reason = unavailable();
  if (reason !== undefined) {
    context.skip(reason);
    return;
  }
  const mount = await mkdtemp(join(tmpdir(), 'bunny-full-'));
  context.after(() => rm(mount, {recursive: true, force: true}));
  const child = spawn('unshare', ['-rm', 'sh', '-c', MOUNT, 'sh', mount, process.execPath, FIXTURE], {stdio: ['ignore', 'pipe', 'pipe']});
  context.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
  const [code] = await once(child, 'exit') as [number | null];
  assert.equal(code, 0, `the run ended cleanly: ${stderr}`);
  const steps = new Map(stdout.split('\n').filter(line => line.startsWith('{')).map(line => {
    const step = JSON.parse(line) as Step;
    return [step.step, step];
  }));
  assert.deepEqual(steps.get('empty-disk'), {step: 'empty-disk', core: 'running', taken: ['accepted'], sync: 'synced'});
  assert.deepEqual(steps.get('restart-full-disk'), {step: 'restart-full-disk', core: 'running', taken: ['rejected/capacity'], sync: 'unavailable'},
    'restarted after a clean stop on a full disk, the core opens its database, runs, refuses intake with capacity and syncs with unavailable');
  assert.deepEqual(steps.get('first-start-full-disk'), {step: 'first-start-full-disk', core: 'running', taken: ['rejected/capacity'], sync: 'unavailable'},
    'started for the first time on a full disk, the core runs, refuses intake with capacity and syncs with unavailable');
  assert.deepEqual(steps.get('room-again'), {
    step: 'room-again',
    restarted: {core: 'running', taken: ['rejected/capacity', 'accepted'], sync: 'synced'},
    started: {core: 'running', taken: ['rejected/capacity', 'accepted'], sync: 'synced'},
  }, 'once there is room, both take the next observation and serve syncs');
});
