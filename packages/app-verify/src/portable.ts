// Finite offline Acceptance, separate from the unchanged managed-preview receipt/lifecycle.
import {mkdir, readFile, writeFile, rename, lstat, realpath, mkdtemp, chmod, copyFile, rm} from 'node:fs/promises';
import {constants} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, relative, isAbsolute} from 'node:path';
import {refusalBody} from './error-body.js';
import {isPng, isFinalizedWebm} from './capture.js';
import {candidate, canonicalCheckout} from './roots.js';
import type {AppPlugin} from './types.js';
import {exec, newRunId, pause, hex256} from './util.js';

const IMAGE = /^sha256:[a-f0-9]{64}$/;
const REVISION = /^[a-f0-9]{40}$/;
const RUN = /^runtime-\d{8}T\d{6}Z-[a-f0-9]{6}$/;
const ID = /^[a-f0-9]{64}$/;
const FILES = new Set(['capture/assertions.json', 'capture/after.png', 'capture/interaction.webm', 'capture/checks.json']);
const DRIVER = '/opt/bunny/apps/runtime/dist/verify/portable-driver.js';
export const PORTABLE_RECEIPT_VERSION = 'app-verification-portable/1';

export interface PortableIdentity {
  runId: string; revision: string; image: string; artifactDigest: string | null; step: string; seconds: number;
}
export interface PortableManifest {
  schema: 'portable-capture/1'; runId: string; revision: string; artifactDigest: string; step: string;
  outcome: 'passed' | 'failed' | 'unavailable'; assertions: number;
  files: {name: string; bytes: number; sha256: string}[];
}
export interface PortableReceipt {
  receiptVersion: typeof PORTABLE_RECEIPT_VERSION;
  identity: PortableIdentity;
  backend: 'docker-foreground'; containerId: string | null; architecture: string;
  state: 'starting' | 'running' | 'passed' | 'failed' | 'expired' | 'unknown';
  startedAt: string; finishedAt: string | null; realtimeExpiryAcrossSuspend: false;
  capture: PortableManifest | null;
  cleanup: {stopped: boolean; container: 'pending' | 'removed' | 'left' | 'unknown'};
  failure: string | null;
  components?: AppPlugin['components'];
  secrets: 'none recorded';
}
export type DockerCommand = (args: string[]) => Promise<string>;
interface DockerContainer {
  Id: string; Image?: string;
  Config?: {User?: string; Labels?: Record<string, string>; Entrypoint?: unknown; Cmd?: unknown};
  HostConfig?: {NetworkMode?: string; RestartPolicy?: {Name?: string}; AutoRemove?: boolean; Init?: boolean; Privileged?: boolean;
    CapDrop?: unknown; CapAdd?: unknown; SecurityOpt?: string[]; Binds?: unknown; Devices?: unknown; DeviceRequests?: unknown;
    PortBindings?: unknown; PidMode?: string; IpcMode?: string; UTSMode?: string; CgroupnsMode?: string;
    LogConfig?: {Type?: string}; Tmpfs?: unknown; VolumesFrom?: unknown};
  State?: {Running?: boolean; Restarting?: boolean; Paused?: boolean; Pid?: number; Status?: string; ExitCode?: number};
  NetworkSettings?: {Networks?: Record<string, unknown>; Ports?: unknown}; Mounts?: unknown;
}
interface DockerImage {Id?: string; Config?: {Labels?: Record<string, string>; User?: string}; Architecture?: string; Os?: string}
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const empty = (value: unknown) => value === null || value === undefined || (Array.isArray(value) ? value.length === 0 : object(value) !== undefined && Object.keys(value).length === 0);
function checkIdentity(i: PortableIdentity, pendingArtifact = false): void {
  if (!RUN.test(i.runId) || !REVISION.test(i.revision) || !IMAGE.test(i.image) || !(pendingArtifact && i.artifactDigest === null || IMAGE.test(i.artifactDigest ?? ''))
    || !/^[a-z][a-z0-9-]{0,95}$/.test(i.step) || !Number.isInteger(i.seconds) || i.seconds < 30 || i.seconds > 600) throw new Error('invalid portable identity');
}
export function portableCreateArgs(i: PortableIdentity): string[] {
  checkIdentity(i, true);
  const root = `/var/lib/app-verify/${i.runId}`;
  return ['create', '--init', '--network', 'none', '--restart', 'no', '--user', '1000:1000', '--workdir', '/opt/bunny',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--ipc', 'private', '--cgroupns', 'private', '--pids-limit', '256',
    '--memory', '2g', '--cpus', '2', '--shm-size', '256m', '--no-healthcheck', '--log-driver', 'none',
    '--label', `org.bunny.verify.run=${i.runId}`, '--label', `org.bunny.verify.revision=${i.revision}`,
    '--env', `APP_VERIFY_RUN_ID=${i.runId}`, '--env', `APP_VERIFY_REVISION=${i.revision}`,
    '--env', `APP_VERIFY_STEP=${i.step}`,
    '--env', `HOME=${root}/home`, '--env', `TMPDIR=${root}/tmp`, '--env', 'BUNNY_CONTROL=disabled',
    '--entrypoint', '/usr/bin/timeout', i.image, '--signal=KILL', `${i.seconds}s`, '/usr/local/bin/node', DRIVER];
}
/** Admission checks effective isolation; stop separately checks exact owned identity. */
export function portableContainerMatches(value: unknown, i: PortableIdentity): boolean {
  const c = object(value) as unknown as DockerContainer | undefined, h = c?.HostConfig, config = c?.Config, networks = object(c?.NetworkSettings?.Networks);
  if (!c || !h || !config || !networks) return false;
  const args = portableCreateArgs(i), command = args.slice(args.indexOf(i.image) + 1);
  return ID.test(c.Id ?? '') && c.Image === i.image && config.User === '1000:1000'
    && config.Labels?.['org.bunny.verify.run'] === i.runId && config.Labels?.['org.bunny.verify.revision'] === i.revision
    && JSON.stringify(config.Entrypoint) === JSON.stringify(['/usr/bin/timeout']) && JSON.stringify(config.Cmd) === JSON.stringify(command)
    && h.NetworkMode === 'none' && h.RestartPolicy?.Name === 'no' && h.AutoRemove === false && h.Init === true && h.Privileged === false
    && JSON.stringify(h.CapDrop) === JSON.stringify(['ALL']) && empty(h.CapAdd)
    && Array.isArray(h.SecurityOpt) && h.SecurityOpt.length === 1 && ['no-new-privileges', 'no-new-privileges:true'].includes(h.SecurityOpt[0])
    && empty(c.Mounts) && empty(h.Binds) && empty(h.Devices) && empty(h.DeviceRequests) && empty(h.PortBindings)
    && empty(c.NetworkSettings?.Ports) && Object.keys(networks).length === 1 && Object.hasOwn(networks, 'none')
    && !h.PidMode && h.IpcMode === 'private' && !h.UTSMode && h.CgroupnsMode === 'private'
    && h.LogConfig?.Type === 'none' && empty(h.Tmpfs) && empty(h.VolumesFrom);
}
function owned(c: DockerContainer | undefined, i: PortableIdentity): boolean {
  return c !== undefined && ID.test(c.Id) && c.Image === i.image && c.Config?.Labels?.['org.bunny.verify.run'] === i.runId
    && c.Config?.Labels?.['org.bunny.verify.revision'] === i.revision;
}
function sameKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys.sort());
}
export function portableArtifact(value: unknown, revision: string): string {
  const m = object(value);
  if (!m || !sameKeys(m, ['schema', 'revision', 'artifactDigest']) || m.schema !== 'portable-artifact/1'
    || m.revision !== revision || typeof m.artifactDigest !== 'string' || !IMAGE.test(m.artifactDigest)) throw new Error('image artifact refused');
  return m.artifactDigest;
}
/** Closed allowlist: no paths, credential fields or arbitrary attachments cross this boundary. */
export function portableManifest(value: unknown, i: PortableIdentity): PortableManifest {
  const m = object(value) as Partial<PortableManifest> | undefined;
  if (!m || !sameKeys(m, ['schema', 'runId', 'revision', 'artifactDigest', 'step', 'outcome', 'assertions', 'files'])
    || m.schema !== 'portable-capture/1' || m.runId !== i.runId || m.revision !== i.revision || m.artifactDigest !== i.artifactDigest || m.step !== i.step
    || typeof m.outcome !== 'string' || !['passed', 'failed', 'unavailable'].includes(m.outcome) || typeof m.assertions !== 'number' || !Number.isInteger(m.assertions) || m.assertions < 0 || m.assertions > 1000
    || !Array.isArray(m.files) || m.files.length > FILES.size) throw new Error('portable proof refused');
  const names = new Set();
  for (const value of m.files) {
    const f = object(value);
    if (!f || !sameKeys(f, ['name', 'bytes', 'sha256']) || typeof f.name !== 'string' || !FILES.has(f.name) || names.has(f.name)
      || typeof f.bytes !== 'number' || !Number.isInteger(f.bytes) || f.bytes < 1 || f.bytes > 32 * 1024 * 1024 || typeof f.sha256 !== 'string' || !ID.test(f.sha256)) throw new Error('portable proof refused');
    names.add(f.name);
  }
  if (m.outcome === 'passed' && (m.assertions < 2 || !['capture/assertions.json', 'capture/after.png', 'capture/interaction.webm',
    ...(i.step === 'mac-codex-local' ? ['capture/checks.json'] : [])].every(n => names.has(n)))) throw new Error('incomplete portable capture');
  return m as PortableManifest;
}
async function inspect(id: string, run: DockerCommand): Promise<DockerContainer> {
  const result: unknown = JSON.parse(await run(['inspect', id]));
  if (!Array.isArray(result) || result.length !== 1) throw new Error('container readback refused');
  const c = object(result[0]) as unknown as DockerContainer | undefined;
  if (!c || c.Id !== id) throw new Error('container readback refused');
  return c;
}
const stopped = (c: DockerContainer) => c.State?.Running === false && c.State?.Restarting === false && c.State?.Paused === false
  && c.State?.Pid === 0 && typeof c.State.Status === 'string' && ['created', 'exited', 'dead'].includes(c.State.Status);
