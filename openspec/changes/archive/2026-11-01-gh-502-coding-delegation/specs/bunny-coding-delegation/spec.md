## ADDED Requirements

### Requirement: Worker credential and endpoint

A coding worker SHALL act through a credential with the `coding-worker` role, bound to the `bunny/parts/coding-worker` source with no ordinary scope. The edge SHALL grant that credential exactly one connection-bound endpoint: answering `coding-work`, publishing `coding-progress` and requesting `coding-endpoint`, with no subscription, sync, operator command or other publication. The worker SHALL declare its availability explicitly after connecting; a lost connection SHALL be reported by the gateway as `coding-lost`, and reconnecting SHALL require a fresh declaration. The gateway SHALL refuse any direct dispatch of a `coding-*` family.

#### Scenario: Endpoint-only authority
- **WHEN** a credential carries the coding-worker role
- **THEN** it may answer work, publish progress and declare its endpoint, and it is refused every state read, sync, device command and other publication

#### Scenario: Lost worker
- **WHEN** the worker's connection closes while an operation is running
- **THEN** the gateway reports the endpoint lost, the operation ends uncertain and the task is told so, and no second start is sent

### Requirement: Tracked dispatch and one operation at a time

An approved delegation SHALL go from the companions module to the core as `coding-dispatch` and through the core's tracked dispatcher as one `coding-run` operation the module answers. The module SHALL save its responsibility before sending one `coding-work` start to the worker endpoint, SHALL refuse a second dispatch while one runs, and SHALL report the tracked outcome succeeded (observed) when the worker reports it started, failed when the start is refused, and uncertain when no start arrives within twenty seconds. The worker's completion, failure, cancellation or uncertainty SHALL settle the responsibility and reach the task as the delegation's answer without a second tracked outcome. Restart SHALL settle a pending responsibility as uncertain and resend nothing. Bounds of twenty minutes, sixty turns and five dollars per task SHALL travel with the dispatch.

#### Scenario: Handed to the worker
- **WHEN** the owner approves a delegation and the worker reports it started
- **THEN** the core's operation completes succeeded with observed evidence, the coding state shows the running task, and a further dispatch is refused with capacity until the worker reports an end

#### Scenario: Restart never resends
- **WHEN** the runtime restarts with a responsibility the worker had not finished
- **THEN** the responsibility is settled uncertain, the task receives an uncertain result, availability starts off, and no start is sent again

### Requirement: Truthful structured results

The worker SHALL run the harness only in a fresh worktree of an allowlisted repository, with worktree-only edit permission, a bounded tool allowlist without push, network or destructive tools, and the dispatch's turn, budget and wall-clock bounds. Its result SHALL carry the outcome, summary, checks, findings and limitations the harness reported, bounded, together with the base and head revisions and changed files the worker observed through git itself, the harness session identity, and usage or unknown. A refused repository, a failed worktree, a harness exit, a timeout, cancellation or unreadable output SHALL be reported with its reason; nothing SHALL be claimed beyond what was observed, and no path or brief SHALL enter a diagnostic record.

#### Scenario: Result from a fresh worktree
- **WHEN** the worker runs a start for an allowlisted repository
- **THEN** it creates a worktree from the repository's main, reports started, runs the harness with the bounds, and reports completed with the observed base, head and changed files beside the harness's structured output

#### Scenario: Cancel and failure
- **WHEN** the module sends a cancel, or the harness exits with an error or outlives the wall clock
- **THEN** the worker stops the harness and reports cancelled, exit or timeout with the facts it has, and a second task is refused while one runs
