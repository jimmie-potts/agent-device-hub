// Local facts for a proposed run. No application, listener, browser or run state is created.
import {constants} from 'node:fs';
import {existsSync} from 'node:fs';
import {access} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {AppPlugin, PrerequisiteCheck, PrerequisiteResult} from './types.js';
import {resolveRoots, RootError} from './roots.js';
import {exec, KEBAB, which} from './util.js';
import {VERSION} from './version.js';

type Env = Readonly<Record<string, string | undefined>>;
type Probe = {access: typeof access; exec: typeof exec; which: typeof which; resolveRoots: typeof resolveRoots};
const localProbe: Probe = {access, exec, which, resolveRoots};
type Phase = PrerequisiteCheck['phase'];
const phases: readonly Phase[] = ['launch', 'capture', 'handoff'];
const statuses = new Set<PrerequisiteCheck['status']>(['present', 'missing', 'unknown', 'unsupported']);
const managerStates = new Set(['running', 'degraded', 'starting', 'initializing']);
const rootNext = 'Choose an accessible, ignored proof root and a private runtime root outside Git.';

const row = (id: string, phase: Phase, status: PrerequisiteCheck['status'], reason: string, next?: string): PrerequisiteCheck =>
  ({id, phase, status, reason, ...(next ? {next} : {})});

/** Only an existing ancestor can be inspected without creating a root. A positive heuristic does not prove a write. */
async function rootAccess(path: string, id: string, phase: Phase, probe: Probe): Promise<PrerequisiteCheck> {
  let ancestor = path;
  while (!existsSync(ancestor) && dirname(ancestor) !== ancestor) ancestor = dirname(ancestor);
  try {
    await probe.access(ancestor, constants.W_OK | constants.X_OK);
    return row(id, phase, 'unknown', 'write-not-probed');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'EACCES' || code === 'EPERM'
      ? row(id, phase, 'missing', 'parent-access-denied', rootNext)
      : row(id, phase, 'unknown', 'parent-access-unreadable');
  }
}

/** Validate plug-in output before it becomes a human-facing result. Never print a thrown error. */
function adapterChecks(value: unknown): PrerequisiteCheck[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) return undefined;
  const seen = new Set<string>();
  const checked: PrerequisiteCheck[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return undefined;
    const {id, phase, status, reason, next} = item as Partial<PrerequisiteCheck>;
    if (typeof id !== 'string' || !KEBAB.test(id) || seen.has(id) || !phases.includes(phase as Phase) || !statuses.has(status as PrerequisiteCheck['status'])) return undefined;
    if (typeof reason !== 'string' || !KEBAB.test(reason)) return undefined;
    if (next !== undefined && (typeof next !== 'string' || next.length > 120 || /[\r\n\0\/\\]/.test(next))) return undefined;
    seen.add(id);
    checked.push({id, phase: phase as Phase, status: status as PrerequisiteCheck['status'], reason, ...(next ? {next} : {})});
  }
  return checked;
}

/** Feature negotiation for an older adapter's `help` response. */
export function prerequisitesSupport(help: unknown): 'supported' | 'unsupported' | 'unknown' {
  if (!help || typeof help !== 'object') return 'unknown';
  const operations = (help as {operations?: unknown}).operations;
  if (!Array.isArray(operations) || !operations.every(operation => typeof operation === 'string')) return 'unknown';
  return operations.some(operation => operation === 'prerequisites' || operation.startsWith('prerequisites ')) ? 'supported' : 'unsupported';
}

/** Observe local prerequisites. A successful return never qualifies launch, capture or handoff. */
export async function inspectPrerequisites(plugin: AppPlugin, env: Env = process.env): Promise<PrerequisiteResult> {
  return inspectPrerequisitesWith(plugin, env);
}

