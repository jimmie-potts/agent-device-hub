# Explicit client read receipts

Research date: 2026-10-31. [Hub #1341](https://github.com/jimmie-potts/agent-device-hub/issues/1341)
owns the contract delivery following [#1324](https://github.com/jimmie-potts/agent-device-hub/issues/1324).
Those issues own acceptance and remaining work. This note records source and
experiment findings, not installed qualification.

## What the contract changes

The old lifecycle and session contracts reserve read evidence for Codex Desktop.
Shared Mac Codex sessions have a different identity, and Claude sessions use
`claude/code`. Relabeling them would join unrelated evidence. The new opt-in
lifecycle/2.1 contract preserves identity and binds a qualified read action to
one owner generation, turn and finished notice. Its pure reference rejects
missing qualification and obsolete targets. See the
[contract guide](../../packages/event-contracts/README.md#explicit-client-read-receipts-lifecycle21-opt-in).

Default runtime and SDK validators still refuse this version. Neither the
retained state owner nor session/2.0 can preserve the new evidence yet. Their
later adoption must be coordinated with the producer and actual-client
qualification. No service, hook, provider setting or device changes here.

## Codex protocol experiment

Tests used standalone Codex 0.163.0 and the ChatGPT application's bundled
0.166.0-alpha.5.1. Each test created a private disposable home, used synthetic
prompts and a loopback Responses SSE endpoint, and removed its home afterward.
No owner transcript or credential was read, and no external model was called.
The initial cleanup encountered an asynchronous plugin child process; the probe
was corrected to stop its own process group before removing its home.

Both versions completed two successful turns containing a synthetic final
assistant message. Each completed turn acquired unread state. Reading
`thread/read` left that state unchanged. An explicit
`thread/readState/update` with the observed revision cleared it. Reusing that
revision after the next completed turn returned `readStateConflict` and left
the newer turn unread. These checks extend the earlier error-turn experiments
in the [reviewed research supplement](https://github.com/jimmie-potts/agent-device-hub/issues/1324#issuecomment-6551464046).

A second app-server process sharing only the disposable home could read the
same state. After a `thread/read` snapshot, it received no
`thread/readState/changed` notification during the two-second observation
window. A later snapshot saw the updated state. The process that performed
the read received notifications. This test establishes the limits of that
snapshot-only observer setup, not the absence of every possible subscription
route. The pinned processor publishes to its own subscribed connection IDs.
See [Codex's read-state processor](https://github.com/openai/codex/blob/f79b26ccbb3116b052544666a181012fb45dc49b/codex-rs/app-server/src/request_processors/thread_read_state.rs)
for the version-bound implementation.

The protocol permits a client to mark a thread read; that does not identify
which UI was viewed. A production observer must observe the real client's
successful action without issuing an update itself. Native snapshots, output
events and absent unread markers do not establish readership. No polling path
to the Hub is added.

Actual Desktop viewing remains unqualified. The available computer-use tool
refused access to ChatGPT, and no alternate automation route was used to bypass
that restriction. The prior installed-code tests exercised the application's
receipt class with synthetic dependencies; they were not a live UI test.

## T3 Code and Claude

T3 Code owns its UI and can record its own view policy. Its
[thread visit implementation](https://github.com/pingdotgg/t3code/blob/575579d68ac4bae09f8426a345d4a3eac1e90c67/packages/client-runtime/src/state/threadVisits.ts)
records visits when a thread view mounts and while the tracker remains mounted. This
supports the `owned-ui` contract branch. It cannot tell us whether a result in
a separate provider's application was viewed.

Claude's documented `MessageDisplay` hook also runs in non-interactive SDK and
CLI jobs. It establishes rendering, not a person's view action. Its message ID
is not a transcript message ID. See the
[Claude hook reference](https://code.claude.com/docs/en/hooks#messagedisplay).

The shared contract and reference accept qualified `claude/code` receipts, so
Claude can reuse the target and stale-evidence rules. A Claude-specific adapter
still needs a qualified reader signal. Existing host-session metadata helps
route a session but does not establish a read. Existing Claude lifecycle,
title/project and attention behavior is unchanged. An application we own can
use its own qualified view action for either provider.

## Collection and evidence boundaries

Only declared identity, target and receipt metadata crosses the new contract.
The [private-data policy](../decisions/0011-private-personal-data-retention.md)
and [diagnostic contract](../observability-contract.md) still apply. The
experiments retained private scripts and synthetic results; this publication
contains sanitized findings only. Valid payloads and passing source checks
qualify neither a producer nor a live state consumer.
