// The host-local coding worker (Hub #502): one Node process on the owner's computer, started after sign-in, that holds
// the `coding-worker` credential, opens its one endpoint on the core's gateway and runs Claude Code headless in a fresh
// worktree of an allowlisted repository when the companions module hands it owner-approved work. It reports progress
// as occurrences and never resends, retries or claims more than it observed. The container gets no CLI and no
// repository; this process gets no state, no device and no dashboard authority.
import {spawn, type ChildProcess} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {mkdir, readFile, stat} from 'node:fs/promises';
import {isAbsolute, join, resolve} from 'node:path';
import {StringDecoder} from 'node:string_decoder';
import {promisify} from 'node:util';
import {SdkError, connectRemote, type RemoteEndpoint, type RemoteParticipant, type RequestResult} from '@jimmie-potts/sdk/remote';
import {Outcome, type Command, type Reply} from '@jimmie-potts/sdk';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {CODING_WORKER_SLOTS, CODING_WORKER_SOURCE, type CodingBounds, type CodingCheck, type CodingCompanion, type CodingEndpointControl, type CodingHarnessReadiness, type CodingProgress, type CodingProgressReason,
  type CodingReadiness, type CodingResult, type CodingWork} from '@jimmie-potts/event-contracts/v2/coding';
import {readPrivateJson} from '../hook/producer.js';
import {readPrivateFile} from '../state.js';
import {BLANKED_SWITCHES, ClaudeStream, UNKNOWN_READINESS, claudeAuthRefused, configurableVariable, harnessEnvironment, keySourceName, parseAuthStatus, parseVersion, settingsRefusal, type HarnessReadiness} from './claude-stream.js';

import {nativeSessionId, type AdapterEvidence, type AdapterRun, type CodingAdapter} from './adapter.js';
import {codexAdapter, type CodexConfiguration} from './codex-adapter.js';

const run = promisify(execFile);
const CLAUDE = 'claude-code';
const CLAUDE_CAPABILITIES = {steering: 'unsupported', resume: 'unsupported', review: true} as const;
export const WORKER_SCHEMA = 'coding-worker/1.0';
const MAX_CONFIG_BYTES = 8192;
/**
 * One stream event longer than this many characters (UTF-16 code units, so up to about three times as many bytes) is
 * skipped, not buffered; a run whose final result was skipped is unreadable output.
 */
const MAX_LINE_CHARS = 4 * 1024 * 1024;
/** How long each readiness probe (`--version`, `auth status`) may take before its answer counts as unknown. */
export const PROBE_MS = 10_000;
/** The enable declares the worker's slots (Hub #2028), which only a core that knows `coding-endpoint/2.2` accepts. */
const ENDPOINT_SCHEMA = 'https://bunny.invalid/events/coding-endpoint/2.2';
const PROGRESS_SCHEMA = 'https://bunny.invalid/events/coding-progress/2.1';
const NAME = /^[a-z0-9]+(?:[-._][a-z0-9]+)*$/;
const SHA = /^[0-9a-f]{40}$/;
const TOKEN = /^[A-Za-z0-9_-]{20,256}$/;
/**
 * How long the worker waits for stopped runs to end before it declares again or finishes stopping: the SIGKILL ten
 * seconds after SIGTERM, and five more. A run still alive then keeps its companion's slot until it ends.
 */
export const STOPPED_RUN_MS = 15_000;
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
  codex?: CodexConfiguration;
  adapterProtocol?: true;
};
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
/** Reads and checks the worker's private configuration file. Throws `coding-worker-config` with a fixed reason; never quotes the file. */
export function parseConfiguration(value: unknown): WorkerConfiguration {
  const bad = (reason: string): never => {throw new Error(`coding-worker-config: ${reason}`);};
  if (!isRecord(value) || (value.schema !== WORKER_SCHEMA && value.schema !== 'coding-worker/1.1')) return bad('not a coding-worker/1.0 or 1.1 document');
  if (Object.keys(value).some(key => !['schema', 'edge', 'tokenFile', 'repositories', 'claude', ...(value.schema === 'coding-worker/1.1' ? ['codex'] : [])].includes(key))) return bad('unknown member');
  const {edge, tokenFile, repositories, claude, codex} = value;
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
  let codexConfig: CodexConfiguration | undefined;
  if (codex !== undefined) {
    if (!isRecord(codex) || Object.keys(codex).some(key => !['executable', 'model'].includes(key)) ||
      typeof codex.executable !== 'string' || !isAbsolute(codex.executable)) return bad('codex needs an absolute executable path and optional model');
    if (codex.model !== undefined && (typeof codex.model !== 'string' || !/^[a-z0-9.-]{1,64}$/.test(codex.model))) return bad('codex.model is not a model name');
    codexConfig = {executable: codex.executable, ...(codex.model === undefined ? {} : {model: codex.model})};
  }
  return {edge: url.origin, tokenFile, repositories: list, ...(value.schema === 'coding-worker/1.1' ? {adapterProtocol: true} : {}), ...(codexConfig === undefined ? {} : {codex: codexConfig}), claude: {executable: claude.executable, ...(claude.model === undefined ? {} : {model: claude.model}), permissionMode, allowedTools: allowedTools as string[],
    ...(claude.maxTurns === undefined ? {} : {maxTurns: Number(claude.maxTurns)}), ...(environment === undefined ? {} : {environment: environment as string[]})}};
}

