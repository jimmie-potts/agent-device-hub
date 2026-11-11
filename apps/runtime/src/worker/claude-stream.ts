// What the coding worker reads from headless Claude Code (Hub #1743): the `--output-format stream-json` events of a run,
// the tool's version and sign-in status for readiness, and the environment the harness starts with. Everything here is
// pure and bounded; it keeps only the values the worker reports and never a path, an account or the brief.
import type {CodingLimit, CodingLimitWindow, CodingReadiness} from '@jimmie-potts/event-contracts/v2/coding';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
/** The tool's snake_case names (`seven_day`, `allowed_warning`) as the contracts' kebab-case enum values; anything else is unknown. */
const enumValue = (value: unknown): string | undefined =>
  typeof value === 'string' && /^[A-Za-z][A-Za-z0-9]*(?:[_-][A-Za-z0-9]+)*$/.test(value) && value.length <= 64 ? value.toLowerCase().replaceAll('_', '-') : undefined;
/** The stream's reset times are Unix seconds; the contracts carry integer milliseconds. */
const resetMs = (value: unknown): number | null => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) < 1e11 ? Number(value) * 1000 : null;
const utilization = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
const STATUS: Readonly<Record<string, CodingLimitWindow['status']>> = {allowed: 'allowed', allowed_warning: 'allowed-warning', rejected: 'rejected'};
/** At most this many limit windows are kept, as the contracts allow. */
const MAX_WINDOWS = 8;

/**
 * One run's stream, fed line by line as the harness writes it. It keeps the final `result` event, the limit windows the
 * `rate_limit_event`s reported, and a usage limit when the tool said one stopped the run: a `rate_limit_event` whose
 * status is `rejected` without overage, or an assistant message the tool typed `usage_limit_reached`. A generic
 * `rate_limit` error without that type is not a usage limit (the tool uses it for throttling and policy refusals too).
 */
