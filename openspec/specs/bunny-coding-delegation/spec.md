# Bunny coding delegation specification

## Purpose

Let the owner hand one bounded coding task from the B.U.N.N.Y. conversation to a worker on their own computer through the core's tracked dispatcher, with the worker's authority limited to its endpoint and a truthful structured result, without a second runtime, a CLI in the container or unattended merge authority.

## Requirements

### Requirement: Worker credential and endpoint

A coding worker SHALL act through a credential with the `coding-worker` role, bound to the `bunny/parts/coding-worker` source with no ordinary scope. The edge SHALL grant that credential exactly one connection-bound endpoint: answering `coding-work`, publishing `coding-progress` and requesting `coding-endpoint`, with no subscription, sync, operator command or other publication. The worker SHALL declare its availability explicitly after connecting, and a worker from Hub #2028 SHALL declare its three slots with it (`coding-endpoint/2.2`); a lost connection SHALL be reported by the gateway as `coding-lost`, and reconnecting SHALL require a fresh declaration. When its endpoint closes, the worker SHALL stop every run that endpoint started, including one whose tool starts after the stop, keep each under its original operation identity, where a cancel or a stop still reaches it, until it ends, declare its next endpoint once they have ended or after a bound of fifteen seconds, after which a run still alive keeps only its own companion's slot busy on a finite worker, and send no report of those runs on another endpoint. The gateway SHALL refuse any direct dispatch of a `coding-*` family.

#### Scenario: Endpoint-only authority
- **WHEN** a credential carries the coding-worker role
- **THEN** it may answer work, publish progress and declare its endpoint, and it is refused every state read, sync, device command and other publication

#### Scenario: Lost worker
- **WHEN** the worker's connection closes while operations are running
- **THEN** the gateway reports the endpoint lost, each of its operations ends uncertain on its own and its task is told so, and no second start is sent

#### Scenario: Slots free on the next endpoint
- **WHEN** a finite worker's endpoint closes with three runs, one of whose tools starts only after the close
- **THEN** that tool is stopped as it starts, no second start for its companion is taken while it lives, the fresh endpoint is declared once the stopped runs have ended and accepts a start for each companion, and no report of a stopped run goes out on it

#### Scenario: A stopped run that never ends
- **WHEN** a finite worker's stopped run output stays held open by a leftover process
- **THEN** the worker declares its fresh endpoint after the bound, refuses that companion's start with `capacity` until the run ends, and accepts the other companions' starts

### Requirement: Tracked dispatch and one slot per companion

An approved delegation SHALL go from the companions module to the core as `coding-dispatch` and through the core's tracked dispatcher as one `coding-run` operation the module answers. A worker using the finite three-slot declaration SHALL hold one slot per companion (B.U.N.N.Y., Reachy and MicroDuck) and at most three runs at once, and SHALL refuse a start with `capacity` when that companion's slot or every slot is busy. The module SHALL tag each run with the companion whose task asked, send the worker the start with that companion (`coding-work/2.1`), and send a legacy worker that declared neither capacity nor slots the untagged 2.0 start while counting it as one slot shared by every companion. The module SHALL save its responsibility before sending one `coding-work` start to the worker endpoint, SHALL refuse a dispatch whose finite slot is busy with `capacity`, and SHALL report the tracked outcome succeeded (observed) when the worker reports it started, failed when the start is refused, and uncertain when no start arrives within twenty seconds. On a finite endpoint, an approved hand-off whose companion's slot is busy, or already has hand-offs waiting, SHALL wait durably, first in first out per slot and at most 32 at once, without being sent; when the slot frees and a worker is selected, the module SHALL send the oldest one once through the core's tracked dispatcher with its own request ID, and a refused or unanswered dispatch SHALL end its wait and reach its task as failed with the code or uncertain, without a retry. Stopping a named unsent job SHALL remove its waiting attempt without sending it. A stop saved before a sending attempt reaches the responder SHALL refuse the worker start when that responder sees it. A pre-change hand-off that still depends on its task SHALL keep the task's cancellation and wait guard. Runs on the same repository at once SHALL each use their own fresh worktree. The worker's completion, failure, cancellation or uncertainty SHALL settle only its own responsibility and reach the original exchange, or the task's saved delegation interrupt for an earlier record without a second tracked outcome; a cancel, a timeout or a lost endpoint SHALL settle only the operations it names or holds. Restart SHALL settle each pending responsibility as uncertain and resend nothing; a waiting hand-off that was never sent SHALL keep its place and be sent when its slot is free, and one whose dispatch had left without its acceptance recorded SHALL end uncertain and never be sent again. Startup settlement SHALL publish the saved evidence without starting a Conversation turn. For finite endpoints within the legacy state bounds, `coding-state/2.2` SHALL list the selected worker's declared slots, every active run with its companion and status, and the waiting hand-offs, oldest first, and keep `active` as the oldest run. Bounds of twenty minutes, sixty turns and five dollars per task SHALL travel with each dispatch.

