# Bunny coding delegation specification

## Purpose

Let the owner hand one bounded coding task from the B.U.N.N.Y. conversation to a worker on their own computer through the core's tracked dispatcher, with the worker's authority limited to its endpoint and a truthful structured result, without a second runtime, a CLI in the container or unattended merge authority.

## Requirements

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

The worker SHALL run the harness only in a fresh worktree of an allowlisted repository, with worktree-only edit permission, a bounded tool allowlist without push, network or destructive tools, a fixed deny list the harness enforces over any allow (push, remotes, worktrees, GitHub, nested harnesses, network shells, privilege and settings edits), no MCP server and only the repository's own settings, and the dispatch's turn, budget and wall-clock bounds, where a private turn cap may only lower the dispatch's. The brief SHALL reach the harness as its input, never as an argument. The worker SHALL report started as soon as it takes the work, before the fetch and worktree, so the hand-off's tracked outcome lands within the dispatcher's budget; a worktree that then fails is reported failed with that reason. Its result SHALL carry the outcome, summary, checks, findings and limitations the harness reported, bounded, together with the base and head revisions and changed files the worker observed through git itself, the harness session identity, and usage or unknown. A refused repository, a failed worktree, a harness exit, a timeout, cancellation or unreadable output SHALL be reported with its reason; nothing SHALL be claimed beyond what was observed, and no path or brief SHALL enter a diagnostic record.

#### Scenario: Result from a fresh worktree
- **WHEN** the worker runs a start for an allowlisted repository
- **THEN** it reports started, creates a worktree from the repository's main, runs the harness with the bounds and the deny list, and reports completed with the observed base, head and changed files beside the harness's structured output

#### Scenario: Cancel and failure
- **WHEN** the module sends a cancel, or the harness exits with an error or outlives the wall clock
- **THEN** the worker stops the harness and reports cancelled, exit or timeout with the facts it has, and a second task is refused while one runs
