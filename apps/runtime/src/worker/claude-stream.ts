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
  /** The providers the final result's per-model usage names (`firstParty` for the subscription), as bounded names. */
  get providers(): string[] {
    const usage = this.#result?.modelUsage;
    if (!isRecord(usage)) return [];
    return [...new Set(Object.values(usage).flatMap(model => isRecord(model) && typeof model.provider === 'string'
      ? [/^[A-Za-z0-9_-]{1,32}$/.test(model.provider) ? model.provider : 'unnamed'] : []))];
  }
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
 * Sign-in and plan from `claude auth status --json`. Signed in is `yes` only for the subscription sign-in: `loggedIn` true
 * with `authMethod` `claude.ai` and `apiProvider` `firstParty`. A sign-in by API key, helper or cloud provider is
 * `unknown`, never read as the subscription; `loggedIn` false is `no`. The plan is the subscription type, only with
 * `yes`. Account, organization, e-mail and directories are not read.
 */
export function parseAuthStatus(output: string): Pick<HarnessReadiness, 'signedIn' | 'plan'> {
  let parsed: unknown;
  try {parsed = JSON.parse(output);} catch {return {signedIn: 'unknown', plan: null};}
  if (!isRecord(parsed) || typeof parsed.loggedIn !== 'boolean') return {signedIn: 'unknown', plan: null};
  if (!parsed.loggedIn) return {signedIn: 'no', plan: null};
  if (parsed.authMethod !== 'claude.ai' || parsed.apiProvider !== 'firstParty') return {signedIn: 'unknown', plan: null};
  const plan = enumValue(parsed.subscriptionType);
  return {signedIn: 'yes', plan: plan !== undefined && /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(plan) ? plan : null};
}

/**
 * What the harness may inherit: what a command-line tool needs to run (search path, home, user, shell, locale, temporary
 * directory, terminal, time zone) and `CLAUDE_CODE_OAUTH_TOKEN`, the subscription sign-in token `claude setup-token`
 * makes, which a host without a keychain sign-in uses. Anything else reaches the harness only when the private worker
 * configuration names it (`claude.environment`), and never when the denylist below matches it.
 */
const ALLOWED = /^(?:PATH|HOME|USER|LOGNAME|SHELL|TMPDIR|LANG|LANGUAGE|LC_[A-Z_]+|TERM|TZ|CLAUDE_CODE_OAUTH_TOKEN)$/;
/**
 * The second pass, which also bounds what the configuration may add: every `ANTHROPIC_` variable (API keys, auth tokens,
 * base URLs, custom headers, provider settings and the model names, which the worker configuration sets instead), the
 * `CLAUDE_CODE_USE_` provider switches, the OAuth refresh token and scopes (read only by an interactive login), the
 * API-key descriptors and helpers, client certificates, skipped-auth switches, the configuration-directory selector, cloud
 * credentials (`AWS_`, `GOOGLE_`, `GCLOUD_`, `CLOUD_ML_REGION`, `VERTEX_REGION_`, `AZURE_`), proxies, extra CA
 * certificates, `NODE_OPTIONS`, the host-managed provider switch, and the worker's own `BUNNY_` variables.
 */
const DENIED = /^(?:ANTHROPIC_|CLAUDE_CODE_USE_|CLAUDE_CODE_OAUTH_(?!TOKEN$)|CLAUDE_CODE_API_KEY|CLAUDE_CODE_CLIENT_|CLAUDE_CODE_CERT_STORE$|CLAUDE_CODE_SKIP_|CLAUDE_CODE_PROVIDER_|CLAUDE_CONFIG_DIR$|AWS_|GOOGLE_|GCLOUD_|CLOUDSDK_|CLOUD_ML_REGION$|VERTEX_REGION_|AZURE_|HTTPS?_PROXY$|ALL_PROXY$|NO_PROXY$|NODE_EXTRA_CA_CERTS$|NODE_OPTIONS$|NODE_TLS_|SSL_CERT_|BUNNY_)/;
/** Whether a variable name may never reach the harness, whatever the configuration says. */
export const deniedVariable = (name: string): boolean => DENIED.test(name.toUpperCase());
/**
 * Whether the configuration may add a name: not denied, not named like a key, token, secret, password, credential or base
 * URL (the settings check's rule, so a GitHub token or another provider's key never reaches the agent's commands), and
 * not a dynamic-loader variable (`DYLD_`, `LD_`). The subscription token, already allowlisted, is the one exception.
 */
export const configurableVariable = (name: string): boolean =>
  name === 'CLAUDE_CODE_OAUTH_TOKEN' || (!deniedVariable(name) && !CREDENTIAL_NAME.test(name) && !/^(?:DYLD_|LD_)/i.test(name));
/** The environment the harness and its probes start with: the allowlist plus configurable configured names, minus the denylist. */
export function harnessEnvironment(environment: NodeJS.ProcessEnv, configured: readonly string[] = []): Record<string, string> {
  return Object.fromEntries(Object.entries(environment).filter((entry): entry is [string, string] =>
    typeof entry[1] === 'string' && (ALLOWED.test(entry[0]) || (configured.includes(entry[0]) && configurableVariable(entry[0]))) && !deniedVariable(entry[0])));
}

/** Settings keys that run a command to obtain a credential; the worker never executes them, it refuses the run. */
const CREDENTIAL_HELPERS = ['apiKeyHelper', 'awsAuthRefresh', 'awsCredentialExport', 'gcpAuthRefresh'];
/** A settings `env` name that carries a key, token, secret or endpoint (whole words, so `MAX_THINKING_TOKENS` is not one). */
const CREDENTIAL_NAME = /(?:^|_)(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIALS?|BASE_URL)(?:_|$)/i;
/**
 * Why project settings would undo the harness environment, or undefined when they would not. `text` is one settings file
 * the run loads, or undefined when it is absent. Settings are data here: nothing in them is executed. A file that is not a
 * JSON object is a refusal, because the tool might read it differently. Only setting names enter the reason, never values.
 */
export function settingsRefusal(file: string, text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  let parsed: unknown;
  try {parsed = JSON.parse(text);} catch {return `${file} is not valid JSON`;}
  if (!isRecord(parsed)) return `${file} is not a JSON object`;
  const helpers = CREDENTIAL_HELPERS.filter(key => key in parsed);
  if (helpers.length > 0) return `${file} sets the credential helper ${helpers.join(', ')}`;
  if (parsed.env === undefined) return undefined;
  if (!isRecord(parsed.env)) return `${file} has an env member that is not an object`;
  const names = Object.keys(parsed.env).filter(name => deniedVariable(name) || CREDENTIAL_NAME.test(name)).map(name => /^[A-Za-z0-9_]{1,64}$/.test(name) ? name : 'an unnamed variable');
  return names.length === 0 ? undefined : `${file} sets the provider or credential variable ${names.slice(0, 8).join(', ')}`;
}
/**
 * The provider switches the run blanks through `--settings`, which the tool ranks above project settings; its
 * documentation counts an empty value as unset for provider selection. Keys, tokens and base URLs are refused instead.
 */
export const BLANKED_SWITCHES = ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDE_CODE_USE_MANTLE', 'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  'CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD', 'CLAUDE_CODE_USE_GATEWAY'] as const;