/** One run in one of the worker's slots, with the companion that asked and the endpoint that started it. */
type Running = {operationId: string; companion: CodingCompanion | undefined; endpoint: RemoteEndpoint | undefined; cancelled: boolean;
  timer: ReturnType<typeof setTimeout> | undefined; limitsChanged?: boolean; ended: Promise<void>; harness: string; sessionId?: string; sessionReport?: Promise<void>; controller: AbortController};
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
  subscriptionRefused?(): Promise<boolean>;
};
/**
 * Splits decoded output into lines for `onLine`. A line longer than `maxLength` is skipped, whole or in part and whether
 * it ends in the same chunk or a later one, and marks the output truncated; memory stays bounded by one chunk over it.
 */
export function lineSplitter(onLine: (line: string) => void, maxLength: number = MAX_LINE_CHARS): {write(text: string): void; end(text?: string): void; readonly truncated: boolean} {
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
  subscriptionRefused: async () => {
    const result = await probe(executable, ['auth', 'status', '--json'], harnessEnvironment(environment, options.environment),
      options.probeCwd, options.probeMs ?? PROBE_MS, options.probeTimer ?? realTimer);
    return result.missing || (result.answered && claudeAuthRefused(result.stdout));
  },
  readiness: async () => {
    const env = harnessEnvironment(environment, options.environment), timeoutMs = options.probeMs ?? PROBE_MS, timer = options.probeTimer ?? realTimer;
    const version = await probe(executable, ['--version'], env, options.probeCwd, timeoutMs, timer);
    if (version.missing) return {...UNKNOWN_READINESS, installed: 'no'};
    const auth = await probe(executable, ['auth', 'status', '--json'], env, options.probeCwd, timeoutMs, timer);
    const parsed = parseVersion(version.stdout);
    return {installed: parsed === null ? 'unknown' : 'yes', version: parsed, ...(auth.answered ? parseAuthStatus(auth.stdout) : {signedIn: 'unknown', plan: null})};
  },
});

/**
 * Whether a changed path from git's status or diff is in the project settings directory: either side of a rename,
 * quoted or not, with the directory name compared without case, as a case-insensitive volume resolves it.
 */
export function touchesSettingsDirectory(path: string): boolean {
  return path.split(' -> ').some(side => /^\.claude(?:\/|$)/i.test(side.trim().replace(/^"|"$/g, '')));
}
const bounded = (value: unknown, max: number): string | undefined => typeof value === 'string' && value.trim() !== '' ? value.slice(0, max) : undefined;
function structuredReport(value: unknown) {
  const structured = isRecord(value) ? value : undefined;
  const outcome = structured !== undefined && ['tested-candidate', 'incomplete', Outcome.failed, 'waiting-for-owner'].includes(String(structured.outcome)) ? structured.outcome as CodingResult['outcome'] : 'incomplete';
  const checks: CodingCheck[] = Array.isArray(structured?.checks) ? structured.checks.slice(0, 32).flatMap((check: unknown) => {
    if (!isRecord(check) || typeof check.name !== 'string' || !['passed', 'failed', 'skipped', 'unrun', 'unknown'].includes(String(check.status))) return [];
    const detail = bounded(check.detail, 1024);
    const entry: CodingCheck = {name: check.name.slice(0, 128), status: check.status as CodingCheck['status'], ...(detail === undefined ? {} : {detail})};
    return [entry];
  }) : [];
  const strings = (value: unknown): string[] => Array.isArray(value) ? value.slice(0, 32).flatMap(item => {const text = bounded(item, 1024); return text === undefined ? [] : [text];}) : [];
  return {outcome, checks, findings: strings(structured?.findings), limitations: strings(structured?.limitations), summary: bounded(structured?.summary, 4096)};
}

