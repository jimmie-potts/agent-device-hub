# Explicit client read receipts

Research dates: 2026-10-31 and 2026-11-01. The completed contract delivery in
[Hub #1341](https://github.com/jimmie-potts/agent-device-hub/issues/1341) follows
[#1324](https://github.com/jimmie-potts/agent-device-hub/issues/1324).
[#1354](https://github.com/jimmie-potts/agent-device-hub/issues/1354) owns runtime
adoption and its remaining acceptance. This note records source and disposable
experiment findings; installed qualification remains separate.

## What the contract changes

The old lifecycle and session contracts reserve read evidence for Codex Desktop.
Shared Mac Codex sessions have a different identity, and Claude sessions use
`claude/code`. Relabeling them would join unrelated evidence. The new opt-in
lifecycle/2.1 contract preserves identity and binds a qualified read action to
one owner generation, turn and finished notice. Its pure reference rejects
missing qualification and obsolete targets. See the
[contract guide](../../packages/event-contracts/README.md#explicit-client-read-receipts-lifecycle21-opt-in).

Default SDK registration still refuses lifecycle/2.1. The adopting runtime
explicitly registers it and stores qualified provenance in its core-owned
record, publishing session/2.1. The retained state owner and session/2.0 remain
unchanged. The [runtime guide](../../apps/runtime/READ-RECEIPTS.md) describes
the qualified producer and its enrollment boundaries.

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

Codex's [stored-state implementation](https://github.com/openai/codex/blob/f79b26ccbb3116b052544666a181012fb45dc49b/codex-rs/state/src/runtime/thread_read_state.rs#L73)
uses `initial:<thread-id>` before a receipt row exists and a UUID after an update.
The contract preserves both token forms. An initial state is not a read action;
the reviewed Desktop class can skip that state. Admitting its token does not
qualify stock Desktop behavior.

The protocol permits a client to mark a thread read; that does not identify
which UI was viewed. A production observer must observe the real client's
successful action without issuing an update itself. Native snapshots, output
events and absent unread markers do not establish readership. No polling path
to the Hub is added.

The owner completed a manual disposable Desktop check on 2026-11-01 using
Desktop 26.1027.30824, build 22943, and bundled 0.166.0-alpha.5.1. Opening one
completed synthetic thread produced its matching native read request and
successful response. Independent API readback confirmed that thread read and
an unopened control still unread at its original revision. The owner confirmed
that no sign-in screen appeared. The temporary application and profile were
removed; original metadata remains private. This is operator-confirmed UI
action plus native metadata, not direct computer-use observation or installed
B.U.N.N.Y. acceptance.

Same-process tests on both native versions found that `thread/resume` subscribes
a loaded connection, while `thread/read` alone does not. Another connection's
read update produces the same subscribed notification without reader identity.
Unsubscribe and reconnect do not replay the missed change. The selected
collector therefore observes Desktop's own request and successful response,
with its target frozen before the request reaches the native process.

The available computer-use tool refused access to ChatGPT. The manual route
respects that restriction; no alternate UI automation was used. The earlier
installed-code tests exercised the receipt class with synthetic dependencies
and remain distinct from the operator-run check.

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

The follow-up T3 inspection at
[8760d063](https://github.com/pingdotgg/t3code/blob/8760d063e903406c8e8f695b0852c0a15fc1e00f/packages/client-runtime/src/state/threadVisits.ts)
found the same application-owned visit policy. It does not qualify another
application's UI. Existing host-session metadata can route a Claude session
but cannot establish a read.

## Claude terminal qualification

Native Claude Code 2.1.292 supports a terminal plugin that exposes an explicit
button. Disposable real-UI tests found that its extension `turnId` differs from
the lifecycle hook's `prompt_id`. The sequence UserPromptSubmit, turn.start,
Stop and turn.complete supplies the correlation. An older open panel retains
both its original native turn and lifecycle prompt after another result.

The delivered plugin and helper were then exercised against a disposable Linux
runtime with existing lifecycle hooks. Completion and panel opening left read
unknown. A real terminal mouse press produced the matching session/2.1 receipt
and displayed confirmation. After another completion, a late click on the old
panel left the newer record unchanged. Reopening selected the newer turn and
its button produced the matching read. Notice acknowledgments, attention and
lifecycle timestamps remained unchanged.

The native test caught and corrected two integration defects: a fractional SDK
deadline in the executable and an incorrectly shaped native redraw call. The
executable has a gateway regression test; native plugin validation and its
offline rendering tests also pass. These native and synthetic checks cover
different boundaries and do not substitute for installed acceptance.

Tests used temporary Claude homes, synthetic prompts, a dummy key and a loopback
model endpoint. Tools and MCP were disabled, external model traffic was denied,
and no owner configuration or credentials were used. The test container had no
installed volumes or device modules. Temporary profiles and the test container
were removed. Qualification is limited to this Claude terminal version;
Claude Desktop remains unqualified. Codex's permitted manual action evidence
and version-bound collector are described above and in the runtime guide.

## Collection and evidence boundaries

Only declared identity, target and receipt metadata crosses the new contract.
The [private-data policy](../decisions/0011-private-personal-data-retention.md)
and [diagnostic contract](../observability-contract.md) still apply. The
experiments retained private scripts and synthetic results; this publication
contains sanitized findings only. Valid payloads and passing source checks
qualify neither a producer nor a live state consumer.
