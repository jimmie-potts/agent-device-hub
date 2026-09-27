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
//   npm run -s verify:compose -- handoff <composition-id>
//   npm run -s verify:compose -- extend <composition-id> [--lease <minutes>]
//   npm run -s verify:compose -- stop <composition-id>
//
// Every operation prints one JSON result line on stdout and progress on
// stderr. Exit 0 means the outcome was verified; 1 a failed outcome; 2 a usage
// error; 3 an unavailable supervisor or adapter.
import {spawn, execFile} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {existsSync} from 'node:fs';
import {lstat, mkdir, open, readdir, readFile, realpath, rename, rm, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {isAbsolute, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {promisify} from 'node:util';
import {consumerState} from './consumers.mjs';
import {PAIRING} from './integrated.mjs';

const run = promisify(execFile);
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
const pause = (/** @type {number} */ ms) => new Promise(resolve => setTimeout(resolve, ms));
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
 *   endpoints: Record<string, string> | null, proofDir: string | null, expiresAt: string | null, failure: {cause: string, detail: string | null} | null, cleanup: any}} Service
 * @typedef {{compositionVersion: string, id: string, state: string, pinned: boolean, startedAt: string, updatedAt: string, restarts?: string, continuity?: string, manifest: unknown, lease: unknown,
 *   services: Service[], readiness: {outcome: string, checks: Check[], at: string} | null, captures: any[], injections: any[], failure: any, cleanup: any, handoff?: unknown, secrets: string}} Composition
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
    const child = spawn(program ?? '', [...rest, ...args], {cwd: service.checkout, env, stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '', pending = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
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
  /** One writer at a time: an exclusive lock file naming its holder; a dead holder's lock is broken. */
  async lock() {
    const path = join(this.dir, '.composition.lock');
    for (let attempt = 0; attempt < 200; attempt++) {
      try {
        const handle = await open(path, 'wx', 0o600);
        await handle.writeFile(String(process.pid));
        await handle.close();
        return async () => rm(path, {force: true});
      } catch (error) {
        if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'EEXIST') throw error;
        const holder = Number(await readFile(path, 'utf8').catch(() => ''));
        let alive = Number.isInteger(holder) && holder > 0;
        if (alive) {
          try {
            process.kill(holder, 0);
          } catch (probe) {
            alive = /** @type {NodeJS.ErrnoException} */ (probe).code === 'EPERM';
          }
        }
        if (!alive) await rm(path, {force: true});
        else await pause(100);
      }
    }
    throw new ComposeFailure('composition-locked', `another operation holds ${this.id}`);
  }
  /**
   * Read, change and write the record under the lock.
   * @param {(value: Composition) => void | Promise<void>} change @param {string} [event] @param {Record<string, unknown>} [fields]
   */
  async update(change, event, fields) {
    const release = await this.lock();
    try {
      const value = await this.read();
      await change(value);
      await this.write(value);
      if (event) await this.event(event, fields);
      return value;
    } finally {
      await release();
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

/** The controller alias the Hub's integrated configuration gives a consumer. @param {string} consumer */
const aliasOf = consumer => /** @type {Record<string, {alias: string}>} */ (PAIRING.controllers)[consumer]?.alias ?? consumer;

/**
 * One pass of the pairing checks. Reads only: a snapshot read through the Hub
 * is the Hub's ordinary read path and changes no controller.
 * @param {Env} env @param {Composition} composition
 * @returns {Promise<Check[]>}
 */
async function pairingChecks(env, composition) {
  const hub = owner(composition);
  /** @type {Check[]} */
  const checks = [];
  const add = (/** @type {string} */ id, /** @type {boolean} */ ok, /** @type {string} */ detail) => checks.push(ok ? {id, outcome: 'passed'} : {id, outcome: 'failed', detail});
  let revision;
  try {
    const sessions = await hubRead(env, hub, '/api/monitor/v1/sessions');
    revision = sessions.body?.snapshot?.revision;
    add('hub-owner', sessions.status === 200 && Number.isInteger(revision), `the Hub feed answered ${sessions.status}`);
  } catch (error) {
    add('hub-owner', false, `the Hub feed is unreadable (${/** @type {Error} */ (error).name})`);
  }
  for (const consumer of consumers(composition)) {
    const alias = aliasOf(consumer.id);
    try {
      const snapshot = await hubRead(env, hub, `/api/controllers/v1/${alias}/snapshot`);
      add(`hub-reads-${consumer.id}`, snapshot.status === 200, `the Hub's ${alias} snapshot answered ${snapshot.status}${snapshot.body?.error?.code ? ` ${snapshot.body.error.code}` : ''}`);
    } catch (error) {
      add(`hub-reads-${consumer.id}`, false, `the Hub's ${alias} snapshot is unreadable (${/** @type {Error} */ (error).name})`);
    }
    try {
      const state = await consumerState(consumer.id, consumer.url ?? '');
      const current = state.feed.connection === 'current' && state.feed.revision === revision;
      add(`${consumer.id}-feed-current`, current, `feed ${state.feed.connection} at revision ${state.feed.revision} (Hub ${revision})${state.feed.error ? `, ${state.feed.error}` : ''}`);
    } catch (error) {
      add(`${consumer.id}-feed-current`, false, /** @type {Error} */ (error).message);
    }
  }
  try {
    const health = await hubRead(env, hub, '/api/hub/v1/health');
    const devices = Object.fromEntries((health.body?.devices ?? []).map((/** @type {{id: string, health: string}} */ d) => [d.id, d.health]));
    const expected = consumers(composition).map(c => aliasOf(c.id));
    add('hub-devices-current', health.status === 200 && expected.every(alias => devices[alias] === 'ready'), `health ${health.status}, devices ${JSON.stringify(devices)}`);
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
async function awaitReady(env, composition, progress, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  /** @type {Check[]} */
  let checks = [];
  for (;;) {
    checks = await pairingChecks(env, composition);
    if (checks.every(c => c.outcome === 'passed')) {
      checks = [...checks, ...await doctorChecks(env, composition, progress)];
      if (checks.every(c => c.outcome === 'passed')) return checks;
    }
    if (Date.now() > deadline) {
      const failing = checks.filter(c => c.outcome !== 'passed');
      const failure = new ComposeFailure('readiness-timeout', `not ready within ${Math.round(timeoutMs / 1000)} s: ${failing.map(c => `${c.id}: ${c.detail}`).join('; ')}`);
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
  lines.push(`Doctor   ${COMMAND} doctor ${composition.id}`, `Extend   ${COMMAND} extend ${composition.id}`, `Stop     ${COMMAND} stop ${composition.id}`);
  return lines;
}

/** The fields of a service a result line carries: never the checkout path, a token or a runtime file. */
const publicService = (/** @type {Service} */ s) => ({id: s.id, repository: s.repository, app: s.app, runId: s.runId, state: s.state, revision: s.revision, pinned: s.pinned, dirty: s.dirty, coreVersion: s.coreVersion, scenario: s.scenario, url: s.url, endpoints: s.endpoints, proofDir: s.proofDir, expiresAt: s.expiresAt, failure: s.failure, cleanup: s.cleanup});

// ---------------------------------------------------------------------------
// start

const RUN_ID = (/** @type {string} */ app) => new RegExp(`^(${app}-\\d{8}T\\d{6}Z-[0-9a-f]{6}): starting `);

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
export async function start(options, io) {
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
    if (previous.state === 'running' || previous.state === 'starting') throw new UsageError(`${options.restarts} is ${previous.state}; stop it before restarting it`);
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
    services: services.map(s => ({id: s.id, role: s.role, repository: s.repository, app: s.app, checkout: s.checkout, run: s.run, pin: s.pin, revision: s.revision, dirty: s.dirty, pinned: s.pinned, coreVersion: helps[s.id].coreVersion, scenario: s.scenario, runId: null, state: 'pending', url: null, endpoints: null, proofDir: null, expiresAt: null, failure: null, cleanup: null})),
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
      const {code, result} = await invoke(service, ['start', ...lease], {env, progress, onLine: line => {
        const match = RUN_ID(service.app).exec(line);
        if (match) recorded = store.update(c => void (serviceOf(c, service.id).runId = match[1]), 'run-recorded', {service: service.id, runId: match[1]});
      }});
      await recorded;
      await store.update(c => {
        const s = serviceOf(c, service.id);
        Object.assign(s, {runId: result.runId ?? s.runId, state: result.state ?? 'failed', url: result.url ?? null, endpoints: result.endpoints ?? null, proofDir: result.proofDir ?? null, expiresAt: result.expiresAt ?? null});
        if (code !== EXIT.ok) s.failure = {cause: result.cause ?? result.error ?? 'start-failed', detail: result.detail ?? null};
        if (result.cleanup) s.cleanup = result.cleanup;
      }, 'service-started', {service: service.id, runId: result.runId, state: result.state});
      Object.assign(service, {runId: result.runId ?? null, url: result.url ?? null, expiresAt: result.expiresAt ?? null});
      if (code !== EXIT.ok) throw new ComposeFailure('service-start-failed', `${service.id} ${result.cause ?? result.error ?? 'failed'}${result.detail ? `: ${result.detail}` : ''}`, service.id, code === EXIT.unavailable ? EXIT.unavailable : EXIT.failed);
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
}

// ---------------------------------------------------------------------------
// stop: the owner first, then the consumers; every recorded run, past any failure.

/** @param {string} unit @returns {Promise<Record<string, string>>} */
async function freezerState(unit) {
  const output = await run('systemctl', ['--user', 'show', unit, '-p', 'FreezerState', '-p', 'LoadState', '-p', 'ActiveState'], {encoding: 'utf8'}).then(r => r.stdout, () => '');
  return Object.fromEntries(output.trim().split('\n').filter(Boolean).map(line => line.split('=')));
}

/** @param {string} unit */
async function thaw(unit) {
  await run('systemctl', ['--user', 'thaw', unit]).catch(() => undefined);
  return (await freezerState(unit)).FreezerState;
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
      const after = await thaw(unit);
      progress(`${store.id}: thawed ${unit} before stopping it (${after})`);
    }
    try {
      const {code, result} = await invoke(service, ['stop', service.runId], {env, progress});
      const cleanup = result.cleanup ?? null;
      const entry = {id: service.id, runId: service.runId, state: result.state ?? null, result: cleanup?.result ?? (code === EXIT.ok ? 'clean' : 'unknown'), ...(code === EXIT.ok ? {} : {detail: result.detail ?? result.error ?? `exit ${code}`})};
      results.push(entry);
      await store.update(c => {
        const s = serviceOf(c, service.id);
        s.state = result.state ?? s.state;
        s.cleanup = cleanup ?? {result: entry.result};
      }, 'service-stopped', {service: service.id, runId: service.runId, state: result.state, cleanup: entry.result, reason});
    } catch (error) {
      const detail = /** @type {ComposeFailure} */ (error).detail ?? /** @type {Error} */ (error).message;
      results.push({id: service.id, runId: service.runId, result: 'unknown', detail});
      await store.event('service-stop-failed', {service: service.id, runId: service.runId, detail});
    }
  }
  const result = results.some(r => r.result === 'unknown') ? 'unknown' : results.some(r => r.result === 'partial') ? 'partial' : 'clean';
  return {result, services: results};
}

/** @param {string | undefined} id @param {Io} io @returns {Promise<Outcome>} */
export async function stop(id, io) {
  const {store, composition} = await loadComposition(io.env, id, io.hubRoot);
  if (['stopped'].includes(composition.state) && composition.cleanup) {
    return {code: composition.cleanup.result === 'clean' ? EXIT.ok : EXIT.failed, value: {operation: 'stop', compositionId: id, state: composition.state, cleanup: composition.cleanup, repeated: true}};
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
export async function doctor(id, io) {
  if (id === undefined) return {code: EXIT.ok, value: {operation: 'doctor', compositions: await listCompositions(io.env, io.hubRoot)}};
  const {composition} = await loadComposition(io.env, id, io.hubRoot);
  /** @type {string[]} */
  const frozen = [];
  for (const service of composition.services) if (service.runId && (await freezerState(unitOf(service))).FreezerState === 'frozen') frozen.push(service.id);
  if (composition.state !== 'running') return {code: EXIT.failed, value: {operation: 'doctor', compositionId: id, state: composition.state, failure: composition.failure, frozen, services: composition.services.map(publicService)}};
  /** @type {Record<string, string>} */
  const states = {};
  /** @type {Check[]} */
  const checks = [...await pairingChecks(io.env, composition), ...await doctorChecks(io.env, composition, io.progress, states), ...frozen.map(s => ({id: `${s}-frozen`, outcome: /** @type {const} */ ('failed'), detail: `${s} is frozen by an interrupted loss injection; stop thaws it`}))];
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
export async function capture(id, step, io) {
  const {store, composition} = await loadComposition(io.env, id, io.hubRoot);
  requireRunning(composition);
  const {code, record, result} = await captureStep(store, io.env, io.progress, owner(composition), step);
  return {code, value: {operation: 'capture', compositionId: id, ...record, screenshot: result.screenshot ?? null, video: result.video ?? null, log: result.log ?? null}};
}

/** @param {string | undefined} id @param {Io} io @returns {Promise<Outcome>} */
export async function handoff(id, io) {
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
export async function extend(id, leaseMinutes, io) {
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

// ---------------------------------------------------------------------------
// inject: one consumer's loss and recovery, driven by a Hub capture step.
//
// The step and the orchestrator share two small files in the Hub run's runtime
// directory. The step asks for `freeze` or `thaw` in compose-inject-request;
// the orchestrator applies it to the recorded unit of the service named on the
// command line, reads the unit's FreezerState back, and answers in
// compose-inject-state. The step never names a unit, and the orchestrator
// always thaws when the step ends.

export const INJECT_FILES = {request: 'compose-inject-request', state: 'compose-inject-state'};

/** @param {string | undefined} id @param {string} kind @param {string} serviceId @param {string} step @param {Io} io @returns {Promise<Outcome>} */
export async function inject(id, kind, serviceId, step, io) {
  if (kind !== 'consumer-loss') throw new UsageError('inject supports consumer-loss');
  const {store, composition} = await loadComposition(io.env, id, io.hubRoot);
  requireRunning(composition);
  const target = serviceOf(composition, serviceId);
  if (!target || target.role !== 'consumer') throw new UsageError(`${serviceId} is not a consumer of ${id}`);
  const hub = owner(composition);
  const unit = unitOf(target);
  const before = await freezerState(unit);
  if (before.ActiveState !== 'active' || before.FreezerState !== 'running') throw new ComposeFailure('run-not-running', `${unit} is ${before.ActiveState ?? 'unknown'}/${before.FreezerState ?? 'unknown'}`, serviceId);
  const directory = runtimeDir(io.env, hub);
  const requestFile = join(directory, INJECT_FILES.request), stateFile = join(directory, INJECT_FILES.state);
  await rm(requestFile, {force: true});
  await rm(stateFile, {force: true});
  const answer = async (/** @type {string} */ phase) => {
    const next = `${stateFile}.tmp`;
    await writeFile(next, JSON.stringify({service: serviceId, phase, at: iso()}), {mode: 0o600});
    await rename(next, stateFile);
  };
  await answer('armed');
  /** @type {Record<string, unknown>} */
  const injection = {kind, service: serviceId, unit, step, startedAt: iso(), frozenAt: null, thawedAt: null, thawedBy: null, capture: null, outcome: null};
  await store.update(c => void c.injections.push({...injection}), 'inject-armed', {service: serviceId, unit, step});
  const record = async (/** @type {Record<string, unknown>} */ fields) => {
    Object.assign(injection, fields);
    await store.update(c => void Object.assign(c.injections.at(-1), fields), 'inject-progress', fields);
  };
  const problems = [];
  let handled = 0;
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
    if (request.service !== serviceId || !['freeze', 'thaw'].includes(request.phase)) {
      problems.push(`the step asked to ${request.phase} ${request.service}; this injection targets ${serviceId}`);
      await answer('refused');
      return;
    }
    if (request.phase === 'freeze') {
      await run('systemctl', ['--user', 'freeze', unit]).catch(() => undefined);
      const state = (await freezerState(unit)).FreezerState;
      if (state !== 'frozen') {
        problems.push(`freeze left ${unit} ${state}`);
        await answer('refused');
        return;
      }
      await record({frozenAt: iso()});
      await answer('frozen');
    } else {
      const state = await thaw(unit);
      if (state !== 'running') {
        problems.push(`thaw left ${unit} ${state}`);
        await answer('refused');
        return;
      }
      await record({thawedAt: iso(), thawedBy: 'step'});
      await answer('thawed');
    }
  };
  let finished = false;
  const captured = captureStep(store, io.env, io.progress, hub, step).finally(() => (finished = true));
  while (!finished) {
    await watch().catch(error => problems.push(/** @type {Error} */ (error).message));
    await pause(100);
  }
  const {code, record: captureRecord} = await captured;
  // Always leave the consumer running.
  if ((await freezerState(unit)).FreezerState !== 'running') {
    const state = await thaw(unit);
    await record({thawedAt: iso(), thawedBy: 'orchestrator'});
    if (state !== 'running') problems.push(`the final thaw left ${unit} ${state}`);
  }
  await rm(requestFile, {force: true});
  await rm(stateFile, {force: true});
  if (!injection.frozenAt) problems.push('the step never asked for the freeze');
  // After recovery the composition must be ready again: feeds current and both devices read.
  /** @type {Check[]} */
  let checks = [];
  try {
    checks = await awaitReady(io.env, composition, io.progress, 30000);
  } catch (error) {
    checks = /** @type {ComposeFailure} */ (error).checks ?? [];
    problems.push(/** @type {ComposeFailure} */ (error).detail ?? /** @type {Error} */ (error).message);
  }
  const passed = code === EXIT.ok && captureRecord.outcome === 'passed' && problems.length === 0;
  await record({capture: {n: captureRecord.n, outcome: captureRecord.outcome, reason: captureRecord.reason, captureDir: captureRecord.captureDir}, recovery: checks, problems, outcome: passed ? 'passed' : 'failed', finishedAt: iso()});
  return {code: passed ? EXIT.ok : EXIT.failed, value: {operation: 'inject', compositionId: id, kind, service: serviceId, unit, step, outcome: passed ? 'passed' : 'failed', frozenAt: injection.frozenAt, thawedAt: injection.thawedAt, thawedBy: injection.thawedBy, capture: injection.capture, recovery: checks, problems}};
}

// ---------------------------------------------------------------------------
// CLI

const OPERATIONS = [
  'help',
  'start --checkout <service>=<absolute path>... [--lease <minutes>] [--unpinned] [--restarts <composition-id>] [--manifest <path>]',
  'doctor [<composition-id>]',
  'capture <composition-id> <step>',
  'inject <composition-id> consumer-loss <service> [--step <step>]',
  'handoff <composition-id>',
  'extend <composition-id> [--lease <minutes>]',
  'stop <composition-id>',
];
/** @type {Record<string, string[]>} */
const FLAGS = {start: ['--checkout', '--lease', '--manifest', '--restarts'], inject: ['--step'], extend: ['--lease']};
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
  const env = options.env ?? process.env;
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
        outcome = await inject(positional[0], positional[1] ?? '', positional[2] ?? '', flags['--step'] ?? `${positional[2]}-loss`, io);
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

