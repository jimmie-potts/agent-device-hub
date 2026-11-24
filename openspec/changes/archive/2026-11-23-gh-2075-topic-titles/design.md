## Context

See proposal.md for why. Today `ConversationTitles` (`modules/companions/src/assistant/titles.ts`) writes a title when `started()` counts the first or third task of an appearance, or when the engine reports an accepted coding hand-off. `generate()` aborts any call in flight and starts a new one. A rename stores an owner title, advances the record's generation and is never replaced. The engine calls the title code after a commit, because the outbox opens its own synchronous transaction and a title call's admission is one.

## Goals / Non-Goals

**Goals:** checks at a finished task and at each major event the engine already records; one call per conversation; coalesced follow-ups; a fixed-form event label; KEEP; a rename that the model may later replace.

**Non-Goals:** new major events beyond the four the issue lists; a durable queue of checks across restarts; any wire, table or section change; New conversation (#2029), whose fresh conversation is untitled and so gets its first title by the first-message rule.

## Decisions

1. **Triggers are engine commits, fired after the commit.** A finished task is any transition to `succeeded`, `failed` or `cancelled`: `#change` notes the transition in its transaction and asks for a check once it commits, and the cancel control does the same after its reply. An answered approval is checked from the input's admission, a state-changing tool call when `#act` records a dispatch the core accepted, an accepted hand-off where #2025 already checked it, and a hand-off result when `deliver` records the worker's word. A start of the module starts no check, as a start starts no work: startup reconciliation runs under a starting flag, and the coding coordinator marks its settlement at start of a hand-off left pending at the last stop, which then reaches its task without a check. Alternative: deriving triggers from the session reports in `#report`, which run inside every transaction; rejected because the check cannot start inside a transaction and a rolled-back report would still have asked for one.
2. **The first message is checked only while the conversation is untitled.** `started()` now answers whether the conversation has no title. No count of tasks or time since the last message is kept or read; the record's `turns` field from #2025 is left as it was and no longer written.
3. **KEEP is a plain-text answer.** The instruction asks for `KEEP` alone, which normalization reads in any case with quotes, emphasis or trailing punctuation, or inside the `{"title": ...}` unwrap. Alternative: a JSON answer for both outcomes; rejected because the instruction already asks for plain text and the normalization reads it, so one more literal is the smaller change. A real one-word title `Keep` is no longer possible; the cost is negligible.
4. **One run per conversation with one pending list.** `check()` starts a run when none is in flight. Otherwise it adds the event's label to the run's pending list, each label once, oldest first, keeping the latest `TITLE_EVENTS` (4). When a call settles, the run starts one follow-up with the pending labels, until none remain. The run gives up the conversation's slot in the same synchronous step that finds no label waiting, so a trigger after that step starts a new run instead of joining one that has ended. Alternative: keeping only the latest label; rejected because a state change followed by a finished task would lose the more telling label.
5. **Each admitted check advances the generation, as a rename does.** The settle transaction drops an answer whose generation is no longer the record's, so a late answer after a rename or after a newer check can never be applied, whatever the in-memory run does. A refused check advances nothing.
6. **A rename drops the run's pending follow-up.** The rename is the newest word on the title, so triggers that arrived before it are not checked against it. Triggers after it start or join a run as usual.
7. **The owner's title is context, not a lock.** The prompt names the source (`set by the owner`), and the fixed instruction tells the model to keep such a title unless the topic has clearly changed since. A new title then replaces it with source generated, published as `provider`. Alternative: a stronger lock, for example only replacing an owner title after several checks agree; not chosen because the owner asked for the model to decide, and it would bring back a count.

## Risks / Trade-offs

- [More paid calls than #2025: one per finished task and major event, KEEP included] → each is a small Haiku call reserved in the shared spend limits, and coalescing bounds a burst to one call in flight and one follow-up per conversation.
- [The model may replace an owner's title sooner than the owner expects] → the instruction states the owner's choice and the clear-change test; the owner can rename again; the call record keeps the answer and events for diagnosis.
- [Pending checks live in memory only] → a restart loses them, which drops checks, never repeats one; the next trigger checks again. Nothing is retried (ADR 0012).
- [A label is new prompt text] → labels are fixed module text with at most a tool identifier from the tool definitions, a decision or an outcome word; tool results stay out, as ADR 0011 requires.

## Migration Plan

No migration. The release reads #2025 title records unchanged and writes no task count. Returning to #2025 needs no step; `apps/runtime/UPGRADE.md` describes what that release does with records this one saved.
