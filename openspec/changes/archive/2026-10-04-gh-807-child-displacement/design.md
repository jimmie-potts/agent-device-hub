## Context

`agent-state` caps active records at 128, and each expires 24 hours after its last lifecycle evidence. Every subagent is its own child record, so a session that runs many subagents fills the owner for a day. The original design (#105) rejected new identities when full and never discarded state to make room. The installed Hub sat full for about 12 hours with 114 child records, dropping new root tasks.

## Decisions

- **Who may displace.** Only an event that would create a root session: one whose parent is not `known`, which covers both `top-level` and `unknown`. It must pass every earlier admission check (staleness, guards, archive evidence and the reducer producing a session) before anything is removed, so a stale, archived or non-creating event never costs a record.
- **Who is displaced.** A child record (parent `known`) whose whole subtree (itself and its known descendants) is finished, meaning activity `idle`, `interrupted` or `ended`, and holds no attention. Among those, the subtree whose newest `lastEvidenceAtMs` is oldest goes, with ties broken by identity key. A running subagent therefore never disappears to make room: a Claude Code subagent reports only at start, permission request and stop, so its own evidence ages while it runs, but its activity stays `active`, or `unknown` after real `SubagentStart`/`SubagentStop` hooks. The same holds for a pending approval anywhere in the subtree. In the installed owner, 94 of 118 child records were `idle` and none was `active`, so the rule still frees space.
- **How.** Through the existing `retire()` path, which removes the subtree in one durable replacement and keeps retirement guards. The displaced records' later events other than an eligible start are rejected as stale instead of re-creating them, and a fresh `session.started` or `turn.started` for that identity is still eligible like any retired identity. The guards share the 128-identity retirement memory with runtime ends, so sustained saturation evicts older end guards sooner. That is within the documented best-effort limit.
- **Spec consistency.** "Runtime-end retirement" names this displacement as the one other early removal besides expiry.
- **Visibility.** Each displacement increments the existing loss count, which hosts already surface. No new snapshot field or schema.
- **Unchanged.** New children are rejected when full, roots are never displaced, and with no eligible child the root is rejected as `capacity`.

## Timing and failure

Displacement and admission are two commits inside the same serialized ingest. If the root's own commit then fails, the child stays retired. That loses only a subagent record that already met the eligibility rule, and the store stays consistent. A failed retirement returns its own outcome, and the root is not admitted.

## Privacy

No new data is read, stored or sent. Outcomes stay fixed and content-free.

## Acceptance examples

| Example | Test |
| --- | --- |
| Full owner, new root: the finished subtree with the oldest evidence retired, loss +1, two revisions, later child event stale | `capacity.test.mjs` "displaces the finished child subtree" |
| Subtree evidence ranks: a child whose grandchild worked recently stays | `capacity.test.mjs` "subtree evidence ranks children" |
| Running (`active`), real-hook `unknown` and attended subtrees stay; with none eligible the root is rejected | `capacity.test.mjs` "never displaced" |
| New child: capacity, nothing removed | `capacity.test.mjs` "rejects a new child" |
| Non-creating acknowledgment, guarded retired root and old observation displace nothing | `capacity.test.mjs` "would not create a root" |
| Archived Codex Desktop conversation displaces nothing; a live one does | `capacity.test.mjs` "archived Codex Desktop" |
| A failed displacement commit admits nothing and leaves the child | `capacity.test.mjs` "failed displacement" |
