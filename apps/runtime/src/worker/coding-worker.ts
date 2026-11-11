// The host-local coding worker (Hub #502): one Node process on the owner's computer, started after sign-in, that holds
// the `coding-worker` credential, opens its one endpoint on the core's gateway and runs Claude Code headless in a fresh
// worktree of an allowlisted repository when the companions module hands it owner-approved work. It reports progress
// as occurrences and never resends, retries or claims more than it observed. The container gets no CLI and no
// repository; this process gets no state, no device and no dashboard authority.
import {spawn, type ChildProcess} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {mkdir, readFile, stat} from 'node:fs/promises';
import {isAbsolute, join, resolve} from 'node:path';
import {StringDecoder} from 'node:string_decoder';
import {promisify} from 'node:util';
import {SdkError, connectRemote, type RemoteEndpoint, type RemoteParticipant, type RequestResult} from '@jimmie-potts/sdk/remote';
import {Outcome, type Command, type Reply} from '@jimmie-potts/sdk';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {CODING_WORKER_SOURCE, type CodingBounds, type CodingCheck, type CodingEndpointControl, type CodingLimitWindow, type CodingProgress, type CodingProgressReason,
  type CodingReadiness, type CodingResult, type CodingWork} from '@jimmie-potts/event-contracts/v2/coding';
import {readPrivateJson} from '../hook/producer.js';
import {readPrivateFile} from '../state.js';
import {BLANKED_SWITCHES, ClaudeStream, UNKNOWN_READINESS, configurableVariable, harnessEnvironment, parseAuthStatus, parseVersion, settingsRefusal, type HarnessReadiness} from './claude-stream.js';

const run = promisify(execFile);
export const WORKER_SCHEMA = 'coding-worker/1.0';
const MAX_CONFIG_BYTES = 8192;
/** One stream event longer than this is skipped, not buffered; a run whose final result was skipped is unreadable output. */
const MAX_LINE_BYTES = 4 * 1024 * 1024;
/** How long each readiness probe (`--version`, `auth status`) may take before its answer counts as unknown. */
export const PROBE_MS = 10_000;
const ENDPOINT_SCHEMA = 'https://bunny.invalid/events/coding-endpoint/2.1';
const PROGRESS_SCHEMA = 'https://bunny.invalid/events/coding-progress/2.1';
const NAME = /^[a-z0-9]+(?:[-._][a-z0-9]+)*$/;
const SHA = /^[0-9a-f]{40}$/;
const TOKEN = /^[A-Za-z0-9_-]{20,256}$/;
/** How long after a refused re-declaration the worker tries again, doubling each time, and how often. */
export const REDECLARE_MS = 500;
const REDECLARE_ATTEMPTS = 6;
/** The tools Claude Code may use without asking in the worker's worktree: files, search, builds and tests; no push, no PR, no arbitrary shell. */
export const DEFAULT_ALLOWED_TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(npm run *)', 'Bash(npm test*)', 'Bash(npx tsc*)', 'Bash(node --test*)', 'Bash(git status*)', 'Bash(git diff*)', 'Bash(git log*)'];
/**
 * The hard deny list every run carries, whatever the private allowlist or the owner's own Claude Code settings allow: a
 * deny rule wins over any allow, so pushing, remotes, worktrees, GitHub, nested harnesses, network shells, privilege and
 * settings edits are refused by the harness itself, not only by the appended instruction.
 */
export const DENIED_TOOLS = ['Bash(git push*)', 'Bash(git -C *)', 'Bash(git --git-dir*)', 'Bash(git --work-tree*)', 'Bash(git remote*)', 'Bash(git worktree*)', 'Bash(git config*)', 'Bash(gh *)', 'Bash(claude *)', 'Bash(curl *)', 'Bash(wget *)',
  'Bash(ssh *)', 'Bash(scp *)', 'Bash(sudo *)', 'Edit(.claude/**)', 'Write(.claude/**)', 'Edit(~/.claude/**)', 'Write(~/.claude/**)', 'Edit(~/.claude.json)', 'Write(~/.claude.json)', 'WebFetch', 'WebSearch'];
/** The JSON Schema the worker asks Claude Code to return as its structured output. */
export const RESULT_SCHEMA = {type: 'object', additionalProperties: false, required: ['outcome', 'summary', 'checks', 'findings', 'limitations'], properties: {
  outcome: {type: 'string', enum: ['tested-candidate', 'incomplete', 'failed', 'waiting-for-owner']},
  summary: {type: 'string', description: 'What changed and what was verified, in a few sentences.'},
  checks: {type: 'array', items: {type: 'object', additionalProperties: false, required: ['name', 'status'], properties: {name: {type: 'string'}, status: {type: 'string', enum: ['passed', 'failed', 'skipped', 'unrun', 'unknown']}, detail: {type: 'string'}}}},
  findings: {type: 'array', items: {type: 'string'}, description: 'Unresolved problems, questions for the owner, or refused actions. With waiting-for-owner, the question first.'},
  limitations: {type: 'array', items: {type: 'string'}},
}};

