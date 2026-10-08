// The Nanoleaf migration on a real full disk (Hub #933): the bridge state and the destination on a 4 MiB private tmpfs,
// in a user and mount namespace (`unshare -rm`), so SQLite and the file writes meet ENOSPC. A full disk at the final
// checkpoint, where SQLite's close would keep the log without an error, at the secret files or before the tool starts
// fails the migration with `disk-short` and leaves nothing behind; with room again, the same source migrates and
// verifies. A host that refuses unprivileged user namespaces, as some CI runners do, skips this test and says why.
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {EXIT} from '../src/nanoleaf-migration.js';
import {it} from './support.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/nanoleaf-full-disk.js', import.meta.url));
const MOUNT = 'mount -t tmpfs -o size=4m,mode=700 tmpfs "$1" && exec "$2" "$3" "$1"';

/** Why this host cannot run the test, or undefined when it can mount a private tmpfs in a user namespace. */
function unavailable(): string | undefined {
  const probe = spawnSync('unshare', ['-rm', 'sh', '-c', 'mount -t tmpfs -o size=64k tmpfs /mnt'], {encoding: 'utf8'});
  if (probe.error !== undefined) return `unshare could not run (${probe.error.message}), so no private tmpfs can be mounted`;
  if (probe.status !== 0) return `this host refuses an unprivileged user namespace with a tmpfs mount (unshare -rm exited ${String(probe.status)}: ${probe.stderr.trim()})`;
  return undefined;
}

type Step = {step: string; exit: number; result: string; code?: string; destination?: string; left: string[]};

it('a full disk at the final checkpoint, at the secrets or at the start fails the migration with disk-short and leaves nothing', async context => {
  const reason = unavailable();
  if (reason !== undefined) {
    context.skip(reason);
    return;
  }
  const mount = await mkdtemp(join(tmpdir(), 'nanoleaf-full-'));
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
  const failed = {exit: EXIT.failed, result: 'failed', code: 'disk-short', destination: 'removed', left: []};
  assert.deepEqual(steps.get('checkpoint-full'), {step: 'checkpoint-full', ...failed},
    'the final checkpoint on a full disk fails the migration, where a plain close would keep the log and report migrated');
  assert.deepEqual(steps.get('secrets-full'), {step: 'secrets-full', ...failed}, 'a full disk at the secret files');
  const start = steps.get('start-full');
  assert.deepEqual([start?.code, start?.left], ['disk-short', []], 'a full disk before the tool starts');
  assert.ok(start?.exit === EXIT.failed || start?.exit === EXIT.refused);
  assert.deepEqual(steps.get('room-again'), {step: 'room-again', exit: EXIT.ok, result: 'migrated', left: [
    'nanoleaf', 'nanoleaf-panels-token', 'nanoleaf-wall-token', 'nanoleaf.sqlite', 'section']});
  assert.deepEqual(steps.get('verified'), {step: 'verified', exit: EXIT.ok, result: 'verified', left: [
    'nanoleaf', 'nanoleaf-panels-token', 'nanoleaf-wall-token', 'nanoleaf.sqlite', 'section']});
});
