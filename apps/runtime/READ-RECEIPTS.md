# Explicit read receipts

The qualified producer is Claude Code **2.1.292 in a terminal**. After a reply
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
Codex and Claude Desktop read-receipt production remain disabled. Codex
protocol experiments do not establish an actual Desktop view; that needs a
permitted actual-client test and its own qualification before admission changes.

## Verify and disable

Use a disposable session and runtime first. Check that completion and opening
the panel leave read unknown, one button press produces the matching receipt,
and a panel retained across another completion cannot mark the newer reply.
Reopen and confirm the newer reply. Also test missing credentials, unavailable
runtime and session clear. Inspect only declared metadata, privately; keep
native identifiers, tokens and diagnostic originals out of Git and GitHub.

Installed acceptance repeats the selected supported path after the runtime and
host artifacts are deployed. Removing the plugin selection or disabling its
private producer file stops future observations without erasing committed
evidence. Do not infer backward storage compatibility merely from unchanged
table names; assess the exact previous release under the owning upgrade guide.
