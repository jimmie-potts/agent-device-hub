// The host-local coding worker (Hub #502): one Node process on the owner's computer, started after sign-in, that holds
// the `coding-worker` credential, opens its one endpoint on the core's gateway and runs Claude Code headless in a fresh
// worktree of an allowlisted repository when the companions module hands it owner-approved work. It reports progress
// as occurrences and never resends, retries or claims more than it observed. The container gets no CLI and no
// repository; this process gets no state, no device and no dashboard authority.
import {spawn, type ChildProcess} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {mkdir, stat} from 'node:fs/promises';
import {isAbsolute, join, resolve} from 'node:path';
import {promisify} from 'node:util';
import {connectRemote, type RemoteEndpoint, type RemoteParticipant} from '@jimmie-potts/sdk/remote';
import {Outcome, type Command, type Reply} from '@jimmie-potts/sdk';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {CODING_WORKER_SOURCE, type CodingBounds, type CodingCheck, type CodingProgress, type CodingProgressReason, type CodingResult, type CodingWork} from '@jimmie-potts/event-contracts/v2/coding';
import {readPrivateJson} from '../hook/producer.js';
import {readPrivateFile} from '../state.js';

const run = promisify(execFile);
export const WORKER_SCHEMA = 'coding-worker/1.0';
const MAX_CONFIG_BYTES = 8192;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
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
  outcome: {type: 'string', enum: ['tested-candidate', 'incomplete', 'failed']},
  summary: {type: 'string', description: 'What changed and what was verified, in a few sentences.'},
  checks: {type: 'array', items: {type: 'object', additionalProperties: false, required: ['name', 'status'], properties: {name: {type: 'string'}, status: {type: 'string', enum: ['passed', 'failed', 'skipped', 'unrun', 'unknown']}, detail: {type: 'string'}}}},
  findings: {type: 'array', items: {type: 'string'}, description: 'Unresolved problems, questions for the owner, or refused actions.'},
  limitations: {type: 'array', items: {type: 'string'}},
}};

export type WorkerConfiguration = {
  edge: string; tokenFile: string;
  repositories: readonly {name: string; path: string}[];
  claude: {executable: string; model?: string; permissionMode: string; allowedTools: readonly string[]; maxTurns?: number};
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
  return {edge: url.origin, tokenFile, repositories: list, claude: {executable: claude.executable, ...(claude.model === undefined ? {} : {model: claude.model}), permissionMode, allowedTools: allowedTools as string[], ...(claude.maxTurns === undefined ? {} : {maxTurns: Number(claude.maxTurns)})}};
}

type Running = {operationId: string; child: ChildProcess | undefined; cancelled: boolean; timer: ReturnType<typeof setTimeout> | undefined};
export type Harness = {
  /**
   * Runs the headless harness in `cwd` with the brief on its standard input and resolves with its exit code and collected
   * stdout; the worker kills it on cancel or deadline. The brief never becomes an argument, so a brief that starts with a
   * dash cannot be read as an option and it never shows in the process list.
   */
  start(args: string[], cwd: string, input: string, onChild: (child: ChildProcess) => void): Promise<{code: number | null; signal: string | null; stdout: string; truncated: boolean}>;
};
const realHarness = (executable: string): Harness => ({start: (args, cwd, input, onChild) => new Promise(resolvePromise => {
  const child = spawn(executable, args, {cwd, stdio: ['pipe', 'pipe', 'ignore'], env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('BUNNY_')))});
  onChild(child);
  child.stdin?.on('error', () => {});
  child.stdin?.end(input);
  const chunks: Buffer[] = []; let size = 0, truncated = false;
  child.stdout?.on('data', (chunk: Buffer) => {if (size + chunk.length > MAX_OUTPUT_BYTES) {truncated = true; return;} chunks.push(chunk); size += chunk.length;});
  child.on('error', () => {resolvePromise({code: null, signal: null, stdout: '', truncated});});
  child.on('close', (code, signal) => {resolvePromise({code, signal, stdout: Buffer.concat(chunks).toString('utf8'), truncated});});
})});

