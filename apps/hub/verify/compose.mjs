// The Hub's composition orchestrator (Hub #495): one integrated preview made of
// three independent app-verify runs, the Nanoleaf wall, Pixoo and the Hub,
// each started through its own repository's adapter wrapper in its own pinned
// checkout. The Hub owns orchestration only. Each run keeps its own unit,
// lease, receipt and proof; the aggregate `composition.json` under the Hub's
// proof root records which runs belong together, in what state, and what was
// cleaned. See docs/app-verification.md, "Composed previews".
//
//   npm run -s verify:compose -- start --checkout nanoleaf=<abs> --checkout pixoo=<abs> [--lease <minutes>] [--unpinned]
//   npm run -s verify:compose -- doctor [<composition-id>]
//   npm run -s verify:compose -- capture <composition-id> <step>
//   npm run -s verify:compose -- inject <composition-id> consumer-loss <service> [--step <step>]
//   npm run -s verify:compose -- reset <composition-id>
//   npm run -s verify:compose -- handoff <composition-id>
//   npm run -s verify:compose -- extend <composition-id> [--lease <minutes>]
//   npm run -s verify:compose -- stop <composition-id>
//
// Every operation prints one JSON result line on stdout and progress on
// stderr. Exit 0 means the outcome was verified; 1 a failed outcome; 2 a usage
// error; 3 an unavailable supervisor or adapter.
import {AsyncLocalStorage} from 'node:async_hooks';
import {spawn, execFile} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {existsSync} from 'node:fs';
import {lstat, mkdir, open, readdir, readFile, realpath, rename, rm, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {isAbsolute, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {promisify} from 'node:util';
import {consumerState, follows, sessionKey} from './consumers.mjs';
import {PAIRING, pause} from './integrated.mjs';
import {adapterLock, processIdentity} from './adapter-runner.mjs';
import {DirectoryLock, LockedError} from './lock.mjs';
import {currentLease, thawWithLease} from './safety-thaw.mjs';
import {FeedPauseError, liveFeedIdentity, releaseFeed, verifyPausedFeeds, withPausedFeeds} from './feed-pause.mjs';
import {CAPTURE_STEPS, CONTROLS, INJECTIONS} from './integrated-steps.mjs';

const run = promisify(execFile);
/** @type {AsyncLocalStorage<{directory: string, parent: number, started: string}>} */
const operationContext = new AsyncLocalStorage();
const ADAPTER_RUNNER = fileURLToPath(new URL('adapter-runner.mjs', import.meta.url));
export const HUB_ROOT = fileURLToPath(new URL('../../..', import.meta.url)).replace(/\/$/, '');
export const DEFAULT_MANIFEST = fileURLToPath(new URL('compose.json', import.meta.url));
export const EXIT = Object.freeze({ok: 0, failed: 1, usage: 2, unavailable: 3});
export const COMPOSITION_VERSION = 'hub-compose/1';
const COMMAND = 'npm run -s verify:compose --';
const ID = /^compose-\d{8}T\d{6}Z-[0-9a-f]{6}$/;
const SERVICE_ID = /^[a-z][a-z0-9-]{0,31}$/;
const SHA = /^[0-9a-f]{40}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
const USABLE_MANAGER = ['running', 'degraded', 'starting', 'initializing'];
const iso = (ms = Date.now()) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

class UsageError extends Error {}
/** A composition failure with a stable cause, the service it concerns and a one-line detail. */
export class ComposeFailure extends Error {
  /** @param {string} failure @param {string} detail @param {string | null} [service] @param {number} [code] */
  constructor(failure, detail, service = null, code = EXIT.failed) {
    super(`${failure}: ${detail}`);
    this.failure = failure;
    this.detail = detail;
    this.service = service;
    this.code = code;
    /** @type {Check[] | undefined} */
    this.checks = undefined;
  }
}

/**
 * @typedef {Readonly<Record<string, string | undefined>>} Env
 * @typedef {(line: string) => void} Progress
 * @typedef {{env: Env, progress: Progress, hubRoot?: string}} Io
 * @typedef {{id: string, outcome: 'passed' | 'failed', detail?: string}} Check
 * @typedef {{code: number, value: Record<string, unknown>}} Outcome
 */

// ---------------------------------------------------------------------------
// Manifest: which repositories, at which pinned revisions and core version, with which scenario.

/**
 * @typedef {{id: string, role: 'consumer' | 'owner', app: string, repository: string, revision: string, coreVersion: string, scenario: string, run: string[]}} ServiceSpec
 * @typedef {{manifestVersion: string, services: ServiceSpec[]}} Manifest
 * @typedef {ServiceSpec & {checkout: string, pin: string | null, dirty: boolean, pinned: boolean, runId: string | null, state: string, url: string | null,
 *   endpoints: Record<string, string> | null, proofDir: string | null, expiresAt: string | null, failure: {cause: string, detail: string | null} | null, cleanup: any,
 *   standalone?: string}} Service
 * @typedef {{compositionVersion: string, id: string, state: string, pinned: boolean, startedAt: string, updatedAt: string, restarts?: string, continuity?: string, manifest: unknown, lease: unknown,
 *   services: Service[], readiness: {outcome: string, checks: Check[], at: string} | null, captures: any[], injections: any[], failure: any, cleanup: any, handoff?: unknown, reset?: {attempt: string, phase: string, service: string | null, startedAt: string, finishedAt?: string}, secrets: string}} Composition
 */

/**
 * Load and check the manifest. Services are listed in start order: the consumers, then the one owner.
 * @param {string} path
 * @returns {Promise<{manifest: Manifest, digest: string}>}
 */
export async function loadManifest(path) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new UsageError(`the manifest is unreadable: ${String(/** @type {Error} */ (error).message).split('\n')[0]}`);
  }
  const bad = (/** @type {string} */ why) => new UsageError(`the manifest ${why}`);
  if (manifest?.manifestVersion !== COMPOSITION_VERSION || !Array.isArray(manifest.services)) throw bad(`must be ${COMPOSITION_VERSION} with a services list`);
  const ids = new Set();
  for (const [index, s] of manifest.services.entries()) {
    const where = `service ${index + 1}`;
    if (!SERVICE_ID.test(s?.id ?? '') || ids.has(s.id)) throw bad(`${where} needs a unique lowercase id`);
    ids.add(s.id);
    if (!['consumer', 'owner'].includes(s.role)) throw bad(`${where} role must be consumer or owner`);
    if (!/^[a-z][a-z0-9-]{0,15}$/.test(s.app ?? '') || !/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(s.repository ?? '')) throw bad(`${where} needs an app name and an owner/name repository`);
    if (!(SHA.test(s.revision ?? '') || (s.role === 'owner' && s.revision === 'self'))) throw bad(`${where} revision must be a full commit (or "self" for the owner)`);
    if (!SEMVER.test(s.coreVersion ?? '') || typeof s.scenario !== 'string' || !s.scenario) throw bad(`${where} needs a core version and a scenario`);
    if (!Array.isArray(s.run) || s.run.length === 0 || s.run.some((/** @type {unknown} */ a) => typeof a !== 'string' || !a)) throw bad(`${where} run must be the adapter wrapper's argv`);
  }
  const owners = manifest.services.filter((/** @type {ServiceSpec} */ s) => s.role === 'owner');
  if (owners.length !== 1 || manifest.services.at(-1).role !== 'owner' || manifest.services.length < 2) throw bad('must list the consumers first and exactly one owner last');
  return {manifest, digest: `sha256:${createHash('sha256').update(await readFile(path)).digest('hex')}`};
}

// ---------------------------------------------------------------------------
// Roots, identity and adapter invocation.

/** The runtime root every run shares, as @jimmie-potts/app-verify resolves it. @param {Env} env */
export function stateRoot(env) {
  return env.APP_VERIFY_STATE_ROOT ? resolve(env.APP_VERIFY_STATE_ROOT) : join(env.HOME || homedir(), '.local/state/app-verify');
}

/** @param {string} checkout @param {string[]} args */
async function git(checkout, args) {
  try {
    return (await run('git', ['-C', checkout, ...args], {encoding: 'utf8'})).stdout;
  } catch {
    return undefined;
  }
}

/** The Hub's proof root: compositions sit beside the Hub's own runs. @param {Env} env @param {string} [hubRoot] */
export async function proofRoot(env, hubRoot = HUB_ROOT) {
  if (env.APP_VERIFY_PROOF_ROOT) return resolve(env.APP_VERIFY_PROOF_ROOT);
  const first = /^worktree (.+)$/m.exec((await git(hubRoot, ['worktree', 'list', '--porcelain'])) ?? '');
  if (!first) throw new ComposeFailure('proof-root-unusable', 'the Hub checkout has no canonical checkout for proof');
  return join(first[1], '.local/evidence/verify');
}

/** A checkout's revision and whether tracked files differ from it, as the core judges a candidate. @param {string} checkout */
export async function checkoutIdentity(checkout) {
  const head = (await git(checkout, ['rev-parse', 'HEAD']))?.trim();
  const status = await git(checkout, ['status', '--porcelain', '--untracked-files=no']);
  const revision = head && SHA.test(head) ? head : 'unknown';
  return {revision, dirty: revision === 'unknown' || status === undefined || status.trim().length > 0};
}

/**
 * Run one adapter operation through the service's own wrapper, in its own
 * checkout. Returns the exit code and the one JSON result line. Progress goes
 * to our stderr prefixed with the service id; `onLine` sees each progress line.
 * @param {{id: string, run: string[], checkout: string}} service @param {string[]} args
 * @param {{env: Env, progress?: Progress, onLine?: (line: string) => void, timeoutMs?: number}} options
 * @returns {Promise<{code: number, result: any}>}
 */
