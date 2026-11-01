# Explicit read receipts

The Claude producer supports Code **2.1.292 in a terminal**. After a reply
finishes, `/bunny-read` opens a panel for that reply. Only pressing **I read this
reply** requests a read transition. The panel reports success after the core's
session stream confirms the commit. Opening, rendering, model completion and
tool output alone never mark a reply read. This records an explicit action,
not comprehension.

The extension maps the native `turnId` to the classic hook's `prompt_id`; these
are different identifiers. A root `UserPromptSubmit`, `turn.start`, `Stop` and
successful `turn.complete` must agree on their session and prompt. The panel
freezes that selection. Missing mapping, child turns, aborted turns, failures, session clear,
another Claude version or another rendering surface cannot produce an action.
Reopening after a new completion selects the new reply.

## Owner and contract

The Node helper performs one existing SDK sync when opening a panel. It binds
the full identity, known prompt, session generation, finished notice and an
opaque `viewRevision` equal to `session-<record revision>`. The core compares
that token for equality only. Any intervening session revision makes the panel
stale, including a new turn, native unread update, label/freshness change or
restart. Reopen the panel to bind a current target. No polling loop or provider
read-update request is added.

The explicit click sends a lifecycle/2.1 occurrence through the authenticated
gateway. The core rechecks the target in its serialized operation and commits
read provenance, history and outbox in its existing SQLite transaction. The
state stream then publishes session/2.1. A repeated action cannot advance the
same record twice. A disconnected or timed-out helper reports unconfirmed;
the core may have committed before connection loss. The helper does not retry.

Read evidence does not acknowledge notices for consumers, resolve attention,
refresh lifecycle timestamps or establish connectivity. There is no retained
agent-state 1.x schema change or new database table. A later incompatible turn
or admitted native read observation removes the receipt provenance. Restart
preserves committed evidence and the existing uncertainty rules.

## Select a producer

Installation is a coordinated operator action on the selected runtime and
Claude profile. Source tests do not enroll an installed client. Follow the
[Mac container procedure](../../docs/bunny-container.md) for that installation;
the WSL upgrade guide does not manage the Mac container. Preserve existing
credentials and coordinate the installation writer before any change.

Use the same `provider: claude`, `client: code`, `hostId` and `sourceId` as the
existing Claude lifecycle producer. Do not rename that feed or reuse its
ingest-only token. The read producer needs a separate, randomly generated
43-character base64url token and precisely `read` and `ingest` scopes. Its
source is `receiptSource(feed)`, exported by
`@jimmie-potts/runtime/read-receipts`. This derives
`bunny/parts/claude-read-<32 hex characters>` from the full feed and
`feed: claude-terminal-read-2.1.292`. The distinct grant is the trusted opt-in;
a payload cannot qualify itself. Its credential ID is the source without
`bunny/parts/`. Store only the token digest in the runtime credential list.

The ordinary runtime credential parser and selected container profile must
admit this grant. The host-local browser profile permits only its existing
single ingest-only grant and cannot enroll this helper. Do not widen that
profile as a shortcut. Use an already selected profile that permits ordinary
scoped credentials and verify admission before changing installed state.

Keep a private producer file outside Git, mode `0600`, in its own directory:

```json
{
  "enabled": true,
  "qualified": true,
  "endpoint": "http://127.0.0.1:18788/api/monitor/v1/events",
  "source": {
    "provider": "claude",
    "client": "code",
    "hostId": "MATCH_THE_EXISTING_HOOK",
    "sourceId": "MATCH_THE_EXISTING_HOOK",
    "feed": "claude-terminal-read-2.1.292"
  },
  "token": "GENERATE_AND_STORE_PRIVATELY"
}
```

These placeholders are not runnable credentials. The file uses the existing
producer checks: owner-only regular file, one link, no followed file link,
8 KiB limit and exact fields. Omit `lifecycleVersion`; the helper accepts no
content enrichment. A local file may have no enrollment receipt. If a
`receipt.json` is present beside it, it must be private, installed and match
the producer. A remote endpoint requires the existing `private-https`
transport and a matching installed receipt. Do not share a directory with
another producer's receipt.

Select matching reviewed host artifacts and Node 24. Set absolute paths in
the selected terminal's environment, not in Git:

```text
BUNNY_READ_NODE=/absolute/path/to/node
BUNNY_READ_HELPER=/reviewed/release/apps/runtime/bin/claude-read.mjs
BUNNY_CLAUDE_READ_PRODUCER=/private/read-producer/producer.json
claude --plugin-dir /reviewed/release/apps/runtime/plugins/claude-read
```

The environment variables must be exported. The helper's release must include
its built workspace packages. Loading the plugin is explicit; it changes no
personal settings or lifecycle hook configuration. Disabled hooks or managed
plugin restrictions can prevent loading. The extension runs the helper as an
argument vector without a shell, on explicit panel actions only. Each child
ends within 2.7 seconds; each native call has a 2.8-second limit. Helper output
stays in the extension and carries no model prompt or permission decision.