/** Never deletes. A failed read/stop preserves the container's private state. */
export async function stopPortableContainer(id: string, i: PortableIdentity, run: DockerCommand): Promise<boolean> {
  try {
    if (!ID.test(id)) return false;
    let c = await inspect(id, run);
    if (!owned(c, i)) return false;
    if (!stopped(c)) {await run(['stop', '--time', '3', id]); c = await inspect(id, run);}
    return owned(c, i) && stopped(c);
  } catch {return false;}
}
const docker: DockerCommand = async args => {
  const r = await exec('docker', args, {timeoutMs: 30_000});
  if (r.code !== 0) throw new Error('Docker operation unavailable');
  return r.stdout.trim();
};
async function regular(path: string, limit: number): Promise<Buffer> {
  const s = await lstat(path);
  if (!s.isFile() || s.isSymbolicLink() || s.size > limit) throw new Error('irregular portable proof');
  return readFile(path);
}
async function save(path: string, receipt: PortableReceipt): Promise<void> {
  const next = path + '.next';
  await writeFile(next, JSON.stringify(receipt, null, 2) + '\n', {mode: 0o600});
  await rename(next, path);
}
async function proofRoot(plugin: AppPlugin): Promise<string> {
  const canonical = await canonicalCheckout(plugin.root);
  if (!canonical) throw new Error('canonical proof root unavailable');
  const root = join(canonical, '.local', 'evidence', 'verify');
  const ignored = await exec('git', ['-C', canonical, 'check-ignore', '-q', join(root, 'probe')]);
  if (ignored.code !== 0) throw new Error('proof root must be ignored');
  await mkdir(root, {recursive: true, mode: 0o700});
  const resolved = await realpath(root);
  const inside = relative(await realpath(canonical), resolved);
  if (inside.startsWith('..') || isAbsolute(inside)) throw new Error('proof root escaped canonical checkout');
  return resolved;
}
async function imageArtifact(receipt: PortableReceipt, run: DockerCommand): Promise<void> {
  const stage = await mkdtemp(join(await realpath(tmpdir()), 'portable-image-'));
  await chmod(stage, 0o700);
  try {
    const path = join(stage, 'artifact.json');
    await run(['cp', `${receipt.containerId!}:/opt/bunny/portable-artifact.json`, path]);
    receipt.identity.artifactDigest = portableArtifact(JSON.parse((await regular(path, 4096)).toString('utf8')), receipt.identity.revision);
  } finally {await rm(stage, {recursive: true, force: true});}
}
async function validateProofFiles(manifest: PortableManifest, i: PortableIdentity, path: (name: string) => string): Promise<void> {
  for (const file of manifest.files) {
    const bytes = await regular(path(file.name), 32 * 1024 * 1024);
    if (bytes.length !== file.bytes || hex256(bytes) !== file.sha256) throw new Error('portable artifact hash mismatch');
    if (file.name.endsWith('.json') && /Bearer |tok_SYNTHETIC|PRIVATE_CANARY|DO_NOT_OPEN/.test(bytes.toString('utf8'))) throw new Error('unsafe portable proof');
  }
  if (manifest.outcome === 'passed') {
    const log = object(JSON.parse((await regular(path('capture/assertions.json'), 1024 * 1024)).toString('utf8')));
    if (!log || log.runId !== i.runId || log.step !== i.step || log.outcome !== 'passed' || typeof log.finishedAt !== 'string'
      || !Array.isArray(log.assertions) || log.assertions.length !== manifest.assertions
      || log.assertions.some(value => object(value)?.outcome !== 'passed')
      || !await isPng(path('capture/after.png')) || !await isFinalizedWebm(path('capture/interaction.webm'))) throw new Error('finalized capture refused');
  }
}
async function retainedProof(receipt: PortableReceipt, at: string): Promise<void> {
  const directory = await lstat(join(at, 'capture'));
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('proof directory refused');
  const manifest = portableManifest(JSON.parse((await regular(join(at, 'capture-manifest.json'), 64 * 1024)).toString('utf8')), receipt.identity);
  await validateProofFiles(manifest, receipt.identity, name => join(at, ...name.split('/')));
  receipt.capture = manifest;
}
async function exportProof(receipt: PortableReceipt, at: string, run: DockerCommand): Promise<void> {
  const i = receipt.identity, id = receipt.containerId!;
  const from = `${id}:/var/lib/app-verify/${i.runId}/proof`;
  const stage = await mkdtemp(join(await realpath(tmpdir()), 'portable-export-'));
  await chmod(stage, 0o700);
  try {
    const manifestPath = join(stage, 'manifest.json');
    await run(['cp', `${from}/manifest.json`, manifestPath]);
    const manifest = portableManifest(JSON.parse((await regular(manifestPath, 64 * 1024)).toString('utf8')), i);
    for (const file of manifest.files) {
      const path = join(stage, file.name.split('/')[1]);
      await run(['cp', `${from}/${file.name}`, path]);
    }
    await validateProofFiles(manifest, i, name => join(stage, name.split('/')[1]));
    const directory = join(at, 'capture');
    await mkdir(directory, {recursive: true, mode: 0o700});
    if (!(await lstat(directory)).isDirectory() || (await lstat(directory)).isSymbolicLink()) throw new Error('proof directory refused');
    for (const file of manifest.files) {
      const path = join(at, ...file.name.split('/'));
      if (await lstat(path).catch(() => undefined)) {
        if (hex256(await regular(path, 32 * 1024 * 1024)) !== file.sha256) throw new Error('proof conflict');
      } else {await copyFile(join(stage, file.name.split('/')[1]), path, constants.COPYFILE_EXCL); await chmod(path, 0o600);}
    }
    await writeFile(join(at, 'capture-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {mode: 0o600, flag: 'wx'}).catch(async error => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || (await regular(join(at, 'capture-manifest.json'), 64 * 1024)).toString() !== JSON.stringify(manifest, null, 2) + '\n') throw error;
    });
    receipt.capture = manifest;
  } finally {await rm(stage, {recursive: true, force: true});}
}
export async function finishPortable(receipt: PortableReceipt, at: string, run: DockerCommand, allowPass: boolean, removeFailed = false): Promise<void> {
  const id = receipt.containerId, i = receipt.identity;
  if (!id || !(await stopPortableContainer(id, i, run))) {
    receipt.state = 'unknown'; receipt.cleanup.container = 'unknown'; receipt.failure = 'stop-unconfirmed';
    if (id && removeFailed) {
      try {
        if ((await run(['ps', '--all', '--no-trunc', '--filter', `id=${id}`, '--format', '{{.ID}}'])) === '') {
          receipt.cleanup.stopped = true; receipt.cleanup.container = 'removed';
          await retainedProof(receipt, at);
          receipt.state = 'failed'; receipt.failure = 'recovered-after-removal';
        }
      } catch {receipt.failure = 'recovery-unconfirmed';}
    }
    return;
  }
  receipt.cleanup.stopped = true; receipt.cleanup.container = 'left';
  const info = await inspect(id, run);
  if (!owned(info, i) || !stopped(info)) {receipt.state = 'unknown'; receipt.failure = 'stop-unconfirmed'; return;}
  receipt.state = 'failed';
  if (info.State?.ExitCode === 137) receipt.state = 'expired';
  if (i.artifactDigest === null) await imageArtifact(receipt, run);
  try {await exportProof(receipt, at, run);} catch {receipt.failure = 'proof-unavailable'; return;}
  const final = await inspect(id, run);
  if (!owned(final, i) || !stopped(final)) {receipt.failure = 'ownership-changed'; return;}
  // Keep failed/partial private captures for inspection until an explicit recovery/cleanup request.
  if (receipt.capture?.outcome !== 'passed' && !removeFailed) {receipt.failure = 'capture-incomplete'; return;}
  await run(['rm', id]);
  // Absence from a successful complete exact-ID query, never a failed inspect, establishes removal.
  const remaining = await run(['ps', '--all', '--no-trunc', '--filter', `id=${id}`, '--format', '{{.ID}}']);
  if (remaining !== '') {receipt.failure = 'removal-unconfirmed'; return;}
  receipt.cleanup.container = 'removed';
  if (allowPass && info.State?.ExitCode === 0 && receipt.capture?.outcome === 'passed') receipt.state = 'passed';
}
/** One finite foreground run, or recovery of one interrupted run. No systemd fallback is selected implicitly. */
export async function runPortableCli(plugin: AppPlugin, argv: string[], run: DockerCommand = docker): Promise<number> {
  let receipt: PortableReceipt | undefined, at: string | undefined;
  let interrupted = false;
  const interrupt = () => {interrupted = true;};
  const print = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n');
  try {
    if (plugin.app !== 'runtime' || argv[0] !== 'portable' && argv[0] !== 'portable-cleanup') throw new Error('runtime portable operation required');
    if (argv[0] === 'portable-cleanup' && (argv.length !== 2 || !RUN.test(argv[1]))) throw new Error('invalid portable arguments');
    if (argv[0] === 'portable' && (argv.length !== 7 || argv[1] !== '--image' || argv[3] !== '--step' || argv[5] !== '--seconds')) throw new Error('invalid portable arguments');
    const root = await proofRoot(plugin);
    if (argv[0] === 'portable-cleanup') {
      if (argv.length !== 2 || !RUN.test(argv[1])) throw new Error('invalid portable arguments');
      at = join(root, argv[1]);
      if ((await lstat(at)).isSymbolicLink() || relative(root, await realpath(at)).startsWith('..')) throw new Error('portable path refused');
      receipt = JSON.parse((await regular(join(at, 'portable.json'), 128 * 1024)).toString('utf8')) as PortableReceipt;
      if (receipt.receiptVersion !== PORTABLE_RECEIPT_VERSION || receipt.backend !== 'docker-foreground' || receipt.identity?.runId !== argv[1]
        || !['starting', 'running', 'passed', 'failed', 'expired', 'unknown'].includes(receipt.state)
        || !object(receipt.cleanup) || !['pending', 'removed', 'left', 'unknown'].includes(receipt.cleanup.container)
        || receipt.containerId !== null && !ID.test(receipt.containerId)) throw new Error('invalid portable receipt');
      checkIdentity(receipt.identity, true);
      if (receipt.cleanup.container === 'removed') {
        if (!receipt.containerId || (await run(['ps', '--all', '--no-trunc', '--filter', `id=${receipt.containerId}`, '--format', '{{.ID}}'])) !== '') throw new Error('absence unconfirmed');
        await retainedProof(receipt, at);
        receipt.cleanup.stopped = true;
        if (receipt.state === 'unknown' || receipt.state === 'starting' || receipt.state === 'running') {
          receipt.state = 'failed'; receipt.failure = 'recovered-after-removal';
        }
        receipt.finishedAt = new Date().toISOString(); await save(join(at, 'portable.json'), receipt);
        print(receipt); return 0;
      }
      if (!receipt.containerId) {
        const ids = (await run(['ps', '--all', '--no-trunc', '--filter', `label=org.bunny.verify.run=${receipt.identity.runId}`, '--format', '{{.ID}}'])).split('\n').filter(Boolean);
        if (ids.length !== 1 || !ID.test(ids[0])) throw new Error('container identity unresolved');
        receipt.containerId = ids[0]!;
      }
      await finishPortable(receipt, at, run, false, true);
    } else {
      if (plugin.app !== 'runtime' || argv.length !== 7 || argv[0] !== 'portable' || argv[1] !== '--image' || argv[3] !== '--step' || argv[5] !== '--seconds') throw new Error('use portable --image sha256:ID --step NAME --seconds 30..600');
      const image = argv[2], step = argv[4], seconds = Number(argv[6]);
      if (!Object.hasOwn(plugin.captureSteps, step)) throw new Error('unknown capture step');
      const build = await candidate(plugin);
      const status = await exec('git', ['-C', plugin.root, 'status', '--porcelain']);
      if (build.dirty || status.code !== 0 || status.stdout.trim()) throw new Error('clean exact candidate required');
      if (!(await plugin.prerequisites?.inspect())?.some(check => check.id === 'app-build' && check.status === 'present')) throw new Error('current host adapter build required');
      const i: PortableIdentity = {runId: newRunId('runtime'), revision: build.sourceRevision, image,
        artifactDigest: null, step, seconds};
      checkIdentity(i, true);
      const images: unknown = JSON.parse(await run(['image', 'inspect', image]));
      if (!Array.isArray(images) || images.length !== 1) throw new Error('exact portable image required');
      const meta = object(images[0]) as DockerImage | undefined;
      if (meta?.Id !== image || meta.Config?.Labels?.['org.opencontainers.image.revision'] !== i.revision
        || meta.Config?.Labels?.['org.bunny.verify.portable'] !== '1' || meta.Config?.User !== '1000:1000'
        || meta.Os !== 'linux' || !['arm64', 'amd64'].includes(meta.Architecture ?? '')) throw new Error('exact portable Linux image required');
      at = join(root, i.runId); await mkdir(at, {mode: 0o700});
      receipt = {receiptVersion: PORTABLE_RECEIPT_VERSION, identity: i, backend: 'docker-foreground', containerId: null,
        architecture: meta.Architecture ?? 'unknown', state: 'starting', startedAt: new Date().toISOString(), finishedAt: null,
        realtimeExpiryAcrossSuspend: false, capture: null, cleanup: {stopped: false, container: 'pending'}, failure: null, secrets: 'none recorded',
        components: [...plugin.components, {id: 'browser', kind: 'actual', note: 'the pinned Playwright Chromium inside this offline test image'}]};
      await save(join(at, 'portable.json'), receipt);
      receipt.containerId = (await run(portableCreateArgs(i))).trim();
      if (!ID.test(receipt.containerId)) throw new Error('container identity unresolved');
      await save(join(at, 'portable.json'), receipt);
      if (!portableContainerMatches(await inspect(receipt.containerId, run), i)) throw new Error('effective isolation refused');
      await imageArtifact(receipt, run);
      await save(join(at, 'portable.json'), receipt);
      process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
      await run(['start', receipt.containerId]);
      receipt.state = 'running'; await save(join(at, 'portable.json'), receipt);
      const until = Date.now() + seconds * 1000 + 5000;
      for (;;) {
        const c = await inspect(receipt.containerId, run);
        if (!portableContainerMatches(c, i)) throw new Error('effective isolation refused');
        if (stopped(c) || interrupted || Date.now() >= until) break;
        await pause(200);
      }
      await finishPortable(receipt, at, run, !interrupted);
    }
    receipt.finishedAt = new Date().toISOString(); await save(join(at, 'portable.json'), receipt); print(receipt);
    return receipt.state === 'passed' || argv[0] === 'portable-cleanup' && receipt.state !== 'unknown' && receipt.cleanup.container === 'removed' ? 0 : 1;
  } catch {
    if (receipt && at) {
      if (receipt.containerId) receipt.cleanup.stopped = await stopPortableContainer(receipt.containerId, receipt.identity, run);
      receipt.state = 'unknown'; receipt.failure = 'operation-unconfirmed'; receipt.cleanup.container = 'unknown';
      await save(join(at, 'portable.json'), receipt).catch(() => {});
    }
    print({operation: argv[0], state: 'unavailable', errorBody: refusalBody('invalid-receipt', 'portable operation incomplete; inspect its private receipt and recover only its exact owned container'), ...(receipt ? {runId: receipt.identity.runId} : {})});
    return 1;
  } finally {process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);}
}