export type WorkerConfiguration = {
  edge: string; tokenFile: string;
  repositories: readonly {name: string; path: string}[];
  /** `environment` names further variables the harness may inherit; a provider credential or switch is refused. */
  claude: {executable: string; model?: string; permissionMode: string; allowedTools: readonly string[]; maxTurns?: number; environment?: readonly string[]};
};
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
/** Reads and checks the worker's private configuration file. Throws `coding-worker-config` with a fixed reason; never quotes the file. */
export function parseConfiguration(value: unknown): WorkerConfiguration {
  const bad = (reason: string): never => {throw new Error(`coding-worker-config: ${reason}`);};
  if (!isRecord(value) || value.schema !== WORKER_SCHEMA) return bad('not a coding-worker/1.0 document');
  if (Object.keys(value).some(key => !['schema', 'edge', 'tokenFile', 'repositories', 'claude'].includes(key))) return bad('unknown member');
  const {edge, tokenFile, repositories, claude} = value;
  let url: URL;
  try {url = new URL(String(edge));} catch {return bad('edge is not a URL');}
  if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search !== '' || url.hash !== '' || url.username !== '') return bad('edge must be an origin');
  if (typeof tokenFile !== 'string' || !isAbsolute(tokenFile)) return bad('tokenFile must be an absolute path');
  if (!Array.isArray(repositories) || repositories.length === 0 || repositories.length > 16) return bad('repositories must list one to sixteen entries');
  const names = new Set<string>();
  const list = repositories.map(entry => {
    if (!isRecord(entry) || typeof entry.name !== 'string' || !NAME.test(entry.name) || entry.name.length > 64 || typeof entry.path !== 'string' || !isAbsolute(entry.path) || names.has(entry.name)) return bad('a repository needs a distinct lowercase name and an absolute path');
    names.add(entry.name); return {name: entry.name, path: resolve(entry.path)};
  });
  if (!isRecord(claude) || typeof claude.executable !== 'string' || !isAbsolute(claude.executable)) return bad('claude.executable must be an absolute path');
  if (claude.model !== undefined && (typeof claude.model !== 'string' || !/^[a-z0-9.-]{1,64}$/.test(claude.model))) return bad('claude.model is not a model name');
  const permissionMode = claude.permissionMode ?? 'acceptEdits';
  if (typeof permissionMode !== 'string' || !['default', 'acceptEdits', 'plan'].includes(permissionMode)) return bad('claude.permissionMode must be default, acceptEdits or plan');
  const allowedTools = claude.allowedTools ?? DEFAULT_ALLOWED_TOOLS;
  if (!Array.isArray(allowedTools) || allowedTools.length > 64 || allowedTools.some(tool => typeof tool !== 'string' || tool.length > 128 || /push|gh |curl|wget|ssh|rm -rf/i.test(tool))) return bad('claude.allowedTools must be a bounded list without push, network or destructive tools');
  if (claude.maxTurns !== undefined && (!Number.isSafeInteger(claude.maxTurns) || Number(claude.maxTurns) < 1 || Number(claude.maxTurns) > 200)) return bad('claude.maxTurns must be 1 to 200');
  const environment = claude.environment;
  if (environment !== undefined && (!Array.isArray(environment) || environment.length > 32 || environment.some(name => typeof name !== 'string' || !/^[A-Z_][A-Z0-9_]{0,63}$/.test(name) || !configurableVariable(name)))) {
    return bad('claude.environment must list at most 32 variable names without credentials, provider switches or loader variables');
  }
  return {edge: url.origin, tokenFile, repositories: list, claude: {executable: claude.executable, ...(claude.model === undefined ? {} : {model: claude.model}), permissionMode, allowedTools: allowedTools as string[],
    ...(claude.maxTurns === undefined ? {} : {maxTurns: Number(claude.maxTurns)}), ...(environment === undefined ? {} : {environment: environment as string[]})}};
}

type Running = {operationId: string; child: ChildProcess | undefined; cancelled: boolean; timer: ReturnType<typeof setTimeout> | undefined; limitsChanged?: boolean};
export type HarnessRun = {code: number | null; signal: string | null; stdout?: string; truncated: boolean};
export type Harness = {
  /**
   * Runs the headless harness in `cwd` with the brief on its standard input and resolves with its exit code; the worker
   * kills it on cancel or deadline. The brief never becomes an argument, so a brief that starts with a dash cannot be
   * read as an option and it never shows in the process list. Each output line goes to `onLine` as it arrives; output
   * returned as `stdout` instead is read after the run, line by line, the same way.
   */
  start(args: string[], cwd: string, input: string, onChild: (child: ChildProcess) => void, onLine?: (line: string) => void): Promise<HarnessRun>;
  /** Reports the tool's version and sign-in without starting a task or a session; absent means all unknown. */
  readiness?(): Promise<HarnessReadiness>;
};
/**
 * Splits decoded output into lines for `onLine`. A line longer than `maxLength` is skipped, whole or in part and whether
 * it ends in the same chunk or a later one, and marks the output truncated; memory stays bounded by one chunk over it.
 */
