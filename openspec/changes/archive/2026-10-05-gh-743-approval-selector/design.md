## Context

Send types one Enter into the verified composer. An open approval card must block it: in Codex, focus moves to a card button that Enter activates; in Claude, the composer keeps focus while the card is open, so the composer-focus re-check does not catch it. The UI Automation helper already serves composer focus and the Codex selected row, scoped to the client's foreground window, and never reads text except the documented title comparison.

## Decisions

- **Counts in the helper, decisions in the adapter.** The helper returns `{ approvalCards }` for Claude or `{ composers }` for Codex. The adapter turns counts into answers, so the portable tests cover every decision with a fake helper.
- **Bounded and read-only.** One `FindAll(Descendants)` from the target window with a control-type condition (`Group` or `Edit`), caching only `ClassName`, then an exact token match with `HasToken`. No `TreeWalker` loop, which loops in the Codex tree, and no Name, Value or focus read.
- **Offscreen counts.** `FindAll` includes offscreen elements, so a pending Claude card scrolled out of view still blocks Send.
- **Codex with no composer is unknown, not `true`.** The evidence shows that a card removes the composer, not that every missing composer means a card: another view could hide it too. Unknown with the reason `codex-composer-absent` keeps the observation honest, and the router refuses either way. Several composers (a case not observed, such as a pop-out) are unknown too.
- **Not in front is unknown.** Unlike composer focus, where `false` is the safe answer, `false` here would allow Send, so a client that is not in front answers unknown (`codex-not-foreground`, `claude-not-foreground`).
- **No interface version change.** The method and its `Observation<boolean>` result already exist in interface version 2.

## Risks

- Other card kinds, such as a Codex patch approval, were not opened. The rules assume they carry the same token (Claude) or replace the composer (Codex). The composer-focus re-check is a second guard for any card that takes focus.
- A client update can rename the token or restructure the card. Re-qualification with a card open in each client goes with the qualified-version list.
- Claude's question card blocks Send as well, even though Hub `question` attention does not. Telling the two cards apart would need structure beyond the shared token, which was not qualified.

## Acceptance examples

| Example | Test |
| --- | --- |
| Claude: one or more cards is `true`, none is `false`, malformed counts and helper failures are unknown | `windows-adapter.test.mjs` |
| Codex: one composer is `false`, none is `codex-composer-absent`, several is `codex-composer-count`, malformed replies are unknown | `windows-adapter.test.mjs` |
| Client not in front, no foreground window, foreground change, invalid client and closed adapter are unknown without a window query | `windows-adapter.test.mjs` |
| The helper operation is dispatched, scoped by `TargetWindow`, uses `FindAll` with control-type conditions and token checks, and reads no Name, Value or focus | `windows-uia-helper.test.mjs` |
| The operation runs against the live Codex window and replies with a composer count | `native.mjs` (native Windows check) |
