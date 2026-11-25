import {execFile, spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {Ajv2020} from 'ajv/dist/2020.js';
import {createInterface} from 'node:readline';
import type {CodingLimit, CodingLimitWindow} from '@jimmie-potts/event-contracts/v2/coding';
import {nativeSessionId, type AdapterEvidence, type AdapterHealth, type AdapterRun, type CodingAdapter} from './adapter.js';
import {harnessEnvironment, parseVersion, UNKNOWN_READINESS, type HarnessReadiness} from './claude-stream.js';

const execute = promisify(execFile);
const outputValidator = new Ajv2020({strict: true});
const PROBE_MS = 10_000;
const MESSAGE_BYTES = 1024 * 1024;
const CLOSED = new Error('codex protocol closed');
const UNSUPPORTED_RPC_REQUEST = {code: -32601, message: 'Unsupported worker request'};
export type CodexConfiguration = {executable: string; model?: string};

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const record = (value: unknown): Record<string, unknown> => object(value) ? value : {};
export const codexSignIn = (reply: unknown): Pick<HarnessReadiness, 'signedIn' | 'plan'> => {
  const {account, requiresOpenaiAuth} = record(reply);
  if (requiresOpenaiAuth !== true) return {signedIn: 'unknown', plan: null};
  if (account === null) return {signedIn: 'no', plan: null};
  const {type, planType} = record(account);
  if (type !== 'chatgpt') return {signedIn: 'unknown', plan: null};
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

/** The child uses its saved ChatGPT sign-in. No API key, endpoint override or Claude token crosses this boundary. */
export function codexEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  const allowed = harnessEnvironment(environment);
  delete allowed.CLAUDE_CODE_OAUTH_TOKEN;
  return allowed;
}

const configArg = (key: string, value: string | boolean): string[] => ['-c', `${key}=${JSON.stringify(value)}`];
function codexArguments(cwd: string, profile: string): string[] {
  const filesystem = `permissions.${profile}.filesystem`;
  return ['app-server', '--listen', 'stdio://',
    ...configArg('forced_login_method', 'chatgpt'), ...configArg('model_provider', 'openai'),
    ...configArg('chatgpt_base_url', 'https://chatgpt.com/backend-api/'),
    ...configArg('openai_base_url', 'https://api.openai.com/v1'),
    ...configArg('approval_policy', 'never'), ...configArg('web_search', 'disabled'), ...configArg('allow_login_shell', false),
    ...configArg('analytics.enabled', false), ...configArg('feedback.enabled', false),
    ...configArg('otel.log_user_prompt', false), ...configArg('otel.logs_exporter', 'none'), ...configArg('otel.trace_exporter', 'none'),
    ...configArg('otel.metrics_exporter', 'none'),
    ...configArg('features.hooks', false), ...configArg('features.goals', false), ...configArg('features.multi_agent', false),
    ...configArg('features.apps', false), '-c', 'mcp_servers={}', '-c', 'plugins={}',
    ...configArg('shell_environment_policy.inherit', 'core'),
    '-c', 'shell_environment_policy.include_only=["PATH","HOME","USER","LOGNAME","SHELL","LANG","LC_*","TERM","TZ"]',
    ...configArg(`projects.${JSON.stringify(cwd)}.trust_level`, 'untrusted'),
    ...configArg('default_permissions', profile),
    ...configArg(`${filesystem}.":minimal"`, 'read'),
    ...configArg(`${filesystem}.${JSON.stringify(cwd)}`, 'write'),
    ...configArg(`${filesystem}.${JSON.stringify(join(cwd, '.git'))}`, 'read'),
    ...configArg(`${filesystem}.${JSON.stringify(join(cwd, '.codex'))}`, 'read'),
    ...configArg(`permissions.${profile}.network.enabled`, false)];
}

type Wire = {
  request(method: string, params?: object): Promise<unknown>;
  notify(method: string): void;
  close(): void;
};
export type CodexTransport = (input: {executable: string; args: string[]; cwd: string; env: Record<string, string>; signal: AbortSignal;
  event: (method: string, data: unknown) => void; closed: () => void}) => Wire;

/** One child, one stdio connection and a small number of in-flight request IDs. */
export const openCodex: CodexTransport = ({executable, args, cwd, env, signal, event, closed}) => {
  const child = spawn(executable, args, {cwd, env, detached: true, stdio: ['pipe', 'pipe', 'ignore']});
  const pending = new Map<number, {resolve: (value: unknown) => void; reject: (error: Error) => void}>();
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
    else waiter.reject(new Error('codex request refused'));
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

const initialize = async (wire: Wire) => {
  await wire.request('initialize', {clientInfo: {name: 'bunny-worker', title: 'B.U.N.N.Y. worker', version: '1.0'}, capabilities: {experimentalApi: true, explicitGatewayOauth: true}});
  wire.notify('initialized');
};

export function codexAdapter(configuration: CodexConfiguration, options: {
  probeCwd: string; environment?: NodeJS.ProcessEnv; transport?: CodexTransport; version?: () => Promise<string | null>;
}): CodingAdapter {
  const env = codexEnvironment(options.environment ?? process.env);
  const transport = options.transport ?? openCodex;
  const open = (cwd: string, signal: AbortSignal, event: (method: string, data: unknown) => void, closed: () => void) => {
    const profile = `bunny-worker-${randomUUID()}`;
    return {wire: transport({executable: configuration.executable, args: codexArguments(cwd, profile), cwd, env, signal, event, closed}), profile};
  };
  return {
    id: 'codex', capabilities: {steering: 'unsupported', resume: 'unsupported', review: true},
    async readiness(): Promise<AdapterHealth> {
      const signal = AbortSignal.timeout(PROBE_MS);
      let version: string | null;
      try {
        version = options.version === undefined ? parseVersion((await execute(configuration.executable, ['--version'], {cwd: options.probeCwd, env, signal, maxBuffer: 4096})).stdout.replace(/^codex-cli\s+/, '')) : await options.version();
      } catch (error) {
        return {...UNKNOWN_READINESS, installed: object(error) && error.code === 'ENOENT' ? 'no' : 'unknown'};
      }
      const {wire} = open(options.probeCwd, signal, () => {}, () => {});
      const health: AdapterHealth = {...UNKNOWN_READINESS, installed: version === null ? 'unknown' : 'yes', version};
      try {
        await initialize(wire);
        Object.assign(health, codexSignIn(await wire.request('account/read', {refreshToken: false})));
        if (health.signedIn === 'yes') {
          try {health.windows = windowsOf(record(await wire.request('account/rateLimits/read')).rateLimits);} catch { /* The account can omit this evidence. */ }
        }
        return health;
      } catch {return health;}
      finally {wire.close();}
    },
    async run(input: AdapterRun): Promise<AdapterEvidence> {
      if (input.signal.aborted) return {reason: 'cancelled'};
      // Validate independently of the provider's structured-output promise.
      const validOutput = outputValidator.compile(input.outputSchema);
      const cwd = await realpath(input.worktree);
      let sessionId: string | undefined, turnId: string | undefined, dispatched = false, unauthorized = false, accountVerified = false;
      let windows: CodingLimitWindow[] = [];
      let message: string | undefined, terminal: Record<string, unknown> | undefined;
      let settle = (): void => {};
      const completed = new Promise<void>(resolve => {settle = resolve;});
      const {wire, profile} = open(cwd, input.signal, (method, value) => {
        const data = record(value);
        if (method === 'account/updated' && accountVerified && data.authMode !== 'chatgpt') {unauthorized = true; settle(); return;}
        if (method === 'account/rateLimits/updated') {const reported = windowsOf(data.rateLimits); if (reported.length > 0) windows = reported; return;}
        if (data.threadId !== sessionId || sessionId === undefined || !dispatched) return;
        if (method === 'turn/started' && turnId === undefined) turnId = nativeSessionId(record(data.turn).id);
        if (method === 'item/completed' && turnId !== undefined && data.turnId === turnId) {
          const item = record(data.item);
          if (item.type === 'agentMessage' && item.phase !== 'commentary') {
            message = typeof item.text === 'string' && item.text.length <= 128 * 1024 ? item.text : undefined;
          }
        }
        const turn = record(data.turn);
        if (method === 'turn/completed' && turnId !== undefined && turn.id === turnId) {terminal = turn; settle();}
      }, () => {settle();});
      const refusal = (summary: string): AdapterEvidence => ({reason: 'refused', summary});
      try {
        await initialize(wire);
        const account = codexSignIn(await wire.request('account/read', {refreshToken: false}));
        if (account.signedIn !== 'yes') return refusal('Codex needs a confirmed ChatGPT subscription sign-in.');
        accountVerified = true;
        const opened = record(await wire.request('thread/start', {cwd, runtimeWorkspaceRoots: [cwd], permissions: profile,
          modelProvider: 'openai', approvalPolicy: 'never', allowProviderModelFallback: false,
          developerInstructions: 'Work only on this delegated repository brief. Do not change settings, publish changes or open a pull request. Report checks and limitations. Use waiting-for-owner for an unresolved decision.',
          ...(configuration.model === undefined ? {} : {model: configuration.model})}));
        const roots = opened.runtimeWorkspaceRoots;
        const sandbox = record(opened.sandbox);
        const writable = sandbox.writableRoots;
        if (unauthorized || opened.modelProvider !== 'openai' || opened.approvalPolicy !== 'never' || opened.cwd !== cwd ||
          record(opened.activePermissionProfile).id !== profile || sandbox.type !== 'workspaceWrite' || sandbox.networkAccess !== false ||
          !Array.isArray(writable) || writable.some(root => root !== cwd) || !Array.isArray(roots) || roots.length !== 1 || roots[0] !== cwd) {
          return refusal('Codex did not confirm the required worktree, permission profile or first-party provider.');
        }
        sessionId = nativeSessionId(record(opened.thread).id);
        if (sessionId === undefined) return {reason: 'invalid-output', summary: 'Codex returned no valid thread identity.'};
        await input.session(sessionId);
        if (input.signal.aborted) return {reason: 'cancelled', sessionId};
        const latestAccount = codexSignIn(await wire.request('account/read', {refreshToken: false}));
        if (unauthorized || latestAccount.signedIn !== 'yes') {
          return {...refusal('Codex could not confirm subscription sign-in immediately before the turn.'), sessionId};
        }
        if (input.signal.aborted) return {reason: 'cancelled', sessionId};
        dispatched = true;
        const started = record(await wire.request('turn/start', {threadId: sessionId, input: [{type: 'text', text: input.brief, text_elements: []}],
          outputSchema: input.outputSchema}));
        const acceptedTurn = nativeSessionId(record(started.turn).id);
        if (acceptedTurn === undefined || (turnId !== undefined && turnId !== acceptedTurn)) return {reason: 'invalid-output', uncertain: true, sessionId};
        turnId = acceptedTurn;
        await completed;
        if (unauthorized) return {...refusal('Codex reported a change away from subscription sign-in during the run.'), sessionId, uncertain: true};
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
      } finally {wire.close();}
    },
  };
}
