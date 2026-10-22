#!/usr/bin/env node
// Small, explicit operator surface. No downloads, automatic restart, migration or device handoff.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {dirname, join, resolve, isAbsolute} from 'node:path';
import {lstat, realpath} from 'node:fs/promises';

const execute = promisify(execFile);
const composeDefault = fileURLToPath(new URL('../deploy/container/compose.yaml', import.meta.url));
const refuse = () => {throw new Error('operator-refused');};
export const usage = 'node scripts/bunny.mjs <start|stop|status|backup DESTINATION|restore ARCHIVE> --project NAME [--compose FILE] [--archive-volume NAME]';
export async function docker(args) {
  const result = await execute('docker', args, {encoding: 'utf8', maxBuffer: 1024 * 1024});
  return result.stdout.trim();
}
export function parse(argv) {
  const {values, positionals} = parseArgs({args: argv, strict: true, allowPositionals: true,
    options: {project: {type: 'string'}, compose: {type: 'string'}, revision: {type: 'string'}, destination: {type: 'string'}, archive: {type: 'string'}, 'archive-volume': {type: 'string'}}});
  const command = positionals[0];
  if (['worker-backup', 'worker-restore'].includes(command)) {
    if (positionals.length !== 1 || values['archive-volume'] !== undefined || values.project !== undefined || values.compose !== undefined
      || !/^[0-9a-f]{40}$/.test(values.revision ?? '')
      || (command === 'worker-backup' ? values.destination === undefined || values.archive !== undefined : values.archive === undefined || values.destination !== undefined)) refuse();
    return {command, ...values};
  }
  if (!['start', 'stop', 'status', 'backup', 'restore'].includes(command) || !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(values.project ?? '')
    || values.revision !== undefined || values.destination !== undefined || values.archive !== undefined
    || positionals.length !== (['backup', 'restore'].includes(command) ? 2 : 1)) refuse();
  if (values['archive-volume'] !== undefined && (!['backup', 'restore'].includes(command)
    || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,127}$/.test(values['archive-volume'])
    || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(positionals[1]))) refuse();
  return {command, archiveVolume: values['archive-volume'], project: values.project, compose: resolve(values.compose ?? composeDefault), path: positionals[1]};
}
function stopped(info) {
  if (!['created', 'exited'].includes(info.State?.Status) || info.State.Running !== false || info.State.Restarting !== false || info.State.Pid !== 0
    || info.HostConfig?.RestartPolicy?.Name !== 'no') refuse();
}
function container(info, project) {
  if (!/^[0-9a-f]{64}$/.test(info.Id ?? '') || !/^sha256:[0-9a-f]{64}$/.test(info.Image ?? '')
    || info.Config?.Labels?.['com.docker.compose.project'] !== project || info.Config?.Labels?.['com.docker.compose.service'] !== 'core'
    || info.Config?.User !== '1000:1000' || info.HostConfig?.RestartPolicy?.Name !== 'no') refuse();
  const destinations = ['/var/lib/bunny', '/etc/bunny', '/run/secrets/bunny'];
  const overlaps = (a, b) => a === b || a === '/' || b === '/' || a.startsWith(b + '/') || b.startsWith(a + '/');
  if (!Array.isArray(info.Mounts) || info.Mounts.some(m => typeof m.Destination !== 'string'
    || (!destinations.includes(m.Destination) && destinations.some(path => overlaps(path, m.Destination))))) refuse();
  const mounts = info.Mounts.filter(m => destinations.includes(m.Destination));
  if (mounts.length !== 3 || new Set(mounts.map(m => m.Destination)).size !== 3 || new Set(mounts.map(m => m.Name)).size !== 3
    || mounts.some(m => m.Type !== 'volume' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/.test(m.Name)
      || m.RW !== (m.Destination === '/var/lib/bunny'))) refuse();
  return mounts;
}
function localBinding(ports) {
  const bindings = ports?.['18788/tcp'];
  return ports !== undefined && ports !== null && Object.keys(ports).length === 1
    && Array.isArray(bindings) && bindings.length === 1
    && bindings[0].HostIp === '127.0.0.1' && bindings[0].HostPort === '18788';
}
async function access(info, project, run) {
  const ports = info.HostConfig?.PortBindings ?? {};
  const value = name => {
    const entries = (info.Config?.Env ?? []).filter(entry => entry.startsWith(name + '='));
    if (entries.length > 1) refuse();
    return entries[0]?.slice(name.length + 1);
  };
  const profile = value('BUNNY_ACCESS') ?? 'isolated';
  // eslint-disable-next-line bunny/no-raw-outcome-literal -- Docker network-mode identifier, not an evidence outcome.
  const isolatedNetwork = 'none';
  if (profile === 'isolated') {
    if (Object.keys(ports).length !== 0 || info.Config?.Labels?.['io.bunny.access'] !== undefined
      || info.HostConfig?.NetworkMode !== isolatedNetwork
      || Object.keys(info.NetworkSettings?.Networks ?? {}).some(name => name !== isolatedNetwork)) refuse();
    return;
  }
  const name = project + '_local';
  const networks = info.NetworkSettings?.Networks;
  if (profile !== 'host-local' || info.Config?.Labels?.['io.bunny.access'] !== 'host-local'
    || value('BUNNY_CONTROL') !== 'disabled' || value('BUNNY_PORT') !== '18788'
    || ![undefined, '/var/lib/bunny'].includes(value('BUNNY_STATE_DIR'))
    || ![undefined, '/etc/bunny/runtime.json'].includes(value('BUNNY_CONFIG'))
    || !localBinding(ports)
    || (info.State?.Running && !localBinding(info.NetworkSettings?.Ports))
    || info.HostConfig?.NetworkMode !== name || !networks || Object.keys(networks).length !== 1 || !networks[name]) refuse();
  const selected = JSON.parse(await run(['network', 'inspect', name]));
  const network = selected[0];
  if (selected.length !== 1 || network.Name !== name || !/^[0-9a-f]{64}$/.test(network.Id ?? '')
    || network.Driver !== 'bridge' || network.Scope !== 'local' || network.Internal !== false
    || network.Attachable !== false || network.EnableIPv6 !== false
    || Object.entries(network.Options ?? {}).some(([key, value]) => key !== 'com.docker.network.enable_ipv4' || value !== 'true')
    || network.Labels?.['com.docker.compose.project'] !== project || network.Labels?.['com.docker.compose.network'] !== 'local'
    || Object.keys(network.Containers ?? {}).some(id => id !== info.Id)
    || (networks[name].NetworkID && networks[name].NetworkID !== network.Id)
    || (info.State?.Running && networks[name].NetworkID !== network.Id)) refuse();
}
async function ordinaryVolume(name, run) {
  const volumes = JSON.parse(await run(['volume', 'inspect', name]));
  if (!Array.isArray(volumes) || volumes.length !== 1 || volumes[0].Name !== name
    || volumes[0].Driver !== 'local' || volumes[0].Scope !== 'local'
    || Object.keys(volumes[0].Options ?? {}).length !== 0) refuse();
}
async function selected(plan, run) {
  const raw = await run(['ps', '-aq', '--no-trunc', '--filter', 'label=com.docker.compose.project=' + plan.project,
    '--filter', 'label=com.docker.compose.service=core']);
  if (raw === '') return undefined;
  const ids = raw.split(/\s+/); if (ids.length !== 1 || !/^[0-9a-f]{64}$/.test(ids[0])) refuse();
  const rows = JSON.parse(await run(['inspect', ids[0]]));
  if (!Array.isArray(rows) || rows.length !== 1) refuse();
  container(rows[0], plan.project); return rows[0];
}
export async function privateHostDirectory(path) {
  // Windows ACL qualification belongs to its host lane; a POSIX-looking mode alone is insufficient there.
  if (process.getuid === undefined || !isAbsolute(path) || resolve(path) !== path || await realpath(path) !== path) refuse();
  const info = await lstat(path);
  if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o7777) !== 0o700) refuse();
  for (let at = path; ; at = dirname(at)) {
    const git = await lstat(join(at, '.git')).catch(error => {if (error.code === 'ENOENT') return undefined; throw error;});
    if (git !== undefined) refuse();
    if (dirname(at) === at) break;
  }
}
export async function operate(plan, run = docker, checkPrivate = privateHostDirectory) {
  if (plan.command.startsWith('worker-')) {
    if (process.platform !== 'linux') refuse();
    const {backup, restore} = await import('./bunny-backup.mjs');
    return plan.command === 'worker-backup' ? backup(plan) : restore(plan);
  }
  let info = await selected(plan, run);
  if (plan.command === 'status') return {operation: 'status', status: info?.State?.Status ?? 'not-created', health: 'not-checked'};
  if (plan.command === 'start') {
    if (info === undefined) {
      // Inspect the created configuration/network before any listener or runtime effects.
      await run(['compose', '-f', plan.compose, '-p', plan.project, 'create', '--no-build', '--pull', 'never', 'core']);
      info = await selected(plan, run); if (info === undefined) refuse();
    }
    try {await access(info, plan.project, run);}
    catch (error) {
      if (info.State.Running && info.Config.Labels['io.bunny.access'] === 'host-local') await run(['stop', '--timeout', '30', info.Id]);
      throw error;
    }
    if (info.State.Status === 'running') return {operation: 'start', status: 'running', health: 'not-checked'};
    stopped(info); await run(['start', info.Id]);
    info = await selected(plan, run);
    if (info?.State?.Status !== 'running') refuse();
    try {await access(info, plan.project, run);}
    catch (error) {await run(['stop', '--timeout', '30', info.Id]); throw error;}
    return {operation: 'start', status: 'running', health: 'not-checked'};
  }
  if (info === undefined) refuse();
  if (plan.command === 'stop') {
    if (info.State.Status === 'running') await run(['stop', '--timeout', '30', info.Id]);
    const after = await selected(plan, run);
    if (after?.Id !== info.Id) refuse(); stopped(after);
    return {operation: 'stop', status: 'stopped'};
  }
  stopped(info);
  const mounts = container(info, plan.project);
  await access(info, plan.project, run);
  for (const mount of mounts) await ordinaryVolume(mount.Name, run);
  const images = JSON.parse(await run(['image', 'inspect', info.Image]));
  const revision = images[0]?.Config?.Labels?.['org.opencontainers.image.revision'];
  if (images.length !== 1 || !/^[0-9a-f]{40}$/.test(revision ?? '')) refuse();
  let archiveMount, target;
  if (plan.archiveVolume !== undefined) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,127}$/.test(plan.archiveVolume)
      || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(plan.path)
      || mounts.some(m => m.Name === plan.archiveVolume)) refuse();
    await ordinaryVolume(plan.archiveVolume, run);
    archiveMount = `type=volume,source=${plan.archiveVolume},target=/backup`;
    target = '/backup/' + plan.path;
  } else {
    if (!isAbsolute(plan.path) || resolve(plan.path) !== plan.path || plan.path.includes(',')) refuse();
    const parent = plan.command === 'backup' ? dirname(plan.path) : plan.path;
    await checkPrivate(parent);
    archiveMount = `type=bind,source=${parent},target=/backup`;
    target = plan.command === 'backup' ? '/backup/' + plan.path.slice(parent.length + 1) : '/backup';
    if (plan.command === 'backup' && target === '/backup/') refuse();
  }
  const mountArgs = mounts.flatMap(m => ['--mount', `type=volume,source=${m.Name},target=${m.Destination}${m.RW ? '' : ',readonly'}`]);
  const workerArgs = ['run', '--rm', '--pull', 'never', '--network=none', '--read-only', '--user', '1000:1000',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--tmpfs', '/tmp:rw,nosuid,nodev,mode=700,uid=1000,gid=1000',
    ...mountArgs, '--mount', `${archiveMount}${plan.command === 'restore' ? ',readonly' : ''}`,
    '--entrypoint', 'node', info.Image, '/opt/bunny/scripts/bunny.mjs', 'worker-' + plan.command,
    plan.command === 'backup' ? '--destination' : '--archive', target, '--revision', revision];
  const result = JSON.parse(await run(workerArgs));
  if (result.operation !== plan.command || result.status !== 'complete') refuse();
  return result;
}
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {process.stdout.write(JSON.stringify(await operate(parse(process.argv.slice(2)))) + '\n');}
  catch {process.stderr.write('B.U.N.N.Y. operation did not complete. Keep partial output and inspect the selected stopped instance; do not retry a partial restore.\n'); process.exitCode = 1;}
}