function assembleAdapterResult(repository: string, base: string | null, head: string | null, changedFiles: string[], evidence: AdapterEvidence,
  reason: CodingProgressReason | undefined, sessionId: string | undefined, elapsedMs: number): CodingResult {
  const {summary, outcome, checks, findings, limitations} = structuredReport(evidence.structured);
  const limit = reason === 'usage-limit' ? evidence.limit ?? {window: null, resetsAtMs: null} : undefined;
  const usage = evidence.usage == null ? null : {...evidence.usage, durationMs: evidence.usage.durationMs ?? Math.max(0, elapsedMs)};
  return {repository, base, head, changedFiles: changedFiles.slice(0, 200).map(file => file.slice(0, 512)), checks, findings,
    outcome: limit !== undefined ? 'usage-limit' : reason === undefined ? outcome : Outcome.failed,
    limitations: [...(evidence.limitations ?? []), ...limitations].slice(0, 32).flatMap(line => {
      const text = bounded(line, 1024);
      return text === undefined ? [] : [text];
    }),
    summary: bounded(evidence.summary, 4096) ?? summary ?? (limit === undefined ? 'The harness returned no structured summary.' : 'The harness stopped at a subscription usage limit.'),
    sessionId: sessionId ?? null, usage, ...(limit === undefined ? {} : {limit})};
}


/**
 * The result from Claude Code's stream (or a buffered output read as one) and the git facts the worker observed itself.
 * The stream's final `result` event is the envelope. A usage limit the tool reported, on a run that did not end with a
 * successful result, is the `usage-limit` outcome with the window and reset the tool gave, or null where it gave none.
 */
export function assembleResult(repository: string, base: string | null, head: string | null, changedFiles: string[], output: string | ClaudeStream, given?: CodingProgressReason,
  settingsChanged = false): {result: CodingResult; reason?: CodingProgressReason} {
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
  const report = structuredReport(structured);
  const usage = envelope === undefined ? null : {
    turns: Number.isSafeInteger(envelope.num_turns) && Number(envelope.num_turns) >= 0 ? Number(envelope.num_turns) : null,
    costUsd: typeof envelope.total_cost_usd === 'number' && envelope.total_cost_usd >= 0 ? envelope.total_cost_usd : null,
    durationMs: Number.isSafeInteger(envelope.duration_ms) && Number(envelope.duration_ms) >= 0 ? Number(envelope.duration_ms) : null};
  const sessionId = stream.sessionId ?? null;
  // A run the harness ended for its dollar budget is a budget stop whatever its exit code says.
  if (reason === undefined && envelope?.subtype === 'error_max_budget_usd') reason = 'budget';
  const summary = report.summary ?? (envelope === undefined ? (reason === 'usage-limit' ? 'The harness stopped at a usage limit.' : 'The harness produced no readable result envelope.')
    : bounded(envelope.result, 4096) ?? 'The harness ended without a summary.');
  const limitations = report.limitations.slice(0, 31);
  if (structured === undefined) limitations.push('No structured result was returned; the summary is the harness text or absent.');
  // The harness was started without provider credentials; a source it still names came from somewhere else, such as a setting.
  const keySource = stream.apiKeySource;
  if (keySource !== undefined && keySource !== 'none' && limitations.length < 32) limitations.push(`The harness reported an API key source (${keySourceName(keySource)}), so this run may not have used the subscription sign-in.`);
  const providers = stream.providers.filter(provider => provider !== 'firstParty');
  if (providers.length > 0 && limitations.length < 32) limitations.push(`The result names a model provider other than the first-party one (${providers.join(', ')}), so this run may not have used the subscription.`);
  // The project settings were checked once, before the start. The worker compares the settings files themselves after the
  // run (which also sees files the repository ignores), and git's changed paths name anything else under `.claude/`.
  if (settingsChanged && limitations.length < 32) {
    limitations.push('The run created, changed or removed a project settings file, which the settings check before the start did not see.');
  } else if (changedFiles.some(touchesSettingsDirectory) && limitations.length < 32) {
    limitations.push('The run created or changed files under .claude/, the project settings directory, which the settings check before the start did not see.');
  }
  const usageLimited = reason === 'usage-limit' && limit !== undefined;
  return {result: {outcome: usageLimited ? 'usage-limit' : reason === undefined ? report.outcome : Outcome.failed, repository, base, head, changedFiles: changedFiles.slice(0, 200).map(file => file.slice(0, 512)), checks: report.checks,
    findings: report.findings, limitations, summary, sessionId, usage, ...(usageLimited ? {limit} : {})}, ...(reason === undefined ? {} : {reason})};
}