export class ClaudeStream {
  #result: Record<string, unknown> | undefined;
  #limit: CodingLimit | undefined;
  readonly #windows = new Map<string, CodingLimitWindow>();
  #apiKeySource: string | undefined;
  #unreadable = 0;
  /** Reads a whole recorded or buffered output, one event per line. */
  static of(output: string): ClaudeStream {
    const stream = new ClaudeStream();
    for (const line of output.split('\n')) stream.push(line);
    return stream;
  }
  push(line: string): void {
    const text = line.trim();
    if (text === '') return;
    let event: unknown;
    try {event = JSON.parse(text);} catch {this.#unreadable += 1; return;}
    if (!isRecord(event)) {this.#unreadable += 1; return;}
    if (event.type === 'system' && event.subtype === 'init' && typeof event.apiKeySource === 'string') this.#apiKeySource = event.apiKeySource;
    else if (event.type === 'rate_limit_event') this.#rateLimit(event.rate_limit_info, false);
    else if (event.type === 'assistant' && event.api_error === 'usage_limit_reached') this.#rateLimit(isRecord(event.api_error_params) ? event.api_error_params.rate_limit_info : undefined, true);
    else if (event.type === 'result') this.#result = event;
  }
  #rateLimit(info: unknown, refused: boolean): void {
    const record = isRecord(info) ? info : {};
    const limiting = enumValue(record.rateLimitType);
    const status = refused ? 'rejected' : STATUS[String(record.status)] ?? 'unknown';
    const seen = new Set<string>();
    for (const [name, window] of Object.entries(isRecord(record.unifiedWindows) ? record.unifiedWindows : {})) {
      const id = enumValue(name);
      if (id === undefined || !isRecord(window)) continue;
      seen.add(id);
      this.#window({window: id, status: id === limiting ? status : 'unknown', resetsAtMs: resetMs(window.resetsAt), utilization: utilization(window.utilization)});
    }
    if (limiting !== undefined && !seen.has(limiting)) {
      this.#window({window: limiting, status, resetsAtMs: resetMs(record.resetsAt), utilization: utilization(record.utilization)});
    }
    if (status === 'rejected' && record.isUsingOverage !== true) this.#limit = {window: limiting ?? null, resetsAtMs: resetMs(record.resetsAt)};
  }
  /** A later report of a window replaces what it states and keeps what it leaves out, so a refusal without figures keeps the last ones. */
  #window(window: CodingLimitWindow): void {
    const known = this.#windows.get(window.window);
    if (known === undefined && this.#windows.size >= MAX_WINDOWS) return;
    this.#windows.set(window.window, {window: window.window, status: window.status === 'unknown' ? known?.status ?? 'unknown' : window.status,
      resetsAtMs: window.resetsAtMs ?? known?.resetsAtMs ?? null, utilization: window.utilization ?? known?.utilization ?? null});
  }
  /** The run's final `result` event, or undefined when the stream ended without one. */
  get result(): Record<string, unknown> | undefined {return this.#result;}
  /** The usage limit the tool reported as stopping the run, with its window and reset or null where it gave none. */
  get limit(): CodingLimit | undefined {return this.#limit === undefined ? undefined : {...this.#limit};}
  /** The latest state of each limit window the run reported; empty when it reported none. */
  get windows(): CodingLimitWindow[] {return [...this.#windows.values()].map(window => ({...window}));}
  /** Where the harness said its API credential came from (`none` for a subscription sign-in), when it said. */
  get apiKeySource(): string | undefined {return this.#apiKeySource;}
  get unreadable(): number {return this.#unreadable;}
}

/** What the harness reports about itself without starting a task. */
export type HarnessReadiness = Pick<CodingReadiness, 'installed' | 'version' | 'signedIn' | 'plan'>;
export const UNKNOWN_READINESS: HarnessReadiness = Object.freeze({installed: 'unknown', version: null, signedIn: 'unknown', plan: null});

/** The version `claude --version` prints first (`2.1.292 (Claude Code)`), or null when it printed none. */
export function parseVersion(output: string): string | null {
  const match = /^\s*v?(\d+\.\d+\.\d+[0-9A-Za-z.+-]*)/.exec(output);
  return match?.[1] === undefined ? null : match[1].slice(0, 64);
}

/**
 * Sign-in and plan from `claude auth status --json`: `loggedIn` true or false is yes or no, anything else unknown. The plan
 * is the tool's subscription type while signed in, else null. Account, organization, e-mail and directories are not read.
 */
export function parseAuthStatus(output: string): Pick<HarnessReadiness, 'signedIn' | 'plan'> {
  let parsed: unknown;
  try {parsed = JSON.parse(output);} catch {return {signedIn: 'unknown', plan: null};}
  if (!isRecord(parsed) || typeof parsed.loggedIn !== 'boolean') return {signedIn: 'unknown', plan: null};
  if (!parsed.loggedIn) return {signedIn: 'no', plan: null};
  const plan = enumValue(parsed.subscriptionType);
  return {signedIn: 'yes', plan: plan !== undefined && /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(plan) ? plan : null};
}

/**
 * Variables that would make the harness use a credential, provider or endpoint other than the owner's subscription
 * sign-in, as the installed Claude Code reads them: every `ANTHROPIC_` variable (API key, auth token, base URLs, custom
 * headers, the Foundry and cloud keys), the `CLAUDE_CODE_USE_` provider switches (Bedrock, Vertex, Foundry and the
 * others), `CLAUDE_CODE_OAUTH_` tokens and `CLAUDE_CODE_API_KEY_` helpers, and the Bedrock bearer token. `BUNNY_`
 * variables are the worker's own and never reach the harness either.
 */
const STRIPPED = /^(?:ANTHROPIC_|CLAUDE_CODE_USE_|CLAUDE_CODE_OAUTH_|CLAUDE_CODE_API_KEY|AWS_BEARER_TOKEN_BEDROCK$|BUNNY_)/;
/** The environment the harness starts with: the worker's own, without provider credentials or switches. */
export function harnessEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(environment).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && !STRIPPED.test(entry[0].toUpperCase())));
}