/** Internal observation seam for deterministic missing and denied-path tests. */
export async function inspectPrerequisitesWith(plugin: AppPlugin, env: Env, probe: Probe = localProbe): Promise<PrerequisiteResult> {
  const checks: PrerequisiteCheck[] = [];
  checks.push(row('linux-host', 'launch', process.platform === 'linux' ? 'present' : 'missing', process.platform === 'linux' ? 'linux' : 'linux-required',
    process.platform === 'linux' ? undefined : 'Use a Linux WSL checkout.'));
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push(row('node-runtime', 'launch', nodeMajor >= 22 ? 'present' : 'missing', nodeMajor >= 22 ? 'node-supported' : 'node-too-old',
    nodeMajor >= 22 ? undefined : 'Use Node 22 or later; the Hub uses Node 24.'));

  const systemctl = probe.which('systemctl', '/usr/bin:/bin', '/');
  if (!systemctl) checks.push(row('user-manager', 'launch', 'missing', 'systemctl-missing', 'Install the Linux systemd tools.'));
  else {
    const answer = await probe.exec(systemctl, ['--user', 'is-system-running'], {timeoutMs: 10000, env: env as NodeJS.ProcessEnv});
    const state = answer.stdout.trim();
    checks.push(managerStates.has(state)
      ? row('user-manager', 'launch', 'present', 'manager-visible')
      : row('user-manager', 'launch', state === 'offline' ? 'missing' : 'unknown', state === 'offline' ? 'manager-offline' : 'manager-unreadable', 'Check the local user manager in the selected execution host.'));
  }
  const systemdRun = probe.which('systemd-run', '/usr/bin:/bin', '/');
  let systemdRunStatus: PrerequisiteCheck['status'] = 'missing';
  let systemdRunReason = 'tool-missing';
  if (systemdRun) {
    try {
      await probe.access(systemdRun, constants.X_OK);
      systemdRunStatus = 'present';
      systemdRunReason = 'tool-executable';
    } catch (error) {
      systemdRunReason = (error as NodeJS.ErrnoException).code === 'EACCES' ? 'tool-not-executable' : 'tool-unreadable';
      systemdRunStatus = systemdRunReason === 'tool-not-executable' ? 'missing' : 'unknown';
    }
  }
  checks.push(row('systemd-run-tool', 'launch', systemdRunStatus, systemdRunReason,
    systemdRunStatus === 'present' ? undefined : 'Install the Linux systemd tools.'));

  try {
    const roots = await probe.resolveRoots(plugin, env);
    checks.push(row('proof-root', 'handoff', 'present', 'ignored-location'));
    checks.push(row('runtime-root', 'launch', 'present', 'outside-checkout'));
    checks.push(await rootAccess(roots.proof, 'proof-write', 'handoff', probe));
    checks.push(await rootAccess(roots.runtime, 'runtime-write', 'launch', probe));
  } catch (error) {
    if (error instanceof RootError) {
      checks.push(row(error.code === 'proof-root-unusable' ? 'proof-root' : 'runtime-root', error.code === 'proof-root-unusable' ? 'handoff' : 'launch', 'missing', error.code, rootNext));
    } else checks.push(row('storage-roots', 'launch', 'unknown', 'root-inspection-failed'));
    checks.push(row('proof-write', 'handoff', 'unknown', 'root-unresolved'));
    checks.push(row('runtime-write', 'launch', 'unknown', 'root-unresolved'));
  }

  const require = createRequire(join(plugin.root, 'package.json'));
  let browser: {executablePath?: () => string} | undefined;
  for (const name of plugin.browser?.modules ?? ['playwright', '@playwright/test']) {
    try {
      const located = require.resolve(name);
      const loaded = await import(pathToFileURL(located).href) as {chromium?: typeof browser; default?: {chromium?: typeof browser}};
      browser = loaded.chromium ?? loaded.default?.chromium;
      if (browser) break;
    } catch { /* A missing or unreadable module cannot be used for capture. */ }
  }
  if (!browser) checks.push(row('playwright-module', 'capture', 'missing', 'module-unavailable', 'Install the checkout dependencies.'));
  else {
    checks.push(row('playwright-module', 'capture', 'present', 'module-resolved'));
    const browserEnvironmentDiffers = ['PLAYWRIGHT_BROWSERS_PATH', 'HOME', 'XDG_CACHE_HOME']
      .some(key => env[key] !== process.env[key]);
    if (browserEnvironmentDiffers) checks.push(row('chromium-file', 'capture', 'unknown', 'browser-environment-differs'));
    else try {
      const executable = browser.executablePath?.();
      if (!executable) checks.push(row('chromium-file', 'capture', 'unknown', 'path-unavailable'));
      else {
        await probe.access(executable, constants.X_OK);
        checks.push(row('chromium-file', 'capture', 'present', 'file-accessible'));
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      checks.push(row('chromium-file', 'capture', code === 'ENOENT' || code === 'EACCES' ? 'missing' : 'unknown', code === 'ENOENT' ? 'file-missing' : code === 'EACCES' ? 'file-denied' : 'file-unreadable', 'Install the checkout Chromium build.'));
    }
  }

  if (plugin.prerequisites) {
    try {
      const adapted = adapterChecks(await plugin.prerequisites.inspect());
      if (!adapted || adapted.some(check => checks.some(existing => existing.id === check.id))) checks.push(row('adapter-prerequisites', 'launch', 'unknown', 'adapter-check-invalid'));
      else checks.push(...adapted);
    } catch {
      checks.push(row('adapter-prerequisites', 'launch', 'unknown', 'adapter-check-failed'));
    }
    if (!checks.some(check => check.id === 'app-build')) checks.push(row('app-build', 'launch', 'unknown', 'build-not-inspected'));
  } else checks.push(row('app-build', 'launch', 'unsupported', 'adapter-has-no-read-only-inspector'));

  checks.push(row('host-launch', 'launch', 'unknown', 'unit-not-started'));
  checks.push(row('loopback-listener', 'launch', 'unknown', 'bind-not-probed'));
  checks.push(row('listener-ownership', 'launch', 'unknown', 'live-listener-not-probed'));
  checks.push(row('browser-execution', 'capture', 'unknown', 'browser-not-launched'));
  checks.push(row('video-finalization', 'capture', 'unknown', 'video-not-recorded'));
  checks.push(row('windows-browser', 'handoff', 'unknown', 'human-browser-not-checked'));
  // An interop marker can indicate a potential curl.exe route, never an actual Windows browser session.
  checks.push(row('windows-interop', 'handoff', existsSync('/proc/sys/fs/binfmt_misc/WSLInterop') || existsSync('/proc/sys/fs/binfmt_misc/WSLInterop-late') ? 'present' : 'unknown', 'browser-reachability-unproven'));

  const summaries = Object.fromEntries(phases.map(phase => {
    const own = checks.filter(check => check.phase === phase);
    const prerequisites = own.some(check => check.status === 'missing') ? 'missing' : own.some(check => check.status !== 'present') ? 'unknown' : 'present';
    return [phase, {prerequisites, operation: 'unproven'}];
  })) as PrerequisiteResult['phases'];
  const first = checks.find(check => check.status === 'missing');
  return {operation: 'prerequisites', app: plugin.app, coreVersion: VERSION, scope: 'local-read-only', checks, phases: summaries,
    next: first?.next ?? 'Request the bounded launch, capture and handoff checks under Hub #613.'};
}