export function invoke(service, args, {env, progress, onLine, timeoutMs = 20 * 60000}) {
  return new Promise((resolvePromise, reject) => {
    const [program, ...rest] = service.run;
    const context = operationContext.getStore();
    const guarded = context ? [ADAPTER_RUNNER, '--run-adapter', JSON.stringify({...context, service: service.id, timeoutMs, argv: [program, ...rest, ...args]})] : null;
    const child = spawn(guarded ? process.execPath : program ?? '', guarded ?? [...rest, ...args], {cwd: service.checkout, env, detached: Boolean(guarded), stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '', pending = '';
    // The runner owns the timeout while it holds the barrier. Killing that
    // guardian here would abandon its wrapper just as killing compose did.
    const timer = guarded ? undefined : setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout.on('data', chunk => (stdout += chunk));
    child.stderr.on('data', chunk => {
      pending += chunk;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        progress?.(`[${service.id}] ${line}`);
        onLine?.(line);
      }
    });
    child.on('error', error => {
      clearTimeout(timer);
      reject(new ComposeFailure('adapter-unavailable', `${service.id} wrapper ${program} could not start (${/** @type {NodeJS.ErrnoException} */ (error).code ?? 'error'})`, service.id, EXIT.unavailable));
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (pending) {
        progress?.(`[${service.id}] ${pending}`);
        onLine?.(pending);
      }
      const line = stdout.trim().split('\n').filter(Boolean).at(-1);
      let result;
      try {
        result = line ? JSON.parse(line) : undefined;
      } catch {
        result = undefined;
      }
      if (!result || typeof result !== 'object') return reject(new ComposeFailure('adapter-unavailable', `${service.id} ${args[0]} printed no JSON result (exit ${code})`, service.id, EXIT.unavailable));
      resolvePromise({code: code ?? EXIT.failed, result});
    });
  });
}

async function supervisor() {
  const output = await run('systemctl', ['--user', 'is-system-running'], {encoding: 'utf8'}).then(r => r.stdout, e => e.stdout ?? '');
  const state = String(output).trim();
  return USABLE_MANAGER.includes(state) ? {available: true} : {available: false, reason: `systemctl --user is-system-running answered ${state || 'nothing'}`};
}

// ---------------------------------------------------------------------------
// The composition record: composition.json and events.jsonl under the Hub's proof root.

class Store {
  /** @param {string} root @param {string} id */
  constructor(root, id) {
    this.root = root;
    this.id = id;
    this.dir = join(root, id);
    this.file = join(this.dir, 'composition.json');
  }
  /** @returns {Promise<Composition>} */
  async read() {
    return JSON.parse(await readFile(this.file, 'utf8'));
  }
  /** @param {Composition} value */
  async write(value) {
    value.updatedAt = iso();
    const next = `${this.file}.${process.pid}.tmp`;
    await writeFile(next, JSON.stringify(value, null, 2) + '\n', {mode: 0o600});
    await rename(next, this.file);
  }
  /** @param {string} event @param {Record<string, unknown>} [fields] */
  async event(event, fields = {}) {
    await writeFile(join(this.dir, 'events.jsonl'), JSON.stringify({at: iso(), event, ...fields}) + '\n', {flag: 'a', mode: 0o600});
  }
  /**
   * Read, change and write the record under the lock.
   * @param {(value: Composition) => void | Promise<void>} change @param {string} [event] @param {Record<string, unknown>} [fields]
   */
  async update(change, event, fields) {
    try {
      return await new DirectoryLock(this.dir, '.composition.lock').run(async stillHeld => {
        const value = await this.read();
        await change(value);
        // Fencing: never write after losing the lock, so a displaced operation cannot overwrite another's update.
        if (!(await stillHeld())) throw new ComposeFailure('composition-locked', `the lock on ${this.id} changed hands during this operation; nothing was written`);
        await this.write(value);
        if (event) await this.event(event, fields);
        return value;
      });
    } catch (error) {
      if (error instanceof LockedError) throw new ComposeFailure('composition-locked', `another operation holds ${this.id}; retry when it finishes`);
      throw error;
    }
  }
}

/** @param {Env} env @param {string | undefined} id @param {string | undefined} hubRoot */
async function loadComposition(env, id, hubRoot) {
  if (!ID.test(id ?? '')) throw new UsageError('expected a composition id, compose-<yyyymmddThhmmssZ>-<6 hex>');
  const store = new Store(await proofRoot(env, hubRoot), /** @type {string} */ (id));
  if (!existsSync(store.file)) throw new ComposeFailure('unknown-composition', `no composition.json for ${id}`);
  return {store, composition: await store.read()};
}

/** @template T @param {Store} store @param {() => Promise<T>} work @param {string[]} [initialServices] @returns {Promise<T>} */
async function exclusive(store, work, initialServices) {
  try {
    return await new DirectoryLock(store.dir, '.operation.lock').run(async stillHeld => {
      const services = initialServices ?? (await store.read()).services.map(s => s.id);
      if (!services.length || new Set(services).size !== services.length || services.some(id => typeof id !== 'string' || !SERVICE_ID.test(id))) {
        throw new ComposeFailure('composition-locked', 'recorded adapter service identities are invalid');
      }
      // Drain the old shared barrier too, for a runner started before this
      // revision. Sibling services can run together inside one operation, but
      // recovery waits for every service's orphan adapter group to stop.
      await new DirectoryLock(store.dir, '.adapter.lock').run(async () => {});
      await Promise.all(services.map(id => new DirectoryLock(store.dir, adapterLock(id)).run(async () => {})));
      const started = await processIdentity(process.pid);
      if (!started) throw new ComposeFailure('composition-locked', 'operation process identity is unavailable');
      const result = await operationContext.run({directory: store.dir, parent: process.pid, started}, work);
      if (!await stillHeld()) throw new ComposeFailure('composition-locked', 'operation ownership changed');
      return result;
    });
  } catch (error) {
    if (error instanceof LockedError) throw new ComposeFailure('composition-locked', `another operation holds ${store.id}; retry when it finishes`);
    throw error;
  }
}
/** @template T @param {string | undefined} id @param {Io} io @param {() => Promise<T>} work @returns {Promise<T>} */
async function operation(id, io, work) {
  const {store} = await loadComposition(io.env, id, io.hubRoot);
  return exclusive(store, work);
}

/** @param {Composition} composition @param {string} id @returns {Service} */
const serviceOf = (composition, id) => /** @type {Service} */ (composition.services.find(s => s.id === id));
/** @param {Composition} composition @returns {Service} */
const owner = composition => /** @type {Service} */ (composition.services.find(s => s.role === 'owner'));
/** @param {Composition} composition */
const consumers = composition => composition.services.filter(s => s.role === 'consumer');
/** Stop order: the owner first, then the consumers in reverse start order. @param {Composition} composition */
const stopOrder = composition => [owner(composition), ...consumers(composition).reverse()];
/** @param {Env} env @param {Service} service */
const runtimeDir = (env, service) => join(stateRoot(env), service.runId ?? '');
/** @param {Service} service */
const unitOf = service => `app-verify-${service.runId}.service`;

// ---------------------------------------------------------------------------
// Pairing credentials: generated here, written 0600 into each run's runtime directory under the names
// PAIRING.files gives, never printed or recorded.

/** @param {string} directory @param {string} name @param {string} value */
async function writeSecret(directory, name, value) {
  const info = await lstat(directory).catch(() => undefined);
  if (!info?.isDirectory() || info.uid !== process.getuid?.()) throw new ComposeFailure('pairing-failed', `the runtime directory for ${name} is missing or not owned by this user`);
  const handle = await open(join(directory, name), 'wx', 0o600);
  try {
    await handle.writeFile(value);
  } finally {
    await handle.close();
  }
}

// ---------------------------------------------------------------------------
// Readiness: every run healthy, each consumer's feed current at the Hub's revision, and the Hub reading both devices.

/** @param {Env} env @param {Service} hub */
async function hubToken(env, hub) {
  return (await readFile(join(runtimeDir(env, hub), 'data/api-token'), 'utf8')).trim();
}

/** @param {Env} env @param {Service} hub @param {string} path @returns {Promise<{status: number, body: any}>} */
async function hubRead(env, hub, path) {
  const response = await fetch(new URL(path, hub.url ?? ''), {headers: {authorization: `Bearer ${await hubToken(env, hub)}`}, signal: AbortSignal.timeout(5000)});
  let body;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return {status: response.status, body};
}

/**
 * Why a consumer does not follow the Hub, naming each difference: connection, owner, revision, sessions and source.
 * @param {import('./consumers.mjs').ConsumerState} state @param {number | undefined} revision @param {string[]} sessions
 */
function followDetail(state, revision, sessions) {
  const parts = [`feed ${state.feed.connection}`];
  if (state.feed.ownerId !== PAIRING.ownerId) parts.push(`owner ${state.feed.ownerId ?? 'none yet'}, not ${PAIRING.ownerId}`);
  parts.push(`revision ${state.feed.revision ?? 'none yet'} (Hub ${revision})`);
  if (state.feed.sessions) {
    const mine = new Set(state.feed.sessions), hub = new Set(sessions);
    const differing = [...mine].filter(key => !hub.has(key)).length + [...hub].filter(key => !mine.has(key)).length;
    if (differing) parts.push(`its sessions differ from the Hub's: ${differing} session key(s) differ (${state.feed.sessions.length} here, ${sessions.length} on the Hub)`);
  }
  if (state.feed.source && state.feed.source !== 'shared') parts.push(`source ${state.feed.source}`);
  if (state.feed.error) parts.push(state.feed.error);
  return parts.join(', ');
}

/** The controller alias the Hub's integrated configuration gives a consumer. @param {string} consumer */
const aliasOf = consumer => /** @type {Record<string, {alias: string}>} */ (PAIRING.controllers)[consumer]?.alias ?? consumer;

/**
 * One pass of the pairing checks. Reads only: a snapshot read through the Hub
 * is the Hub's ordinary read path and changes no controller. Consumer reads use
 * the dashboard's versioned path, so a broken device card cannot pass (Hub #856).
 * @param {Env} env @param {Composition} composition
 * @returns {Promise<Check[]>}
 */
async function pairingChecks(env, composition) {
  const hub = owner(composition);
  /** @type {Check[]} */
  const checks = [];
  const add = (/** @type {string} */ id, /** @type {boolean} */ ok, /** @type {string} */ detail) => checks.push(ok ? {id, outcome: 'passed'} : {id, outcome: 'failed', detail});
  /** @type {number | undefined} */
  let revision;
  /** @type {string[]} */
  let sessions = [];
  try {
    const feed = await hubRead(env, hub, '/api/monitor/v1/sessions');
    revision = feed.body?.snapshot?.revision;
    sessions = (feed.body?.snapshot?.sessions ?? []).map((/** @type {any} */ s) => sessionKey(s.identity)).sort();
    add('hub-owner', feed.status === 200 && Number.isInteger(revision), `the Hub feed answered ${feed.status}`);
  } catch (error) {
    add('hub-owner', false, `the Hub feed is unreadable (${/** @type {Error} */ (error).name})`);
  }
  for (const consumer of consumers(composition)) {
    const alias = aliasOf(consumer.id);
    try {
      const snapshot = await hubRead(env, hub, `/api/controllers/v1/${alias}/snapshot?apiVersion=1.1`);
      add(`hub-reads-${consumer.id}`, snapshot.status === 200, `the Hub's ${alias} snapshot answered ${snapshot.status}${snapshot.body?.error?.code ? ` ${snapshot.body.error.code}` : ''}`);
    } catch (error) {
      add(`hub-reads-${consumer.id}`, false, `the Hub's ${alias} snapshot is unreadable (${/** @type {Error} */ (error).name})`);
    }
    try {
      const state = await consumerState(consumer.id, consumer.url ?? '');
      // The same rule as the steps: current, the owner, the Hub's revision and, where listed, exactly its sessions.
      add(`${consumer.id}-feed-current`, follows(state, {revision: revision ?? -1, sessions}), followDetail(state, revision, sessions));
    } catch (error) {
      add(`${consumer.id}-feed-current`, false, /** @type {Error} */ (error).message);
    }
  }
  try {
    const health = await hubRead(env, hub, '/api/hub/v1/health');
    const devices = Object.fromEntries((health.body?.devices ?? []).map((/** @type {{id: string, health: string}} */ d) => [d.id, d.health]));
    const expected = consumers(composition).map(c => aliasOf(c.id));
    add('hub-devices-current', health.status === 200 && expected.every(alias => devices[alias] === 'ready'), `health ${health.status}, devices ${JSON.stringify(devices)}`);
    if (health.status === 200) {
      for (const consumer of consumers(composition)) {
        const alias = aliasOf(consumer.id);
        add(`hub-health-${consumer.id}`, devices[alias] === 'ready', `the Hub's ${alias} health is ${devices[alias] ?? 'missing'}`);
      }
    }
  } catch (error) {
    add('hub-devices-current', false, `health unreadable (${/** @type {Error} */ (error).name})`);
  }
  return checks;
}

/**
 * Each run's own doctor: running, identity matched and every read-only boundary check passed.
 * `states` receives each run's assessed state from its doctor.
 * @param {Env} env @param {Composition} composition @param {Progress} progress @param {Record<string, string>} [states] @returns {Promise<Check[]>}
 */
async function doctorChecks(env, composition, progress, states = {}) {
  /** @type {Check[]} */
  const checks = [];
  for (const service of composition.services) {
    if (!service.runId) {
      checks.push({id: `${service.id}-run`, outcome: 'failed', detail: 'no run recorded'});
      continue;
    }
    try {
      const {code, result} = await invoke(service, ['doctor', service.runId], {env, progress});
      const row = result.runs?.[0];
      states[service.id] = row?.state ?? result.error ?? 'unknown';
      /** @type {{id: string, outcome: string, reason?: string}[]} */
      const failing = (row?.checks ?? []).filter((/** @type {{outcome: string}} */ c) => c.outcome !== 'passed');
      const ok = code === EXIT.ok && row?.state === 'running' && (row.reasons ?? []).length === 0 && failing.length === 0;
      checks.push(ok ? {id: `${service.id}-run`, outcome: 'passed'} : {id: `${service.id}-run`, outcome: 'failed', detail: `state ${row?.state ?? result.error ?? 'unknown'}${row?.reasons?.length ? `, ${row.reasons.join(', ')}` : ''}${failing.length ? `, check ${failing.map(c => `${c.id} ${c.outcome}${c.reason ? ` (${c.reason})` : ''}`).join('; ')}` : ''}`});
    } catch (error) {
      checks.push({id: `${service.id}-run`, outcome: 'failed', detail: /** @type {ComposeFailure} */ (error).detail ?? /** @type {Error} */ (error).message});
    }
  }
  return checks;
}

/**
 * Wait until every pairing and run check passes, or report the last failing checks.
 * @param {Env} env @param {Composition} composition @param {Progress} progress @param {number} timeoutMs @returns {Promise<Check[]>}
 */
export async function awaitReady(env, composition, progress, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  /** @type {Check[]} */
  let checks;
  for (;;) {
    checks = await pairingChecks(env, composition);
    if (checks.every(c => c.outcome === 'passed')) {
      checks = [...checks, ...await doctorChecks(env, composition, progress)];
      if (checks.every(c => c.outcome === 'passed')) return checks;
    }
    if (Date.now() > deadline) {
      const failing = checks.filter(c => c.outcome !== 'passed');
      // Preserve a known failing service without guessing one when several
      // boundaries fail. Per-device health is attributed only from a successful
      // health response; an unreadable aggregate response names no consumer.
      const implicated = new Set(failing.flatMap(check => {
        if (check.id === 'hub-owner') return [owner(composition).id];
        return composition.services.filter(s => [s.id + '-run', s.id + '-feed-current', 'hub-reads-' + s.id, 'hub-health-' + s.id].includes(check.id)).map(s => s.id);
      }));
      const service = implicated.size === 1 ? [...implicated][0] : null;
      const failure = new ComposeFailure('readiness-timeout', `not ready within ${Math.round(timeoutMs / 1000)} s: ${failing.map(c => `${c.id}: ${c.detail}`).join('; ')}`, service);
      failure.checks = checks;
      throw failure;
    }
    await pause(1000);
  }
}

// ---------------------------------------------------------------------------
// Card and results.

/** @param {Composition} composition */
function card(composition) {
  const services = composition.services;
  const width = Math.max(...services.map(s => s.id.length));
  const lines = [`Composition ${composition.id}  ${composition.pinned ? 'pinned' : 'UNPINNED: development only, not citable evidence'}`];
  for (const s of services) lines.push(`${s.id.padEnd(width)}  ${s.url ?? '(no URL)'}  run ${s.runId ?? '-'}  ${s.revision.slice(0, 8)} ${s.dirty ? 'dirty' : 'clean'}  ${s.scenario}${s.state && s.state !== 'running' ? `  ${s.state}` : ''}`);
  const expiries = /** @type {string[]} */ (services.map(s => s.expiresAt).filter(Boolean)).sort();
  if (expiries.length) lines.push(`Expires  ${expiries[0]} (earliest lease of the three runs)`);
  lines.push(`Doctor   ${COMMAND} doctor ${composition.id}`, `Reset    ${COMMAND} reset ${composition.id}`, `Extend   ${COMMAND} extend ${composition.id}`, `Stop     ${COMMAND} stop ${composition.id}`);
  return lines;
}

/** The fields of a service a result line carries: never the checkout path, a token or a runtime file. */
const publicService = (/** @type {Service} */ s) => ({id: s.id, repository: s.repository, app: s.app, runId: s.runId, state: s.state, revision: s.revision, pinned: s.pinned, dirty: s.dirty, coreVersion: s.coreVersion, scenario: s.scenario, url: s.url, endpoints: s.endpoints, proofDir: s.proofDir, expiresAt: s.expiresAt, failure: s.failure, cleanup: s.cleanup});

// ---------------------------------------------------------------------------
// start

const RUN_ID = (/** @type {string} */ app) => new RegExp(`^(${app}-\\d{8}T\\d{6}Z-[0-9a-f]{6}): starting `);
const RUN_ID_FORMAT = (/** @type {string} */ app) => new RegExp(`^${app}-\\d{8}T\\d{6}Z-[0-9a-f]{6}$`);

/** @param {Service & {checkout: string}} service @param {Env} env @param {Progress} progress */
async function checkAdapter(service, env, progress) {
  const {code, result} = await invoke(service, ['help'], {env, progress, timeoutMs: 120000});
  if (code !== EXIT.ok) throw new ComposeFailure('adapter-unavailable', `${service.id} help exited ${code}: ${result.detail ?? result.error ?? 'no detail'}`, service.id, EXIT.unavailable);
  /** @type {string[]} */
  const problems = [];
  if (result.app !== service.app) problems.push(`app ${result.app}, expected ${service.app}`);
  if (result.coreVersion !== service.coreVersion) problems.push(`core ${result.coreVersion ?? 'unknown (before 1.1)'}, pinned ${service.coreVersion}`);
  if (!Object.hasOwn(result.scenarios ?? {}, service.scenario)) problems.push(`no scenario ${service.scenario}`);
  const required = result.scenarioInputs?.[service.scenario] ?? [];
  const expected = service.role === 'consumer' ? ['hub-feed'] : [];
  for (const name of expected) if (!required.includes(name)) problems.push(`scenario ${service.scenario} does not require input ${name}`);
  if (problems.length) throw new ComposeFailure('identity-mismatch', `${service.id}: ${problems.join('; ')}`, service.id);
  return result;
}

/**
 * @param {{checkouts: Record<string, string>, lease?: number, unpinned?: boolean, restarts?: string, manifest?: string, hubRoot?: string, readyTimeoutMs?: number}} options
 * @param {Io} io @returns {Promise<Outcome>}
 */
async function startUnlocked(options, io) {
  const {env, progress} = io;
  const {manifest, digest} = await loadManifest(options.manifest ?? DEFAULT_MANIFEST);
  const hubRoot = options.hubRoot ?? HUB_ROOT;
  // Checkouts: absolute paths given for every service but a `self` owner.
  /** @type {any[]} */
  const services = [];
  for (const spec of manifest.services) {
    const given = options.checkouts[spec.id];
    const self = spec.revision === 'self';
    if (self && given !== undefined) throw new UsageError(`${spec.id} runs from this checkout; do not give --checkout ${spec.id}`);
    if (!self && given === undefined) throw new UsageError(`give --checkout ${spec.id}=<absolute path>`);
    const checkout = self ? hubRoot : given;
    if (!isAbsolute(checkout) || resolve(checkout) !== checkout) throw new UsageError(`--checkout ${spec.id} must be an absolute path`);
    if (!existsSync(checkout) || (await realpath(checkout)) !== checkout) throw new UsageError(`--checkout ${spec.id} must be an existing checkout named by its real path`);
    services.push({...spec, checkout});
  }
  for (const id of Object.keys(options.checkouts)) if (!services.some(s => s.id === id)) throw new UsageError(`the manifest has no service ${id}`);
  // A composition restarts as a new one: the paired runs cannot restart in place, because their credentials
  // live in runtime directories that exist only after a start. The new record names the one it replaces.
  /** @type {Composition | undefined} */
  let previous;
  if (options.restarts !== undefined) {
    previous = (await loadComposition(env, options.restarts, hubRoot)).composition;
    if (previous.state !== 'stopped' || previous.cleanup?.result !== 'clean') throw new UsageError(`${options.restarts} needs a clean stop before restarting it`);
  }
  const manager = await supervisor();
  if (!manager.available) throw new ComposeFailure('supervisor-unavailable', manager.reason ?? 'no usable user manager', null, EXIT.unavailable);
  // Identity before anything is created: each checkout clean at its pin, unless explicitly unpinned.
  /** @type {string[]} */
  const mismatches = [];
  for (const service of services) {
    const identity = await checkoutIdentity(service.checkout);
    const top = (await git(service.checkout, ['rev-parse', '--show-toplevel']))?.trim();
    if (top !== service.checkout) throw new UsageError(`--checkout ${service.id} is not the top of a Git checkout`);
    Object.assign(service, identity, {pin: service.revision === 'self' ? null : service.revision});
    service.pinned = !identity.dirty && (service.pin === null || service.pin === identity.revision);
    if (!service.pinned) mismatches.push(`${service.id} at ${identity.revision.slice(0, 12)}${identity.dirty ? ' with tracked changes' : ''}${service.pin && service.pin !== identity.revision ? `, pinned ${service.pin.slice(0, 12)}` : ''}`);
  }
  if (mismatches.length && !options.unpinned) throw new ComposeFailure('identity-mismatch', `${mismatches.join('; ')}; check out each pin cleanly, or pass --unpinned for a labelled development run`);
  /** @type {Record<string, any>} */
  const helps = {};
  /** @type {string[]} */
  const adapters = [];
  for (const service of services) {
    try {
      helps[service.id] = await checkAdapter(service, env, progress);
    } catch (error) {
      if (!(error instanceof ComposeFailure) || error.failure !== 'identity-mismatch') throw error;
      adapters.push(error.detail);
    }
  }
  if (adapters.length) throw new ComposeFailure('identity-mismatch', adapters.join('; '));

  // From here on everything created is recorded before the next step, so a failure stops exactly what exists.
  const id = `compose-${iso().replace(/[-:]/g, '').replace(/Z$/, 'Z')}-${randomBytes(3).toString('hex')}`;
  const store = new Store(await proofRoot(env, hubRoot), id);
  await mkdir(store.root, {recursive: true});
  await mkdir(store.dir, {mode: 0o700});
  return exclusive(store, async () => {
  /** @type {Composition} */
  const composition = {
    compositionVersion: COMPOSITION_VERSION,
    id,
    state: 'starting',
    pinned: mismatches.length === 0,
    startedAt: iso(),
    updatedAt: iso(),
    ...(previous ? {restarts: previous.id, continuity: previous.services.every(p => services.some(s => s.id === p.id && s.revision === p.revision && !s.dirty && !p.dirty)) ? 'same-candidate' : 'different-candidate'} : {}),
    manifest: {digest, services: manifest.services.map(s => ({id: s.id, revision: s.revision, coreVersion: s.coreVersion, scenario: s.scenario}))},
    lease: {minutes: options.lease ?? null},
    services: services.map(s => ({id: s.id, role: s.role, repository: s.repository, app: s.app, checkout: s.checkout, run: s.run, pin: s.pin, revision: s.revision, dirty: s.dirty, pinned: s.pinned, coreVersion: helps[s.id].coreVersion, scenario: s.scenario, standalone: helps[s.id].defaultScenario, runId: null, state: 'pending', url: null, endpoints: null, proofDir: null, expiresAt: null, failure: null, cleanup: null})),
    readiness: null,
    captures: [],
    injections: [],
    failure: null,
    cleanup: null,
    secrets: 'none recorded',
  };
  await store.write(composition);
  await store.event('created', {pinned: composition.pinned, services: composition.services.map(s => ({id: s.id, revision: s.revision, dirty: s.dirty}))});
  progress(`${id}: composing ${services.map(s => s.id).join(', ')}${composition.pinned ? '' : ' (unpinned development run)'}`);
  const lease = options.lease === undefined ? [] : ['--lease', String(options.lease)];
  const failWith = async (/** @type {unknown} */ error) => {
    const failure = error instanceof ComposeFailure ? error : new ComposeFailure('compose-failed', String(/** @type {Error} */ (error)?.message ?? error).split('\n')[0] ?? '');
    progress(`${id}: failed: ${failure.message}; stopping the recorded runs`);
    const cleanup = await stopRuns(store, env, progress, {reason: 'start-failed'});
    const value = await store.update(c => {
      c.state = 'failed';
      c.failure = {cause: failure.failure, service: failure.service, detail: failure.detail, at: iso()};
      if (failure.checks) c.readiness = {outcome: 'failed', checks: failure.checks, at: iso()};
    }, 'start-failed', {cause: failure.failure, service: failure.service});
    return {code: failure.code === EXIT.unavailable ? EXIT.unavailable : EXIT.failed, value: {operation: 'start', compositionId: id, state: 'failed', cause: failure.failure, service: failure.service, detail: failure.detail, cleanup, services: value.services.map(publicService), compositionDir: store.dir}};
  };
  try {
    // 1. Each run starts standalone through its own wrapper; its run id is recorded as soon as the wrapper names it.
    for (const service of composition.services) {
      await store.update(c => void (serviceOf(c, service.id).state = 'starting'), 'service-starting', {service: service.id});
      /** @type {Promise<unknown>} */
      let recorded = Promise.resolve();
      /** @type {{code: number, result: any}} */
      let started;
      try {
        started = await invoke(service, ['start', ...lease], {env, progress, onLine: line => {
          const match = RUN_ID(service.app).exec(line);
          if (match) recorded = store.update(c => void (serviceOf(c, service.id).runId = match[1]), 'run-recorded', {service: service.id, runId: match[1]});
        }});
      } finally {
        // The run id lands in the record before any cleanup reads it, even when the wrapper failed.
        await recorded.catch(error => progress(`${id}: could not record ${service.id}'s run id: ${/** @type {Error} */ (error).message}`));
      }
      const {code, result} = started;
      // A run id names units and paths the orchestrator stops and writes, so only the core's exact form is accepted.
      if (result.runId !== undefined && !RUN_ID_FORMAT(service.app).test(result.runId)) {
        throw new ComposeFailure('adapter-unavailable', `${service.id} answered a malformed run id`, service.id, EXIT.unavailable);
      }
      await store.update(c => {
        const s = serviceOf(c, service.id);
        Object.assign(s, {runId: result.runId ?? s.runId, state: result.state ?? 'failed', url: result.url ?? null, endpoints: result.endpoints ?? null, proofDir: result.proofDir ?? null, expiresAt: result.expiresAt ?? null});
        if (code !== EXIT.ok) s.failure = {cause: result.cause ?? result.error ?? 'start-failed', detail: result.detail ?? null};
        if (result.cleanup) s.cleanup = result.cleanup;
      }, 'service-started', {service: service.id, runId: result.runId, state: result.state});
      Object.assign(service, {runId: result.runId ?? null, url: result.url ?? null, expiresAt: result.expiresAt ?? null});
      if (code !== EXIT.ok) throw new ComposeFailure('service-start-failed', `${service.id} ${result.cause ?? result.error ?? 'failed'}${result.detail ? `: ${result.detail}` : ''}`, service.id, code === EXIT.unavailable ? EXIT.unavailable : EXIT.failed);
      // The run's own candidate must be the checkout the pin check saw; a checkout that changed meanwhile is another candidate.
      if (result.build?.sourceRevision !== service.revision || result.build?.dirty !== service.dirty) {
        const drift = `${service.id} started ${String(result.build?.sourceRevision).slice(0, 12)}${result.build?.dirty ? ' dirty' : ''}, but the pin check saw ${service.revision.slice(0, 12)}${service.dirty ? ' dirty' : ''}`;
        if (composition.pinned) throw new ComposeFailure('identity-mismatch', drift, service.id);
        progress(`${id}: ${drift}; the composition stays unpinned`);
        await store.update(c => {
          const s = serviceOf(c, service.id);
          Object.assign(s, {revision: result.build?.sourceRevision ?? 'unknown', dirty: result.build?.dirty !== false, pinned: false});
        }, 'identity-drift', {service: service.id});
      }
    }
    // 2. Pairing credentials: one feed and one controller token per consumer, 0600, only in the runtime directories.
    const hub = owner(composition);
    for (const consumer of consumers(composition)) {
      const feed = randomBytes(32).toString('base64url'), controller = randomBytes(32).toString('base64url');
      await writeSecret(runtimeDir(env, consumer), PAIRING.files.consumer.feed, feed);
      await writeSecret(runtimeDir(env, consumer), PAIRING.files.consumer.controller, controller);
      await writeSecret(runtimeDir(env, hub), PAIRING.files.hub.feed(consumer.id), feed);
      await writeSecret(runtimeDir(env, hub), PAIRING.files.hub.controller(consumer.id), controller);
    }
    await store.event('pairing-written', {services: composition.services.map(s => s.id)});
    // 3. Each consumer reseeds hub-paired with the Hub's feed; it announces its controller endpoint.
    for (const consumer of consumers(composition)) {
      const {code, result} = await invoke(consumer, ['scenario', consumer.runId ?? '', consumer.scenario, '--input', `hub-feed=${hub.url}`], {env, progress});
      await store.update(c => {
        const s = serviceOf(c, consumer.id);
        if (code === EXIT.ok) Object.assign(s, {endpoints: result.endpoints ?? null, state: 'running'});
        else Object.assign(s, {state: result.state ?? 'failed', failure: {cause: result.cause ?? result.error ?? 'reseed-failed', detail: result.detail ?? null}});
      }, 'service-paired', {service: consumer.id, scenario: consumer.scenario, ok: code === EXIT.ok});
      if (code !== EXIT.ok) throw new ComposeFailure('pairing-failed', `${consumer.id} ${consumer.scenario}: ${result.cause ?? result.error ?? 'failed'}${result.detail ? `: ${result.detail}` : ''}`, consumer.id);
      if (!result.endpoints?.controller) throw new ComposeFailure('pairing-failed', `${consumer.id} ${consumer.scenario} announced no controller endpoint`, consumer.id);
      consumer.endpoints = result.endpoints;
    }
    // 4. The Hub reseeds integrated with the consumers' controllers and previews.
    const inputs = consumers(composition).flatMap(c => ['--input', `${c.id}-controller=${c.endpoints?.controller}`, '--input', `${c.id}-preview=${c.url}`]);
    const reseeded = await invoke(hub, ['scenario', hub.runId ?? '', hub.scenario, ...inputs], {env, progress});
    await store.update(c => {
      const s = serviceOf(c, hub.id);
      if (reseeded.code === EXIT.ok) s.state = 'running';
      else Object.assign(s, {state: reseeded.result.state ?? 'failed', failure: {cause: reseeded.result.cause ?? reseeded.result.error ?? 'reseed-failed', detail: reseeded.result.detail ?? null}});
    }, 'service-paired', {service: hub.id, scenario: hub.scenario, ok: reseeded.code === EXIT.ok});
    if (reseeded.code !== EXIT.ok) throw new ComposeFailure('pairing-failed', `${hub.id} ${hub.scenario}: ${reseeded.result.cause ?? reseeded.result.error ?? 'failed'}${reseeded.result.detail ? `: ${reseeded.result.detail}` : ''}`, hub.id);
    // 5. Readiness across the boundaries.
    const checks = await awaitReady(env, composition, progress, options.readyTimeoutMs ?? 60000);
    const value = await store.update(c => {
      c.state = 'running';
      c.readiness = {outcome: 'passed', checks, at: iso()};
    }, 'running', {});
    const lines = card(value);
    for (const line of lines) progress(line);
    return {code: EXIT.ok, value: {operation: 'start', compositionId: id, state: 'running', pinned: value.pinned, ...(value.restarts ? {restarts: value.restarts, continuity: value.continuity} : {}), services: value.services.map(publicService), readiness: value.readiness, compositionDir: store.dir, card: lines}};
  } catch (error) {
    if (error instanceof UsageError) throw error;
    return failWith(error);
  }
  }, services.map(s => s.id));
}

// ---------------------------------------------------------------------------
// stop: the owner first, then the consumers; every recorded run, past any failure.

/** @param {string} unit @returns {Promise<Record<string, string>>} */
async function freezerState(unit) {
  const output = await run('systemctl', ['--user', 'show', unit, '-p', 'FreezerState', '-p', 'LoadState', '-p', 'ActiveState'], {encoding: 'utf8'}).then(r => r.stdout, () => '');
  return Object.fromEntries(output.trim().split('\n').filter(Boolean).map(line => line.split('=')));
}

/** The safety thaw of a run: a transient timer, owned by the user manager, that thaws its unit if nobody else does. @param {Service} service */
const safetyThaw = service => `app-verify-${service.runId}-thaw`;
const SAFETY_THAW = fileURLToPath(new URL('safety-thaw.mjs', import.meta.url));
/** @param {Service} service */
const receiptPath = service => join(service.proofDir ?? '', 'receipt.json');
/** @param {Service} service @param {number} seconds */
async function requireFreezeLease(service, seconds) {
  const lease = await currentLease(service.runId ?? '', receiptPath(service));
  const needed = (seconds + LOSS_STEP_SECONDS) * 1000;
  if (!lease.valid || lease.expiry - Date.now() < needed) throw new ComposeFailure('lease-too-short', `${service.id}'s current lease ends at ${lease.expiresAt ?? 'an unverified time'}, within the ${Math.ceil(needed / 60000)} min a loss may take; extend the composition first`, service.id);
  return lease;
}

/**
 * Arm the safety thaw before a freeze. systemd refuses to stop a frozen unit, so a unit left frozen by an
 * orchestrator that died would outlive its own lease. The timer thaws and enforces the current per-run lease.
 * @param {Service} service @param {number} seconds
 */
async function armSafetyThaw(service, seconds) {
  const name = safetyThaw(service);
  if (!await disarmSafetyThaw(service)) return false;
  const armed = await run('systemd-run', ['--user', `--unit=${name}`, '--collect', `--on-active=${seconds}s`, '--timer-property=AccuracySec=1s', `--description=app-verify safety thaw ${service.runId}`, process.execPath, SAFETY_THAW, service.runId ?? '', receiptPath(service)]).then(() => true, () => false);
  return armed && (await freezerState(`${name}.timer`)).ActiveState === 'active';
}

/** Disarm the safety thaw once the unit is running again. @param {Service} service */
async function disarmSafetyThaw(service) {
  const units = [`${safetyThaw(service)}.timer`, `${safetyThaw(service)}.service`];
  for (const unit of units) await run('systemctl', ['--user', 'stop', unit]).catch(() => undefined);
  for (const unit of units) {
    const state = await freezerState(unit);
    if (state.LoadState !== 'not-found' && !['inactive', 'failed'].includes(state.ActiveState ?? '')) return false;
  }
  return true;
}

/**
 * Stop a run's unit and lease timers by their exact names, then read back that none is left.
 * @param {Service} service @returns {Promise<{stopped: boolean, left: string[]}>}
 */
async function stopByName(service) {
  const base = `app-verify-${service.runId}`;
  const listed = await run('systemctl', ['--user', 'list-units', '--all', '--plain', '--no-legend', `${base}-lease*.timer`], {encoding: 'utf8'}).then(r => r.stdout, () => '');
  const units = [...new Set([`${base}.service`, `${base}-lease.timer`, `${base}-thaw.timer`, `${base}-thaw.service`, ...listed.split('\n').map(line => line.trim().split(/\s+/)[0] ?? '').filter(name => name.startsWith(`${base}-lease`) && name.endsWith('.timer'))])];
  for (const unit of units) await run('systemctl', ['--user', 'stop', unit]).catch(() => undefined);
  const left = [];
  for (const unit of units) {
    const state = await freezerState(unit);
    if (state.LoadState === 'loaded' && state.ActiveState !== 'inactive' && state.ActiveState !== 'failed') left.push(unit);
  }
  return {stopped: left.length === 0, left};
}

/** @param {Store} store @param {Env} env @param {Progress} progress @param {{reason: string}} why */
async function stopRuns(store, env, progress, {reason}) {
  const composition = await store.read();
  /** @type {{id: string, runId: string | null, result: string, state?: string | null, detail?: string}[]} */
  const results = [];
  for (const service of stopOrder(composition)) {
    if (!service.runId) {
      results.push({id: service.id, runId: null, result: 'none', detail: 'no run was recorded'});
      continue;
    }
    // A run left frozen by an interrupted loss injection is thawed first, so its unit stops cleanly.
    const unit = unitOf(service);
    if ((await freezerState(unit)).FreezerState === 'frozen') {
      try {
        const after = await thawWithLease(service.runId, receiptPath(service));
        progress(`${store.id}: recovered ${unit} before adapter stop (${after.stopped ? 'stopped' : 'running with lease'})`);
      } catch {
        // The adapter and exact-name fallback still get a cleanup attempt.
        // Keep the safety timer armed until unit removal is verified.
        progress(`${store.id}: recovery of ${unit} could not be verified; attempting adapter stop`);
      }
    }
    try {
      const {code, result} = await invoke(service, ['stop', service.runId], {env, progress});
      // Keep the safety net through the adapter stop: a crash after thaw must
      // still enforce a lease that already fired while the unit was frozen.
      const after = await freezerState(unit);
      const disarmed = (after.LoadState === 'not-found' || ['inactive', 'failed'].includes(after.ActiveState ?? '')) && await disarmSafetyThaw(service);
      const cleanup = result.cleanup ?? null;
      const entry = {id: service.id, runId: service.runId, state: result.state ?? null, result: cleanup?.result ?? (code === EXIT.ok ? 'clean' : 'unknown'), ...(code === EXIT.ok ? {} : {detail: result.detail ?? result.error ?? `exit ${code}`})};
      if (!disarmed) {
        entry.result = 'unknown';
        entry.detail = 'the safety thaw could not be verified stopped';
      }
      results.push(entry);
      await store.update(c => {
        const s = serviceOf(c, service.id);
        s.state = result.state ?? s.state;
        s.cleanup = {...cleanup, result: entry.result, ...(entry.detail ? {detail: entry.detail} : {})};
      }, 'service-stopped', {service: service.id, runId: service.runId, state: result.state, cleanup: entry.result, reason});
    } catch (error) {
      // The wrapper cannot run: stop the run's exact unit and lease timers by name, as the core would. Its runtime
      // directory and receipt stay for the adapter's own stop, which a later `stop` of the composition retries.
      const detail = /** @type {ComposeFailure} */ (error).detail ?? /** @type {Error} */ (error).message;
      const byName = await stopByName(service);
      const entry = {id: service.id, runId: service.runId, result: byName.stopped ? 'partial' : 'unknown', detail: `${detail}; ${byName.stopped ? 'stopped its unit and lease timers by name, and left its runtime directory and receipt for its own stop' : `could not stop ${byName.left.join(', ')}`}`};
      results.push(entry);
      await store.update(c => void (serviceOf(c, service.id).cleanup = {result: entry.result, detail: entry.detail}), 'service-stop-failed', {service: service.id, runId: service.runId, detail: entry.detail, cleanup: entry.result, reason});
    }
  }
  const result = results.some(r => r.result === 'unknown') ? 'unknown' : results.some(r => r.result === 'partial') ? 'partial' : 'clean';
  return {result, services: results};
}

/** @param {string | undefined} id @param {Io} io @returns {Promise<Outcome>} */
async function stopUnlocked(id, io) {
  const {store, composition} = await loadComposition(io.env, id, io.hubRoot);
  // Only a clean stop is final. After a partial or unknown one, every run is stopped again: each adapter's stop is
  // idempotent and reports its final state, and one whose wrapper could not run gets its turn.
  if (composition.state === 'stopped' && composition.cleanup?.result === 'clean') {
    return {code: EXIT.ok, value: {operation: 'stop', compositionId: id, state: composition.state, cleanup: composition.cleanup, repeated: true}};
  }
  const cleanup = await stopRuns(store, io.env, io.progress, {reason: 'stop'});
  const value = await store.update(c => {
    c.state = 'stopped';
    c.cleanup = {...cleanup, at: iso()};
  }, 'stopped', {cleanup: cleanup.result});
  return {code: cleanup.result === 'clean' ? EXIT.ok : EXIT.failed, value: {operation: 'stop', compositionId: id, state: 'stopped', cleanup: value.cleanup, services: value.services.map(publicService)}};
}

// ---------------------------------------------------------------------------
// doctor

/** @param {Env} env @param {string | undefined} hubRoot */
async function listCompositions(env, hubRoot) {
  const root = await proofRoot(env, hubRoot);
  const names = existsSync(root) ? (await readdir(root)).filter(name => ID.test(name)).sort() : [];
  /** @type {Record<string, unknown>[]} */
  const rows = [];
  for (const name of names) {
    try {
      /** @type {Composition} */
      const c = JSON.parse(await readFile(join(root, name, 'composition.json'), 'utf8'));
      rows.push({compositionId: name, state: c.state, pinned: c.pinned, services: c.services.map(s => ({id: s.id, runId: s.runId, state: s.state, url: s.url}))});
    } catch {
      rows.push({compositionId: name, state: 'unreadable'});
    }
  }
  return rows;
}

/** @param {string | undefined} id @param {Io} io @returns {Promise<Outcome>} */
async function doctorUnlocked(id, io) {
  if (id === undefined) return {code: EXIT.ok, value: {operation: 'doctor', compositions: await listCompositions(io.env, io.hubRoot)}};
  const {composition} = await loadComposition(io.env, id, io.hubRoot);
  /** @type {string[]} */
  const frozen = [];
  for (const service of composition.services) if (service.runId && (await freezerState(unitOf(service))).FreezerState === 'frozen') frozen.push(service.id);
  if (composition.state !== 'running') return {code: EXIT.failed, value: {operation: 'doctor', compositionId: id, state: composition.state, failure: composition.failure, reset: composition.reset ?? null, readiness: composition.readiness, frozen, services: composition.services.map(publicService)}};
  /** @type {Record<string, string>} */
  const states = {};
  // A Hub change reaches the consumers on their next poll, so the pairing checks get a few seconds, as readiness does.
  let pairing = await pairingChecks(io.env, composition);
  for (const deadline = Date.now() + 8000; pairing.some(c => c.outcome !== 'passed') && Date.now() < deadline;) {
    await pause(1000);
    pairing = await pairingChecks(io.env, composition);
  }
  /** @type {Check[]} */
  const checks = [...pairing, ...await doctorChecks(io.env, composition, io.progress, states), ...frozen.map(s => ({id: `${s}-frozen`, outcome: /** @type {const} */ ('failed'), detail: `${s} is frozen by an interrupted loss injection; stop thaws it`}))];
  const ok = checks.every(c => c.outcome === 'passed');
  // Every lease elapsed: the composition expired as a whole, and stop removes what is left.
  const expired = composition.services.every(s => states[s.id] === 'expired');
  return {code: ok ? EXIT.ok : EXIT.failed, value: {operation: 'doctor', compositionId: id, state: ok ? 'running' : expired ? 'expired' : 'degraded', pinned: composition.pinned, runs: states, checks, services: composition.services.map(publicService), card: card(composition)}};
}

// ---------------------------------------------------------------------------
// capture, handoff, extend

/** @param {Composition} composition */
function requireRunning(composition) {
  if (composition.state !== 'running') throw new ComposeFailure('composition-not-running', `${composition.id} is ${composition.state}`);
}

/** @param {Store} store @param {Env} env @param {Progress} progress @param {Service} hub @param {string} step */
async function captureStep(store, env, progress, hub, step) {
  const {code, result} = await invoke(hub, ['capture', hub.runId ?? '', step], {env, progress});
  const record = {step, runId: hub.runId, n: result.n ?? null, set: result.set ?? null, outcome: result.outcome ?? (result.error ? 'failed' : null), reason: result.reason ?? result.detail ?? null, captureDir: result.captureDir ?? null, at: iso()};
  await store.update(c => void c.captures.push(record), 'captured', {step, outcome: record.outcome});
  return {code, record, result};
}

/** @param {string | undefined} id @param {string} step @param {Io} io @returns {Promise<Outcome>} */
async function captureUnlocked(id, step, io) {
  // Only the integrated steps: any other Hub step is pinned to a fixture scenario and would reseed the owner out of
  // `integrated` under the paired consumers, and the injection steps need `inject`.
  if (!CAPTURE_STEPS.includes(step)) throw new UsageError(`capture runs only ${CAPTURE_STEPS.join(', ')}; the loss and second-owner steps run through inject`);
  const {store, composition} = await loadComposition(io.env, id, io.hubRoot);
  requireRunning(composition);
  const {code, record, result} = await captureStep(store, io.env, io.progress, owner(composition), step);
  return {code: code === EXIT.unavailable ? code : verdict(step, record).ok ? EXIT.ok : EXIT.failed, value: {operation: 'capture', compositionId: id, ...record, screenshot: result.screenshot ?? null, video: result.video ?? null, log: result.log ?? null}};
}

/** @param {string | undefined} id @param {Io} io @returns {Promise<Outcome>} */
async function handoffUnlocked(id, io) {
  const {store, composition} = await loadComposition(io.env, id, io.hubRoot);
  requireRunning(composition);
  /** @type {{id: string, runId: string | null, ok: boolean, frozenAt: string | null, verified: string | null, expiresAt: string | null, detail?: string}[]} */
  const results = [];
  for (const service of composition.services) {
    const {code, result} = await invoke(service, ['handoff', service.runId ?? ''], {env: io.env, progress: io.progress});
    results.push({id: service.id, runId: service.runId, ok: code === EXIT.ok, frozenAt: result.frozenAt ?? null, verified: result.verified ?? null, expiresAt: result.expiresAt ?? null, ...(code === EXIT.ok ? {} : {detail: result.detail ?? result.error ?? `exit ${code}`})});
  }
  const value = await store.update(c => {
    c.handoff = {at: iso(), services: results};
    for (const r of results) if (r.expiresAt) serviceOf(c, r.id).expiresAt = r.expiresAt;
  }, 'handed-off', {ok: results.every(r => r.ok)});
  const lines = card(value);
  for (const line of lines) io.progress(line);
  return {code: results.every(r => r.ok) ? EXIT.ok : EXIT.failed, value: {operation: 'handoff', compositionId: id, pinned: value.pinned, services: results, card: lines}};
}

/** @param {string | undefined} id @param {number | undefined} leaseMinutes @param {Io} io @returns {Promise<Outcome>} */
async function extendUnlocked(id, leaseMinutes, io) {
  const {store, composition} = await loadComposition(io.env, id, io.hubRoot);
  requireRunning(composition);
  /** @type {{id: string, runId: string | null, ok: boolean, expiresAt: string | null, detail?: string}[]} */
  const results = [];
  for (const service of composition.services) {
    const {code, result} = await invoke(service, ['extend', service.runId ?? '', ...(leaseMinutes === undefined ? [] : ['--lease', String(leaseMinutes)])], {env: io.env, progress: io.progress});
    results.push({id: service.id, runId: service.runId, ok: code === EXIT.ok, expiresAt: result.expiresAt ?? null, ...(code === EXIT.ok ? {} : {detail: result.detail ?? result.error ?? `exit ${code}`})});
  }
  const value = await store.update(c => {
    for (const r of results) if (r.ok) serviceOf(c, r.id).expiresAt = r.expiresAt;
  }, 'extended', {ok: results.every(r => r.ok)});
  return {code: results.every(r => r.ok) ? EXIT.ok : EXIT.failed, value: {operation: 'extend', compositionId: id, services: results, card: card(value)}};
}

// Public operations take the same lock even when called without the CLI.
/** @param {Parameters<typeof startUnlocked>[0]} options @param {Io} io */
export async function start(options, io) {
  return options.restarts ? operation(options.restarts, {...io, hubRoot: options.hubRoot ?? io.hubRoot}, () => startUnlocked(options, io)) : startUnlocked(options, io);
}
/** @param {string | undefined} id @param {Io} io */
export const stop = (id, io) => operation(id, io, () => stopUnlocked(id, io));
/** @param {string | undefined} id @param {Io} io */
export const doctor = (id, io) => id === undefined ? doctorUnlocked(id, io) : operation(id, io, () => doctorUnlocked(id, io));
/** @param {string | undefined} id @param {string} step @param {Io} io */
export const capture = (id, step, io) => operation(id, io, () => captureUnlocked(id, step, io));
/** @param {string | undefined} id @param {Io} io */
export const handoff = (id, io) => operation(id, io, () => handoffUnlocked(id, io));
/** @param {string | undefined} id @param {number | undefined} leaseMinutes @param {Io} io */
export const extend = (id, leaseMinutes, io) => operation(id, io, () => extendUnlocked(id, leaseMinutes, io));
/** @param {string | undefined} id @param {string} kind @param {string} serviceId @param {string | undefined} step @param {Io} io @param {number} [thawAfter] */
export const inject = (id, kind, serviceId, step, io, thawAfter) => operation(id, io, () => injectUnlocked(id, kind, serviceId, step, io, thawAfter));

// ---------------------------------------------------------------------------
// reset: pause both live feeds, reseed their owner, then release fresh consumers.

/** @param {Composition} composition */
async function resetSourceIdentity(composition) {
  for (const service of composition.services) {
    const identity = await checkoutIdentity(service.checkout);
    if (identity.revision !== service.revision || identity.dirty || service.dirty) throw new ComposeFailure('identity-mismatch', 'reset requires the unchanged clean recorded candidate', service.id);
  }
}
/** @param {string | undefined} id @param {Io} io @param {{pauseTimeoutMs?: number, readyTimeoutMs?: number}} [options] */
export async function reset(id, io, options = {}) {
  return operation(id, io, async () => {
    const {store, composition} = await loadComposition(io.env, id, io.hubRoot);
    requireRunning(composition);
    await resetSourceIdentity(composition);
    const hub = owner(composition), paired = consumers(composition);
    const pauseOptions = {runtimeRoot: stateRoot(io.env),
      runtimeLabel: io.env.APP_VERIFY_STATE_ROOT ? stateRoot(io.env) : '~/.local/state/app-verify',
      timeoutMs: options.pauseTimeoutMs};
    let phase = 'pause', affected = /** @type {string | null} */ (null);
    const attempt = randomBytes(8).toString('hex');
    await store.update(c => {
      c.state = 'resetting'; c.readiness = null; c.failure = null;
      for (const consumer of paired) serviceOf(c, consumer.id).state = 'pause-pending';
      c.reset = {attempt, phase, service: null, startedAt: iso()};
    }, 'reset-started', {attempt});
    const enter = async (/** @type {string} */ next, /** @type {Service | undefined} */ service) => {
      phase = next; affected = service?.id ?? null;
      await store.update(c => {
        if (c.reset) Object.assign(c.reset, {phase, service: affected});
        if (service) serviceOf(c, service.id).state = 'resetting';
      }, 'reset-phase', {attempt, phase, service: affected});
    };
    const reseed = async (/** @type {Service} */ service, /** @type {string[]} */ inputs) => {
      const {code, result} = await invoke(service, ['scenario', service.runId ?? '', service.scenario, ...inputs], io);
      await store.update(c => {
        const row = serviceOf(c, service.id);
        row.state = result.state ?? (code === EXIT.ok ? 'running' : 'unknown');
        row.failure = code === EXIT.ok ? null : {cause: result.cause ?? result.error ?? 'reset-failed', detail: result.detail ?? null};
        if (result.cleanup) row.cleanup = result.cleanup;
      }, 'reset-service', {attempt, service: service.id, ok: code === EXIT.ok});
      if (code !== EXIT.ok) throw new ComposeFailure('service-reset-failed', 'the recorded adapter did not complete reseeding', service.id);
      if (result.runId !== service.runId || result.state !== 'running' || result.url !== service.url
        || JSON.stringify(Object.entries(result.endpoints ?? {}).sort()) !== JSON.stringify(Object.entries(service.endpoints ?? {}).sort())) {
        throw new ComposeFailure('reset-identity-mismatch', 'reseed did not preserve the recorded run and endpoints', service.id);
      }
      service.state = 'running';
    };
    try {
      await liveFeedIdentity(hub, pauseOptions);
      await withPausedFeeds(paired, pauseOptions, async tickets => {
        await store.update(c => { for (const consumer of paired) serviceOf(c, consumer.id).state = 'paused'; }, 'feeds-paused', {attempt});
        await resetSourceIdentity(composition);
        await liveFeedIdentity(hub, pauseOptions);
        await enter('owner', hub);
        await verifyPausedFeeds(tickets, pauseOptions);
        const inputs = paired.flatMap(c => ['--input', `${c.id}-controller=${c.endpoints?.controller}`, '--input', `${c.id}-preview=${c.url}`]);
        await reseed(hub, inputs);
        for (const ticket of tickets) {
          const consumer = serviceOf(composition, ticket.service.id);
          await enter('consumer', consumer);
          await releaseFeed(ticket, pauseOptions);
          await reseed(consumer, ['--input', `hub-feed=${hub.url}`]);
        }
      });
      await enter('readiness', undefined);
      const current = await store.read();
      const checks = await awaitReady(io.env, current, io.progress, options.readyTimeoutMs ?? 60000);
      const value = await store.update(c => {
        c.state = 'running'; c.readiness = {outcome: 'passed', checks, at: iso()};
        if (c.reset) Object.assign(c.reset, {phase: 'complete', service: null, finishedAt: iso()});
      }, 'reset-complete', {attempt});
      return {code: EXIT.ok, value: {operation: 'reset', compositionId: id, state: value.state, reset: value.reset, services: value.services.map(publicService), readiness: value.readiness, card: card(value)}};
    } catch (error) {
      const failure = error instanceof ComposeFailure ? error : error instanceof FeedPauseError
        ? new ComposeFailure('feed-pause-failed', error.message, error.service)
        : new ComposeFailure('reset-failed', 'reset could not complete; inspect the recorded phase and stop the composition', affected);
      const value = await store.update(c => {
        c.state = 'reset-failed'; c.failure = {cause: failure.failure, detail: failure.detail, phase, service: failure.service ?? affected, at: iso()};
        if (failure.checks) c.readiness = {outcome: 'failed', checks: failure.checks, at: iso()};
        if (c.reset) Object.assign(c.reset, {phase, service: failure.service ?? affected, finishedAt: iso()});
        // A wrapper failure without a result does not establish that the unit stopped.
        if (affected && serviceOf(c, affected).state === 'resetting') serviceOf(c, affected).state = 'unknown';
      }, 'reset-failed', {attempt, phase, service: failure.service ?? affected, cause: failure.failure});
      return {code: EXIT.failed, value: {operation: 'reset', compositionId: id, state: value.state, failure: value.failure, reset: value.reset, services: value.services.map(publicService), readiness: value.readiness}};
    }
  });
}

// ---------------------------------------------------------------------------
// inject: a consumer's loss and recovery, or a second owner, driven by a Hub capture step.
//
// The step and the orchestrator share two small files in the Hub run's runtime
// directory (PAIRING.files.inject). The step asks for a phase in the request
// file; the orchestrator applies it to the recorded run of the service named on
// the command line and answers in the state file:
// - consumer-loss: `freeze` and `thaw` of the recorded unit, read back through
//   its FreezerState;
// - second-owner: `second-owner` reseeds the consumer to its standalone
//   scenario, its own embedded owner.
// The step never names a unit or a scenario. Whatever happens to the step, the
// orchestrator thaws the unit or reseeds the consumer back to its paired
// scenario, removes the files, records the injection and prints one result line.

/** @type {Record<string, Record<string, string[]>>} */
const INJECTION_STEPS = INJECTIONS;
/** The loss step's own budget in seconds (its capture timeout), which a lease must outlast with the safety thaw. */
const LOSS_STEP_SECONDS = 180;

/**
 * The verdict on a capture: a reference step must pass; a control must fail at its named assertion.
 * @param {string} step @param {{outcome: string | null, reason: string | null}} record
 */
export function verdict(step, record) {
  const expected = /** @type {Record<string, string>} */ (CONTROLS)[step];
  if (expected === undefined) return {ok: record.outcome === 'passed'};
  const held = record.outcome === 'failed' && typeof record.reason === 'string' && record.reason.startsWith(`assertion failed: ${expected}`);
  return {ok: held, control: {expected, held}};
}

/**
 * @param {string | undefined} id @param {string} kind @param {string} serviceId @param {string | undefined} step @param {Io} io
 * @param {number} [thawAfter] seconds after a freeze at which the user manager thaws the consumer even if this process died
 * @returns {Promise<Outcome>}
 */
async function injectUnlocked(id, kind, serviceId, step, io, thawAfter = 120) {
  const kinds = INJECTION_STEPS[kind];
  if (!kinds) throw new UsageError(`inject supports ${Object.keys(INJECTION_STEPS).join(' and ')}`);
  const steps = kinds[serviceId];
  if (!steps) throw new UsageError(`${kind} has no step for ${serviceId}; it supports ${Object.keys(kinds).join(', ')}`);
  const chosen = step ?? steps[0] ?? '';
  if (!steps.includes(chosen)) throw new UsageError(`${kind} ${serviceId} runs only ${steps.join(' or ')}`);
  const {store, composition} = await loadComposition(io.env, id, io.hubRoot);
  requireRunning(composition);
  const target = serviceOf(composition, serviceId);
  if (!target || target.role !== 'consumer') throw new UsageError(`${serviceId} is not a consumer of ${id}`);
  const hub = owner(composition);
  const unit = unitOf(target);
  const before = await freezerState(unit);
  if (before.ActiveState !== 'active' || before.FreezerState !== 'running') throw new ComposeFailure('run-not-running', `${unit} is ${before.ActiveState ?? 'unknown'}/${before.FreezerState ?? 'unknown'}`, serviceId);
  // The lease stops its unit once; systemd refuses to stop a frozen unit, so a lease that ended inside the freeze would
  // leave the consumer running with none. Freeze only a consumer whose lease outlasts the step and the safety thaw.
  if (kind === 'consumer-loss') {
    await requireFreezeLease(target, thawAfter);
  }
  const directory = runtimeDir(io.env, hub);
  const requestFile = join(directory, PAIRING.files.inject.request), stateFile = join(directory, PAIRING.files.inject.state);
  await rm(requestFile, {force: true});
  await rm(stateFile, {force: true});
  const answer = async (/** @type {string} */ phase) => {
    const next = `${stateFile}.tmp`;
    await writeFile(next, JSON.stringify({service: serviceId, phase, at: iso()}), {mode: 0o600});
    await rename(next, stateFile);
  };
  await answer('armed');
  /** @type {Record<string, unknown>} */
  const injection = {kind, service: serviceId, unit, step: chosen, startedAt: iso(), frozenAt: null, thawedAt: null, thawedBy: null, secondOwnerAt: null, restoredAt: null, capture: null, outcome: null};
  await store.update(c => void c.injections.push({...injection}), 'inject-armed', {kind, service: serviceId, unit, step: chosen});
  const record = async (/** @type {Record<string, unknown>} */ fields) => {
    Object.assign(injection, fields);
    await store.update(c => void Object.assign(c.injections.at(-1), fields), 'inject-progress', fields);
  };
  /** @type {string[]} */
  const problems = [];
  let handled = 0, reseeded = false;
  /** Apply one requested phase to the recorded run. @param {{phase?: unknown, service?: unknown}} request */
  const apply = async request => {
    const allowed = kind === 'consumer-loss' ? ['freeze', 'thaw'] : ['second-owner'];
    if (request.service !== serviceId || !allowed.includes(String(request.phase))) {
      problems.push(`the step asked for ${request.phase} on ${request.service}; this ${kind} injection targets ${serviceId}`);
      return answer('refused');
    }
    if (request.phase === 'freeze') {
      try {
        await requireFreezeLease(target, thawAfter);
      } catch (error) {
        problems.push(/** @type {Error} */ (error).message);
        return answer('refused');
      }
      if (!await armSafetyThaw(target, thawAfter)) {
        problems.push(`the safety thaw for ${unit} could not be armed, so it was not frozen`);
        return answer('refused');
      }
      await run('systemctl', ['--user', 'freeze', unit]).catch(() => undefined);
      const state = (await freezerState(unit)).FreezerState;
      if (state !== 'frozen') {
        problems.push(`freeze left ${unit} ${state}`);
        return answer('refused');
      }
      await record({frozenAt: iso()});
      return answer('frozen');
    }
    if (request.phase === 'thaw') {
      // Already running means the safety timer ended the loss before the step asked: its observations may be short.
      const beforeThaw = await freezerState(unit);
      const result = await thawWithLease(target.runId ?? '', receiptPath(target));
      if (!result.leaseValid) problems.push('the consumer lease expired or could not be verified after thaw; its unit was stopped');
      if (beforeThaw.FreezerState === 'running' || beforeThaw.ActiveState !== 'active') {
        problems.push(`the safety thaw ran ${unit} before the step asked for the thaw; raise --thaw-after`);
        await record({thawedAt: iso(), thawedBy: 'safety-timer'});
        return answer(result.leaseValid ? 'thawed' : 'refused');
      }
      const state = result.freezerState;
      if (!result.leaseValid || state !== 'running') {
        problems.push(`thaw left ${unit} ${state}`);
        return answer('refused');
      }
      await record({thawedAt: iso(), thawedBy: 'step'});
      return answer('thawed');
    }
    // second-owner: the consumer's standalone scenario is its own embedded owner.
    // Marked first: whatever happens to this reseed, the finally pairs the consumer again.
    reseeded = true;
    const {code, result} = await invoke(target, ['scenario', target.runId ?? '', target.standalone ?? ''], {env: io.env, progress: io.progress});
    if (code !== EXIT.ok) {
      problems.push(`reseeding ${serviceId} to ${target.standalone} failed: ${result.cause ?? result.error ?? code}`);
      return answer('refused');
    }
    await record({secondOwnerAt: iso()});
    return answer('second-owner');
  };
  const watch = async () => {
    const text = await readFile(requestFile, 'utf8').catch(() => undefined);
    if (!text) return;
    let request;
    try {
      request = JSON.parse(text);
    } catch {
      return;
    }
    if (!Number.isInteger(request.seq) || request.seq <= handled) return;
    handled = request.seq;
    await apply(request);
  };
  /** @type {{code: number, record: any} | undefined} */
  let captured;
  /** @type {unknown} */
  let crashed;
  let finished = false;
  // Settled at once, so a wrapper that dies mid-step is a result here, never an unhandled rejection.
  const capturing = captureStep(store, io.env, io.progress, hub, chosen).then(value => void (captured = value), error => void (crashed = error)).finally(() => (finished = true));
  try {
    while (!finished) {
      await watch().catch(error => problems.push(/** @type {Error} */ (error).message));
      await pause(100);
    }
    await capturing;
  } finally {
    // Always leave the consumer as the composition paired it.
    if (kind === 'consumer-loss') {
      const beforeFinal = await freezerState(unit);
      try {
        const result = await thawWithLease(target.runId ?? '', receiptPath(target));
        if (beforeFinal.FreezerState === 'frozen') await record({thawedAt: iso(), thawedBy: 'orchestrator'});
        if (!result.leaseValid) problems.push('the consumer lease expired or could not be verified after thaw; its unit was stopped');
        if (!await disarmSafetyThaw(target)) problems.push('the safety thaw could not be verified stopped');
      } catch (error) {
        problems.push(/** @type {Error} */ (error).message);
        // Keep the safety timer armed when thaw/stop could not be verified.
      }
    }
    if (reseeded) {
      const {code, result} = await invoke(target, ['scenario', target.runId ?? '', target.scenario], {env: io.env, progress: io.progress}).catch(error => ({code: EXIT.failed, result: {error: /** @type {ComposeFailure} */ (error).failure ?? 'adapter-unavailable'}}));
      if (code === EXIT.ok) await record({restoredAt: iso()});
      else problems.push(`restoring ${serviceId} to ${target.scenario} failed: ${result.cause ?? result.error ?? code}`);
    }
    await rm(requestFile, {force: true});
    await rm(stateFile, {force: true});
  }
  if (crashed !== undefined) {
    const failure = crashed instanceof ComposeFailure ? crashed : new ComposeFailure('adapter-unavailable', String(/** @type {Error} */ (crashed)?.message ?? crashed), hub.id, EXIT.unavailable);
    problems.push(`the Hub capture ended without a result: ${failure.detail}`);
    await record({problems, outcome: 'failed', finishedAt: iso()});
    return {code: failure.code === EXIT.failed ? EXIT.failed : EXIT.unavailable, value: {operation: 'inject', compositionId: id, kind, service: serviceId, unit, step: chosen, outcome: 'failed', error: failure.failure, detail: failure.detail, frozenAt: injection.frozenAt, thawedAt: injection.thawedAt, thawedBy: injection.thawedBy, secondOwnerAt: injection.secondOwnerAt, restoredAt: injection.restoredAt, problems}};
  }
  const {code, record: captureRecord} = /** @type {{code: number, record: any}} */ (captured);
  const expected = kind === 'consumer-loss' ? 'frozenAt' : 'secondOwnerAt';
  if (!injection[expected]) problems.push(`the step never asked for the ${kind === 'consumer-loss' ? 'freeze' : 'second owner'}`);
  // After the step the composition must be ready again: feeds current and both devices read.
  /** @type {Check[]} */
  let checks;
  try {
    checks = await awaitReady(io.env, composition, io.progress, 60000);
  } catch (error) {
    checks = /** @type {ComposeFailure} */ (error).checks ?? [];
    problems.push(/** @type {ComposeFailure} */ (error).detail ?? /** @type {Error} */ (error).message);
  }
  const judged = verdict(chosen, captureRecord);
  const passed = judged.ok && problems.length === 0 && (code === EXIT.ok || judged.control !== undefined);
  await record({capture: {n: captureRecord.n, outcome: captureRecord.outcome, reason: captureRecord.reason, captureDir: captureRecord.captureDir}, ...(judged.control ? {control: judged.control} : {}), recovery: checks, problems, outcome: passed ? 'passed' : 'failed', finishedAt: iso()});
  return {code: passed ? EXIT.ok : EXIT.failed, value: {operation: 'inject', compositionId: id, kind, service: serviceId, unit, step: chosen, outcome: passed ? 'passed' : 'failed', ...(judged.control ? {control: judged.control} : {}), frozenAt: injection.frozenAt, thawedAt: injection.thawedAt, thawedBy: injection.thawedBy, secondOwnerAt: injection.secondOwnerAt, restoredAt: injection.restoredAt, capture: injection.capture, recovery: checks, problems}};
}

// ---------------------------------------------------------------------------
// CLI

const OPERATIONS = [
  'help',
  'start --checkout <service>=<absolute path>... [--lease <minutes>] [--unpinned] [--restarts <composition-id>] [--manifest <path>]',
  'doctor [<composition-id>]',
  'capture <composition-id> <step>',
  'inject <composition-id> consumer-loss|second-owner <service> [--step <step>] [--thaw-after <seconds>]',
  'reset <composition-id>',
  'handoff <composition-id>',
  'extend <composition-id> [--lease <minutes>]',
  'stop <composition-id>',
];
/** @type {Record<string, string[]>} */
const FLAGS = {start: ['--checkout', '--lease', '--manifest', '--restarts'], inject: ['--step', '--thaw-after'], extend: ['--lease']};
/** @type {Record<string, string[]>} */
const SWITCHES = {start: ['--unpinned']};

/** @param {readonly string[]} argv */
function parse(argv) {
  const [operation = 'help', ...rest] = argv;
  /** @type {string[]} */
  const positional = [];
  /** @type {Record<string, string>} */
  const flags = {};
  /** @type {Record<string, string>} */
  const checkouts = {};
  const switches = new Set();
  for (let index = 0; index < rest.length; index++) {
    const argument = /** @type {string} */ (rest[index]);
    if (!argument.startsWith('--')) {
      positional.push(argument);
      continue;
    }
    if ((SWITCHES[operation] ?? []).includes(argument)) {
      switches.add(argument);
      continue;
    }
    if (!(FLAGS[operation] ?? []).includes(argument)) throw new UsageError(`${operation} does not take ${argument}`);
    const value = rest[++index];
    if (value === undefined || value.startsWith('--')) throw new UsageError(`${argument} needs a value`);
    if (argument === '--checkout') {
      const at = value.indexOf('=');
      if (at <= 0) throw new UsageError('--checkout takes <service>=<absolute path>');
      const name = value.slice(0, at);
      if (Object.hasOwn(checkouts, name)) throw new UsageError(`--checkout ${name} is given twice`);
      checkouts[name] = value.slice(at + 1);
    } else if (Object.hasOwn(flags, argument)) throw new UsageError(`${argument} is given twice`);
    else flags[argument] = value;
  }
  return {operation, positional, flags, checkouts, switches};
}

/** @param {string | undefined} value */
function lease(value) {
  if (value === undefined) return undefined;
  const minutes = Number(value);
  if (!/^\d+(?:\.\d+)?$/.test(value) || !(minutes >= 0.05) || minutes > 1440) throw new UsageError('--lease takes minutes from 0.05 to 1440');
  return minutes;
}

/** @param {string | undefined} value */
function thawAfter(value) {
  if (value === undefined) return 120;
  const seconds = Number(value);
  // At least a minute: the loss step holds the freeze while it waits up to 20 s for the stale mark and sends one command.
  if (!/^\d+$/.test(value) || seconds < 60 || seconds > 600) throw new UsageError('--thaw-after takes whole seconds from 60 to 600');
  return seconds;
}

/** @param {string[]} positional @param {number} count @param {string} operation */
function arity(positional, count, operation) {
  if (positional.length !== count) throw new UsageError(`${operation} takes ${count} argument${count === 1 ? '' : 's'}; see help`);
}

/**
 * Run one composition operation and return the exit code. `options` is for
 * tests: env, stdout/stderr sinks, the Hub root and a readiness timeout.
 * @param {readonly string[]} argv
 * @param {{env?: Env, stdout?: Progress, stderr?: Progress, hubRoot?: string, manifest?: string, readyTimeoutMs?: number}} [options]
 */
export async function runCompose(argv, options = {}) {
  let env = options.env ?? process.env;
  // Every adapter writes proof beside the Hub's, under the canonical Hub checkout. Without this a
  // consumer in a disposable checkout keeps its receipts there and loses them on removal (Hub #856).
  if (!env.APP_VERIFY_PROOF_ROOT) {
    const root = await proofRoot(env, options.hubRoot).catch(() => undefined);
    if (root) env = {...env, APP_VERIFY_PROOF_ROOT: root};
  }
  const stdout = options.stdout ?? (/** @param {string} line */ line => void process.stdout.write(line + '\n'));
  const progress = options.stderr ?? (/** @param {string} line */ line => void process.stderr.write(line + '\n'));
  const io = {env, progress, hubRoot: options.hubRoot};
  let operation = argv[0] ?? 'help';
  try {
    const parsed = parse(argv);
    operation = parsed.operation;
    const {positional, flags} = parsed;
    /** @type {Outcome} */
    let outcome;
    switch (operation) {
      case 'help':
        outcome = {code: EXIT.ok, value: {operation, command: COMMAND, operations: OPERATIONS, manifest: 'apps/hub/verify/compose.json', exitCodes: {0: 'verified', 1: 'failed outcome', 2: 'usage error', 3: 'supervisor or adapter unavailable'}}};
        break;
      case 'start':
        arity(positional, 0, operation);
        outcome = await start({checkouts: parsed.checkouts, lease: lease(flags['--lease']), unpinned: parsed.switches.has('--unpinned'), restarts: flags['--restarts'], manifest: flags['--manifest'] ? resolve(flags['--manifest']) : options.manifest, hubRoot: options.hubRoot, readyTimeoutMs: options.readyTimeoutMs}, io);
        break;
      case 'doctor':
        if (positional.length > 1) throw new UsageError('doctor takes at most one composition id');
        outcome = await doctor(positional[0], io);
        break;
      case 'capture':
        arity(positional, 2, operation);
        outcome = await capture(positional[0], positional[1] ?? '', io);
        break;
      case 'inject':
        arity(positional, 3, operation);
        outcome = await inject(positional[0], positional[1] ?? '', positional[2] ?? '', flags['--step'], io, thawAfter(flags['--thaw-after']));
        break;
      case 'reset':
        arity(positional, 1, operation);
        outcome = await reset(positional[0], io, {readyTimeoutMs: options.readyTimeoutMs});
        break;
      case 'handoff':
        arity(positional, 1, operation);
        outcome = await handoff(positional[0], io);
        break;
      case 'extend':
        arity(positional, 1, operation);
        outcome = await extend(positional[0], lease(flags['--lease']), io);
        break;
      case 'stop':
        arity(positional, 1, operation);
        outcome = await stop(positional[0], io);
        break;
      default:
        throw new UsageError(`unknown operation ${operation}; see help`);
    }
    stdout(JSON.stringify(outcome.value));
    return outcome.code;
  } catch (error) {
    if (error instanceof UsageError) {
      stdout(JSON.stringify({operation, error: 'usage', detail: error.message}));
      return EXIT.usage;
    }
    if (error instanceof ComposeFailure) {
      stdout(JSON.stringify({operation, error: error.failure, ...(error.service ? {service: error.service} : {}), detail: error.detail}));
      return error.code;
    }
    stdout(JSON.stringify({operation, error: 'internal', detail: String(/** @type {Error} */ (error)?.message ?? error).split('\n')[0]}));
    progress(/** @type {Error} */ (error)?.stack ?? String(error));
    return EXIT.failed;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await runCompose(process.argv.slice(2));
}
