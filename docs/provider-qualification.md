# Provider qualification

Source qualification for [Hub #2](https://github.com/jimmie-potts/agent-device-hub/issues/2), inspected on 2026-09-08. The OpenSpec identity is `gh-2-agent-lifecycle-contract`, capability `agent-lifecycle-contract`. That source qualification does not qualify an installed producer or establish delivery timing; later sections name the issue behind each installed observation.

## Evidence classes

- Documented: a primary source describes the signal or delivery behavior.
- Observed artifact: an installed manifest, executable identity or package layout was inspected. This does not establish emitted events.
- Observed live: an authorized installed-client exercise records actual behavior. None was performed for the Hub #2 source delivery; later sections name the issue that recorded each observation.
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
| SessionEnd | `runtime.ended` | Every supported path retires the known record and its known descendants; the reason is never copied |
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

A listed session is `unread`. An unlisted session is `read` when it was unread, or when its read value is unknown, it is not known to be active, and its last lifecycle evidence is at least five seconds old. Desktop sets the flag shortly after Stop; legacy Nanoleaf used the same wait. Unordered Interrupt leaves activity unknown; Desktop SessionEnd removes the record. The read rule excludes a known running turn and never recreates an absent session. A missing, oversized, malformed or other-version file produces no evidence. The standalone Hub's optional `codexDesktop` configuration enables this reader; see [the Hub guide](../apps/hub/README.md#configuration-and-authority).

## Required-client stops

[Hub #8](https://github.com/jimmie-potts/agent-device-hub/issues/8) owns authorized installed-path observation and setup. Keep a path disabled when its required version/path/coverage is unverified; mandatory identity or attention correlation cannot be established; privacy canaries fail; or the producer changes permissions, emits context, waits on devices, exceeds its deadline or permits unbounded processes/queues. Required missing signals need an accepted degraded mode exposing uncertainty. Optional unread evidence can remain unknown.

Source fixtures validate this contract. Live Codex Windows/WSL, Desktop and Claude gaps remain for #8 and device acceptance. No settings, hooks, agent sessions or devices were changed to obtain this matrix.

## Performance handoff

[Hub #30](https://github.com/jimmie-potts/agent-device-hub/issues/30) measures the delivered Linux hook in Ubuntu WSL using pinned source and synthetic isolated state. Native Windows comparison and cross-OS forwarding measurements are not required. Record cold/warm starts, repeat counts, load and artifact revisions. Separate producer return, admission, reduction, publication, consumer admission and transport. Compare durations within one monotonic clock domain. This document supplies no measurements or numeric budgets. Freeze measured budgets before Hub #3; installed-client and integrated qualification retain their own gates.

## Runtime ends and archive admission

The shared owner retires the known record and its known descendants on a normalized `runtime.ended` from every supported path. It does not classify the reason and adds no turn-duration timer ([Hub #241](https://github.com/jimmie-potts/agent-device-hub/issues/241), extending [Hub #218](https://github.com/jimmie-potts/agent-device-hub/issues/218)). The table records each path's documented end and start evidence, read on 2026-09-25, and its installed evidence. Source normalization and synthetic host checks establish the mapping; neither proves delivery by an installed build. A path with missing or unqualified end evidence is a coverage gap. Its records keep the 24-hour expiry fallback, and the owner never invents an end.

| Path | Documented end | Documented start | Installed evidence |
| --- | --- | --- | --- |
| Codex Desktop (`codex`/`desktop`) | SessionEnd for archive/delete of an open main thread, normal close, or 30 minutes idle and unopened in any connected client; reason always `other`; not for subagents; switching away or `thread/unsubscribe` does not end the session | SessionStart with `source` `startup`, `resume`, `clear` or `compact`; a resumed conversation keeps its session ID | Archive-end retirement, dashboard removal and visible Nanoleaf Line release observed for #218; native idle/shutdown emission and reopen/live-resume remain in [Hub #253](https://github.com/jimmie-potts/agent-device-hub/issues/253) |
| Codex CLI (`codex`/`cli`) | Same SessionEnd reference, which does not distinguish the CLI from Desktop: normal exit is documented, while the idle and archive causes describe Desktop | Same SessionStart sources; `codex resume` reuses the session ID | [Observed live](#installed-cli-and-claude-observation) on 2026-09-25 with 0.156.0: `/quit` retired the session. `/clear` sent no end; the cleared session ended only at `/quit`. `codex resume` kept the session ID and re-created a retired session at its first prompt |
| Claude Code (`claude`/`code`) | SessionEnd with reason `clear`, `resume`, `logout`, `prompt_input_exit` or `other`; hooks share a 1.5-second budget raised to the configured timeout; not documented for subagents, which use SubagentStop | SessionStart with `source` `startup`, `resume`, `clear`, `compact` or `fork`; `compact` restarts hooks without an end; whether `/clear` keeps the session ID is not documented | [Observed live](#installed-cli-and-claude-observation) on 2026-09-25 with 2.1.280 and 2.1.283: `/exit` (`prompt_input_exit`) and `/clear` (`clear`) retired the session, and `/clear` started a new session ID. `claude --resume` kept the ID and re-created a retired session; in-session `/resume` (`resume`) retired the current session and re-created the target |

Retirement does not depend on the reason or source, and neither field enters the envelope. A `resume` or `clear` end retires the ended identity. The start that follows is an ordinary start for its identity; a same-identity start after retirement creates a fresh record, subject to the retained delayed-event guards. Claude Code's `compact` start refreshes an existing record without ending it. `Stop`/`turn.ended`, `SubagentStop`, `Interrupt`, waiting, read status and freshness uncertainty never become ends.

The optional `codexDesktop` home also supplies positive archive admission evidence. The host checks regular `archived_sessions/rollout-YYYY-MM-DDTHH-MM-SS-<session-id>.jsonl` filenames for a new identity and its known ancestors, including an absent parent. It reads no transcript content, scans at most 10,000 entries within the owner's 200 ms deadline, and does not poll or retain archive results. Missing, unreadable, differently shaped or timed-out evidence cannot block monitoring. An unarchived conversation can supply fresh eligible work. Ending an already tracked session does not consult archive evidence.

Archive filenames are an implementation-specific safeguard exercised with synthetic files. They apply to Codex Desktop conversations only; Claude and CLI identities are never probed. The owning [#218 acceptance](https://github.com/jimmie-potts/agent-device-hub/issues/218) recorded the throwaway archive end, dashboard removal and visible Nanoleaf Line release on the selected installation. The CLI and Claude paths were observed on the same installation for #312, below.

### Installed CLI and Claude observation

[Hub #312](https://github.com/jimmie-potts/agent-device-hub/issues/312) observed both paths on 2026-09-25 local time (00:09 to 00:19 UTC on 2026-09-26). The target was the installed standalone Hub 0.3.7 (source `68c9333`, Agent State 3.2.0, as recorded in the Hub #330 installation receipt) with the existing WSL hooks: the Claude Code producer from [Hub #367](https://github.com/jimmie-potts/agent-device-hub/issues/367) and the earlier Codex CLI producer. Each throwaway session ran in an empty directory with one trivial prompt. A read-only poller read the shared owner's `/api/monitor/v1/sessions` snapshot every 0.5 s and recorded when each row appeared, changed or disappeared, with the owner revision. Times below are UTC on 2026-09-26: client times come from Claude Code's debug log, and owner times are the poll that first showed the change.

| Path | Client emission | Owner result |
| --- | --- | --- |
| Claude Code exit | SessionStart once folder trust was accepted, before the first prompt; `/exit` sent SessionEnd `prompt_input_exit` at 00:10:16.309 | Row appeared at 00:09:34.045; removed at 00:10:16.688 (revision 3225) |
| Claude Code `/clear` | SessionEnd `clear` at 00:11:08.769, then a start under a new session ID; `/exit` sent SessionEnd `prompt_input_exit` at 00:11:41.815 | Old row removed and new row created at 00:11:08.867 (revision 3237); the new row and its forked `prompt_suggestion` child removed together at 00:11:41.982 (revision 3247) |
| Claude Code resume | `claude --resume` of the retired exit session kept its ID; in-session `/resume` of the retired `/clear` session sent SessionEnd `resume` at 00:12:19.253; `/exit` sent SessionEnd `prompt_input_exit` at 00:13:27.483 | Retired exit ID returned as a fresh record at 00:11:55.532 (revision 3248). At 00:12:19.619 (revision 3258) the current row and its forked child were removed and the retired `/clear` ID returned as a fresh record. Removed at 00:13:27.858 (revision 3263) |
| Codex CLI exit | Nothing at launch; the first event arrived with the first prompt; `/quit` ended the session | Row appeared at 00:14:59.178 (revision 3268); removed at 00:15:49.384 (revision 3273) |
| Codex CLI `/clear` | No end at `/clear` (sent at about 00:17:00); the new session's events began at its first prompt; `/quit` ended both sessions | First row appeared at 00:16:37.058 and stayed idle after `/clear`; new row appeared at 00:17:37.283. Both removed at 00:17:55.352 (revision 3288; the previous poll showed 3286, so the two ends committed between polls) |
| Codex CLI resume | `codex resume` of the retired exit session kept its ID; `/quit` ended it | Retired ID returned as a fresh record at its first prompt, 00:18:36.514 (revision 3294); removed at 00:18:54.080 (revision 3298) |

Every observed end retired its session, the two Claude Code ends that followed a forked child also retired that child, and every same-ID start after retirement created a fresh record, matching the rule above. Claude's `/clear` issues a new session ID; both clients' resume keeps it. Codex CLI 0.156.0 held the cleared session's end until the CLI exited, and its row stayed idle for 55 s until then. A CLI killed without a normal exit would leave that row on the 24-hour expiry. This is client behavior, not a Hub defect; the repository owner accepted it without a follow-up on 2026-09-25.

Evidence limits: Claude Code's debug log named each SessionEnd reason but not its starts, which are inferred from rows appearing. Codex CLI records no hook runs in its logs or rollout, so its emission and the `/quit` times are inferred from the owner, where only an accepted `runtime.ended` removes a row before expiry. The poller did not record parent links; the forked children are attributed by the client log and their removal in their parent's end revision. The owner holds its store exclusively, so retirement guards were not read directly. Each path ran once, and times are bounded by the 0.5 s poll. Unrelated sessions on the owner were excluded by session ID. Claude Code downloaded 2.1.283 during the exit run; that process stayed on 2.1.280, and the `/clear` and resume runs used 2.1.283. No device was commanded and no hook was changed. The only client-state writes were folder trust for the empty directory in both clients and one dismissed Codex update prompt. The private observation log stays outside Git.
