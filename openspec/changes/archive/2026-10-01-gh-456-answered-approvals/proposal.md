## Why

[Hub #456](https://github.com/jimmie-potts/agent-device-hub/issues/456): Claude Code's `PermissionRequest` hook carries no request ID, and no installed hook fires after the owner answers the dialog. The owner forgets a no-ID approval only when a newer turn retires its turn (#225), so devices stay amber until the next prompt. In the #22 trial, `pendant-1` stayed amber for about a minute and four minutes after answered question dialogs.

## What Changes

- The Claude Code producer maps `PostToolUse` and `PostToolUseFailure` to `attention.resolved` with the known `tool_use_id` on the `prompt_id` turn. It sends nothing without either field, from a child agent or for Codex. `tool_response`, `tool_input` and `cwd` never enter the envelope.
- A known-ID resolution on turn T also forgets that session's no-ID approvals on T. A `turn.ended` on T forgets them too, which covers a denied dialog that fires no tool hook. Questions, input markers, other turns and other sessions are unchanged.
- Setup generates the two events for Claude Code sources. Re-applying setup on an installed receipt from the previous event list adds exactly those entries and keeps the credential. Plan, inspection and removal accept that receipt.
- The packaged hook reads up to 8 MiB of stdin, because `PostToolUse` carries the whole `tool_response`.
- Publish agent-state 3.4.0 and Hub 0.4.1. No envelope change: lifecycle 1.0 and 1.1 already carry `attention.resolved`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-state-core`: answered and ended-turn approvals without a request ID.
- `agent-provider-emitters`: Claude tool-completion evidence.
- `shared-monitor-installation`: re-apply on an installed receipt from the previous event list.

## Impact

Shared agent-state normalizer and reducer, Hub setup and packaged hook, tests, the provider-qualification and lifecycle-contract docs, the agent-state and setup guides and package manifests. Device consumers need no change. The turn-end rule also applies to Codex no-ID approvals; Codex hooks are unchanged. Installation is a separate setup re-apply by a named owner.