const bounded = (value: unknown, max: number): string | undefined => typeof value === 'string' && value.trim() !== '' ? value.slice(0, max) : undefined;
/** The result from Claude Code's `--output-format json` envelope and the git facts the worker observed itself. */
export function assembleResult(repository: string, base: string | null, head: string | null, changedFiles: string[], output: string, given?: CodingProgressReason): {result: CodingResult; reason?: CodingProgressReason} {
  let envelope: Record<string, unknown> | undefined, structured: Record<string, unknown> | undefined, reason: CodingProgressReason | undefined = given;
  try {
    const parsed: unknown = JSON.parse(output);
    if (isRecord(parsed)) {
      envelope = parsed;
      const candidate = isRecord(parsed.structured_output) ? parsed.structured_output : (() => {try {const inner: unknown = JSON.parse(typeof parsed.result === 'string' ? parsed.result : ''); return isRecord(inner) ? inner : undefined;} catch {return undefined;}})();
      structured = candidate;
    }
  } catch { /* no envelope: the result below says so */ }
  const outcome = structured !== undefined && ['tested-candidate', 'incomplete', Outcome.failed].includes(String(structured.outcome)) ? structured.outcome as CodingResult['outcome'] : 'incomplete';
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
  const summary = bounded(structured?.summary, 4096) ?? (envelope === undefined ? 'The harness produced no readable result envelope.' : bounded(envelope.result, 4096) ?? 'The harness ended without a summary.');
  const limitations = strings(structured?.limitations);
  if (structured === undefined) limitations.push('No structured result was returned; the summary is the harness text or absent.');
  return {result: {outcome: reason === undefined ? outcome : Outcome.failed, repository, base, head, changedFiles: changedFiles.slice(0, 200).map(file => file.slice(0, 512)), checks,
    findings: strings(structured?.findings), limitations, summary, sessionId, usage}, ...(reason === undefined ? {} : {reason})};
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
  /** `log` is the process's own line writer, owned by the entry point; the library writes nothing itself. */
  constructor(readonly configuration: WorkerConfiguration, readonly token: string, harness?: Harness, readonly log: (line: string) => void = () => {}, connect: typeof connectRemote = connectRemote) {
    this.#harness = harness ?? realHarness(configuration.claude.executable);
    this.#connect = connect;
  }
  #stopping = false;
  #redeclaring = false;
  async start(): Promise<void> {
    this.#participant = await this.#connect({url: this.configuration.edge, token: this.token, source: CODING_WORKER_SOURCE,
      onDiagnostic: diagnostic => {
        this.log(`coding-worker ${diagnostic.event}`);
        // A lost stream closed the connection-bound endpoint; the new stream needs a fresh declaration, which the core hears as a new endpoint.
        if (diagnostic.event === 'remote.reconnected' && !this.#stopping) void this.#redeclare();
      }});
    await this.#declare();
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
  /** Opens the one endpoint on the current stream and declares it available; a refused declaration closes the endpoint again and throws. */
  async #declare(): Promise<void> {
    const participant = this.#participant;
    if (participant === undefined) throw new Error('coding-worker: not connected');
    if (this.#endpoint !== undefined) return;
    const endpoint = await participant.openEndpoint<CodingWork>({family: 'coding-work', respond: command => this.#work(command), onClosed: () => {
      if (this.#endpoint === endpoint) this.#endpoint = undefined;
      this.log('coding-worker endpoint closed; the running task, if any, is lost to the core and will be stopped');
      this.#stopChild();
    }});
    this.#endpoint = endpoint;
    const answer = await endpoint.request('coding-endpoint', {type: 'org.bunny.coding.endpoint.requested', dataschema: 'https://bunny.invalid/events/coding-endpoint/2.0',
      data: {requestId: randomUUID(), action: 'enable'}}, {timeoutMs: 5000}).catch(() => ({status: 'uncertain' as const}));
    if (answer.status !== 'accepted') {
      if (this.#endpoint === endpoint) this.#endpoint = undefined;
      await endpoint.close().catch(() => {});
      throw new Error(`coding-worker-enable-refused: ${answer.status === 'rejected' ? answer.error.error.code : 'uncertain'}`);
    }
    this.log(`coding-worker available as endpoint ${endpoint.id}`);
  }
  async stop(): Promise<void> {
    this.#stopping = true;
    this.#stopChild();
    try {await this.#endpoint?.request('coding-endpoint', {type: 'org.bunny.coding.endpoint.requested', dataschema: 'https://bunny.invalid/events/coding-endpoint/2.0',
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
    queueMicrotask(() => {void this.#run(running, repository, data.taskId, data.brief, data.bounds).finally(() => {if (this.#running === running) this.#running = undefined;});});
    return {status: 'accepted'};
  }
  async #progress(data: CodingProgress): Promise<void> {
    try {await this.#endpoint?.publish('coding-progress', {kind: 'occurrence', type: 'org.bunny.coding.progress.observed', dataschema: 'https://bunny.invalid/events/coding-progress/2.0', data});}
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
    const {claude} = this.configuration;
    // The brief travels on stdin, never as an argument. The private turn cap can only lower the dispatch's. Only the
    // repository's own settings load, no MCP server, and the deny list applies whatever any setting allows.
    const args = ['--print', '--output-format', 'json', '--json-schema', JSON.stringify(RESULT_SCHEMA), '--permission-mode', claude.permissionMode,
      '--max-turns', String(Math.min(claude.maxTurns ?? bounds.maxTurns, bounds.maxTurns)), '--max-budget-usd', String(bounds.budgetUsd),
      ...(claude.allowedTools.length === 0 ? [] : ['--allowedTools', ...claude.allowedTools]), '--disallowedTools', ...DENIED_TOOLS, '--strict-mcp-config', '--setting-sources', 'project',
      ...(claude.model === undefined ? [] : ['--model', claude.model]),
      '--append-system-prompt', 'You are a delegated coding worker in a fresh worktree. Make only the change the brief asks for, run the checks the repository documents for it, never push, open a PR, change settings or leave the worktree, and end with the structured result: outcome, summary, checks, findings, limitations.'];
    let timedOut = false;
    const started = Date.now();
    const finished = await this.#harness.start(args, worktree, brief, child => {
      running.child = child;
      running.timer = setTimeout(() => {timedOut = true; child.kill('SIGTERM'); setTimeout(() => {child.kill('SIGKILL');}, 10_000).unref();}, bounds.wallClockMs);
    });
    if (running.timer !== undefined) {clearTimeout(running.timer); running.timer = undefined;}
    let head: string | null = null, changedFiles: string[] = [];
    try {
      head = await git(worktree, ['rev-parse', 'HEAD']); if (!SHA.test(head)) head = null;
      // Porcelain lines are two status letters, a space and the path; the first line's leading space is part of the status, so the output is not trimmed.
      const status = await git(worktree, ['status', '--porcelain', '--untracked-files=all'], {trim: false});
      changedFiles = status.split('\n').map(line => line.trimEnd()).filter(Boolean).map(line => line.slice(3).trim()).filter(Boolean);
      if (base !== null && head !== null && head !== base) changedFiles = [...new Set([...(await git(worktree, ['diff', '--name-only', `${base}..${head}`])).split('\n').filter(Boolean), ...changedFiles])];
    } catch {this.log('coding-worker: git facts unavailable after the run');}
    if (running.cancelled) {await this.#progress({operationId: running.operationId, status: 'cancelled', reason: 'cancelled', result: assembleResult(repository.name, base, head, changedFiles, finished.stdout, 'cancelled').result}); return;}
    if (timedOut) {await this.#progress({operationId: running.operationId, status: 'failed', reason: 'timeout', result: assembleResult(repository.name, base, head, changedFiles, finished.stdout, 'timeout').result}); return;}
    if (finished.truncated) {await this.#progress({operationId: running.operationId, status: 'failed', reason: 'invalid-output', result: assembleResult(repository.name, base, head, changedFiles, '', 'invalid-output').result}); return;}
    const assembled = assembleResult(repository.name, base, head, changedFiles, finished.stdout);
    if (assembled.result.usage !== null && assembled.result.usage.durationMs === null) assembled.result.usage.durationMs = Date.now() - started;
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
