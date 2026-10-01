## Context

A no-ID approval marker records that a dialog opened during a turn. Claude Code's `PermissionRequest` input omits `tool_use_id`, so no later event can name it. AskUserQuestion dialogs use the same hook. Before this change the owner forgot such a marker only when a newer turn retired its turn (#225) or through explicit recovery (#185).

## Decisions

**Tool completion proves the answer.** Producer hooks are synchronous, so `PostToolUse` or `PostToolUseFailure` for turn T is emitted after a tool on T completed, and a tool completes only after its own dialog closed. The normalizer maps both to `attention.resolved {status:'known', id: tool_use_id}` on the `prompt_id` turn. The reducer keeps removing a matching known-ID item and also forgets every no-ID approval on the same session and turn. Child agent payloads carry no turn, so the normalizer drops them instead of sending a resolution the owner would mark ambiguous.

**Turn end is the fallback.** A manually denied dialog produces neither tool hook (`PostToolUseFailure` excludes permission denials and `PermissionDenied` skips manual denials). `turn.ended` on T therefore forgets T's no-ID approvals. This applies to Codex no-ID approvals as well.

**Accepted window.** With several tool calls in flight in one Claude message, a completed auto-allowed tool can clear the marker before the remaining dialog is answered. The owner accepted this on 2026-09-30; installed acceptance observes it.

**In-place setup upgrade.** A receipt records the exact entries it owns, and validation compares them with the generated list. A receipt from the previous seven-event Claude list stays valid. Re-applying setup on it writes the reviewed target, then records the new entries and target text in the receipt. The credential, grant, producer file and backup are untouched. If the process stops between the two writes, the target already holds every entry; the next plan finds no additions and the next apply records the receipt.

**Stdin bound.** The packaged hook reads at most 8 MiB. A larger payload is dropped silently, and the turn-end fallback still clears the marker.

## Failure and recovery

Missing `prompt_id` or `tool_use_id` sends nothing, so missing evidence never clears attention. Esc during a dialog fires no `Stop`, so the marker stays until the next prompt or #185 recovery, as before. A storage failure follows the owner's existing fault semantics. Rollback to the previous owner keeps working: older owners already accept `attention.resolved`, and an older setup package rejects the upgraded receipt, so roll setup back by removing with this version first.
