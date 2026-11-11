## ADDED Requirements

### Requirement: Worker readiness without side effects

The worker SHALL produce a readiness record without starting a task or a session and without spending: the tool's version, whether it is installed (`yes`, `no` or `unknown`), whether it is signed in (`yes`, `no` or `unknown`), the plan where the tool reports one, and the limit windows with their reset times that the latest run reported, with when they were observed, or null before any. It SHALL read only the sign-in state and plan from the tool's status, never the account, organization, e-mail or directories, and SHALL report `unknown` or null wherever the tool did not say or the probe failed. The worker SHALL send the record with its enable declaration (`coding-endpoint/2.1`) and, after a run that reported limit windows, once more in an enable from the selected endpoint, never retried. The companions module SHALL record the selected endpoint's latest record in `coding-state/2.1`, change the revision only when it changed, and clear it when the endpoint is disabled or lost. A readiness report from the selected endpoint SHALL NOT move the revision a pending delegation proposal is bound to.

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

The worker SHALL run the harness only in a fresh worktree of an allowlisted repository, with worktree-only edit permission, a bounded tool allowlist without push, network or destructive tools, a fixed deny list the harness enforces over any allow (push, remotes, worktrees, GitHub, nested harnesses, network shells, privilege and settings edits), no MCP server and only the repository's own settings, and the dispatch's turn, budget and wall-clock bounds, where a private turn cap may only lower the dispatch's. The brief SHALL reach the harness as its input, never as an argument. The harness and its readiness probes SHALL start without provider credentials or provider switches in their environment (every `ANTHROPIC_` variable, the `CLAUDE_CODE_USE_` switches, `CLAUDE_CODE_OAUTH_` tokens, `CLAUDE_CODE_API_KEY_` helpers and the Bedrock bearer token), so the owner's subscription sign-in is what it uses; an API key source the harness still reports SHALL be stated as a limitation. The worker SHALL read the harness's output as a stream of events as it arrives. The worker SHALL report started as soon as it takes the work, before the fetch and worktree, so the hand-off's tracked outcome lands within the dispatcher's budget; a worktree that then fails is reported failed with that reason. Its result SHALL carry the outcome, summary, checks, findings and limitations the harness reported, bounded, together with the base and head revisions and changed files the worker observed through git itself, the harness session identity, and usage or unknown. A run whose stream reported a usage limit, and that did not end with a successful structured result, SHALL end failed with reason and outcome `usage-limit` and the window and reset time the tool gave, or null where it gave none; a generic rate-limit error SHALL NOT count as a usage limit. A run that asks the owner a question SHALL complete with outcome `waiting-for-owner` and the question first among its findings. A refused repository, a failed worktree, a harness exit, a timeout, cancellation or unreadable output SHALL be reported with its reason; nothing SHALL be claimed beyond what was observed, nothing SHALL be retried automatically, and no path or brief SHALL enter a diagnostic record.

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
- **THEN** the harness and its readiness probes start without it
