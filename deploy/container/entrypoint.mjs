// The small, manually operated container profile. The sealed-package profile is separate and unchanged.
import {constants} from 'node:fs';
import {lstat, mkdir, open, readdir} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const producerSource = /^bunny\/parts\/hub-[0-9a-f]{32}(?![\s\S])/;

export function containerOptions(env) {
  const access = env.BUNNY_ACCESS ?? 'isolated';
  const control = env.BUNNY_CONTROL ?? 'disabled';
  const stateDir = env.BUNNY_STATE_DIR ?? '/var/lib/bunny';
  const config = env.BUNNY_CONFIG ?? '/etc/bunny/runtime.json';
  const portText = env.BUNNY_PORT ?? (access === 'host-local' ? '18788' : '8788');
  const ingestSource = env.BUNNY_INGEST_SOURCE;
  if (!['isolated', 'host-local'].includes(access) || !['disabled', 'enabled'].includes(control) || !isAbsolute(stateDir) || !isAbsolute(config)
    || (ingestSource !== undefined && (access !== 'host-local' || !producerSource.test(ingestSource)))
    || (access === 'host-local' && (control !== 'disabled' || portText !== '18788'
      || stateDir !== '/var/lib/bunny' || config !== '/etc/bunny/runtime.json'))
    || !/^[1-9][0-9]*$/.test(portText) || Number(portText) > 65535) throw new Error('container-options-refused');
  return {control, stateDir, config, port: Number(portText), access, ...(ingestSource === undefined ? {} : {ingestSource})};
}

// Input has already passed the shared credential parser. This profile narrows its grants further.
export function checkLocalBrowserCredentials(credentials, ingestSource) {
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

export function checkLocalBrowserConfig(config) {
  if (Object.keys(config.modules).length !== 0 || config.edge?.credentials !== '/run/secrets/bunny/edge.json'
    || config.edge.browserAccess !== 'trusted-loopback' || config.edge.launcher !== false || config.edge.mcp !== false
    || config.edge.wifiProxy !== undefined) {
    throw new Error('container-browser-config-refused');
  }
}

async function start(options) {
  if (process.platform !== 'linux' || process.getuid?.() === 0) throw new Error('container-host-refused');
  process.umask(0o077);
  const [{checkStateDirectory, prepareStateDirectory, readRuntimeConfig}, {acquireRuntimeOwnership},
    {bindCoreRuntimeOwnership}, {coreFactory, shippedModules, buildModules}, {parseArguments, runProcess}] = await Promise.all([
    import('../../apps/runtime/dist/src/state.js'),
    import('../../apps/runtime/dist/src/runtime-ownership.js'), import('../../apps/runtime/dist/src/core/core.js'),
    import('../../apps/runtime/dist/src/modules.js'), import('../../apps/runtime/dist/src/process.js'),
  ]);
  // Read protected configuration before state effects. No default credential or remote listener is created.
  const config = await readRuntimeConfig(options.config);
  if (options.access === 'host-local') {
    const {readEdgeCredentials} = await import('../../apps/runtime/dist/src/credentials.js');
    checkLocalBrowserConfig(config);
    checkLocalBrowserCredentials(await readEdgeCredentials(config.edge.credentials), options.ingestSource);
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
  const factories = options.control === 'disabled' ? [coreFactory] : shippedModules;
  const modules = buildModules(factories, false);
  bindCoreRuntimeOwnership(modules[0], ownership);
  const parsed = parseArguments(['--port', String(options.port), '--state-dir', options.stateDir, '--environment', 'production']);
  // The real core consumes the held ownership capability; stopping its store cannot release process ownership.
  await runProcess({...parsed, modules: factories, edge: config.edge !== undefined}, {
    modules, config, ...(options.access === 'host-local' ? {listener: 'container-host-local'} : {}),
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
