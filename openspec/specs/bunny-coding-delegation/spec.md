# Bunny coding delegation specification

## Purpose

Let the owner hand one bounded coding task from the B.U.N.N.Y. conversation to a worker on their own computer through the core's tracked dispatcher, with the worker's authority limited to its endpoint and a truthful structured result, without a second runtime, a CLI in the container or unattended merge authority.

## Requirements

### Requirement: Worker credential and endpoint

A coding worker SHALL act through a credential with the `coding-worker` role, bound to the `bunny/parts/coding-worker` source with no ordinary scope. The edge SHALL grant that credential exactly one connection-bound endpoint: answering `coding-work`, publishing `coding-progress` and requesting `coding-endpoint`, with no subscription, sync, operator command or other publication. The worker SHALL declare its availability explicitly after connecting, and a worker from Hub #2028 SHALL declare its three slots with it (`coding-endpoint/2.2`); a lost connection SHALL be reported by the gateway as `coding-lost`, and reconnecting SHALL require a fresh declaration. When its endpoint closes, the worker SHALL stop every run that endpoint started, including one whose tool starts after the stop, keep each in its slot, where a cancel or a stop still reaches it, until it ends, declare its next endpoint once they have ended or after a bound of fifteen seconds, after which a run still alive keeps only its own companion's slot busy, and send no report of those runs on another endpoint. The gateway SHALL refuse any direct dispatch of a `coding-*` family.

#### Scenario: Endpoint-only authority
- **WHEN** a credential carries the coding-worker role
- **THEN** it may answer work, publish progress and declare its endpoint, and it is refused every state read, sync, device command and other publication

#### Scenario: Lost worker
- **WHEN** the worker's connection closes while operations are running
- **THEN** the gateway reports the endpoint lost, each of its operations ends uncertain on its own and its task is told so, and no second start is sent

#### Scenario: Slots free on the next endpoint
- **WHEN** the worker's endpoint closes with three runs, one of whose tools starts only after the close
- **THEN** that tool is stopped as it starts, no second start for its companion is taken while it lives, the fresh endpoint is declared once the stopped runs have ended and accepts a start for each companion, and no report of a stopped run goes out on it

#### Scenario: A stopped run that never ends
- **WHEN** a stopped run's output stays held open by a leftover process
- **THEN** the worker declares its fresh endpoint after the bound, refuses that companion's start with `capacity` until the run ends, and accepts the other companions' starts

### Requirement: Tracked dispatch and one slot per companion

An approved delegation SHALL go from the companions module to the core as `coding-dispatch` and through the core's tracked dispatcher as one `coding-run` operation the module answers. The worker SHALL hold one slot per companion (B.U.N.N.Y., Reachy and MicroDuck) and at most three runs at once, and SHALL refuse a start with `capacity` when that companion's slot or every slot is busy. The module SHALL tag each run with the companion whose task asked, send the worker the start with that companion (`coding-work/2.1`), and send a worker that declared no slots the untagged 2.0 start while counting it as one slot shared by every companion. The module SHALL save its responsibility before sending one `coding-work` start to the worker endpoint, SHALL refuse a dispatch whose companion's slot is busy with `capacity`, and SHALL report the tracked outcome succeeded (observed) when the worker reports it started, failed when the start is refused, and uncertain when no start arrives within twenty seconds. An approved hand-off whose companion's slot is busy, or already has hand-offs waiting, SHALL wait durably, first in first out per slot and at most 32 at once, without being sent; when the slot frees and a worker is selected, the module SHALL send the oldest one once through the core's tracked dispatcher with its own request ID, and a refused or unanswered dispatch SHALL end its wait and reach its task as failed with the code or uncertain, without a retry. Stopping a named unsent job SHALL remove its waiting attempt without sending it. A stop saved before a sending attempt reaches the responder SHALL refuse the worker start when that responder sees it. A pre-change hand-off that still depends on its task SHALL keep the task's cancellation and wait guard. Runs on the same repository at once SHALL each use their own fresh worktree. The worker's completion, failure, cancellation or uncertainty SHALL settle only its own responsibility and reach the original exchange, or the task's saved delegation interrupt for an earlier record without a second tracked outcome; a cancel, a timeout or a lost endpoint SHALL settle only the operations it names or holds. Restart SHALL settle each pending responsibility as uncertain and resend nothing; a waiting hand-off that was never sent SHALL keep its place and be sent when its slot is free, and one whose dispatch had left without its acceptance recorded SHALL end uncertain and never be sent again. Startup settlement SHALL publish the saved evidence without starting a Conversation turn. The coding state (`coding-state/2.2`) SHALL list the selected worker's declared slots, every active run with its companion and status, and the waiting hand-offs, oldest first, and keep `active` as the oldest run. Bounds of twenty minutes, sixty turns and five dollars per task SHALL travel with each dispatch.