export function lineSplitter(onLine: (line: string) => void, maxLength: number = MAX_LINE_BYTES): {write(text: string): void; end(text?: string): void; readonly truncated: boolean} {
  let pending = '', skipping = false, truncated = false;
  const take = (text: string, last: boolean): void => {
    pending += text;
    for (let end = pending.indexOf('\n'); end !== -1; end = pending.indexOf('\n')) {
      const line = pending.slice(0, end); pending = pending.slice(end + 1);
      if (line.length > maxLength) {truncated = true;} else if (!skipping) onLine(line);
      skipping = false;
    }
    if (pending.length > maxLength) {pending = ''; skipping = true; truncated = true;}
    if (last && pending !== '' && !skipping) onLine(pending);
  };
  return {write: text => {take(text, false);}, end: (text = '') => {take(text, true);}, get truncated() {return truncated;}};
}
type Probe = {stdout: string; missing: boolean; answered: boolean};
/** Arms a deadline and returns its cancel; the default is a real timer, and tests fire it themselves. */
export type ProbeTimer = (ms: number, fire: () => void) => () => void;
const realTimer: ProbeTimer = (ms, fire) => {const timer = setTimeout(fire, ms); timer.unref(); return () => {clearTimeout(timer);};};
/**
 * Runs one side-effect-free status command of the tool with no input, the harness's environment and a deadline whose
 * timer kills it outright, so a tool that ignores a terminate signal cannot hold the worker's start. A probe ended by the
 * deadline has not answered.
 */
const probe = (executable: string, args: string[], env: Record<string, string>, cwd: string | undefined, timeoutMs: number, timer: ProbeTimer): Promise<Probe> => new Promise(resolvePromise => {
  const child = execFile(executable, args, {env, cwd, maxBuffer: 64 * 1024, encoding: 'utf8'}, (error, stdout) => {
    cancel();
    const code = (error as NodeJS.ErrnoException | null)?.code;
    resolvePromise({stdout: typeof stdout === 'string' ? stdout : '', missing: code === 'ENOENT', answered: error === null || typeof code === 'number'});
  });
  child.stdin?.end();
  const cancel = timer(timeoutMs, () => {child.kill('SIGKILL');});
});
export type HarnessOptions = {
  /** Further variable names the harness may inherit (the configuration's `claude.environment`). */
  environment?: readonly string[];
  /** The working directory of the readiness probes: the first allowlisted repository, as near the run's as a probe can be. */
  probeCwd?: string;
  /** Each probe's deadline. */
  probeMs?: number;
  /** The probes' deadline timer; tests inject one they fire themselves. */
  probeTimer?: ProbeTimer;
};
/**
 * The real harness: `claude` started with an allowlisted environment without provider credentials or switches, so the
 * owner's subscription sign-in is what it uses, and its stream read line by line without buffering the run. The probes
 * use the same environment.
 */
export const claudeHarness = (executable: string, environment: NodeJS.ProcessEnv = process.env, options: HarnessOptions = {}): Harness => ({
  start: (args, cwd, input, onChild, onLine) => new Promise(resolvePromise => {
    const child = spawn(executable, args, {cwd, stdio: ['pipe', 'pipe', 'ignore'], env: harnessEnvironment(environment, options.environment)});
    onChild(child);
    child.stdin?.on('error', () => {});
    child.stdin?.end(input);
    const decoder = new StringDecoder('utf8');
    const lines = lineSplitter(line => {onLine?.(line);});
    child.stdout?.on('data', (chunk: Buffer) => {lines.write(decoder.write(chunk));});
    child.on('error', () => {resolvePromise({code: null, signal: null, truncated: lines.truncated});});
    child.on('close', (code, signal) => {lines.end(decoder.end()); resolvePromise({code, signal, truncated: lines.truncated});});
  }),
  readiness: async () => {
    const env = harnessEnvironment(environment, options.environment), timeoutMs = options.probeMs ?? PROBE_MS, timer = options.probeTimer ?? realTimer;
    const version = await probe(executable, ['--version'], env, options.probeCwd, timeoutMs, timer);
    if (version.missing) return {...UNKNOWN_READINESS, installed: 'no'};
    const auth = await probe(executable, ['auth', 'status', '--json'], env, options.probeCwd, timeoutMs, timer);
    const parsed = parseVersion(version.stdout);
    return {installed: parsed === null ? 'unknown' : 'yes', version: parsed, ...(auth.answered ? parseAuthStatus(auth.stdout) : {signedIn: 'unknown', plan: null})};
  },
});

