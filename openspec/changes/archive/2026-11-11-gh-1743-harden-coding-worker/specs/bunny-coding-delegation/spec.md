## ADDED Requirements

### Requirement: Worker readiness without side effects

The worker SHALL produce a readiness record without starting a task or a session and without spending: the tool's version, whether it is installed (`yes`, `no` or `unknown`), whether it is signed in (`yes` only for the subscription sign-in, `no` when the tool says it is signed out, `unknown` for any other sign-in or no answer), the plan where the tool reports one, and the limit windows with their reset times that the latest run reported, with when they were observed, or null before any. It SHALL read only the sign-in state, sign-in method, provider and plan from the tool's status, never the account, organization, e-mail or directories, SHALL run each probe with the harness's environment and kill it outright at its deadline, and SHALL report `unknown` or null wherever the tool did not say or the probe failed. The worker SHALL send the record with its enable declaration (`coding-endpoint/2.1`) and, after a run that reported limit windows, once more in an enable from the selected endpoint, never retried. The companions module SHALL record the selected endpoint's latest record in `coding-state/2.1`, change the revision only when it changed, and clear it when the endpoint is disabled or lost. A readiness report from the selected endpoint SHALL NOT move the revision a pending delegation proposal is bound to.

#### Scenario: Readiness of an installed, signed-in tool
- **WHEN** the worker starts with the tool installed and signed in to a subscription
- **THEN** its declaration carries the tool's version, signed in `yes` and the plan, with limits null, and the coding state shows the same record

#### Scenario: Tool missing or signed out
- **WHEN** the configured executable does not exist, or the tool's status says it is not signed in
- **THEN** the readiness says `installed: no`, or `signedIn: no`, and nothing else is guessed

#### Scenario: Limits after a run
- **WHEN** a run's stream reported limit windows
- **THEN** the worker sends one more enable whose readiness carries those windows and when they were observed, and the coding state records it without changing the selected endpoint

## MODIFIED Requirements

### Requirement: Truthful structured results

The worker SHALL run the harness only in a fresh worktree of an allowlisted repository, with worktree-only edit permission, a bounded tool allowlist without push, network or destructive tools, a fixed deny list the harness enforces over any allow (push, remotes, worktrees, GitHub, nested harnesses, network shells, privilege and settings edits), no MCP server and only the repository's own settings, and the dispatch's turn, budget and wall-clock bounds, where a private turn cap may only lower the dispatch's. The brief SHALL reach the harness as its input, never as an argument. Workers SHALL use the owner's subscription sign-in only. The harness and its readiness probes SHALL inherit only an allowlisted environment (search path, home, user, shell, locale, temporary directory, terminal, time zone and the subscription token `CLAUDE_CODE_OAUTH_TOKEN`) plus variable names the private configuration lists, which SHALL NOT be named like a key, token, secret, password, credential, base URL, personal access token, private key or auth value, nor be the SSH agent socket, a git or SSH helper or a dynamic-loader variable, except the subscription token (a rule against mistakes in the owner's own list, not a security boundary), and never a provider credential, provider switch, base URL, OAuth refresh token or scopes, API-key helper or descriptor, client certificate, cloud credential, proxy, certificate setting, `NODE_OPTIONS` or configuration-directory selector, whatever the configuration lists. Before the tool starts, the worker SHALL read the worktree's project settings as data, executing nothing in them, and SHALL refuse the run with reason `refused` when they set a credential helper, set a provider or credential variable in `env`, or are not a JSON object; the run SHALL also blank the provider switches through the tool's higher-ranked settings argument. When the stream's first event reports an API key source other than `none`, the worker SHALL stop the run at that event and report it failed with reason `refused`, so that at most the request already in flight is spent, and SHALL stop it the same way when an assistant or result event arrives before any readable key source; a result naming a model provider other than the first-party one, or a run that created, changed or removed a project settings file (compared with what the check read) or changed files under the project settings directory in any letter case, SHALL be stated as a limitation. The worker SHALL read the harness's output as a stream of events as it arrives. The worker SHALL report started as soon as it takes the work, before the fetch and worktree, so the hand-off's tracked outcome lands within the dispatcher's budget; a worktree that then fails is reported failed with that reason. Its result SHALL carry the outcome, summary, checks, findings and limitations the harness reported, bounded, together with the base and head revisions and changed files the worker observed through git itself, the harness session identity, and usage or unknown. A run whose stream reported a usage limit, and that neither ended with a successful structured result nor stopped at its own budget or turn cap, SHALL end failed with reason and outcome `usage-limit` and the window and reset time the tool gave, or null where it gave none; a generic rate-limit error SHALL NOT count as a usage limit. A run that asks the owner a question SHALL complete with outcome `waiting-for-owner` and the question first among its findings. A refused repository, a failed worktree, a harness exit, a timeout, cancellation or unreadable output SHALL be reported with its reason; nothing SHALL be claimed beyond what was observed, nothing SHALL be retried automatically, and no path or brief SHALL enter a diagnostic record.

#### Scenario: Result from a fresh worktree
- **WHEN** the worker runs a start for an allowlisted repository
- **THEN** it reports started, creates a worktree from the repository's main, runs the harness with the bounds and the deny list, and reports completed with the observed base, head and changed files beside the harness's structured output

#### Scenario: Cancel and failure
- **WHEN** the module sends a cancel, or the harness exits with an error or outlives the wall clock
- **THEN** the worker stops the harness and reports cancelled, exit or timeout with the facts it has, and a second task is refused while one runs

#### Scenario: Usage limit
- **WHEN** the stream reports a rejected rate limit or a message typed as a usage limit, and the run ends without a successful structured result
- **THEN** the worker reports failed with reason `usage-limit`, outcome `usage-limit` and the window and reset time the tool gave, or null where it gave none, and the task is told so without a retry

#### Scenario: A question for the owner
- **WHEN** the harness ends with the `waiting-for-owner` outcome
- **THEN** the worker reports completed with that outcome and the question first among the findings

#### Scenario: API key in the worker's environment
- **WHEN** the worker's environment holds a provider API key, token or provider switch
- **THEN** the harness and its readiness probes start without it, while a subscription token in `CLAUDE_CODE_OAUTH_TOKEN` is kept

#### Scenario: Project settings that would undo the environment
- **WHEN** the worktree's project settings set a credential helper or a provider or credential variable in `env`, or are not a JSON object
- **THEN** the run is refused with reason `refused` before the tool starts, naming the setting but never its value, and nothing is spent

#### Scenario: An API key source at the first event
- **WHEN** the stream's first event names an API key source other than `none`
- **THEN** the worker stops the tool at that event, so that at most the request already in flight is spent, and reports failed with reason `refused`
