// The small, manually operated container profile. The sealed-package profile is separate and unchanged.
import {constants} from 'node:fs';
import {lstat, mkdir, open, readdir} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const producerSource = /^bunny\/parts\/hub-[0-9a-f]{32}(?![\s\S])/;

export function containerOptions(env) {
  const access = env.BUNNY_ACCESS ?? 'isolated';
  const loopback = access === 'host-local' || access === 'private-proxy';
  const control = env.BUNNY_CONTROL ?? 'disabled';
  const stateDir = env.BUNNY_STATE_DIR ?? '/var/lib/bunny';
  const config = env.BUNNY_CONFIG ?? '/etc/bunny/runtime.json';
  const portText = env.BUNNY_PORT ?? (loopback ? '18788' : '8788');
  const ingestSource = env.BUNNY_INGEST_SOURCE;
  if (!['isolated', 'host-local', 'private-proxy'].includes(access) || !['disabled', 'enabled'].includes(control) || !isAbsolute(stateDir) || !isAbsolute(config)
    || (ingestSource !== undefined && (!loopback || !producerSource.test(ingestSource)))
    || (loopback && (control !== 'disabled' || portText !== '18788'
      || stateDir !== '/var/lib/bunny' || config !== '/etc/bunny/runtime.json'))
    || !/^[1-9][0-9]*$/.test(portText) || Number(portText) > 65535) throw new Error('container-options-refused');
  return {control, stateDir, config, port: Number(portText), access, ...(ingestSource === undefined ? {} : {ingestSource})};
}

// Input has already passed the shared credential parser. This profile narrows its grants further.
export function checkLocalBrowserCredentials(credentials, ingestSource, access = 'host-local') {
  if (access === 'private-proxy') {
    if (credentials.some(credential => credential.role !== undefined || credential.robotId !== undefined
      || credential.scopes.some(scope => !['read', 'control', 'ingest'].includes(scope)))) throw new Error('container-browser-config-refused');
    if (ingestSource !== undefined) checkLocalBrowserCredentials(credentials.filter(credential => credential.source === ingestSource), ingestSource);
    return;
  }
  if (ingestSource === undefined) {
    if (credentials.length !== 0) throw new Error('container-browser-config-refused');
    return;
  }
  const credential = credentials[0];
  if (!producerSource.test(ingestSource) || credentials.length !== 1
    || credential.id !== ingestSource.slice('bunny/parts/'.length) || credential.source !== ingestSource
    || credential.scopes.length !== 1 || credential.scopes[0] !== 'ingest'
    || credential.role !== undefined || credential.robotId !== undefined) throw new Error('container-browser-config-refused');
}

/**
 * Admits the browser-only edge and a section only for a shipped module that declares no device simulation (Hub #1202),
 * without its own secrets and with every module it starts after also hosted. Returns those modules' registrations in
 * `shipped` order.
 */
export function checkLocalBrowserConfig(config, shipped, access = 'host-local') {
  const admitted = new Set(shipped.filter(registration => registration.simulation === undefined).map(({name}) => name));
  const hosted = shipped.filter(registration => Object.hasOwn(config.modules, registration.name));
  if (Object.entries(config.modules).some(([name, section]) => !admitted.has(name) || Object.hasOwn(Object(section), 'secrets'))
    || hosted.some(({after = []}) => after.some(name => !Object.hasOwn(config.modules, name)))
    || config.edge?.credentials !== '/run/secrets/bunny/edge.json'
    || config.edge.browserAccess !== 'trusted-loopback' || config.edge.launcher !== false || config.edge.mcp !== false
    || config.edge.wifiProxy !== undefined
    || (access === 'private-proxy' ? config.edge.privateProxy === undefined : config.edge.privateProxy !== undefined)) {
    throw new Error('container-browser-config-refused');
  }
  return hosted;
}

/**
 * The host-local profile's modules, with device control disabled: the core, then each admitted module that has a
 * section. Built before state effects so that a refusal leaves no trace. `runtime` is the runtime's modules.js.
 */
export function hostLocalModules(config, {coreFactory, shippedModules, buildModules}, checkConfiguration, access = 'host-local') {
  const factories = [coreFactory, ...checkLocalBrowserConfig(config, shippedModules.slice(1), access)];
  const modules = buildModules(factories, false);
  refuseNamedDevices(modules, config, checkConfiguration);
  return {factories, modules};
}