The receipt credential cannot publish activity, Desktop metadata or another
feed's receipts. Ordinary hook credentials cannot publish qualified receipts.
Claude Desktop remains unqualified. The separately enrolled Codex Desktop
path is described below; it does not change this Claude plugin or its checks.

## Codex Desktop

The selected version is Desktop **26.1027.30824**, build **22943**, with bundled
`codex-cli 0.166.0-alpha.5.1` on macOS. An operator-run disposable test established
that opening a completed thread caused Desktop's own successful read request,
while an unopened control remained unread. It did not establish comprehension.
Installed acceptance must still verify the selected runtime and launcher.

`bin/codex-with-read.mjs` starts that application with a passive stdio observer
for its bundled app-server. The observer forwards native bytes unchanged,
including stderr, and injects no requests. It recognizes the qualified Desktop
initialization and its native request sequence. It requires an unread snapshot,
a subsequent latest completed-turn selection and a read request with the same
revision. Before forwarding the request, it freezes the already-synchronized
B.U.N.N.Y. identity, turn, generation and finished notice. Only the matching
successful response with cleared unread state and a changed native revision
can produce a `provider-client` receipt.

The producer follows the core through SDK sync and the live stream. It never
polls the Hub. A gap, newer turn, explicit unread, stale revision, failed request
or missing target discards the candidate. A later sync enables future actions
only. Shared read notifications and snapshots alone cannot assert readership;
another client can produce those same notifications. This producer does not
add native title, archive or explicit-unread synchronization for `codex/local`.

The core rechecks the exact generation, turn and notice in its existing
transaction. A stable action ID and retained receipt provenance prevent replay
from making another transition, including after restart. This branch uses the
native seen/accepted revisions. Claude continues to require its displayed
record's `viewRevision`. Neither branch changes attention, acknowledgment or
observation freshness.

Create a separate private producer as above, using the existing Codex lifecycle
feed's `provider: codex`, `client: local`, `hostId` and `sourceId`. Do not relabel
it `desktop`. Set `source.feed` to
`codex-desktop-read-26.1027.30824-22943-0.166.0-alpha.5.1` and omit
`lifecycleVersion`. Derive its source with `codexReceiptSource(feed)` from
`apps/runtime/dist/src/read-receipts/qualification.js` in the reviewed release.
Grant that `bunny/parts/codex-read-<digest>` source precisely `read` and `ingest`
with a new token. The ordinary hooks and Claude credential cannot publish its
receipts. Keep the file private and verify both credential scopes under the
owning installation procedure before selecting the launcher.

Use Node 24 and the built reviewed host release:

```sh
node /reviewed/release/apps/runtime/bin/codex-with-read.mjs --check /Applications/ChatGPT.app /private/codex-read/producer.json
node /reviewed/release/apps/runtime/bin/codex-with-read.mjs /Applications/ChatGPT.app /private/codex-read/producer.json
```

Replace the release and producer paths. `--check` inspects versions only; it
does not open the UI, enroll credentials or prove installed acceptance. The
normal command is an explicit operator launch. Quit the existing application
through its normal UI first, preserving ongoing work. An existing singleton
instance can keep its original connection, so launching another process alone
does not establish enrollment. No personal settings, lifecycle hooks or app
files are edited. An unsupported version starts normally without this
collection selection. Returning to the normal launcher or disabling the
producer stops future collection; retain the release while any observer uses it.

Correlation expires after 30 seconds. Per connection, collection stops on an
invalid frame, reused request ID, a frame above 1 MiB, more than 128 pending
requests, 256 selected threads or 65,536 distinct request IDs. A chunk with
more than 256 frames also stops collection. These limits preserve native
forwarding and require a new controlled connection before collection resumes.
Publication has at most four calls in flight and a 2.4-second deadline, with no
queue or retry. A refused or uncertain publication records no local claim of
success. Collection failures never request agent permissions or wait for a
device. Raw native content and credentials are never logged or published by
the observer.

## Verify and disable

Use a disposable session and runtime first. Check that completion and opening
the panel leave read unknown, one button press produces the matching receipt,
and a panel retained across another completion cannot mark the newer reply.
Reopen and confirm the newer reply. Also test missing credentials, unavailable
runtime and session clear. Inspect only declared metadata, privately; keep
native identifiers, tokens and diagnostic originals out of Git and GitHub.

For Codex, start with two completed synthetic threads and matching lifecycle
records. Open one through the controlled Desktop instance and leave the other
unopened. Independently verify the committed identity, current turn, finished
notice and native revisions in the runtime, and the untouched control. A
protocol client sending a read request is a native integration test, not UI
acceptance. Where computer-use access is restricted, use an operator action
and independent metadata readback without bypassing that restriction.

Installed acceptance repeats the selected supported path after the runtime and
host artifacts are deployed. Removing the plugin selection or disabling its
private producer file stops future observations without erasing committed
evidence. Do not infer backward storage compatibility merely from unchanged
table names; assess the exact previous release under the owning upgrade guide.