#### Scenario: Handed to the worker
- **WHEN** the owner approves a delegation and the worker reports it started
- **THEN** the core's operation completes succeeded with observed evidence, the coding state lists the running task with its companion, and another dispatch for that companion is refused with capacity until the worker reports an end

#### Scenario: Three companions at once
- **WHEN** B.U.N.N.Y., Reachy and MicroDuck each have an approved hand-off for a three-slot worker
- **THEN** three starts reach the worker at once, each tagged with its companion, the coding state lists three runs, and each result reaches only its own task

#### Scenario: A further hand-off waits for its own slot
- **WHEN** a companion's hand-off is approved while that companion's run holds its slot
- **THEN** nothing is sent for it, the coding state lists it as waiting, another companion's run ending sends nothing, and its own slot freeing sends it once

#### Scenario: Cancel a waiting hand-off
- **WHEN** the owner stops a named job whose hand-off waits for its slot, whether the coordinator hears the cancel at once, while the hand-off's dispatch is on its way, or only after a restart
- **THEN** nothing runs for it, its task hears nothing more, and the slot freeing later sends nothing for it

#### Scenario: Restart never resends
- **WHEN** the runtime restarts with a responsibility the worker had not finished and a never-sent waiting hand-off behind it
- **THEN** the responsibility is settled uncertain and its task hears so as a start-time settlement, availability starts off, the waiting hand-off is sent once when a worker declares and its slot is free, and a later enable or restart sends neither again

#### Scenario: Restart with a dispatch on its way
- **WHEN** the runtime stops after a waiting hand-off's dispatch left and before its acceptance was recorded
- **THEN** the next start ends that hand-off uncertain, tells its task as a start-time settlement and never sends it again

#### Scenario: An older worker
- **WHEN** the selected worker declared no slots
- **THEN** it receives untagged 2.0 starts, one run at a time for every companion, and another companion's approved hand-off waits for that run to end

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

### Requirement: Worker readiness without side effects

The worker SHALL produce a readiness record without starting a task or a session and without spending: the tool's version, whether it is installed (`yes`, `no` or `unknown`), whether it is signed in (`yes` only for the subscription sign-in, `no` when the tool says it is signed out, `unknown` for any other sign-in or no answer), the plan where the tool reports one, and the limit windows with their reset times that the latest run reported, with when they were observed, or null before any. It SHALL read only the sign-in state, sign-in method, provider and plan from the tool's status, never the account, organization, e-mail or directories, SHALL run each probe with the harness's environment and kill it outright at its deadline, and SHALL report `unknown` or null wherever the tool did not say or the probe failed. The worker SHALL send the record with its enable declaration (`coding-endpoint/2.1`, or 2.2 with its slots from Hub #2028) and, after a run that reported limit windows, once more in an enable from the selected endpoint, never retried. The companions module SHALL record the selected endpoint's latest record in `coding-state/2.1` and later (`coding-state/2.2` from Hub #2028), change the revision only when it changed, and clear it when the endpoint is disabled or lost. A readiness report from the selected endpoint SHALL NOT move the revision a pending delegation proposal is bound to.

#### Scenario: Readiness of an installed, signed-in tool
- **WHEN** the worker starts with the tool installed and signed in to a subscription
- **THEN** its declaration carries the tool's version, signed in `yes` and the plan, with limits null, and the coding state shows the same record

#### Scenario: Tool missing or signed out
- **WHEN** the configured executable does not exist, or the tool's status says it is not signed in
- **THEN** the readiness says `installed: no`, or `signedIn: no`, and nothing else is guessed

#### Scenario: Limits after a run
- **WHEN** a run's stream reported limit windows
- **THEN** the worker sends one more enable whose readiness carries those windows and when they were observed, and the coding state records it without changing the selected endpoint

### Requirement: Durable coding job ownership

Companions SHALL save the job ID, originating conversation and exchange, approved repository and brief, and attempt operation ID before dispatch. The current dispatcher and worker SHALL continue to use the attempt operation ID. An attempt's terminal status and pending Conversation delivery SHALL be saved together. Duplicate and late progress SHALL only be considered for the attempt they identify.

#### Scenario: Restore after interruption

- **WHEN** Companions restarts with a known unsent job, an ambiguous start, or a saved result pending delivery
- **THEN** the unsent job can dispatch when eligible, the ambiguous start is reported as uncertain without reissue, and the saved result is delivered once

#### Scenario: Stop a named job

- **WHEN** the owner stops one job, or cancels a separate Conversation turn
- **THEN** only the named attempt can receive a stop and an unconfirmed stop does not claim cancellation
