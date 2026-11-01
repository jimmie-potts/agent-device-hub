## Context

See proposal.md. The speech coordinator (#1097) already models a connection-bound browser endpoint: an explicit enable, one active operation, durable responsibility before output, ordered receipts, uncertainty without replay, and a lost-endpoint occurrence from the gateway. The core's tracked dispatcher gives every effect an operation with reply and outcome deadlines (30 s for the default device kind). The assistant engine (#46) proposes commands, binds them to a revision, waits for the owner's approval through a LangGraph interrupt, and dispatches through the core. The container runs read-only with no repository or CLI; host-side producers already connect to the loopback gateway with scoped credentials.

## Goals / Non-Goals

**Goals:** one owner-approved delegation at a time to a worker on the Mac; the worker's authority limited to its endpoint; worktree-only harness permissions with no push; a structured, bounded, truthful result that the task reports; cancel that stops the worker; a lost worker or restart that leaves the operation uncertain rather than restarted; nothing new in logs, spans or public state beyond ids and codes.

**Non-Goals:** steering existing sessions, live approvals or questions from the worker, pushing or opening PRs, a second harness, a worker in a container, installation of the worker.

## Decisions

- **Mirror the speech endpoint, not the hooks.** The worker is a credential with a role, not scopes: `edgePermissions` grants it only an endpoint, so a leaked token cannot read state or control a device. The gateway publishes `coding-lost` when the endpoint closes. Alternative: an ingest-scoped credential publishing results. Rejected: the worker must answer commands, which ingest cannot, and results must bind to an operation the module owns.
- **The tracked effect is "handed to the worker".** A coding run lasts up to twenty minutes while the tracker's device budget is thirty seconds, so the module reports the `coding-run` outcome when the worker reports it started (observed) or when the start is refused or never comes (failed or uncertain within 20 s). The run's end reaches the task directly as the delegation's answer. Alternative: a new tracker kind with a twenty-minute deadline. Rejected: the dispatcher's budgets are the core's contract; the long wait belongs to the task that asked.
- **The delegation is a question the worker answers.** After an accepted dispatch the engine stores a `delegation` question, interrupts in an `await` node, and `deliver` sets the answer and resumes the task through the existing answer path. The owner's input is refused for that question; a delegation counts no owner question. Alternative: a polling node. Rejected: ADR 0012 forbids polling and the resume path already exists.
- **Bind the proposal to the coding state revision.** The coordinator advances its revision on every endpoint or operation change; the module refuses a dispatch whose proposal saw another revision, as `mode-set` is refused on a moved Hub-mode revision.
- **The worker observes git facts itself.** Base and head revisions and changed files come from git in the worktree, never from the model's claims; the model's structured output supplies outcome, summary, checks, findings and limitations, bounded by the contract. Usage comes from the harness envelope or stays unknown. The worktree is retained for the owner's inspection; its path never enters a message.
- **Bounds in the contract.** Twenty minutes, sixty turns and five dollars per task travel with the dispatch, so the worker and the coordinator agree; the worker passes them to the harness and enforces the wall clock itself.

## Risks / Trade-offs

- [The harness edits outside the worktree] → `acceptEdits` applies to the worktree working directory and the tool allowlist excludes arbitrary shell, push and network tools; the brief and the appended system prompt say so; findings report refused actions.
- [A worker result arrives while the engine is disabled] → `deliver` keeps the answer and the owner resumes; nothing is lost or resent.
- [Token spend] → the per-task budget cap and one worker at a time; the installed Mac uses the owner's Claude Code login.
- [The worker crashes mid-run] → the endpoint closes, the gateway reports it lost, the coordinator delivers uncertain; the worktree stays for inspection.

## Migration Plan

Source-only; new tables and families are additive. Existing tasks are unaffected. The worker is installed later under the owner's installation authority with its own credential and private configuration; until then the tool refuses with "no coding worker is connected".