#### Scenario: Handed to the worker
- **WHEN** the owner approves a delegation and a finite worker reports it started
- **THEN** the core's operation completes succeeded with observed evidence, the coding state lists the running task with its companion, and another dispatch for that companion is refused with capacity until the worker reports an end

#### Scenario: Three companions at once
- **WHEN** B.U.N.N.Y., Reachy and MicroDuck each have an approved hand-off for a three-slot worker
- **THEN** three starts reach the worker at once, each tagged with its companion, the coding state lists three runs, and each result reaches only its own task

#### Scenario: A further hand-off waits for its own slot
- **WHEN** a companion's hand-off on a finite worker is approved while that companion's run holds its slot
- **THEN** nothing is sent for it, the coding state lists it as waiting, another companion's run ending sends nothing, and its own slot freeing sends it once

#### Scenario: Cancel a waiting hand-off
- **WHEN** the owner stops a named job whose hand-off has not been sent
- **THEN** its original exchange reports cancellation before dispatch and freeing the slot sends nothing for it

#### Scenario: Restart never resends
- **WHEN** the runtime restarts with a responsibility the worker had not finished and a never-sent waiting hand-off behind it
- **THEN** the responsibility is settled uncertain and its task hears so as a start-time settlement, availability starts off, the waiting hand-off is sent once when a worker declares and its slot is free, and a later enable or restart sends neither again

#### Scenario: Restart with a dispatch on its way
- **WHEN** the runtime stops after a waiting hand-off's dispatch left and before its acceptance was recorded
- **THEN** the next start ends that hand-off uncertain, tells its task as a start-time settlement and never sends it again

#### Scenario: An older worker
- **WHEN** the selected legacy worker declared neither capacity nor slots
- **THEN** it receives untagged 2.0 starts, one run at a time for every companion, and another companion's approved hand-off waits for that run to end

### Requirement: Truthful structured results

