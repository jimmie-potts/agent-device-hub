## Context

See proposal.md and #1354. The core already serializes lifecycle intake and commits its session records, history and outbox in one SQLite transaction. It also owns host-session metadata outside the retained agent-state JSON row. Lifecycle/2.1 is available but opt-in.

Native Claude 2.1.292 testing found that extension turnId differs from classic prompt_id. The observed root sequence is UserPromptSubmit, turn.start, Stop, turn.complete. Both identifiers remain stable when an older pane is clicked after another completion.

## Goals / Non-Goals

Preserve exact result targeting and make read evidence durable without widening retained 1.x schemas or adding another session owner. Qualify the Claude terminal version explicitly. Automatic viewport detection, comprehension claims, transcript collection and device operations are outside this design.

## Decisions

1. The extension captures only native session/prompt IDs from root classic hooks and the native turn ID at turn.start. A successful root completion requires the same mapped prompt at Stop. Session end/clear and failed or aborted turns invalidate selection. An open pane keeps an immutable target. Content fields pass through untouched and are never inspected.
2. The explicit pane command calls a bounded Node helper. It uses the existing SDK sync once, selects only the exact completed session/prompt, and returns generation, notice and an opaque view revision derived from that session record's revision. There is no timer or polling loop. The click sends the frozen lifecycle/2.1 receipt. The helper observes the state stream for confirmation and reports an unconfirmed result on timeout without retry.
3. The dedicated producer uses the existing private producer-file and receipt checks. Its authenticated source is derived from the full feed plus the qualified Claude terminal implementation identifier. Granting its distinct read/ingest credential is the trusted opt-in. Ordinary hook credentials cannot grant themselves receipt qualification. The helper and extension reject unqualified native versions or nonterminal rendering. The runtime admits no provider-client receipt until Codex Desktop is qualified.
4. The core rechecks the reference eligibility and exact opaque view revision inside its serialized operation. Equality binds the view to a current owner record; opaque revisions are never ordered. Any intervening session revision conservatively refuses the old view, including a later unread update or restart. A repeated click cannot clear anything twice because the first commit advances the revision.
5. The receipt becomes optional provenance on the core-owned session record, published as session/2.1. Other records retain session/2.0. The existing core_records row persists it with the revision, history and outbox. Retained agent-state storage stays unchanged. Projection retains evidence only while generation, turn, completed notice and eligible activity still match; an admitted native read update invalidates it.
6. Shared core-family registration adds the session output version for current consumers. Lifecycle/2.1 remains separately registered by the adopting runtime. Legacy schemas remain byte-for-byte unchanged. No credential format or scope widening is required.

## Risks / Trade-offs

- A metadata or freshness update can make an open pane stale. Reopening binds a current view. This conservative refusal avoids adding an owner token service or weakening the later-unread fence.
- The native hook API is version-specific. Only the observed terminal version is enabled; other versions show unavailable until qualified.
- A disconnected helper cannot establish commit. It reports unconfirmed and does not replay. A read published before disconnect may still commit.
- Failed SQLite commit changes neither records nor publication. Existing outbox recovery republishes a committed receipt without generating another action.
- Source checks cannot establish actual Desktop behavior or installed credentials. Those gates remain separate on the issue.

## Migration Plan

Deploy the contracts, owner, consumer validation and helper together through a reviewed PR. Current records load without receipt provenance. No retained agent-state format migration or new database table is needed. Keep the new producer disabled until its selected native version and installed path pass acceptance. Disabling the producer stops future observations without deleting evidence. Recovery follows the owning Mac container procedure and its exact release compatibility assessment; do not assume an old binary can consume new session records.