/** A key source as the stream names it (`ANTHROPIC_API_KEY`, `apiKeyHelper`), only when it reads as a name, never a value. */
const keySourceName = (source: string): string => /^[A-Za-z0-9 _./-]{1,64}$/.test(source) ? source : 'unnamed';
const bounded = (value: unknown, max: number): string | undefined => typeof value === 'string' && value.trim() !== '' ? value.slice(0, max) : undefined;
/**
 * The result from Claude Code's stream (or a buffered output read as one) and the git facts the worker observed itself.
 * The stream's final `result` event is the envelope. A usage limit the tool reported, on a run that did not end with a
 * successful result, is the `usage-limit` outcome with the window and reset the tool gave, or null where it gave none.
 */
export function assembleResult(repository: string, base: string | null, head: string | null, changedFiles: string[], output: string | ClaudeStream, given?: CodingProgressReason): {result: CodingResult; reason?: CodingProgressReason} {
  const stream = typeof output === 'string' ? ClaudeStream.of(output) : output;
  const envelope = stream.result;
  let structured: Record<string, unknown> | undefined, reason: CodingProgressReason | undefined = given;
  if (envelope !== undefined) {
    structured = isRecord(envelope.structured_output) ? envelope.structured_output : (() => {try {const inner: unknown = JSON.parse(typeof envelope.result === 'string' ? envelope.result : ''); return isRecord(inner) ? inner : undefined;} catch {return undefined;}})();
  }
  const limit = stream.limit;
  // The run's own stop wins: a budget or turn cap the tool reached after a limit event is that stop, not the limit.
  const ownStop = envelope?.subtype === 'error_max_budget_usd' || envelope?.subtype === 'error_max_turns';
  const limited = limit !== undefined && !ownStop && (envelope === undefined || envelope.is_error === true || structured === undefined);
  if (reason === undefined && limited) reason = 'usage-limit';
  const outcome = structured !== undefined && ['tested-candidate', 'incomplete', Outcome.failed, 'waiting-for-owner'].includes(String(structured.outcome)) ? structured.outcome as CodingResult['outcome'] : 'incomplete';
  const checks: CodingCheck[] = Array.isArray(structured?.checks) ? structured.checks.slice(0, 32).flatMap((check: unknown) => {
    if (!isRecord(check) || typeof check.name !== 'string' || !['passed', 'failed', 'skipped', 'unrun', 'unknown'].includes(String(check.status))) return [];
    const detail = bounded(check.detail, 1024);
    const entry: CodingCheck = {name: check.name.slice(0, 128), status: check.status as CodingCheck['status'], ...(detail === undefined ? {} : {detail})};
    return [entry];
  }) : [];
  const strings = (value: unknown): string[] => Array.isArray(value) ? value.slice(0, 32).flatMap(item => {const text = bounded(item, 1024); return text === undefined ? [] : [text];}) : [];
  const usage = envelope === undefined ? null : {
    turns: Number.isSafeInteger(envelope.num_turns) && Number(envelope.num_turns) >= 0 ? Number(envelope.num_turns) : null,
    costUsd: typeof envelope.total_cost_usd === 'number' && envelope.total_cost_usd >= 0 ? envelope.total_cost_usd : null,
    durationMs: Number.isSafeInteger(envelope.duration_ms) && Number(envelope.duration_ms) >= 0 ? Number(envelope.duration_ms) : null};
  const sessionId = typeof envelope?.session_id === 'string' && /^[a-zA-Z0-9-]{1,128}$/.test(envelope.session_id) ? envelope.session_id : null;
  // A run the harness ended for its dollar budget is a budget stop whatever its exit code says.
  if (reason === undefined && envelope?.subtype === 'error_max_budget_usd') reason = 'budget';
  const summary = bounded(structured?.summary, 4096) ?? (envelope === undefined ? (reason === 'usage-limit' ? 'The harness stopped at a usage limit.' : 'The harness produced no readable result envelope.')
    : bounded(envelope.result, 4096) ?? 'The harness ended without a summary.');
  const limitations = strings(structured?.limitations).slice(0, 31);
  if (structured === undefined) limitations.push('No structured result was returned; the summary is the harness text or absent.');
  // The harness was started without provider credentials; a source it still names came from somewhere else, such as a setting.
  const keySource = stream.apiKeySource;
  if (keySource !== undefined && keySource !== 'none' && limitations.length < 32) limitations.push(`The harness reported an API key source (${keySourceName(keySource)}), so this run may not have used the subscription sign-in.`);
  const providers = stream.providers.filter(provider => provider !== 'firstParty');
  if (providers.length > 0 && limitations.length < 32) limitations.push(`The result names a model provider other than the first-party one (${providers.join(', ')}), so this run may not have used the subscription.`);
  // The project settings were checked once, before the start; a file the run created or changed there was not.
  if (changedFiles.some(file => file === '.claude' || file.startsWith('.claude/')) && limitations.length < 32) {
    limitations.push('The run created or changed files under .claude/, the project settings directory, which the settings check before the start did not see.');
  }
  const usageLimited = reason === 'usage-limit' && limit !== undefined;
  return {result: {outcome: usageLimited ? 'usage-limit' : reason === undefined ? outcome : Outcome.failed, repository, base, head, changedFiles: changedFiles.slice(0, 200).map(file => file.slice(0, 512)), checks,
    findings: strings(structured?.findings), limitations, summary, sessionId, usage, ...(usageLimited ? {limit} : {})}, ...(reason === undefined ? {} : {reason})};
}

