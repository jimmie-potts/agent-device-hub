## Context

Each profile's conversation is one native session (#505). The companions module reports it in `lifecycle/2.2` with the persona as title. The core already accepts title-only metadata, `metadata-observed`, from Codex Desktop, and `lifecycle/2.2` admits it for the Codex Desktop identity only. The issue names the lift sources: Codex `thread_title.rs` at `a0436d69` and T3 Code `textGenerationUtils.ts` at `b4277089`.

## Goals / Non-Goals

**Goals:** a short model-written title per conversation, published without waiting for other activity; owner rename that always wins; failures that never touch a task; title usage recorded for the spend limits.

**Non-Goals:** titles for Claude and Codex sessions; a clear or reset of the owner's title; diagnostics events for title calls, which would need a new observability profile entry.

## Decisions

1. **Publishing: allow native `metadata-observed`, as `lifecycle/2.3`.** The issue offered this or carrying the title on the next lifecycle observation. Carrying it would leave a rename made while the conversation is idle, and a title that lands after a short task ended, invisible until unrelated activity. `lifecycle/2.2` forbids `metadata-observed` for the native identity in its schema, so allowing it needs a new minor version, not only the core change at `core.ts:754`. `lifecycle/2.3` widens the metadata identity condition to the native source, requires a title and forbids `archived` for it. The module sends only title metadata in 2.3 and keeps every other observation in 2.2, the lowest version that expresses it. The core's existing title transition applies it: it changes the title of a known root only, creates no session, refreshes no evidence and consumes no ordering sequence, so a title never keeps an expiring session alive. Every later lifecycle observation also carries the current title, so a reappearing session is titled from its first observation.
2. **When a title is written.** At the first task of an appearance, at its third task and at the first task after a day without lifecycle evidence, the core's session age. The module records the last instant it reported lifecycle evidence per conversation, and counts tasks per appearance. One refresh keeps calls few; the issue asks for "after a few turns".
3. **Compare before write.** A rename advances the conversation's title generation in its own transaction and abandons the call in flight after the commit. A call records the generation it started with, and its settle transaction drops the answer when the generation moved or the title is the owner's (Codex `expected_name`, T3 `titleRenamed`).
4. **Normalization.** Codex's quote trim, whitespace collapse and trailing `.?!` removal; T3's JSON unwrap, first-line rule and empty guard. Added: markdown heading or emphasis and a `Title:` label are removed, a literal placeholder such as `Title` is refused, this repository's name before `#n` is dropped, only the description is bounded (40 characters, at a word boundary), and the whole title must be session display text, the contract's control-character and credential check. A title that only repeats an owner message is refused, so raw prompt text never becomes a published title.
5. **Failure.** A failed, refused, invalid, abandoned or late title leaves the earlier title, or the persona name when none exists. Nothing is retried (ADR 0012). The task never waits for the title call, which starts after the task's admission commits.
6. **Spend.** A paid title call reserves its most expensive cost in #2024's shared spend ledger (`SpendLedger.reserve`, purpose `conversation`, owner the conversation ID, the call's ID) in its admission's transaction, with the request's input bound and the title call's 1,024-token output cap, and settles it with the reported usage; a lost or failed answer keeps the reservation counting. A refusal from the ledger, the spend limits or a missing price, sends nothing and leaves the persona. The section's price table needs an entry for the title model, and the section is refused without it. `assistant_title_calls` also keeps one record per call with its outcome. A title call counts toward no task's limits.
7. **Provider.** The title call uses the same key, transport, API version and error mapping as the turn provider, with `output_config.effort: low`, a 1,024-token cap and the model's default thinking. A refusal or a cut answer is no title. The synthetic provider writes the fixed `Synthetic conversation`.
8. **Rename.** `assistant-control/2.1` adds `rename` with `profile` and `title` (session display text, at most 80 characters, as the session label). A rename may open a profile's conversation before its first task; the title is then published with the first observation.

## Risks / Trade-offs

- [The three profiles' synthetic titles are the same text, and a titled session no longer names its persona] → Persona identity on the devices is a later design question; the issue keeps the persona only until a title exists.
- [A reader of an earlier release does not know `lifecycle/2.3`] → Only the core reads lifecycle observations, and it is released with this change.
- [Title call records grow without bound] → One record per appearance or refresh, a few hundred bytes each; the spend ledger needs the month's records.

## Migration Plan

The tables are created on first start. A conversation without a title record is a new appearance, so its next task is titled. No data is converted.
