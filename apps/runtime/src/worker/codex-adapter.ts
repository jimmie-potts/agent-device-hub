import {writerGone} from './writer-proof.js';
import {execFile, spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {lstat, mkdtemp, readdir, realpath, rm, symlink, writeFile} from 'node:fs/promises';
import {userInfo} from 'node:os';
import {isAbsolute, join, relative, resolve, sep} from 'node:path';
import {promisify} from 'node:util';
import {Ajv2020} from 'ajv/dist/2020.js';
import {createInterface} from 'node:readline';
import type {CodingLimit, CodingLimitWindow} from '@jimmie-potts/event-contracts/v2/coding';
import {checkStateDirectory, prepareStateDirectory} from '../state.js';
import {CODEX_RESULT_SCHEMA, nativeSessionId, reportedModel, type AdapterEvidence, type AdapterHealth, type AdapterRun, type CodingAdapter} from './adapter.js';
import {harnessEnvironment, parseVersion, UNKNOWN_READINESS, type HarnessReadiness} from './claude-stream.js';

const execute = promisify(execFile);
// Validate independently of the provider's structured-output promise.
const validOutput = new Ajv2020({strict: true}).compile(CODEX_RESULT_SCHEMA);
const PROBE_MS = 10_000;
const QUOTA_MS = 2000;
const STEER_MS = 4000;
const STEER_LIMIT = 32;
const MESSAGE_BYTES = 1024 * 1024;
const CLOSED = new Error('codex protocol closed');
const CHATGPT_ORIGIN = 'https://chatgpt.com';
const CHATGPT_BACKEND = `${CHATGPT_ORIGIN}/backend-api/`;
const OPENAI_API = 'https://api.openai.com/v1';
const PERSONAL_PLANS = new Set(['free', 'go', 'plus', 'pro', 'prolite', 'promax']);
const MANAGED_PLAN = /^(?:team|(?:self_serve_)?business|ent26|enterprise|edu)(?:_|$)/;
class CodexRpcError extends Error {
  constructor(readonly code: number | undefined) {super('codex request refused');}
}
const UNSUPPORTED_RPC_REQUEST = {code: -32601, message: 'Unsupported worker request'};
export type CodexConfiguration = {executable: string; home: string; model?: string};

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const record = (value: unknown): Record<string, unknown> => object(value) ? value : {};
const managedPlan = (plan: unknown): boolean => typeof plan === 'string' && MANAGED_PLAN.test(plan);
function quotaPlans(value: unknown): unknown[] {
  const {rateLimits, rateLimitsByLimitId} = record(value);
  return [rateLimits, ...Object.values(record(rateLimitsByLimitId))].map(snapshot => record(snapshot).planType);
}

function managedQuota(value: unknown): boolean {
  return quotaPlans(value).some(managedPlan);
}

function coherentQuota(value: unknown, plan: string | null): boolean {
  if (plan === null || !PERSONAL_PLANS.has(plan)) return false;
  const plans = quotaPlans(value).filter(reported => reported !== null && reported !== undefined && reported !== 'unknown');
  return plans.length > 0 && plans.every(reported => reported === plan);
}

function contraryAccountEvent(method: string, value: unknown): boolean {
  if (method === 'account/rateLimits/updated') return managedQuota(value);
  if (method !== 'account/updated') return false;
  const {authMode, planType} = record(value);
  return managedPlan(planType) || (authMode !== undefined && authMode !== 'chatgpt');
}

function supportsRouting(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  const {backendOrigin} = record(value);
  return backendOrigin === CHATGPT_ORIGIN || backendOrigin === `${CHATGPT_ORIGIN}/`;
}

export const codexSignIn = (reply: unknown): Pick<HarnessReadiness, 'signedIn' | 'plan'> => {
  const {account, requiresOpenaiAuth, workspaceRouting} = record(reply);
  if (requiresOpenaiAuth !== true) return {signedIn: 'unknown', plan: null};
  if (account === null) return {signedIn: 'no', plan: null};
  const {type, planType} = record(account);
  if (type !== 'chatgpt' || managedPlan(planType) || !supportsRouting(workspaceRouting)) return {signedIn: 'unknown', plan: null};
  const plan = typeof planType === 'string' && planType !== 'unknown' && /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/.test(planType) && planType.length <= 64
    ? planType.replaceAll('_', '-') : null;
  return {signedIn: 'yes', plan};
};

const windowOf = (name: string, value: unknown): CodingLimitWindow | undefined => {
  if (!object(value)) return undefined;
  const {usedPercent, resetsAt, windowDurationMins} = value;
  const duration = typeof windowDurationMins === 'number' && Number.isSafeInteger(windowDurationMins) && windowDurationMins > 0 ? windowDurationMins : null;
  const utilization = typeof usedPercent === 'number' && usedPercent >= 0 && usedPercent <= 100 ? usedPercent : null;
  const reset = typeof resetsAt === 'number' && Number.isSafeInteger(resetsAt) && resetsAt > 0 && resetsAt < 10_000_000_000 ? resetsAt * 1000 : null;
  return {window: duration === null ? name : `${name}-${String(duration)}m`,
    status: utilization === 100 ? 'rejected' : utilization === null ? 'unknown' : 'allowed', resetsAtMs: reset, utilization};
};

const windowsOf = (snapshot: unknown): CodingLimitWindow[] => {
  const {primary, secondary} = record(snapshot);
  return [windowOf('primary', primary), windowOf('secondary', secondary)].filter(window => window !== undefined);
};

const limitOf = (windows: CodingLimitWindow[]): CodingLimit => {
  const reached = windows.filter(window => window.status === 'rejected');
  const window = reached.length === 1 ? reached[0] : undefined;
  return {window: window?.window ?? null, resetsAtMs: window?.resetsAtMs ?? null};
};

/** The child sees only the worker's stable profile, even when its parent uses a different Codex home. */
export function codexEnvironment(environment: NodeJS.ProcessEnv, home: string): Record<string, string> {
  const allowed = harnessEnvironment(environment);
  delete allowed.CLAUDE_CODE_OAUTH_TOKEN;
  return {...allowed, HOME: home, CODEX_HOME: home, SHELL: '/bin/sh'};
}

const inside = (parent: string, child: string): boolean => {
  const path = relative(parent, child);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
};

const missingPath = (error: unknown): boolean => object(error) && error.code === 'ENOENT';
const canonical = (path: string): Promise<string> => realpath(path).catch((error: unknown) => {
  if (missingPath(error)) return path;
  throw error;
});
const entry = (path: string) => lstat(path).catch((error: unknown) => {
  if (missingPath(error)) return undefined;
  throw error;
});

async function checkPrivateEntries(directory: string): Promise<void> {
  for (const filename of await readdir(directory)) {
    const info = await entry(join(directory, filename));
    if (info !== undefined && (info.isSymbolicLink() || (info.isFile() && info.nlink !== 1))) {
      throw new Error('codex worker storage contains an alias');
    }
  }
}

export async function workerHome(home: string, environment: NodeJS.ProcessEnv): Promise<string> {
  const path = await checkStateDirectory(home);
  const userHomes = await Promise.all([userInfo().homedir, environment.HOME]
    .flatMap(value => value === undefined || value === '' ? [] : [canonical(resolve(value))]));
  const profileRoots = userHomes.map(userHome => join(userHome, '.codex'));
  const inheritedCodexHome = environment.CODEX_HOME;
  if (inheritedCodexHome !== undefined && inheritedCodexHome !== '') profileRoots.push(resolve(inheritedCodexHome));
  const personalRoots = await Promise.all(profileRoots.map(canonical));
  if (userHomes.includes(path) || personalRoots.some(root => inside(root, path) || inside(path, root))) {
    throw new Error('codex worker profile must be separate');
  }
  if (!(await lstat(path)).isDirectory()) throw new Error('codex worker profile is missing');
  // App-server has no ignore-user-config flag. Presence alone refuses; never read a supplied configuration.
  for (const name of ['config.toml', '.codex']) {
    if (await entry(join(path, name)) !== undefined) throw new Error('codex worker profile contains configuration');
  }
  const auth = await entry(join(path, 'auth.json'));
  if (auth !== undefined && (!auth.isFile() || auth.uid !== process.getuid?.() || (auth.mode & 0o077) !== 0 || auth.nlink !== 1)) {
    throw new Error('codex worker credentials must be private to this profile');
  }
  await checkPrivateEntries(path);
  for (const directory of Object.values(startupStorage(path))) {
    await prepareStateDirectory(directory);
    await checkPrivateEntries(directory);
  }
  return path;
}

const startupStorage = (home: string) => ({sqlite: join(home, 'sqlite'), logs: join(home, 'log')});
const configArg = (key: string, value: string | boolean): string[] => ['-c', `${key}=${JSON.stringify(value)}`];
export function codexArguments(cwd: string, profile: string, home: string, protectedRoot?: string): string[] {
  const filesystem = {':minimal': 'read', [cwd]: 'write', [join(cwd, '.git')]: 'read',
    [join(cwd, '.codex')]: 'read', [join(home, 'auth.json')]: 'deny', ...(protectedRoot === undefined ? {} : {[protectedRoot]: 'deny'})};
  const rules = Object.entries(filesystem).map(([path, access]) => `${JSON.stringify(path)}=${JSON.stringify(access)}`).join(',');
  const {sqlite, logs} = startupStorage(home);
  return [...configArg('sqlite_home', sqlite), ...configArg('log_dir', logs),
    ...configArg('forced_login_method', 'chatgpt'), ...configArg('cli_auth_credentials_store', 'file'), ...configArg('model_provider', 'openai'),
    ...configArg('chatgpt_base_url', CHATGPT_BACKEND),
    ...configArg('openai_base_url', OPENAI_API),
    ...configArg('approval_policy', 'never'), ...configArg('web_search', 'disabled'), ...configArg('allow_login_shell', false),
    ...configArg('analytics.enabled', false), ...configArg('feedback.enabled', false),
    ...configArg('otel.log_user_prompt', false), ...configArg('otel.exporter', 'none'), ...configArg('otel.trace_exporter', 'none'),
    ...configArg('otel.metrics_exporter', 'none'),
    ...configArg('features.hooks', false), ...configArg('features.goals', false), ...configArg('features.multi_agent', false),
    ...configArg('features.apps', false), ...configArg('features.plugins', false), ...configArg('features.shell_snapshot', false),
    '-c', 'mcp_servers={}', '-c', 'plugins={}', '-c', 'notify=[]',
    ...configArg('shell_environment_policy.inherit', 'core'),
    '-c', 'shell_environment_policy.include_only=["PATH","HOME","USER","LOGNAME","SHELL","LANG","LC_*","TERM","TZ"]',
    '-c', `projects={${JSON.stringify(cwd)}={trust_level="untrusted"}}`,
    ...configArg('default_permissions', profile),
    '-c', `permissions.${profile}.filesystem={${rules}}`,
    ...configArg(`permissions.${profile}.network.enabled`, false)];
}

/** Exercise the same native profile without a model call before relying on it for a successor. */
export async function verifyCodexWriterBoundary(executable: string, cwd: string, home: string, protectedRoot: string, profile: string,
  environment: Record<string, string>): Promise<boolean> {
  if (process.platform !== 'darwin' || inside(cwd, protectedRoot) || inside(home, protectedRoot) || inside(protectedRoot, cwd) || inside(protectedRoot, home)) return false;
  let sourceProbe: string | undefined, targetProbe: string | undefined;
  try {
    sourceProbe = await mkdtemp(join(cwd, '.bunny-boundary-'));
    targetProbe = await mkdtemp(join(protectedRoot, 'boundary-'));
    const target = join(targetProbe, 'exist'), alias = join(sourceProbe, 'alias');
    await writeFile(target, 'protected', {mode: 0o600});
    await symlink(target, alias);
    const script = 'umask 077; /usr/bin/touch "$1/ok" || exit 1; if /usr/bin/touch "$2/out" || /usr/bin/touch "$3" || /bin/ln "$4" "$1/hardlink" || /bin/mv "$2" "$2-moved"; then exit 1; fi';
    await execute(executable, ['sandbox', '-C', cwd, '-P', profile, ...codexArguments(cwd, profile, home, protectedRoot),
      '--', '/bin/sh', '-c', script, 'bunny-boundary', sourceProbe, targetProbe, alias, target],
      {cwd: home, env: environment, timeout: 5000, maxBuffer: 4096});
    return true;
  } catch {return false;}
  finally {
    await Promise.all([sourceProbe, targetProbe].flatMap(path => path === undefined ? [] : [rm(path, {recursive: true, force: true}).catch(() => {})]));
  }
}

type Wire = {
  request(method: string, params?: object): Promise<unknown>;
  notify(method: string): void;
  close(): void;
  writerStopped?(): Promise<boolean>;
};
export type CodexTransport = (input: {executable: string; args: string[]; cwd: string; env: Record<string, string>; signal: AbortSignal;
  event: (method: string, data: unknown) => void; closed: () => void}) => Wire;

/** One child, one stdio connection and a small number of in-flight request IDs. */
export const openCodex: CodexTransport = ({executable, args, cwd, env, signal, event, closed}) => {
  const child = spawn(executable, args, {cwd, env, detached: true, stdio: ['pipe', 'pipe', 'ignore']});
  const pending = new Map<number, {resolve: (value: unknown) => void; reject: (error: Error) => void}>();
  const closedChild = new Promise<boolean>(resolve => {
    child.once('close', () => {resolve(writerGone(child.pid));});
  });
  let next = 0, ended = false;
  let lineBytes = 0;
  const send = (message: object) => {if (!ended) child.stdin.write(JSON.stringify(message) + '\n');};
  const kill = () => {
    if (child.pid === undefined) return;
    try {process.kill(-child.pid, 'SIGKILL');} catch {child.kill('SIGKILL');}
  };
  const finish = () => {
    if (ended) return;
    ended = true;
    signal.removeEventListener('abort', stop);
    for (const waiter of pending.values()) waiter.reject(CLOSED);
    pending.clear();
    closed();
  };
  const stop = () => {if (!ended) kill(); finish();};
  signal.addEventListener('abort', stop, {once: true});
  // Stop before readline can accumulate an unbounded protocol record.
  child.stdout.on('data', (chunk: Buffer) => {
    for (const byte of chunk) {
      lineBytes = byte === 10 ? 0 : lineBytes + 1;
      if (lineBytes > MESSAGE_BYTES) {stop(); return;}
    }
  });
  const reader = createInterface({input: child.stdout, crlfDelay: Infinity});
  reader.on('line', line => {
    if (ended) return;
    let value: unknown;
    try {value = JSON.parse(line);} catch {return;}
    if (!object(value)) return;
    if (typeof value.method === 'string') {
      // The worker never grants new approval, tools or credentials on a server request.
      if ('id' in value) send({id: value.id, error: UNSUPPORTED_RPC_REQUEST});
      else event(value.method, value.params);
      return;
    }
    if (typeof value.id !== 'number') return;
    const waiter = pending.get(value.id);
    if (waiter === undefined) return;
    pending.delete(value.id);
    if ('result' in value) waiter.resolve(value.result);
    else {
      const code = record(value.error).code;
      waiter.reject(new CodexRpcError(typeof code === 'number' ? code : undefined));
    }
  });
  child.stdin.on('error', stop);
  child.on('error', stop);
  child.on('close', finish);
  if (signal.aborted) stop();
  return {
    request: (method, params = {}) => new Promise((resolve, reject) => {
      if (ended) {reject(CLOSED); return;}
      const id = ++next;
      pending.set(id, {resolve, reject});
      send({id, method, params});
    }),
    notify: method => send({method}),
    writerStopped: () => new Promise<boolean>(resolve => {
      const timeout = setTimeout(() => {resolve(false);}, 1500);
      timeout.unref();
      void closedChild.then(gone => {clearTimeout(timeout); resolve(gone);});
    }),
    close: () => {
      if (ended) return;
      // EOF gives the app-server time to close its session store.
      child.stdin.end();
      const deadline = setTimeout(kill, 1000);
      deadline.unref();
      child.once('close', () => {clearTimeout(deadline);});
      finish();
    },
  };
};

/** No turn is submitted. The exact saved thread must accept the successor and the same provider boundary. */
export async function verifyCodexNativeResume(executable: string, cwd: string, original: string, home: string, profile: string,
  threadId: string, env: Record<string, string>): Promise<boolean> {
  const signal = AbortSignal.timeout(5000);
  let wire: Wire | undefined;
  let checked: boolean;
  try {
    wire = openCodex({executable, args: ['app-server', '--listen', 'stdio://', ...codexArguments(cwd, profile, home, original)],
      cwd: home, env, signal, event: () => {}, closed: () => {}});
    await initialize(wire);
    if (!await isolatedSettings(wire, cwd, home) ||
      codexSignIn(await wire.request('account/read', {refreshToken: false})).signedIn !== 'yes') return false;
    const result = record(await wire.request('thread/resume', {threadId, cwd, runtimeWorkspaceRoots: [cwd], permissions: profile,
      modelProvider: 'openai', approvalPolicy: 'never', excludeTurns: true}));
    const thread = record(result.thread), roots = result.runtimeWorkspaceRoots, sandbox = record(result.sandbox), writable = sandbox.writableRoots;
    checked = thread.id === threadId && thread.cwd === cwd && result.cwd === cwd && result.modelProvider === 'openai' &&
      result.approvalPolicy === 'never' && record(result.activePermissionProfile).id === profile &&
      // A named profile with an explicit denial can omit its workspace from the legacy writableRoots projection.
      sandbox.type === 'workspaceWrite' && sandbox.networkAccess === false && Array.isArray(writable) &&
      writable.every(root => root === cwd) && Array.isArray(roots) && roots.length === 1 && roots[0] === cwd &&
      codexSignIn(await wire.request('account/read', {refreshToken: false})).signedIn === 'yes';
  } catch {return false;}
  finally {wire?.close();}
  return checked && await wire?.writerStopped?.() === true;
}

const initialize = async (wire: Wire) => {
  await wire.request('initialize', {clientInfo: {name: 'bunny-worker', title: 'B.U.N.N.Y. worker', version: '1.0'}, capabilities: {experimentalApi: true, explicitGatewayOauth: true}});
  wire.notify('initialized');
};

async function isolatedSettings(wire: Wire, cwd: string, home: string): Promise<boolean> {
  const {config} = record(await wire.request('config/read', {cwd, includeLayers: false}));
  const {mcp_servers, plugins, hooks, notify, features, allow_login_shell, cli_auth_credentials_store, sqlite_home, log_dir,
    forced_login_method, model_provider, chatgpt_base_url, openai_base_url, otel} = record(config);
  const telemetry = record(otel);
  const flags = record(features);
  const {sqlite, logs} = startupStorage(home);
  return sqlite_home === sqlite && log_dir === logs && object(mcp_servers) && Object.keys(mcp_servers).length === 0 && object(plugins) && Object.keys(plugins).length === 0
    && (hooks === null || hooks === undefined || (object(hooks) && Object.keys(hooks).length === 0))
    && (notify === null || notify === undefined || (Array.isArray(notify) && notify.length === 0))
    && allow_login_shell === false && cli_auth_credentials_store === 'file' && forced_login_method === 'chatgpt' && model_provider === 'openai'
    && chatgpt_base_url === CHATGPT_BACKEND
    && openai_base_url === OPENAI_API
    && telemetry.log_user_prompt === false
    && ['exporter', 'trace_exporter', 'metrics_exporter'].every(key => telemetry[key] === 'none')
    && ['apps', 'plugins', 'hooks', 'shell_snapshot'].every(name => flags[name] === false);
}

export function codexAdapter(configuration: CodexConfiguration, options: {
  environment?: NodeJS.ProcessEnv; transport?: CodexTransport; version?: () => Promise<string | null>;
}): CodingAdapter {
  const environment = options.environment ?? process.env;
  const transport = options.transport ?? openCodex;
  // All wires in this adapter use the same private profile. Evidence from an older probe cannot clear a newer refusal.
  let quotaRevision = 0, quotaBlocked = false;
  const quotaInterrupts = new Set<() => void>();
  const recordManagedQuota = () => {
    quotaBlocked = true;
    quotaRevision += 1;
    for (const interrupt of quotaInterrupts) interrupt();
  };
  const quotaAllowed = (revision: number): boolean => !quotaBlocked && quotaRevision === revision;
  const observeAccount = (method: string, data: unknown): boolean => {
    if (!contraryAccountEvent(method, data)) return false;
    if (method === 'account/rateLimits/updated') recordManagedQuota();
    return true;
  };
  const readQuota = async (wire: Wire, revision: number, plan: string | null, revoked?: Promise<void>): Promise<CodingLimitWindow[] | undefined> => {
    let timer: NodeJS.Timeout | undefined;
    try {
      // Keep observing an eventual reply even when the run proceeds without quota windows.
      const request = wire.request('account/rateLimits/read').then(reply => {
        if (managedQuota(reply)) recordManagedQuota();
        else if (quotaBlocked && quotaRevision === revision && coherentQuota(reply, plan)) quotaBlocked = false;
        return windowsOf(record(reply).rateLimits);
      });
      const deadline = new Promise<undefined>(resolve => {timer = setTimeout(() => {resolve(undefined);}, QUOTA_MS);});
      return await Promise.race([request, deadline, ...(revoked === undefined ? [] : [revoked.then(() => undefined)])]);
    } catch {return undefined;}
    finally {if (timer !== undefined) clearTimeout(timer);}
  };
  const prepare = (home: string, cwd: string, signal: AbortSignal, protectedRoot?: string) => {
    const profile = `bunny-worker-${randomUUID()}`;
    const args = ['app-server', '--listen', 'stdio://', ...codexArguments(cwd, profile, home, protectedRoot)];
    return {command: {executable: configuration.executable, cwd: home, env: codexEnvironment(environment, home), signal, args}, profile};
  };
  return {
    id: 'codex', capabilities: {steering: 'live', resume: 'unsupported', review: true},
    async readiness(): Promise<AdapterHealth> {
      const revision = quotaRevision;
      const signal = AbortSignal.timeout(PROBE_MS);
      let home: string, version: string | null;
      try {
        home = await workerHome(configuration.home, environment);
        version = options.version === undefined ? parseVersion((await execute(configuration.executable, ['--version'], {cwd: home, env: codexEnvironment(environment, home), signal, maxBuffer: 4096})).stdout.replace(/^codex-cli\s+/, '')) : await options.version();
      } catch (error) {
        return {...UNKNOWN_READINESS, installed: object(error) && error.code === 'ENOENT' ? 'no' : 'unknown'};
      }
      const health: AdapterHealth = {...UNKNOWN_READINESS, installed: version === null ? 'unknown' : 'yes', version};
      let wire: Wire | undefined;
      let unauthorized = false;
      try {
        const {command} = prepare(home, home, signal);
        wire = transport({...command, event: (method, data) => {if (observeAccount(method, data)) unauthorized = true;}, closed: () => {}});
        await initialize(wire);
        if (!await isolatedSettings(wire, home, home) || unauthorized) return health;
        const account = codexSignIn(await wire.request('account/read', {refreshToken: false}));
        if (unauthorized) return health;
        if (account.signedIn !== 'yes') return {...health, ...account};
        const windows = await readQuota(wire, revision, account.plan);
        return unauthorized || !quotaAllowed(revision) ? health : {...health, ...account, ...(windows === undefined ? {} : {windows})};
      } catch {return health;}
      finally {wire?.close();}
    },
    async run(input: AdapterRun): Promise<AdapterEvidence> {
      const revision = quotaRevision;
      if (input.signal.aborted) return {reason: 'cancelled'};
      let home: string;
      try {home = await workerHome(configuration.home, environment);}
      catch {return {reason: 'refused', summary: 'Codex needs a separate private worker profile with no user configuration.'};}
      const cwd = await realpath(input.worktree);
      if (inside(cwd, home) || inside(home, cwd)) return {reason: 'refused', summary: 'The Codex worker profile must be outside the worktree.'};
      const {signal} = input;
      if (signal.aborted) return {reason: 'cancelled'};
      let sessionId: string | undefined, turnId: string | undefined, dispatched = false, unauthorized = false;
      let windows: CodingLimitWindow[] = [];
      const sentMessages = new Set<string>();
      let pendingSteer = false;
      let wireClosed = false;
      let message: string | undefined, terminal: Record<string, unknown> | undefined;
      let settle = (): void => {};
      const completed = new Promise<void>(resolve => {settle = resolve;});
      let revoke = (): void => {};
      const revoked = new Promise<void>(resolve => {revoke = resolve;});
      const invalidate = () => {unauthorized = true; revoke(); settle();};
      const protectedRoot = input.continuationRoot === undefined ? undefined : await realpath(input.continuationRoot).catch(() => undefined);
      const separated = protectedRoot !== undefined && !inside(home, protectedRoot) && !inside(protectedRoot, home);
      const {command, profile} = prepare(home, cwd, signal, separated ? protectedRoot : undefined);
      const wire = transport({...command, event: (method, value) => {
        const data = record(value);
        if (observeAccount(method, data)) {invalidate(); return;}
        if (method === 'account/rateLimits/updated') {const reported = windowsOf(data.rateLimits); if (reported.length > 0) windows = reported; return;}
        if (data.threadId !== sessionId || sessionId === undefined || !dispatched) return;
        if (method === 'turn/started' && turnId === undefined) turnId = nativeSessionId(record(data.turn).id);
        if (method === 'item/started' && turnId !== undefined && data.turnId === turnId) {
          const item = record(data.item);
          if (item.type === 'userMessage' && typeof item.clientId === 'string' && sentMessages.has(item.clientId)) {
            input.observedMessage?.(item.clientId);
          }
        }
        if (method === 'item/completed' && turnId !== undefined && data.turnId === turnId) {
          const item = record(data.item);
          if (item.type === 'agentMessage' && item.phase !== 'commentary') {
            message = typeof item.text === 'string' && item.text.length <= 128 * 1024 ? item.text : undefined;
          }
        }
        const turn = record(data.turn);
        if (method === 'turn/completed' && turnId !== undefined && turn.id === turnId) {terminal = turn; settle();}
      }, closed: () => {wireClosed = true; settle();}});
      const refusal = (summary: string): AdapterEvidence => ({reason: 'refused', summary});
      const execute = async (): Promise<AdapterEvidence> => {
        try {
          await initialize(wire);
          if (!await isolatedSettings(wire, cwd, home)) return refusal('Codex did not confirm isolated settings for this worktree.');
          if (unauthorized) return refusal('Codex reported contrary personal ChatGPT subscription evidence.');
          const account = codexSignIn(await wire.request('account/read', {refreshToken: false}));
          if (unauthorized || account.signedIn !== 'yes') return refusal('Codex needs a confirmed personal ChatGPT subscription sign-in.');
          const initialWindows = await readQuota(wire, revision, account.plan, revoked);
          if (unauthorized || !quotaAllowed(revision)) return refusal('Codex reported contrary personal ChatGPT subscription evidence.');
          if (signal.aborted) return {reason: 'cancelled'};
          if (initialWindows !== undefined && windows.length === 0) windows = initialWindows;
          const opened = record(await wire.request('thread/start', {cwd, runtimeWorkspaceRoots: [cwd], permissions: profile,
            modelProvider: 'openai', approvalPolicy: 'never', allowProviderModelFallback: false,
            developerInstructions: 'Work only on this delegated repository brief. Do not change settings, publish changes or open a pull request. Report checks and limitations. Use waiting-for-owner for an unresolved decision.',
            ...(configuration.model === undefined ? {} : {model: configuration.model})}));
          const roots = opened.runtimeWorkspaceRoots;
          const sandbox = record(opened.sandbox);
          const writable = sandbox.writableRoots;
          if (unauthorized || opened.modelProvider !== 'openai' || opened.approvalPolicy !== 'never' || opened.cwd !== cwd ||
            record(opened.activePermissionProfile).id !== profile || sandbox.type !== 'workspaceWrite' || sandbox.networkAccess !== false ||
            !Array.isArray(writable) || writable.length !== 1 || writable[0] !== cwd || !Array.isArray(roots) || roots.length !== 1 || roots[0] !== cwd) {
            return refusal('Codex did not confirm the required worktree, permission profile or first-party provider.');
          }
          sessionId = nativeSessionId(record(opened.thread).id);
          if (sessionId === undefined) return {reason: 'invalid-output', summary: 'Codex returned no valid thread identity.'};
          await input.session(sessionId);
          if (input.signal.aborted) return {reason: 'cancelled', sessionId};
          const latestAccount = codexSignIn(await wire.request('account/read', {refreshToken: false}));
          if (unauthorized || !quotaAllowed(revision) || latestAccount.signedIn !== 'yes') {
            return {...refusal('Codex could not confirm personal ChatGPT subscription sign-in immediately before the turn.'), sessionId};
          }
          if (input.signal.aborted) return {reason: 'cancelled', sessionId};
          quotaInterrupts.add(invalidate);
          dispatched = true;
          const contrary = (sessionId: string): AdapterEvidence => ({
            ...refusal('Codex reported a change away from personal ChatGPT subscription sign-in during the run.'), sessionId, uncertain: true,
          });
          const started = record(await Promise.race([wire.request('turn/start', {threadId: sessionId,
            input: [{type: 'text', text: input.brief, text_elements: []}], outputSchema: CODEX_RESULT_SCHEMA}), revoked]));
          if (unauthorized) return contrary(sessionId);
          const acceptedTurn = nativeSessionId(record(started.turn).id);
          if (acceptedTurn === undefined || (turnId !== undefined && turnId !== acceptedTurn)) return {reason: 'invalid-output', uncertain: true, sessionId};
          turnId = acceptedTurn;
          const model = reportedModel(opened.model);
          if (model !== undefined) input.reportedModel?.(model);
          const nativeThread = sessionId;
          input.steering?.(async (messageId, text) => {
            if (signal.aborted || wireClosed || terminal !== undefined || unauthorized || !quotaAllowed(revision) ||
                pendingSteer || sentMessages.size >= STEER_LIMIT || sentMessages.has(messageId)) return 'unavailable';
            pendingSteer = true;
            sentMessages.add(messageId);
            let timer: NodeJS.Timeout | undefined;
            try {
              const deadline = new Promise<undefined>(resolve => {timer = setTimeout(() => {resolve(undefined);}, STEER_MS);});
              const receipt = await Promise.race([wire.request('turn/steer', {threadId: nativeThread, expectedTurnId: acceptedTurn,
                clientUserMessageId: messageId, input: [{type: 'text', text, text_elements: []}]}), revoked, deadline]);
              return record(receipt).turnId === acceptedTurn ? 'accepted' : 'uncertain';
            } catch (error) {
              return error instanceof CodexRpcError && error.code === -32601 ? 'unsupported' : 'uncertain';
            } finally {
              if (timer !== undefined) clearTimeout(timer);
              pendingSteer = false;
            }
          });
          await completed;
          if (unauthorized) return contrary(sessionId);
          if (terminal === undefined) return {reason: 'lost', uncertain: true, sessionId, windows};
          const cause = record(terminal.error).codexErrorInfo;
          if (terminal.status !== 'completed') {
            if (cause === 'usageLimitExceeded') return {reason: 'usage-limit', limit: limitOf(windows), windows, sessionId};
            if (cause === 'sessionBudgetExceeded') return {reason: 'budget', windows, sessionId};
            if (object(cause) && 'responseStreamDisconnected' in cause) return {reason: 'lost', uncertain: true, windows, sessionId};
            return {reason: 'exit', windows, sessionId};
          }
          let structured: unknown;
          try {structured = JSON.parse(message ?? '');} catch {return {reason: 'invalid-output', windows, sessionId};}
          if (!validOutput(structured)) return {reason: 'invalid-output', windows, sessionId};
          return {structured, windows, sessionId, usage: {turns: 1, costUsd: null, durationMs: null},
            limitations: ['Codex is limited to one turn and does not expose a per-turn dollar cap or subscription cost.']};
        } catch {
          return {reason: dispatched ? 'lost' : 'refused', uncertain: dispatched, ...(sessionId === undefined ? {} : {sessionId})};
        } finally {input.steering?.(undefined); quotaInterrupts.delete(invalidate); wire.close();}
      };
      const evidence = await execute();
      const stopped = await wire.writerStopped?.();
      if (stopped === true) {
        const confined = dispatched && evidence.uncertain !== true && separated && protectedRoot !== undefined &&
          options.transport === undefined && await verifyCodexWriterBoundary(configuration.executable, cwd, home, protectedRoot, profile, command.env);
        return {...evidence, writerStopped: true, ...(confined && protectedRoot !== undefined ? {writerFence: {root: protectedRoot, home}} : {})};
      }
      return stopped === false && dispatched ? {...evidence, uncertain: true} : evidence;
    },
  };
}
