# Provider qualification

Source qualification for [Hub #2](https://github.com/jimmie-potts/agent-device-hub/issues/2), inspected on 2026-09-08. The OpenSpec identity is `gh-2-agent-lifecycle-contract`, capability `agent-lifecycle-contract`. This record does not qualify an installed producer or establish delivery timing.

## Evidence classes

- Documented: a primary source describes the signal or delivery behavior.
- Observed artifact: an installed manifest, executable identity or package layout was inspected. This does not establish emitted events.
- Observed live: an authorized installed-client exercise records actual behavior. None was performed for this source delivery.
- Unsupported: a particular interface documents an exclusion.
- Inaccessible or unknown: available evidence cannot establish the claim. Neither means that a client lacks the capability.

## Installed artifact matrix

| Client and execution path | Inspected artifact | Version | Evidence boundary |
| --- | --- | --- | --- |
| Codex CLI, WSL Linux | Global npm manifest; package target `x86_64-unknown-linux-musl` | 0.153.4 | Linux executable version check passed; live hooks unverified |
| Codex CLI, Windows native | Windows npm manifest; package target `x86_64-pc-windows-msvc` | 0.153.4 | Windows binary present; invocation and live hooks unverified |
| Codex Desktop, Windows app with Windows or WSL work | Installed directory `OpenAI.Codex_2p2nqsd0c76g0` | Inaccessible | WindowsApps read denied; neither Desktop version nor hook path established |
| Claude Code, WSL Linux | Active symlink to native `versions/2.1.236`, x86-64 ELF | 2.1.236 artifact | Target verified; live hooks unverified |
| Claude Code, Windows native | Active executable matches native `versions/2.1.237`, x86-64 PE | 2.1.237 artifact | Byte identity verified; live hooks unverified |

Both Codex manifests hash to `302ed64d0846795501768be9f60f78133688c0c09162c76e80a8a04b045664cb`. Windows Claude hashes to `406167231b3636e55a01d0ce93567256c61e7973489e645883302f14808ae668`; WSL Claude hashes to `6c8818fa22187aa555c242be4abbacc44d6b71a32ac9631ee7b2b5d12f51f752`. These establish artifact provenance only.

## Documented provider signals

The current [Codex hook reference](https://learn.chatgpt.com/docs/hooks) describes `session_id` and event-specific `turn_id`. Subagent hooks retain the parent `session_id` and add `agent_id`. `UserPromptSubmit`, `PermissionRequest`, `Stop`, `Interrupt` and `SessionEnd` supply distinct observations. Interrupt applies to active root turns; SessionEnd excludes subagents. Pre/PostToolUse expose tool-call identity, but PermissionRequest's listed fields do not establish unique approval identity. Hosted tools lack these tool hooks; specialized tools may bypass them. Async command hooks can finish out of order. Eight run concurrently per session; additional invocations wait. Shutdown cancels unfinished background hooks. SessionEnd is synchronous. Most default timeouts are 600 seconds; Interrupt and SessionEnd default to one second and allow at most three. These defaults do not establish the required monitoring bounds.

The current [Claude hook reference](https://code.claude.com/docs/en/hooks) describes `session_id`, child `agent_id` and `prompt_id`, introduced in 2.1.196 and absent before first input. Prompt identity can supply turn evidence. UserPromptSubmit, PermissionRequest, Stop, SessionEnd and SubagentStart/Stop are documented events. Elicitation and ElicitationResult can provide input-request evidence with optional correlation identity. The reviewed inventory does not establish a Codex-equivalent Interrupt event. Async command hooks run independently without deduplication. Once backgrounded, their configured timeout is not enforced. Their output can enter later model context; asyncRewake can wake the agent. A monitoring producer must enforce its own lifetime and remain silent.

These pages are not version-pinned installed-client observations. Neither common-field inventory establishes a native event ID or total ordering.

## Mapping and consumer boundaries

These are Hub interpretation rules, conditional on qualified provider evidence.

| Observation | Meaning | Limitation |
| --- | --- | --- |
| SessionStart | `session.started` | No inferred parent or notice acknowledgment |
| UserPromptSubmit | `turn.started` | Exclude prompt; missing turn stays unknown |
| PermissionRequest | `attention.approval` | Never decide permissions or invent correlation |
| Explicit continuing-input operation | `question.continuing` | Requires qualified operation semantics, never prose classification |
| Explicit blocking-input operation | `attention.input` | Requires qualified operation semantics |
| Matched input/result | `attention.resolved` | Resolve only the evidenced attention item |
| Stop | `turn.ended` | Neither success nor readership |
| Interrupt | `turn.interrupted` | Absence does not prove uninterrupted execution |
| SessionEnd | `runtime.ended` | Retained notices survive |
| SubagentStart/Stop | Child session/turn events | Child identity plus evidenced parent selector |
| Monitor dismissal | `notice.acknowledged` | Consumer/notice-scoped, never provider read state |
| Qualified Desktop marker | `read.observed` | Optional evidence, not universal readership |

The session selector identifies the actual child when `agent_id` is present; the parent hook `session_id` belongs in the evidenced parent selector. Project IDs/labels never merge sessions and require explicit user choice. Missing parentage is not a top-level assertion. Use only validated metadata for deduplication and retain its key on retry; indistinguishable observations can collide.

[Nanoleaf's existing source](https://github.com/jimmie-potts/codex-nanoleaf/blob/ea3b95661352f927aceaf92b62d74660978c201f/bridge/README.md#questions-blocks-and-read-status) distinguishes continuing questions and blocked waits, retains unread notices after runtime end and documents same-tool approval ambiguity. Its Desktop unread reconciliation is implementation-specific. This contract neither replaces it nor exports private metadata. `request_user_input_async` coverage in a particular provider version must be qualified; the legacy mapping alone does not establish shared support.

## Codex Desktop read marker

[Hub #191](https://github.com/jimmie-potts/agent-device-hub/issues/191) inspected the installed Windows Desktop state read-only from WSL on 2026-09-23. The Desktop version remains inaccessible, as recorded above.

- Desktop keeps its state in the Windows Codex home, not WSL `~/.codex`. In `.codex-global-state.json`, `electron-thread-read-state-v1` has `version: 1` and `unreadByIdentity`. Each host entry maps identity keys to lists of unread thread IDs, which match Desktop session IDs. Nothing lists read threads.
- The key legacy Nanoleaf reads, `electron-persisted-atom-state.unread-thread-ids-by-host-v1`, no longer exists.
- Desktop also lists unopened subagent threads, so only top-level sessions qualify.
- No hook reports reads, and a Linux file watcher on `/mnt/c` received no events. The reader therefore checks the file's size and modification time every two seconds and parses it only when they change.

A listed session is `unread`. An unlisted session is `read` when it was unread, or when its read value is unknown, it is not known to be active, and its last lifecycle evidence is at least five seconds old. Desktop sets the flag shortly after Stop; legacy Nanoleaf used the same wait. Unordered Interrupt and SessionEnd hooks leave the owner's activity unknown, so the rule excludes only a known running turn. A missing, oversized, malformed or other-version file produces no evidence. The standalone Hub's optional `codexDesktop` configuration enables this reader; see [the Hub guide](../apps/hub/README.md#configuration-and-authority).

## Required-client stops

[Hub #8](https://github.com/jimmie-potts/agent-device-hub/issues/8) owns authorized installed-path observation and setup. Keep a path disabled when its required version/path/coverage is unverified; mandatory identity or attention correlation cannot be established; privacy canaries fail; or the producer changes permissions, emits context, waits on devices, exceeds its deadline or permits unbounded processes/queues. Required missing signals need an accepted degraded mode exposing uncertainty. Optional unread evidence can remain unknown.

Source fixtures validate this contract. Live Codex Windows/WSL, Desktop and Claude gaps remain for #8 and device acceptance. No settings, hooks, agent sessions or devices were changed to obtain this matrix.

## Performance handoff

[Hub #30](https://github.com/jimmie-potts/agent-device-hub/issues/30) measures the delivered Linux hook in Ubuntu WSL using pinned source and synthetic isolated state. Native Windows comparison and cross-OS forwarding measurements are not required. Record cold/warm starts, repeat counts, load and artifact revisions. Separate producer return, admission, reduction, publication, consumer admission and transport. Compare durations within one monotonic clock domain. This document supplies no measurements or numeric budgets. Freeze measured budgets before Hub #3; installed-client and integrated qualification retain their own gates.
