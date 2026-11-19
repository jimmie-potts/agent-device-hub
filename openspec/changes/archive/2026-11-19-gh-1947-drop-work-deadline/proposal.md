## Why

[#1947](https://github.com/jimmie-potts/agent-device-hub/issues/1947), part of epic [#1896](https://github.com/jimmie-potts/agent-device-hub/issues/1896), amends [#1865](https://github.com/jimmie-potts/agent-device-hub/issues/1865). #1865 made running work "unconfirmed (deadline)" five minutes after its last qualifying work evidence on the current turn. A client that works quietly for longer, such as Codex on the Mac (no tool events) or one long tool call, then shows as unconfirmed while it works. The owner decided on 2026-11-19 (recorded on #1947) to drop the five-minute timer and show each session's evidence age instead. This amends the aging part of #1865 design decision 4; its restart rule is unchanged.

## What changes

- The core has no work deadline: `SESSION_LIMITS.workDeadlineMs`, the `deadlineUnconfirmed` marking, the `deadline` transition input, its scheduling and the private progress time `progressAtMs` go. Silence never changes a claim. Expiry after 24 hours and the restart marking keep their behavior.
- `session/3.0`'s work claim no longer carries the reason `deadline`, and the schema enum drops it (design decision 2 states the evidence).
- Approval recovery (`approval-recover`) is allowed only while a core restart left the session's running work unconfirmed.
- A record's evidence time is part of its public meaning at a one-minute resolution (`SESSION_LIMITS.evidenceResolutionMs`), so its `lastEvidenceAtMs` stays within a minute of the hub's last evidence for a busy session. A busy session publishes for its evidence alone at most once a minute; a silent one never.
- The dashboard's session card shows "Heard Nm ago" on its face and in its disclosure, computed against the page's clock from the record's `lastEvidenceAtMs`, with no polling and no new read path.
- The shared case set and every reader's tests and fixtures stop creating deadline cases; restart cases keep their coverage.

## Capabilities

### New capabilities

None.

### Modified capabilities

- `bunny-runtime`: no work deadline; silence changes no claim; approval recovery follows the restart marking; the evidence time publishes at a one-minute resolution; a due expiry replaces the due deadline in the backoff scenario.
- `bunny-message-profile`: `session/3.0` drops the `deadline` reason; the record builder never makes work unconfirmed from silence.
- `runtime-dashboard`: each session row shows its evidence age; silence marks no row uncertain.
- `agent-status-cards`: the card face shows the evidence age; silence marks no card.
- `bunny-reachy`: the unconfirmed-work scenario names a restart.
- `nanoleaf-module`: silent working tasks keep working; only work a restart left unconfirmed holds steady.

## Impact

- Code: `apps/runtime/src/core/session/` (model, transition, record, children), `apps/runtime/src/core/store.ts`, `core.ts`, `gateway/mcp.ts`; `packages/event-contracts` (schema, types, `buildSession`, the case set, the `approval-recover` description); `apps/runtime/dashboard/src/` (sessions, the status card and its CSS).
- Tests and fixtures in the runtime, the dashboard, Nanoleaf, Tidbyt, Codex Desktop, companions and the contracts package.
- Docs: `apps/runtime/README.md`, `apps/runtime/dashboard/README.md`, `packages/event-contracts/README.md` and `MAPPING.md`, `docs/provider-qualification.md`.
- No new message family, no new read path, no storage migration. Delivery is source-only; installation stays with the #1869 batch.