/** The project settings files a run with `--setting-sources project` loads, relative to its worktree. */
export const PROJECT_SETTINGS = ['.claude/settings.json', '.claude/settings.local.json'] as const;
/**
 * Reads the worktree's project settings as data: why they would undo the harness environment, if they would, and a
 * fingerprint of what each file held (absent, unreadable or its SHA-256), to compare after the run.
 */
export async function readProjectSettings(worktree: string): Promise<{refusal?: string; fingerprint: string}> {
  let refusal: string | undefined;
  const prints: string[] = [];
  for (const file of PROJECT_SETTINGS) {
    let text: string | undefined;
    try {
      const buffer = await readFile(join(worktree, file));
      prints.push(createHash('sha256').update(buffer).digest('hex'));
      if (buffer.length > 1024 * 1024) {refusal ??= `${file} is larger than the worker reads`; continue;}
      text = buffer.toString('utf8');
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
      prints.push(missing ? 'absent' : 'unreadable');
      if (!missing) {refusal ??= `${file} could not be read`; continue;}
    }
    refusal ??= settingsRefusal(file, text);
  }
  return {...(refusal === undefined ? {} : {refusal}), fingerprint: prints.join(' ')};
}
/** Why the worktree's project settings would undo the harness environment, if they would. */
export async function projectSettingsRefusal(worktree: string): Promise<string | undefined> {
  return (await readProjectSettings(worktree)).refusal;
}

/** Runs one git command in `cwd`; the worker's default, and the seam a test uses to watch the setup's ordering. */
export type GitRunner = (cwd: string, args: string[], options?: {timeoutMs?: number; trim?: boolean}) => Promise<string>;
async function git(cwd: string, args: string[], {timeoutMs = 60_000, trim = true}: {timeoutMs?: number; trim?: boolean} = {}): Promise<string> {
  const {stdout} = await run('git', ['-C', cwd, ...args], {timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024});
  return trim ? stdout.trim() : stdout;
}

/**
 * One worker process: connect, declare the endpoint and its slots, and run at most one task per companion, three at once
 * (Hub #2028), each in its own fresh worktree.
 */