/** Refuses an admitted module whose configuration the runtime would accept with a device; a refused one stays the runtime's to show. */
export function refuseNamedDevices(modules, config, checkConfiguration) {
  for (const module of modules.slice(1)) {
    const checked = checkConfiguration(module.manifest, config.modules[module.manifest.name]);
    if (checked.status === 'accepted' && checked.devices.length !== 0) throw new Error('container-browser-config-refused');
  }
}

async function start(options) {
  if (process.platform !== 'linux' || process.getuid?.() === 0) throw new Error('container-host-refused');
  process.umask(0o077);
  const [{checkStateDirectory, prepareStateDirectory, readRuntimeConfig}, {acquireRuntimeOwnership},
    {bindCoreRuntimeOwnership}, runtimeModules, {parseArguments, runProcess}] = await Promise.all([
    import('../../apps/runtime/dist/src/state.js'),
    import('../../apps/runtime/dist/src/runtime-ownership.js'), import('../../apps/runtime/dist/src/core/core.js'),
    import('../../apps/runtime/dist/src/modules.js'), import('../../apps/runtime/dist/src/process.js'),
  ]);
  // Read protected configuration before state effects. No default credential or remote listener is created.
  const config = await readRuntimeConfig(options.config);
  const {coreFactory, shippedModules, buildModules} = runtimeModules;
  let factories = options.control === 'disabled' ? [coreFactory] : shippedModules;
  let hosted;
  if (options.access === 'host-local' || options.access === 'private-proxy') {
    const [{readEdgeCredentials}, {checkConfiguration}] = await Promise.all([
      import('../../apps/runtime/dist/src/credentials.js'), import('../../packages/sdk/dist/src/index.js'),
    ]);
    // Device control stays disabled; only configured modules that reach no device join the core.
    ({factories, modules: hosted} = hostLocalModules(config, runtimeModules, checkConfiguration, options.access));
    checkLocalBrowserCredentials(await readEdgeCredentials(config.edge.credentials), options.ingestSource, options.access);
  }
  await checkStateDirectory(options.stateDir);
  await refusePendingRestore(options.stateDir);
  await prepareStateDirectory(options.stateDir);
  // Only an empty, verified state root is fresh. Never run a creating SQLite helper on inherited coordination.
  if ((await readdir(options.stateDir)).length === 0) {
    const modules = join(options.stateDir, 'modules');
    await mkdir(modules, {mode: 0o700}); // Exclusive creation: a competing bootstrap causes refusal.
    await checkStateDirectory(modules);
    const file = await open(join(modules, 'core.sqlite-owner'), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await file.close();
  }
  const ownership = await acquireRuntimeOwnership(options.stateDir);
  try {await refusePendingRestore(options.stateDir);}
  catch (error) {ownership.releaseBeforeStartup(); throw error;}
  const modules = hosted ?? buildModules(factories, false);
  bindCoreRuntimeOwnership(modules[0], ownership);
  const parsed = parseArguments(['--port', String(options.port), '--state-dir', options.stateDir, '--environment', 'production']);
  // The real core consumes the held ownership capability; stopping its store cannot release process ownership.
  await runProcess({...parsed, modules: factories, edge: config.edge !== undefined}, {
    modules, config, ...(options.access === 'host-local' || options.access === 'private-proxy' ? {listener: 'container-host-local'} : {}),
  });
}

async function refusePendingRestore(stateDir) {
  const pending = await lstat(join(stateDir, '.restore-pending')).then(() => true, error => {
    if (error.code === 'ENOENT') return false;
    throw error;
  });
  if (pending) throw new Error('restore-pending');
}

async function status(options) {
  const response = await fetch(`http://127.0.0.1:${options.port}/api/runtime/v1/health`, {signal: AbortSignal.timeout(3000)});
  if (!response.ok) throw new Error('container-health-unavailable');
  const health = await response.json();
  if (health.schema !== 'runtime-health/1.0') throw new Error('container-health-invalid');
  process.stdout.write(JSON.stringify(health) + '\n');
  if (health.status !== 'ok') process.exitCode = 1;
}

export async function main(args, env = process.env) {
  if (args.length > 1 || !['start', 'status'].includes(args[0] ?? 'start')) throw new Error('container-command-refused');
  const options = containerOptions(env);
  if (args[0] === 'status') await status(options);
  else await start(options);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {await main(process.argv.slice(2));}
  catch {
    // Configuration values, paths, credentials and arbitrary dependency exceptions never become CLI diagnostics.
    process.stderr.write('container operation refused; check the private inputs, owner and runtime status\n');
    process.exitCode = 2;
  }
}
