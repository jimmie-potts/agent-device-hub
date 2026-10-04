## Context

`agent-state` caps active records at 128, and each expires 24 hours after its last lifecycle evidence. Every subagent is its own child record, so a session that runs many subagents fills the owner for a day. The original design (#105) rejected new identities when full and never discarded state to make room. The installed Hub sat full for about 12 hours with 114 child records, dropping new root tasks.

## Decisions

- **Who may displace.** Only an event that would create a root session: one whose parent is not `known`, which covers both `top-level` and `unknown`. It must pass every earlier admission check (staleness, guards, archive evidence and the reducer producing a session) before anything is removed, so a stale, archived or non-creating event never costs a record.
- **Who is displaced.** The child record (parent `known`) with the oldest `lastEvidenceAtMs`, ties broken by identity key, whose subtree (itself and its known descendants) holds no attention. A pending subagent approval therefore never disappears to make room.
- **How.** Through the existing `retire()` path, which removes the subtree in one durable replacement and keeps retirement guards. The displaced child's delayed events are rejected as stale instead of re-creating it, and a fresh `session.started` for that identity is still eligible like any retired identity.
- **Visibility.** Each displacement increments the existing loss count, which hosts already surface. No new snapshot field or schema.
- **Unchanged.** New children are rejected when full, roots are never displaced, and with no eligible child the root is rejected as `capacity`.

## Timing and failure

Displacement and admission are two commits inside the same serialized ingest. If the root's own commit then fails, the child stays retired. That loses only a subagent record that already met the eligibility rule, and the store stays consistent. A failed retirement returns its own outcome, and the root is not admitted.

## Privacy

No new data is read, stored or sent. Outcomes stay fixed and content-free.

## Acceptance examples

| Example | Test |
| --- | --- |
| Full owner, new root: least recently active child and its descendants retired, loss +1, root admitted, delayed child event stale | `capacity.test.mjs` "displaces the least recently active child" |
| Child whose descendant awaits approval is skipped for the next eligible child | `capacity.test.mjs` "descendant awaits attention" |
| New child, or every child attended: capacity, nothing removed | `capacity.test.mjs` "still rejects" |
| Unknown end displaces nothing | `capacity.test.mjs` "would not create a root" |
| Archived Codex Desktop conversation displaces nothing; a live one does | `capacity.test.mjs` "archived Codex Desktop" |