export class CodingWorker {
  #participant: RemoteParticipant | undefined;
  #endpoint: RemoteEndpoint | undefined;
  /** The runs in the worker's slots, by operation ID. */
  readonly #running = new Map<string, Running>();
  /** Each repository's git setup (fetch and worktree add), one at a time, so runs on the same repository never race git's locks. */
  readonly #gitSetup = new Map<string, Promise<void>>();
  readonly #harness: Harness;
  readonly #adapters: ReadonlyMap<string, CodingAdapter>;
  readonly #adapterProtocol: boolean;
  readonly #adapterHealth = new Map<string, CodingHarnessReadiness>();
  readonly #connect: typeof connectRemote;
  readonly #now: () => number;
  readonly #git: GitRunner;
  readonly #timer: ProbeTimer;
  /** What the declaration carries: the latest readiness probe and the limit windows the latest run reported. */
  #readiness: CodingReadiness | undefined;
  /** `log` is the process's own line writer, owned by the entry point; the library writes nothing itself. */
  constructor(readonly configuration: WorkerConfiguration, readonly token: string, harness?: Harness, readonly log: (line: string) => void = () => {}, connect: typeof connectRemote = connectRemote,
    now: () => number = Date.now, runGit: GitRunner = git, timer: ProbeTimer = realTimer, adapters: readonly CodingAdapter[] = []) {
    this.#harness = harness ?? claudeHarness(configuration.claude.executable, process.env,
      {...(configuration.claude.environment === undefined ? {} : {environment: configuration.claude.environment}), ...(configuration.repositories[0] === undefined ? {} : {probeCwd: configuration.repositories[0].path})});
    const cwd = configuration.repositories[0]?.path;
    const configured = configuration.codex === undefined || cwd === undefined ? [] : [codexAdapter(configuration.codex, {probeCwd: cwd})];
    const claudeAdapter: CodingAdapter = {
      id: CLAUDE,
      capabilities: CLAUDE_CAPABILITIES,
      readiness: () => this.#harness.readiness?.() ?? Promise.resolve(UNKNOWN_READINESS),
      run: input => this.#runClaude(input),
    };
    const available = new Map<string, CodingAdapter>([[CLAUDE, claudeAdapter]]);
    for (const adapter of [...configured, ...adapters]) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(adapter.id) || adapter.id.length > 32 || adapter.id === CLAUDE || available.has(adapter.id)) {
        throw new Error('coding-worker-config: duplicate or invalid harness identity');
      }
      available.set(adapter.id, adapter);
    }
    if (available.size > 8) throw new Error('coding-worker-config: too many harnesses');
    this.#adapters = available;
    this.#adapterProtocol = available.size > 1 || configuration.adapterProtocol === true;
    this.#connect = connect;
    this.#now = now;
    this.#git = runGit;
    this.#timer = timer;
  }
  /**
   * Waits until every stopped run has ended, or for `STOPPED_RUN_MS`, whichever comes first: a tool whose output a
   * leftover process holds open never ends its run, and must not hold the worker undeclared. A run still alive then
   * keeps its slot, so its companion's start is refused with `capacity` until it ends; it is logged by operation.
   */
  async #stoppedRunsEnded(): Promise<void> {
    const runs = [...this.#running.values()];
    if (runs.length === 0) return;
    let cancel = (): void => {};
    const bounded = await Promise.race([Promise.all(runs.map(running => running.ended)).then(() => true),
      new Promise<boolean>(resolvePromise => {cancel = this.#timer(STOPPED_RUN_MS, () => {resolvePromise(false);});})]);
    cancel();
    if (!bounded) for (const running of runs) if (this.#running.get(running.operationId) === running) this.log(`coding-worker: stopped run ${running.operationId} has not ended; its slot stays busy until it does`);
  }
  /** The readiness this worker last reported, or would report now if it has not probed yet. */
  get readiness(): CodingReadiness | undefined {return this.#readiness === undefined ? undefined : structuredClone(this.#readiness);}
  /**
   * Asks the harness what it is without starting a task: version, sign-in and plan where the tool says, unknown where it
   * does not or the probe fails. The limit windows are the latest run's, with when they were observed, or null.
   */
  async #probe(): Promise<CodingReadiness> {
    await Promise.all([...this.#adapters.values()].map(adapter => this.#probeAdapter(adapter)));
    const found = this.#adapterHealth.get(CLAUDE);
    return {tool: CLAUDE, installed: found?.installed ?? 'unknown', version: found?.version ?? null,
      signedIn: found?.signedIn ?? 'unknown', plan: found?.plan ?? null, limits: found?.limits ?? null,
      limitsObservedAtMs: found?.limitsObservedAtMs ?? null, checkedAtMs: found?.checkedAtMs ?? this.#now()};
  }
  async #probeAdapter(adapter: CodingAdapter): Promise<void> {
    let found: Awaited<ReturnType<CodingAdapter['readiness']>> = UNKNOWN_READINESS;
    try {found = await adapter.readiness();} catch {this.log('coding-worker: an adapter readiness probe failed; reporting unknown');}
    const known = this.#adapterHealth.get(adapter.id);
    const previouslyObserved = adapter.id === CLAUDE || (found.signedIn === 'yes' && known?.signedIn === 'yes' && found.plan === known.plan)
      ? known : undefined;
    const freshLimits = found.windows !== undefined && found.windows.length > 0 ? found.windows : undefined;
    this.#adapterHealth.set(adapter.id, {harness: adapter.id, capabilities: adapter.capabilities, installed: found.installed,
      version: found.version, signedIn: found.signedIn, plan: found.plan,
      limits: freshLimits ?? previouslyObserved?.limits ?? null,
      limitsObservedAtMs: freshLimits !== undefined ? this.#now() : previouslyObserved?.limitsObservedAtMs ?? null, checkedAtMs: this.#now()});
  }
  #enable(readiness: CodingReadiness | undefined): {type: string; dataschema: string; data: CodingEndpointControl} {
    const data: CodingEndpointControl = {requestId: randomUUID(), action: 'enable', slots: CODING_WORKER_SLOTS, ...(readiness === undefined ? {} : {readiness})};
    if (!this.#adapterProtocol || readiness === undefined) return {type: 'org.bunny.coding.endpoint.requested', dataschema: ENDPOINT_SCHEMA, data};
    data.harnesses = [...this.#adapters.keys()].flatMap(id => {
      const health = this.#adapterHealth.get(id);
      return health === undefined ? [] : [health];
    });
    return {type: 'org.bunny.coding.endpoint.requested', dataschema: 'https://bunny.invalid/events/coding-endpoint/2.3', data};
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
      this.#stopAll();
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
      // The runs the lost endpoint started were stopped and hold their slots until they end. The fresh endpoint is
      // declared once they have, or after a bound; a run still alive then keeps its companion's slot busy, so no
      // companion ever has two runs and the other companions are not held without a worker.
      await this.#stoppedRunsEnded();
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
      this.log('coding-worker endpoint closed; the running tasks, if any, are lost to the core and will be stopped');
      // The core gives these runs up as uncertain. Each is stopped and keeps its slot, where a cancel or stop() still
      // reaches it, until it ends; its report goes nowhere, since the endpoint that started it is gone.
      this.#stopAll();
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
    this.#stopAll();
    try {await this.#endpoint?.request('coding-endpoint', {type: 'org.bunny.coding.endpoint.requested', dataschema: ENDPOINT_SCHEMA,
      data: {requestId: randomUUID(), action: 'disable'}}, {timeoutMs: 5000});} catch { /* the gateway reports the lost endpoint either way */ }
    await this.#endpoint?.close();
    // The stopped runs finish their own git steps before the process lets go, within the same bound.
    await this.#stoppedRunsEnded();
    await this.#participant?.close();
  }
  #stopAll(): void {for (const running of this.#running.values()) this.#stopRun(running);}
  #stopRun(running: Running): void {
    running.cancelled = true;
    running.controller.abort();
    if (running.timer !== undefined) {clearTimeout(running.timer); running.timer = undefined;}
  }
  #work(command: Command<CodingWork>): Reply {
    if (command.source !== 'bunny/modules/companions') return errorBody('forbidden');
    const data = command.data;
    if (data.action === 'cancel') {
      const running = this.#running.get(data.operationId);
      if (running === undefined) return errorBody('not-found');
      this.#stopRun(running); return {status: 'accepted'};
    }
    if (this.#running.has(data.operationId)) return {status: 'accepted'};
    const harness = data.harness ?? CLAUDE;
    const adapter = this.#adapters.get(harness);
    if (adapter === undefined) return errorBody('unsupported-capability', {detail: 'the worker does not provide that harness'});
    // One slot per companion, three at once; a start from an older core names no companion and takes any free slot.
    if (this.#running.size >= CODING_WORKER_SLOTS) return errorBody('capacity', {detail: 'every slot is busy'});
    if (data.companion !== undefined && [...this.#running.values()].some(running => running.companion === data.companion)) return errorBody('capacity', {detail: 'that companion\'s slot is busy'});
    const repository = this.configuration.repositories.find(entry => entry.name === data.repository);
    if (repository === undefined) return errorBody('invalid-request', {detail: 'the repository is not on the worker\'s allowlist'});
    let end = (): void => {};
    const running: Running = {operationId: data.operationId, companion: data.companion, endpoint: this.#endpoint, cancelled: false, timer: undefined,
      harness, controller: new AbortController(),
      ended: new Promise<void>(resolvePromise => {end = resolvePromise;})};
    this.#running.set(running.operationId, running);
    queueMicrotask(() => {void this.#run(running, repository, data.taskId, data.brief, data.bounds, adapter).finally(() => {
      if (this.#running.get(running.operationId) === running) this.#running.delete(running.operationId);
      end();
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
  /** Reports a run's progress on the endpoint that started it, and nowhere once that endpoint is gone. */
  async #progress(running: Running, data: CodingProgress): Promise<void> {
    if (running.endpoint === undefined || running.endpoint !== this.#endpoint) {this.log(`coding-worker dropped ${data.status} for ${data.operationId}: its endpoint is gone`); return;}
    const attributed = this.#adapterProtocol;
    if (data.status !== 'started') await running.sessionReport;
    const payload = attributed ? {...data, harness: running.harness, ...(running.sessionId === undefined ? {} : {sessionId: running.sessionId})} : data;
    try {await running.endpoint.publish('coding-progress', {kind: 'occurrence', type: 'org.bunny.coding.progress.observed',
      dataschema: attributed ? 'https://bunny.invalid/events/coding-progress/2.2' : PROGRESS_SCHEMA, data: payload});}
    catch {this.log(`coding-worker could not report ${data.status} for ${data.operationId}`);}
  }
  /** Runs one repository's git setup after any other run's on the same repository has finished its own. */
  async #serially<T>(path: string, step: () => Promise<T>): Promise<T> {
    const previous = this.#gitSetup.get(path) ?? Promise.resolve();
    let done = (): void => {};
    const mine = new Promise<void>(resolvePromise => {done = resolvePromise;});
    const chained = previous.then(() => mine);
    this.#gitSetup.set(path, chained);
    try {await previous; return await step();}
    finally {done(); if (this.#gitSetup.get(path) === chained) this.#gitSetup.delete(path);}
  }
  #session(running: Running, value: unknown): Promise<void> | undefined {
    const id = nativeSessionId(value);
    if (id === undefined || running.sessionId !== undefined) return;
    running.sessionId = id;
    if (this.#adapterProtocol) running.sessionReport = this.#progress(running, {operationId: running.operationId, status: 'started'});
    return running.sessionReport;
  }
  async #gitFacts(worktree: string, base: string | null): Promise<{head: string | null; changedFiles: string[]}> {
    let head: string | null = null, changedFiles: string[] = [];
    try {
      head = await this.#git(worktree, ['rev-parse', 'HEAD']); if (!SHA.test(head)) head = null;
      const status = await this.#git(worktree, ['status', '--porcelain', '--untracked-files=all'], {trim: false});
      changedFiles = status.split('\n').map(line => line.trimEnd()).filter(Boolean).map(line => line.slice(3).trim()).filter(Boolean);
      if (base !== null && head !== null && head !== base) changedFiles = [...new Set([...(await this.#git(worktree, ['diff', '--name-only', `${base}..${head}`])).split('\n').filter(Boolean), ...changedFiles])];
    } catch {this.log('coding-worker: git facts unavailable after the run');}
    return {head, changedFiles};
  }
  async #run(running: Running, repository: {name: string; path: string}, taskId: string, brief: string, bounds: CodingBounds, adapter: CodingAdapter): Promise<void> {
    await this.#progress(running, {operationId: running.operationId, status: 'started'});
    let worktree: string, base: string | null = null;
    try {
      // Runs on the same repository each get their own fresh worktree (Hub #2028); their git setup takes turns.
      ({worktree, base} = await this.#serially(repository.path, async () => {
        await stat(join(repository.path, '.git'));
        try {await this.#git(repository.path, ['fetch', '--quiet', 'origin', 'main'], {timeoutMs: 120_000});} catch {this.log('coding-worker: fetch failed; using the local origin/main');}
        const revision = await this.#git(repository.path, ['rev-parse', 'origin/main']), checked = SHA.test(revision) ? revision : null;
        const root = join(repository.path, '.local', 'worktrees'); await mkdir(root, {recursive: true, mode: 0o700});
        const fresh = join(root, `bunny-${taskId.slice(0, 8)}-${randomUUID().slice(0, 8)}`);
        await this.#git(repository.path, ['worktree', 'add', '--detach', '--quiet', fresh, checked ?? 'origin/main']);
        return {worktree: fresh, base: checked};
      }));
    } catch {
      await this.#progress(running, {operationId: running.operationId, status: 'failed', reason: 'worktree', result: assembleResult(repository.name, base, null, [], '', 'worktree').result}); return;
    }
    if (running.cancelled) {await this.#progress(running, {operationId: running.operationId, status: 'cancelled', reason: 'cancelled', result: null}); return;}
    await this.#runAdapter(running, adapter, repository.name, worktree, base, brief, bounds);
  }

  async #runClaude(input: AdapterRun): Promise<AdapterEvidence> {
    const {worktree, bounds, signal} = input;
    // Check the only project settings the child loads before admitting a run.
    const {refusal: settings, fingerprint: settingsBefore} = await readProjectSettings(worktree);
    if (settings !== undefined) return {reason: 'refused', summary: `The run was refused before the tool started: ${settings}. Workers use only the subscription sign-in.`};
    if (await this.#harness.subscriptionRefused?.() === true) {
      return {reason: 'refused', summary: 'Claude Code is unavailable or reports a sign-in other than the Claude subscription.'};
    }
    if (signal.aborted) return {reason: 'cancelled'};
    const {claude} = this.configuration;
    // The brief travels on stdin, never as an argument. The private turn cap can only lower the dispatch's. Only the
    // repository's own settings load, no MCP server, and the deny list applies whatever any setting allows.
    // The output is a stream of events (stream-json needs --verbose with --print), read as it arrives, so a usage limit
    // the tool reports mid-run is seen even when the run ends without a result.
    const args = ['--print', '--output-format', 'stream-json', '--verbose', '--json-schema', JSON.stringify(input.outputSchema), '--permission-mode', claude.permissionMode,
      '--max-turns', String(Math.min(claude.maxTurns ?? bounds.maxTurns, bounds.maxTurns)), '--max-budget-usd', String(bounds.budgetUsd),
      ...(claude.allowedTools.length === 0 ? [] : ['--allowedTools', ...claude.allowedTools]), '--disallowedTools', ...DENIED_TOOLS, '--strict-mcp-config', '--setting-sources', 'project',
      '--settings', JSON.stringify({env: Object.fromEntries(BLANKED_SWITCHES.map(name => [name, '']))}),
      ...(claude.model === undefined ? [] : ['--model', claude.model]),
      '--append-system-prompt', 'You are a delegated coding worker in a fresh worktree. Make only the change the brief asks for, run the checks the repository documents for it, never push, open a PR, change settings or leave the worktree, and end with the structured result: outcome, summary, checks, findings, limitations. If the brief leaves a choice open that you cannot settle from the repository, do not guess: end with outcome waiting-for-owner and put your one question first in findings.'];
    const stream = new ClaudeStream();
    let child: ChildProcess | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    let keyRefused: string | undefined;
    const stop = () => {
      if (child === undefined || killTimer !== undefined) return;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {child?.kill('SIGKILL');}, 10_000);
      killTimer.unref();
    };
    const watch = (line: string): void => {
      stream.push(line);
      const refusal = stream.credentialRefusal;
      if (keyRefused === undefined && refusal !== undefined) {keyRefused = refusal; stop();}
      const id = stream.sessionId;
      if (keyRefused === undefined && stream.apiKeySource === 'none' && id !== undefined) void input.session(id);
    };
    signal.addEventListener('abort', stop, {once: true});
    let finished: Awaited<ReturnType<Harness['start']>>;
    try {
      finished = await this.#harness.start(args, worktree, input.brief, process => {
        child = process;
        if (signal.aborted) stop();
      }, watch);
    } finally {
      signal.removeEventListener('abort', stop);
      if (killTimer !== undefined) clearTimeout(killTimer);
    }
    child = undefined;
    if (finished.stdout !== undefined) for (const line of finished.stdout.split('\n')) watch(line);
    const windows = stream.windows;
    if (keyRefused !== undefined) return {reason: 'refused', windows,
      summary: `The run was stopped at its ${stream.apiKeySource === undefined ? 'first work event' : 'first event'}: ${keyRefused}, and workers use only the subscription sign-in.`};
    const settingsChanged = (await readProjectSettings(worktree)).fingerprint !== settingsBefore;
    const assembled = assembleResult('', null, null, [], finished.truncated && stream.result === undefined ? '' : stream,
      finished.truncated && stream.result === undefined ? 'invalid-output' : undefined, settingsChanged);
    const {result} = assembled;
    const sessionId = stream.apiKeySource === 'none' ? stream.sessionId : undefined;
    const reason = assembled.reason ?? (stream.providers.some(provider => provider !== 'firstParty') ? 'refused' : finished.code === 0 ? undefined : 'exit');
    return {structured: result, windows, usage: result.usage,
      ...(reason === undefined ? {} : {reason}), ...(sessionId === undefined ? {} : {sessionId}),
      ...(result.limit === undefined ? {} : {limit: result.limit})};
  }
  async #runAdapter(running: Running, adapter: CodingAdapter, repository: string, worktree: string, base: string | null, brief: string, bounds: CodingBounds): Promise<void> {
    let timedOut = false, evidence: AdapterEvidence;
    const started = this.#now();
    running.timer = setTimeout(() => {timedOut = true; running.controller.abort();}, bounds.wallClockMs);
    try {
      evidence = await adapter.run({worktree, brief, bounds, outputSchema: RESULT_SCHEMA, signal: running.controller.signal,
        session: id => this.#session(running, id)});
    } catch {evidence = {reason: 'lost', uncertain: true};}
    finally {clearTimeout(running.timer); running.timer = undefined;}
    const endingSession = nativeSessionId(evidence.sessionId);
    if (running.sessionId === undefined && endingSession !== undefined) running.sessionId = endingSession;
    const health = this.#adapterHealth.get(adapter.id);
    if (health !== undefined && evidence.windows !== undefined && evidence.windows.length > 0) {
      this.#adapterHealth.set(adapter.id, {...health, limits: evidence.windows, limitsObservedAtMs: this.#now()});
      running.limitsChanged = true;
    }
    const {head, changedFiles} = await this.#gitFacts(worktree, base);
    if (adapter.id === CLAUDE && changedFiles.some(touchesSettingsDirectory) &&
      !structuredReport(evidence.structured).limitations.some(text => text.includes('project settings file'))) {
      evidence.limitations = ['The run created or changed files under .claude/, the project settings directory, which the settings check before the start did not see.'];
    }
    const reason = running.cancelled ? 'cancelled' : timedOut ? 'timeout' : evidence.reason;
    const result = assembleAdapterResult(repository, base, head, changedFiles, evidence, reason, running.sessionId, this.#now() - started);
    if (reason === undefined) {await this.#progress(running, {operationId: running.operationId, status: 'completed', result}); return;}
    const status = running.cancelled ? 'cancelled' : evidence.uncertain === true && !timedOut ? 'uncertain' : 'failed';
    await this.#progress(running, {operationId: running.operationId, status, reason, result});

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
