import {execFileSync} from 'node:child_process';
import {loadavg, platform, release} from 'node:os';
import {isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {coreHealth, countSlots, MAX_CHECK_MS, parseContainers} from './pool.mjs';
import {profiles, selectProfile} from './profile.mjs';

const UNKNOWN = {pressure: 'unknown', testSlots: null};
const EXCLUDED_MAC = /^(?:bunny-(?:diagnostics|tronbyt)-|bunny-tests-pool-)/u;
const CORE_IMAGE = /^(?:bunny-core:|[0-9a-f]{12,64}$|sha256:[0-9a-f]{64}$)/u;

// Match the native suite examples in docs/development.md. Only the count leaves this function.
export function nativeTestSlots(listing) {
  if (listing === null) return null;
  return listing.split('\n').filter(line => {
    const command = line.trim();
    return /^(?:\S+\/)?(?:node|[Pp]ython[0-9.]*)\s/u.test(command) &&
      /(?:--test|\/tests\/|unittest|vitest|scripts\/check-)/u.test(command) &&
      !command.includes('--test-isolation=process');
  }).length;
}

/** A routing observation. The host's normal admission still decides whether a test can start. */
export function observeTestResources(destination, {host, load, docker, processes}) {
  let profile;
  try {
    if (destination === 'mac' && host.platform === 'darwin') profile = profiles.mac;
    else if (destination === 'pc') profile = selectProfile({BUNNY_TEST_HOST: 'pc'}, host);
    else return UNKNOWN;
  } catch {return UNKNOWN;}

  if (!Number.isFinite(load) || load < 0) return UNKNOWN;
  const pressure = load > profile.stopLoad ? 'high' : load >= profile.startLoad ? 'elevated' : 'normal';
  if (pressure !== 'normal') return {pressure, testSlots: 0};
  const containersText = docker(['ps', '-a', '--format', '{{.Names}}\t{{.State}}\t{{.Image}}']);
  if (containersText === null) return {pressure, testSlots: null};
  const {names, states, running} = parseContainers(containersText);
  if (profile.core && names.includes(profile.core)) {
    const health = coreHealth(docker(['inspect', '--format', '{{json .State.Health}}', profile.core]));
    if (states[profile.core] !== 'running') return {pressure, testSlots: 0};
    if (health.status === 'unreadable' || health.lastMs === null) return {pressure, testSlots: null};
    if (health.status !== 'healthy' || health.lastMs >= MAX_CHECK_MS) return {pressure, testSlots: 0};
  }

  const native = nativeTestSlots(processes());
  if (native === null) return {pressure, testSlots: null};
  if (profile === profiles.pc) {
    const used = running.reduce((slots, name) => slots + (name.endsWith('-wide') ? 2 : 1), native);
    return {pressure, testSlots: Math.max(0, profile.slots - used)};
  }

  const runningSet = new Set(running);
  const operators = containersText.split('\n').map(row => row.split('\t')).filter(([name, , image]) =>
    name !== profile.core && runningSet.has(name) && /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/u.test(name) &&
    !EXCLUDED_MAC.test(name) && !name.startsWith('bunny-gh') && !name.startsWith('bunny-runtime-check-') && CORE_IMAGE.test(image ?? ''));
  const memory = operators.length === 0 ? '' : docker(['inspect', '--type', 'container', '--format', '{{.HostConfig.Memory}}', ...operators.map(([name]) => name)]);
  if (memory === null) return {pressure, testSlots: null};
  const memories = memory === '' ? [] : memory.split('\n');
  if (memories.length !== operators.length || memories.some(value => !/^\d+$/u.test(value))) return {pressure, testSlots: null};
  const operatorSlots = memories.reduce((slots, bytes) => slots + (bytes === '4294967296' ? 2 : 0), 0);
  return {pressure, testSlots: Math.max(0, profile.slots - native - countSlots(running) - operatorSlots)};
}

const read = (command, args, env = process.env) => {
  try {return execFileSync(command, args, {env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1024 * 1024, timeout: 1_000}).trim();}
  catch {return null;}
};

function observeLocal(destination) {
  const host = {platform: platform(), osRelease: release()};
  const env = {...process.env};
  const configuredHost = env.DOCKER_CONTEXT ? undefined : env.DOCKER_HOST;
  const dockerHost = configuredHost ?? read('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']);
  delete env.DOCKER_CONTEXT;
  delete env.DOCKER_HOST;
  return observeTestResources(destination, {host, load: loadavg()[0],
    docker: args => dockerHost?.startsWith('unix://') && isAbsolute(dockerHost.slice('unix://'.length))
      ? read('docker', ['--host', dockerHost, ...args], env) : null,
    processes: () => read('/bin/ps', host.platform === 'darwin' ? ['-axo', 'command='] : ['-eo', 'args='])});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${JSON.stringify(observeLocal(process.argv[2]))}\n`);
}