/** A refused run's result: the reason as its summary, and the facts it has; the outcome stays `failed`. */
function refusedResult(result: CodingResult, summary: string): CodingResult {
  return {...result, outcome: Outcome.failed, summary: summary.slice(0, 4096), limitations: result.limitations.filter(text => !text.startsWith('No structured result'))};
}
/** The project settings files a run with `--setting-sources project` loads, relative to its worktree. */
export const PROJECT_SETTINGS = ['.claude/settings.json', '.claude/settings.local.json'] as const;
/** Reads the worktree's project settings as data and says why they would undo the harness environment, if they would. */
export async function projectSettingsRefusal(worktree: string): Promise<string | undefined> {
  for (const file of PROJECT_SETTINGS) {
    let text: string | undefined;
    try {
      const buffer = await readFile(join(worktree, file));
      if (buffer.length > 1024 * 1024) return `${file} is larger than the worker reads`;
      text = buffer.toString('utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return `${file} could not be read`;
    }
    const refusal = settingsRefusal(file, text);
    if (refusal !== undefined) return refusal;
  }
  return undefined;
}

async function git(cwd: string, args: string[], {timeoutMs = 60_000, trim = true}: {timeoutMs?: number; trim?: boolean} = {}): Promise<string> {
  const {stdout} = await run('git', ['-C', cwd, ...args], {timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024});
  return trim ? stdout.trim() : stdout;
}

/** One worker process: connect, declare the endpoint, run at most one task at a time. */
export class CodingWorker {
  #participant: RemoteParticipant | undefined;
  #endpoint: RemoteEndpoint | undefined;
  #running: Running | undefined;
  readonly #harness: Harness;
  readonly #connect: typeof connectRemote;
  readonly #now: () => number;
  /** What the declaration carries: the latest readiness probe and the limit windows the latest run reported. */
  #readiness: CodingReadiness | undefined;
  #limits: {windows: CodingLimitWindow[]; atMs: number} | undefined;
  /** `log` is the process's own line writer, owned by the entry point; the library writes nothing itself. */
  constructor(readonly configuration: WorkerConfiguration, readonly token: string, harness?: Harness, readonly log: (line: string) => void = () => {}, connect: typeof connectRemote = connectRemote,
    now: () => number = Date.now) {
    this.#harness = harness ?? claudeHarness(configuration.claude.executable, process.env,
      {...(configuration.claude.environment === undefined ? {} : {environment: configuration.claude.environment}), ...(configuration.repositories[0] === undefined ? {} : {probeCwd: configuration.repositories[0].path})});
    this.#connect = connect;
    this.#now = now;
  }
  /** The readiness this worker last reported, or would report now if it has not probed yet. */
  get readiness(): CodingReadiness | undefined {return this.#readiness === undefined ? undefined : structuredClone(this.#readiness);}
  /**
   * Asks the harness what it is without starting a task: version, sign-in and plan where the tool says, unknown where it
   * does not or the probe fails. The limit windows are the latest run's, with when they were observed, or null.
   */
  async #probe(): Promise<CodingReadiness> {
    let found: HarnessReadiness = UNKNOWN_READINESS;
    try {if (this.#harness.readiness !== undefined) found = await this.#harness.readiness();} catch {this.log('coding-worker: readiness probe failed; reporting unknown');}
    return {tool: 'claude-code', installed: found.installed, version: found.version, signedIn: found.signedIn, plan: found.plan,
      limits: this.#limits?.windows ?? null, limitsObservedAtMs: this.#limits?.atMs ?? null, checkedAtMs: this.#now()};
  }
  #enable(readiness: CodingReadiness | undefined): {type: string; dataschema: string; data: CodingEndpointControl} {
    return {type: 'org.bunny.coding.endpoint.requested', dataschema: ENDPOINT_SCHEMA, data: {requestId: randomUUID(), action: 'enable', ...(readiness === undefined ? {} : {readiness})}};
  }
  #stopping = false;
  #redeclaring = false;
  /** Set once the first declaration is accepted; only then does a reconnect declare again. */
  #declared = false;
  /**
   * Connects and declares the one endpoint. A first declaration that fails closes the connection and throws the original
   * failure, so the process ends and its supervisor owns any later fresh start; nothing here sends the declaration again.
   * A worker that could not connect has nothing to close and throws the same way.
   */
  async start(): Promise<void> {
    // The probe runs before the connection opens, so a slow tool never holds an undeclared endpoint.
    this.#readiness = await this.#probe();
    this.#participant = await this.#connect({url: this.configuration.edge, token: this.token, source: CODING_WORKER_SOURCE,
      onDiagnostic: diagnostic => {
        this.log(`coding-worker ${diagnostic.event}`);
        // A lost stream closed the connection-bound endpoint; the new stream needs a fresh declaration, which the core hears as a new endpoint.
        // During the first declaration, start() alone decides: a reconnect then must not send a second enable.
        if (diagnostic.event === 'remote.reconnected' && this.#declared && !this.#stopping) void this.#redeclare();
      }});
    try {await this.#declare(); this.#declared = true;} catch (error) {
      this.#stopping = true;
      this.#stopChild();
      await this.#participant.close().catch(() => {});
      throw error;
    }
  }
  /**
   * Declares again after a reconnect, with backoff: the core may still name the old endpoint until the gateway has
   * reported it lost, so a refused declaration is closed and tried again rather than left as an undeclared endpoint.
   */
  async #redeclare(): Promise<void> {
    if (this.#redeclaring) return;
    this.#redeclaring = true;
    try {
      for (let attempt = 0; attempt < REDECLARE_ATTEMPTS && !this.#stopping; attempt += 1) {
        try {await this.#declare(); return;} catch { /* refused, timed out or lost again: wait and try once more */ }
        await new Promise<void>(resolvePromise => {setTimeout(resolvePromise, REDECLARE_MS * 2 ** attempt).unref();});
      }
      this.log('coding-worker could not declare its endpoint again; the core keeps reporting it lost');
    } finally {this.#redeclaring = false;}
  }
  /**
   * Opens the one endpoint on the current stream and declares it available. A declaration that was not accepted closes
   * the endpoint again and throws its code and request ID, never the refusal's text: `refused` when the core had no
   * effect, `uncertain` when it may have selected this endpoint, which the close then releases. The command's trace ID
   * comes with the answer, so a declaration that could not be sent at all is uncertain without one.
   */
  async #declare(): Promise<void> {
    const participant = this.#participant;
    if (participant === undefined) throw new Error('coding-worker: not connected');
    if (this.#endpoint !== undefined) return;
    // A registration that fails runs the closed handler before there is an endpoint to compare.
    let opened: RemoteEndpoint | undefined;
    const endpoint = await participant.openEndpoint<CodingWork>({family: 'coding-work', respond: command => this.#work(command), onClosed: () => {
      if (this.#endpoint === opened) this.#endpoint = undefined;
      this.log('coding-worker endpoint closed; the running task, if any, is lost to the core and will be stopped');
      this.#stopChild();
    }}).catch((error: unknown) => {throw error instanceof SdkError ? new Error(`coding-worker-endpoint-refused: ${error.body.error.code}`) : error;});
    opened = endpoint;
    this.#endpoint = endpoint;
    const draft = this.#enable(this.#readiness), requestId = draft.data.requestId;
    let answer: RequestResult;
    try {
      answer = await endpoint.request('coding-endpoint', draft, {timeoutMs: 5000, requestId});
    } catch {answer = {status: 'uncertain', requestId, error: errorBody('uncertain-result')};}
    if (answer.status !== 'accepted') {
      if (this.#endpoint === endpoint) this.#endpoint = undefined;
      await endpoint.close().catch(() => {});
      const {code, traceId} = answer.error.error;
      throw new Error(`coding-worker-enable-${answer.status === 'rejected' ? 'refused' : 'uncertain'}: ${code}${traceId === undefined ? '' : ` trace ${traceId}`} request ${answer.requestId}`);
    }
    this.log(`coding-worker available as endpoint ${endpoint.id}`);
  }
  async stop(): Promise<void> {
    this.#stopping = true;
    this.#stopChild();
    try {await this.#endpoint?.request('coding-endpoint', {type: 'org.bunny.coding.endpoint.requested', dataschema: ENDPOINT_SCHEMA,
      data: {requestId: randomUUID(), action: 'disable'}}, {timeoutMs: 5000});} catch { /* the gateway reports the lost endpoint either way */ }
    await this.#endpoint?.close(); await this.#participant?.close();
  }
  #stopChild(): void {
    const running = this.#running;
    if (running === undefined) return;
    running.cancelled = true;
    if (running.timer !== undefined) {clearTimeout(running.timer); running.timer = undefined;}
    running.child?.kill('SIGTERM');
    setTimeout(() => {running.child?.kill('SIGKILL');}, 10_000).unref();
  }
  #work(command: Command<CodingWork>): Reply {
    if (command.source !== 'bunny/modules/companions') return errorBody('forbidden');
    const data = command.data;
    if (data.action === 'cancel') {
      if (this.#running?.operationId !== data.operationId) return errorBody('not-found');
      this.#stopChild(); return {status: 'accepted'};
    }
    if (this.#running !== undefined) return this.#running.operationId === data.operationId ? {status: 'accepted'} : errorBody('capacity', {detail: 'one task at a time'});
    const repository = this.configuration.repositories.find(entry => entry.name === data.repository);
    if (repository === undefined) return errorBody('invalid-request', {detail: 'the repository is not on the worker\'s allowlist'});
    const running: Running = {operationId: data.operationId, child: undefined, cancelled: false, timer: undefined};
    this.#running = running;
    queueMicrotask(() => {void this.#run(running, repository, data.taskId, data.brief, data.bounds).finally(() => {
      if (this.#running === running) this.#running = undefined;
      if (running.limitsChanged === true) void this.#refresh();
    });});
    return {status: 'accepted'};
  }
  /**
   * After a run that reported limit windows, probes again and sends the selected endpoint one more enable carrying the new
   * readiness, which the core records. It is a report, not a retry: nothing is sent again if it is refused or lost.
   */
  async #refresh(): Promise<void> {
    if (this.#stopping) return;
    const readiness = await this.#probe();
    this.#readiness = readiness;
    const endpoint = this.#endpoint;
    if (endpoint === undefined || this.#stopping) return;
    const draft = this.#enable(readiness);
    try {
      const answer = await endpoint.request('coding-endpoint', draft, {timeoutMs: 5000, requestId: draft.data.requestId});
      if (answer.status !== 'accepted') this.log(`coding-worker readiness ${answer.status}: ${answer.error.error.code} request ${answer.requestId}`);
    } catch {this.log(`coding-worker readiness uncertain: request ${draft.data.requestId}`);}
  }
  async #progress(data: CodingProgress): Promise<void> {
    try {await this.#endpoint?.publish('coding-progress', {kind: 'occurrence', type: 'org.bunny.coding.progress.observed', dataschema: PROGRESS_SCHEMA, data});}
    catch {this.log(`coding-worker could not report ${data.status} for ${data.operationId}`);}
  }
  async #run(running: Running, repository: {name: string; path: string}, taskId: string, brief: string, bounds: CodingBounds): Promise<void> {
    await this.#progress({operationId: running.operationId, status: 'started'});
    let worktree: string, base: string | null = null;
    try {
      await stat(join(repository.path, '.git'));
      try {await git(repository.path, ['fetch', '--quiet', 'origin', 'main'], {timeoutMs: 120_000});} catch {this.log('coding-worker: fetch failed; using the local origin/main');}
      base = await git(repository.path, ['rev-parse', 'origin/main']);
      if (!SHA.test(base)) base = null;
      const root = join(repository.path, '.local', 'worktrees'); await mkdir(root, {recursive: true, mode: 0o700});
      worktree = join(root, `bunny-${taskId.slice(0, 8)}-${randomUUID().slice(0, 8)}`);
      await git(repository.path, ['worktree', 'add', '--detach', '--quiet', worktree, base ?? 'origin/main']);
    } catch {
      await this.#progress({operationId: running.operationId, status: 'failed', reason: 'worktree', result: assembleResult(repository.name, base, null, [], '', 'worktree').result}); return;
    }
    if (running.cancelled) {await this.#progress({operationId: running.operationId, status: 'cancelled', reason: 'cancelled', result: null}); return;}
    // The run loads the worktree's project settings, whose `env` and credential helpers could undo the harness
    // environment. They are read as data before the tool starts; one that would is refused, and nothing is spent.
    const settings = await projectSettingsRefusal(worktree);
    if (settings !== undefined) {
      await this.#progress({operationId: running.operationId, status: 'failed', reason: 'refused',
        result: refusedResult(assembleResult(repository.name, base, base, [], '', 'refused').result, `The run was refused before the tool started: ${settings}. Workers use only the subscription sign-in.`)});
      return;
    }
    const {claude} = this.configuration;
    // The brief travels on stdin, never as an argument. The private turn cap can only lower the dispatch's. Only the
    // repository's own settings load, no MCP server, and the deny list applies whatever any setting allows.
    // The output is a stream of events (stream-json needs --verbose with --print), read as it arrives, so a usage limit
    // the tool reports mid-run is seen even when the run ends without a result.
    const args = ['--print', '--output-format', 'stream-json', '--verbose', '--json-schema', JSON.stringify(RESULT_SCHEMA), '--permission-mode', claude.permissionMode,
      '--max-turns', String(Math.min(claude.maxTurns ?? bounds.maxTurns, bounds.maxTurns)), '--max-budget-usd', String(bounds.budgetUsd),
      ...(claude.allowedTools.length === 0 ? [] : ['--allowedTools', ...claude.allowedTools]), '--disallowedTools', ...DENIED_TOOLS, '--strict-mcp-config', '--setting-sources', 'project',
      '--settings', JSON.stringify({env: Object.fromEntries(BLANKED_SWITCHES.map(name => [name, '']))}),
      ...(claude.model === undefined ? [] : ['--model', claude.model]),
      '--append-system-prompt', 'You are a delegated coding worker in a fresh worktree. Make only the change the brief asks for, run the checks the repository documents for it, never push, open a PR, change settings or leave the worktree, and end with the structured result: outcome, summary, checks, findings, limitations. If the brief leaves a choice open that you cannot settle from the repository, do not guess: end with outcome waiting-for-owner and put your one question first in findings.'];
    let timedOut = false;
    const started = Date.now();
    const stream = new ClaudeStream();
    // The first event names the credential the tool will use, before its first model request: anything but the
    // subscription stops the run there.
    let keyRefused = false;
    const watch = (line: string): void => {
      stream.push(line);
      const source = stream.apiKeySource;
      if (!keyRefused && source !== undefined && source !== 'none') {keyRefused = true; running.child?.kill('SIGTERM'); setTimeout(() => {running.child?.kill('SIGKILL');}, 10_000).unref();}
    };
    const finished = await this.#harness.start(args, worktree, brief, child => {
      running.child = child;
      running.timer = setTimeout(() => {timedOut = true; child.kill('SIGTERM'); setTimeout(() => {child.kill('SIGKILL');}, 10_000).unref();}, bounds.wallClockMs);
    }, watch);
    if (running.timer !== undefined) {clearTimeout(running.timer); running.timer = undefined;}
    if (finished.stdout !== undefined) for (const line of finished.stdout.split('\n')) watch(line);
    const windows = stream.windows;
    if (windows.length > 0) {this.#limits = {windows, atMs: this.#now()}; running.limitsChanged = true;}
    let head: string | null = null, changedFiles: string[] = [];
    try {
      head = await git(worktree, ['rev-parse', 'HEAD']); if (!SHA.test(head)) head = null;
      // Porcelain lines are two status letters, a space and the path; the first line's leading space is part of the status, so the output is not trimmed.
      const status = await git(worktree, ['status', '--porcelain', '--untracked-files=all'], {trim: false});
      changedFiles = status.split('\n').map(line => line.trimEnd()).filter(Boolean).map(line => line.slice(3).trim()).filter(Boolean);
      if (base !== null && head !== null && head !== base) changedFiles = [...new Set([...(await git(worktree, ['diff', '--name-only', `${base}..${head}`])).split('\n').filter(Boolean), ...changedFiles])];
    } catch {this.log('coding-worker: git facts unavailable after the run');}
    if (running.cancelled) {await this.#progress({operationId: running.operationId, status: 'cancelled', reason: 'cancelled', result: assembleResult(repository.name, base, head, changedFiles, stream, 'cancelled').result}); return;}
    if (keyRefused) {
      await this.#progress({operationId: running.operationId, status: 'failed', reason: 'refused', result: refusedResult(assembleResult(repository.name, base, head, changedFiles, stream, 'refused').result,
        `The run was stopped at its first event: the tool reported the API key source ${keySourceName(stream.apiKeySource ?? '')}, and workers use only the subscription sign-in.`)});
      return;
    }
    if (timedOut) {await this.#progress({operationId: running.operationId, status: 'failed', reason: 'timeout', result: assembleResult(repository.name, base, head, changedFiles, stream, 'timeout').result}); return;}
    // A skipped oversized event matters only when it was the final result.
    if (finished.truncated && stream.result === undefined) {await this.#progress({operationId: running.operationId, status: 'failed', reason: 'invalid-output', result: assembleResult(repository.name, base, head, changedFiles, '', 'invalid-output').result}); return;}
    const assembled = assembleResult(repository.name, base, head, changedFiles, stream);
    if (assembled.result.usage !== null && assembled.result.usage.durationMs === null) assembled.result.usage.durationMs = Date.now() - started;
    // A usage limit keeps its own outcome and the limit the tool reported; every other failure is failed, as before.
    if (assembled.reason === 'usage-limit') {await this.#progress({operationId: running.operationId, status: 'failed', reason: 'usage-limit', result: assembled.result}); return;}
    if (finished.code !== 0 || assembled.reason !== undefined) {await this.#progress({operationId: running.operationId, status: 'failed', reason: assembled.reason ?? 'exit', result: {...assembled.result, outcome: Outcome.failed}}); return;}
    await this.#progress({operationId: running.operationId, status: 'completed', result: assembled.result});
  }
}

/** Reads the private configuration and token files and runs the worker until the process is signalled. */
export async function main(argv: readonly string[], log: (line: string) => void): Promise<void> {
  const [configPath] = argv;
  if (configPath === undefined || !isAbsolute(configPath)) throw new Error('usage: coding-worker.mjs /absolute/private/coding-worker.json');
  const raw = await readPrivateJson(configPath, MAX_CONFIG_BYTES);
  const configuration = parseConfiguration(raw);
  const token = (await readPrivateFile(configuration.tokenFile, 1024)).toString('utf8').replace(/[\r\n]+$/, '');
  if (!TOKEN.test(token)) throw new Error('coding-worker-token: the token file does not hold one bearer token');
  const worker = new CodingWorker(configuration, token, undefined, log);
  await worker.start();
  await new Promise<void>(resolvePromise => {
    const stop = (): void => {void worker.stop().finally(resolvePromise);};
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  });
}