For Claude Code, the worker SHALL run the harness only in a fresh worktree of an allowlisted repository, with worktree-only edit permission, a bounded tool allowlist without push, network or destructive tools, a fixed deny list the harness enforces over any allow (push, remotes, worktrees, GitHub, nested harnesses, network shells, privilege and settings edits), no MCP server and only the repository's own settings, and the dispatch's turn, budget and wall-clock bounds, where a private turn cap may only lower the dispatch's. The brief SHALL reach the harness as its input, never as an argument. Workers SHALL use the owner's subscription sign-in only. The harness and its readiness probes SHALL inherit only an allowlisted environment (search path, home, user, shell, locale, temporary directory, terminal, time zone and the subscription token `CLAUDE_CODE_OAUTH_TOKEN`) plus variable names the private configuration lists, which SHALL NOT be named like a key, token, secret, password, credential, base URL, personal access token, private key or auth value, nor be the SSH agent socket, a git or SSH helper or a dynamic-loader variable, except the subscription token (a rule against mistakes in the owner's own list, not a security boundary), and never a provider credential, provider switch, base URL, OAuth refresh token or scopes, API-key helper or descriptor, client certificate, cloud credential, proxy, certificate setting, `NODE_OPTIONS` or configuration-directory selector, whatever the configuration lists. Before the tool starts, the worker SHALL read the worktree's project settings as data, executing nothing in them, and SHALL refuse the run with reason `refused` when they set a credential helper, set a provider or credential variable in `env`, or are not a JSON object; the run SHALL also blank the provider switches through the tool's higher-ranked settings argument. When the stream's first event reports an API key source other than `none`, the worker SHALL stop the run at that event and report it failed with reason `refused`, so that at most the request already in flight is spent, and SHALL stop it the same way when an assistant or result event arrives before any readable key source; a result naming a model provider other than the first-party one, or a run that created, changed or removed a project settings file (compared with what the check read) or changed files under the project settings directory in any letter case, SHALL be stated as a limitation. The worker SHALL read either adapter's output as a stream of events as it arrives. The worker SHALL report started as soon as it takes the work, before the fetch and worktree, so the hand-off's tracked outcome lands within the dispatcher's budget; a worktree that then fails is reported failed with that reason. Its result SHALL carry the outcome, summary, checks, findings and limitations the harness reported, bounded, together with the base and head revisions and changed files the worker observed through git itself, the harness session identity, and usage or unknown. A run whose stream reported a usage limit, and that neither ended with a successful structured result nor stopped at its own budget or turn cap, SHALL end failed with reason and outcome `usage-limit` and the window and reset time the tool gave, or null where it gave none; a generic rate-limit error SHALL NOT count as a usage limit. A run that asks the owner a question SHALL complete with outcome `waiting-for-owner` and the question first among its findings. A refused repository, a failed worktree, a harness exit, a timeout, cancellation or unreadable output SHALL be reported with its reason; nothing SHALL be claimed beyond what was observed, nothing SHALL be retried automatically, and no path or brief SHALL enter a diagnostic record.

#### Scenario: Result from a fresh worktree
- **WHEN** the worker runs a Claude Code start for an allowlisted repository
- **THEN** it reports started, creates a worktree from the repository's main, runs the harness with the bounds and the deny list, and reports completed with the observed base, head and changed files beside the harness's structured output

#### Scenario: Cancel and failure
- **WHEN** the module sends a cancel, or the harness exits with an error or outlives the wall clock
- **THEN** the worker stops the harness and reports cancelled, exit or timeout with the facts it has and a finite worker still applies its declared capacity

#### Scenario: Usage limit
- **WHEN** the stream reports a rejected rate limit or a message typed as a usage limit, and the run ends without a successful structured result
- **THEN** the worker reports failed with reason `usage-limit`, outcome `usage-limit` and the window and reset time the tool gave, or null where it gave none, and the task is told so without a retry

#### Scenario: A question for the owner
- **WHEN** the harness ends with the `waiting-for-owner` outcome
- **THEN** the worker reports completed with that outcome and the question first among the findings

#### Scenario: API key in the worker's environment
- **WHEN** the Claude Code worker's environment holds a provider API key, token or provider switch
- **THEN** the harness and its readiness probes start without it, while a subscription token in `CLAUDE_CODE_OAUTH_TOKEN` is kept

#### Scenario: Project settings that would undo the environment
- **WHEN** the worktree's project settings set a credential helper or a provider or credential variable in `env`, or are not a JSON object
- **THEN** the run is refused with reason `refused` before the tool starts, naming the setting but never its value, and nothing is spent

#### Scenario: An API key source at the first event
- **WHEN** the stream's first event names an API key source other than `none`
- **THEN** the worker stops the tool at that event, so that at most the request already in flight is spent, and reports failed with reason `refused`

### Requirement: Worker readiness without side effects

For the legacy Claude Code readiness projection, the worker SHALL produce a record without starting a task or a session and without spending: the tool's version, whether it is installed (`yes`, `no` or `unknown`), whether it is signed in (`yes` only for the subscription sign-in, `no` when the tool says it is signed out, `unknown` for any other sign-in or no answer), the plan where the tool reports one, and the limit windows with their reset times that the latest run reported, with when they were observed, or null before any. It SHALL read only the sign-in state, sign-in method, provider and plan from the tool's status, never the account, organization, e-mail or directories, SHALL run each probe with the harness's environment and kill it outright at its deadline, and SHALL report `unknown` or null wherever the tool did not say or the probe failed. The worker SHALL send the record with its enable declaration (`coding-endpoint/2.1`, or 2.2 with its slots from Hub #2028) and, after a run that reported limit windows, once more in an enable from the selected endpoint, never retried. The companions module SHALL record the selected endpoint's latest record in `coding-state/2.1` and later (`coding-state/2.2` from Hub #2028), change the revision only when it changed, and clear it when the endpoint is disabled or lost. A readiness report from the selected endpoint SHALL NOT move the revision a pending delegation proposal is bound to.

#### Scenario: Readiness of an installed, signed-in tool
- **WHEN** the worker starts with the tool installed and signed in to a subscription
- **THEN** its declaration carries the tool's version, signed in `yes` and the plan, with limits null, and the coding state shows the same record

#### Scenario: Tool missing or signed out
- **WHEN** the configured executable does not exist, or the tool's status says it is not signed in
- **THEN** the readiness says `installed: no`, or `signedIn: no`, and nothing else is guessed

#### Scenario: Limits after a run
- **WHEN** a run's stream reported limit windows
- **THEN** the worker sends one more enable whose readiness carries those windows and when they were observed, and the coding state records it without changing the selected endpoint

### Requirement: Subscription worker adapters

The worker SHALL route an explicit harness identity to an installed adapter.
An absent harness identity SHALL keep the legacy Claude Code path. Each
adapter SHALL report subscription readiness and supported capabilities using
the existing endpoint. The worker SHALL report the first validated native
session identity once and retain it for the result when observed. It SHALL
respect the adapter's stated bounds and keep a lost start uncertain without
resending the work. A native session reference SHALL remain available even
when live steering and resume through the worker are unsupported.

Claude Code SHALL retain its existing preflight, tool restrictions and stream
credential check. An unknown preflight leaves the first-event check in force.
That check observes the credential after the CLI starts.

The Codex adapter SHALL require a first-party ChatGPT account before opening
a thread and before sending a turn. It SHALL verify that the returned thread
uses the selected worktree, permission profile and no new approval authority.
Its readiness probe SHALL open no model session. It SHALL request one turn
under the worker's wall-clock deadline, refuse external approval requests,
and report subscription cost as unknown. It SHALL report only readiness and
run evidence declared by the worker contract.

#### Scenario: Another harness accepts the same brief

- **WHEN** a disposable worker accepts a bounded start for a configured adapter
- **THEN** it uses that adapter in an allowlisted fresh worktree, reports observed base, head and changed files with the adapter's structured evidence, and identifies the adapter and native session when available

#### Scenario: Subscription identity is contrary or unknown

- **WHEN** Codex cannot confirm its ChatGPT account before a turn, or Claude Code reports a contrary credential during its preflight or stream check
- **THEN** the worker refuses the run at that boundary without falling back to an API key

#### Scenario: Codex cannot confirm isolated configuration

- **WHEN** a readiness probe or delegated run finds unsafe or unreadable effective Codex settings
- **THEN** it SHALL refuse account probing or thread startup and keep any personal profile outside the child environment

#### Scenario: Codex receives a private profile for standalone startup

- **GIVEN** a personal unmanaged Mac, a personal ChatGPT workspace and a separate private worker profile
- **WHEN** the operator configures a standalone CLI that supports the required app-server protocol
- **THEN** the worker SHALL pin SQLite and logs before launching and SHALL verify effective settings before asking for account evidence or sending a brief

#### Scenario: Codex receives contrary profile or account evidence

- **WHEN** a worker profile resolves into a personal profile, an effective setting redirects storage or routing, or account evidence identifies organization management or non-subscription credentials
- **THEN** the worker SHALL refuse at the first unsupported boundary, with no model turn or API fallback

#### Scenario: Codex has already observed an organization quota

- **WHEN** a probe or run sees an organization plan in a quota snapshot
- **THEN** another run SHALL refuse before sending a brief until a fresh personal account report and quota plan agree, and an older probe SHALL NOT release that refusal

#### Scenario: Only explicit plan exhaustion routes as a usage limit

- **WHEN** a harness reports subscription-plan exhaustion without a completed structured result
- **THEN** the worker reports a usage limit with the known window and reset or unknown values
- **AND** ordinary slowdown remains an ordinary failure

#### Scenario: Native identity arrives before the result

- **WHEN** the adapter receives a validated session identity during a run
- **THEN** it reports that identity with the original operation identity before the terminal result and preserves the first identity on loss

#### Scenario: An old worker is connected

- **WHEN** a worker declares an earlier endpoint schema
- **THEN** it continues receiving only the work versions it declared and no explicit alternate harness selection

#### Scenario: Worker controls are unavailable

- **WHEN** an adapter reports a native session ID and declares steering and resume unsupported
- **THEN** the worker reports the ID and reports both capabilities as unsupported

#### Scenario: An unfamiliar adapter uses the same contracts

- **WHEN** a disposable worker registers another adapter with the existing interface
- **THEN** the coordinator can select its declared identity and consume attributed progress without provider-specific changes

### Requirement: Durable coding job ownership

Companions SHALL save the job ID, originating conversation and exchange, approved repository and brief, and attempt operation ID before dispatch. The current dispatcher and worker SHALL continue to use the attempt operation ID. An attempt's terminal status and pending Conversation delivery SHALL be saved together. If that write fails, Companions SHALL retain the first observed terminal evidence while it retries the write. It SHALL NOT send another worker command. A restart without durable terminal evidence SHALL report uncertainty. Duplicate and late progress SHALL only be considered for the attempt they identify.

#### Scenario: Restore after interruption

- **WHEN** Companions restarts with a known unsent job, an ambiguous start, or a saved result pending delivery
- **THEN** the unsent job can dispatch when eligible, the ambiguous start is reported as uncertain without reissue, and the saved result is delivered once

#### Scenario: Stop a named job

- **WHEN** the owner stops one job, or cancels a separate Conversation turn
- **THEN** only the named attempt can receive a stop and an unconfirmed stop does not claim cancellation

### Requirement: Independent coding jobs for uncapped workers

An explicitly uncapped worker SHALL accept independent jobs without a host or
companion job-count limit. The coordinator SHALL pace tracked dispatch and the worker
acknowledgement together, releasing the next delivery without waiting for the
job to finish. On connection loss or disable, an uncapped start assigned to that connection
SHALL be discarded. When the coordinator knows the start did not leave for the
worker, it SHALL record that it was never sent. A start that may have reached
the worker SHALL remain uncertain without resending it. Jobs that have never
been assigned to a connection SHALL keep their place. The core SHALL bind an
explicit dispatch to the current uncapped selection before tracked forwarding.
A forward delayed past replacement SHALL be rejected even if the endpoint
name is reused. The core SHALL synchronize its selection copy on attach and
after a delivery gap. It SHALL refuse an explicit dispatch while selection
is unknown, unavailable or belongs to a different endpoint. A positively
known finite selection SHALL keep its existing dispatch contract.
Finite workers SHALL retain their supported admission behavior. The worker SHALL serialize conflicting Git setup, leave a cancelled
queued attempt without a new worktree, and report setup and execution progress
using the original operation identity. The coordinator SHALL use the attempt's
observed phase to apply its deadline. Active jobs SHALL be visible through a
bounded keyset page independent of admission. Any visible job SHALL be stoppable
by its own job and attempt IDs. The asking companion SHALL remain attributed. The same attribution applies to
a hand-off originating in the Apartment.

#### Scenario: More jobs than a page holds

- **WHEN** multiple companions approve more jobs than fit on one page
- **THEN** jobs can start without an invented slot wait, page reads locate all active jobs, and stopping a job on a later page affects only that attempt

#### Scenario: One repository has conflicting setup

- **WHEN** two attempts need the same repository setup and one is stopped while waiting
- **THEN** setup stays serialized, the cancelled attempt allocates no worktree, and siblings continue independently

### Requirement: Approved coding choice and explicit continuation

A new coding job SHALL bind approval to Auto or a named harness. Auto SHALL choose an eligible personal subscription and record the reason. A pinned refusal SHALL preserve the requested choice. Unknown quota SHALL remain unknown. An ambiguous or live attempt SHALL prevent an automatic replacement.

#### Scenario: Exhausted subscriptions

- **WHEN** the approved Auto job sees a preferred subscription with a rejected quota
- **THEN** the other eligible subscription can run the job and the reason is visible, including when the rejected quota has no known reset

#### Scenario: Continue a stopped and confined writer

- **WHEN** the owner requests Claude Code after a stopped Codex attempt on a supported Mac worker, the native sandbox excludes the successor, and the worker confirms the source checkout identity, revision, index and selected files
- **THEN** the job receives a distinct attempt in a separate checkout and Git store with the same verified state, the full approved brief, bounded Git and check facts, and its own native identity and checks

#### Scenario: Incomplete snapshot or confinement

- **WHEN** the previous writer lacks verified native confinement, or the source identity, revision, index or verified contents differ
- **THEN** the continuation remains unavailable and no replacement writer starts

#### Scenario: Ambiguous start or stop

- **WHEN** a worker may still be writing, or the previous writer's proof is unavailable after restart
- **THEN** the coordinator or worker refuses a competing writer and sends no automatic retry

### Requirement: Inspect coding jobs and direct individual attempts

Jobs SHALL offer a bounded authenticated listing and exact job lookup across the owner's permitted Conversations. Each entry SHALL carry the stable job and attempt identity, owning companion and conversation, repository, and reported attempt evidence. Available attempt evidence SHALL include branch and worktree reference, native session, harness and model, usage, status and updates, pending decisions, checks, changed files and limitations. Unknown values SHALL remain unknown. Private host paths SHALL remain outside the shared projection. An explicit Message job or Stop job SHALL bind to the named current attempt. An unsupported, stale or disconnected target SHALL never silently send to a different attempt.

#### Scenario: Inspect a completed or disconnected job

- **WHEN** an authorized reader opens Jobs or reloads a job's original Conversation
- **THEN** the saved job and known outcome remain readable and the job links back to the original Conversation

#### Scenario: Distinguish instruction evidence

- **WHEN** a job instruction is recorded locally, accepted by a harness, or confirmed by harness activity
- **THEN** each fact is presented at its own level of evidence, and repeating a delivery identifier cannot apply the instruction twice
