## Context

See proposal.md for the observed failure. At Hub main `25590e9c95ce334a516d2de0494584d67ea15a26`, `normalizeHook` retains native session/turn identity but deliberately emits unknown ordering. `reduceSession` requires comparable order to retire turns and makes conflicting unordered activity persistently unknown. The host already serializes and atomically commits reductions. Pixoo and Nanoleaf consume version 1.0 snapshots through their existing owners.

The OpenSpec design conditions apply because this change affects interacting state, persistence compatibility and recovery. Complexity is high, uncertainty medium and impact medium. The owner has accepted receipt-based status with an unseen-delayed-start limitation; no new product decision is required. Technical decisions below remain subject to independent review and executable checks.

## Goals / Non-Goals

The core alone selects current activity. Normalized observations retain their evidence limits. Consumer presentation, attention and acknowledgment remain independent. Use the existing exclusive store and version 1.0 schemas.

This does not add durable event capture, replay, task reset, a new installer, owner migration, UI changes or new client qualification. No personal state, service or device is used during delivery.

## Decisions

1. **Separate selection from provider ordering.** Use a known, previously unselected start as a receipt-based selection only when the session has no qualified activity ordering. Retain provider ordering as unknown and preserve all genuine epoch/sequence watermarks. A qualified source keeps its existing stronger precedence behavior; unordered observations cannot override it. Invented sequence numbers and sorting native IDs are rejected alternatives because they would misstate evidence.
2. **Protect terminal and superseded turns.** Use the existing selected turn, retained completion notices and `retiredTurns` to suppress repeated starts/stops and delayed old activity. A matching stop for the selected turn can complete it without comparable order. A completion received before its start must not be undone by that delayed start. Incompatible or missing turn evidence remains unknown. Unordered or retired-turn attention is handled under its original turn without changing current selection, so retiring activity does not dismiss an approval or prevent its exact resolution. Comparable qualified ordering retains the existing attention-first behavior: a newer attention observation can select its turn, retire the old turn and clear enabled old-turn notices before the delayed start arrives.
3. **Bound identities without changing storage shape.** Maintain `retiredTurns` as a 256-entry FIFO of distinct retired identities instead of refusing every subsequent retirement at saturation. Existing notices also retain completion identity, within their existing 128-notice capacity. The current turn, 256 retry keys and 256 ordering watermarks retain their existing bounds. Do not delete notices to make room. An evicted identity with no other retained evidence can be mistaken for new; rejection of arbitrarily old events is explicitly unsupported.
4. **Recover saved ambiguity in place.** A new eligible start replaces activity/current-turn ambiguity, retaining unknown ordering, parent uncertainty and unrelated evidence. Recoverable earlier turn identity comes only from the current selection, retired IDs and known-turn notices. Old hash-only retry entries cannot reconstruct lost turn IDs. Clear only retained prior known-turn completion notices for enabled consumers; unknown-turn notices remain explicit. Persist the result through the existing atomic commit. No migration or database editing is needed.
5. **Keep observation, calculation and diagnostics separate.** The normalizer's allowlist stays intact. Typed lifecycle envelopes continue to preserve qualified event IDs and ordering for validation/deduplication; unqualified raw fields do not become native evidence. The calculated snapshot keeps uncertainty fields. Journal entries remain bounded mutation summaries, not replayable event payloads or complete history.
6. **Release changed semantics explicitly.** Publish agent-state 2.0.0 and Hub 0.2.0 with snapshot/storage format 1.0. The major state-package version marks the deliberate behavior change. The Hub bundle must include the new state implementation and packaged-hook regression. Existing consumer validators accept the same shape; cross-repository checks verify actual consumer code. Previously published bytes remain untouched.

## Risks / Trade-offs

- An unseen delayed start can select the wrong turn and prematurely acknowledge covered notices. Keep ordering uncertainty visible and document that only later eligible evidence, or a future explicit reset, can correct selection; a timeout marks uncertainty rather than proving order.
- Remembered identities eventually expire. Test recent rejection and eviction behavior directly, including after restart. Retained notice capacity remains an explicit admission limit.
- Existing stores can contain ambiguity without recoverable historical turn IDs. Test a frozen pre-change export and preserve all recoverable state; do not claim retroactive deduplication guarantees.
- Shared package changes affect two languages and both real consumers. Retain existing suites, use fake physical transports, and run independent transition/persistence review plus final Standards and Specification reviews.
- Concurrent PRs #135/#136 overlap package scripts and guide inputs. The coordinator integrates only this branch, refreshes main, reconciles inputs and regenerates derived output before final review.

## Migration Plan

Source delivery packages and verifies immutable artifacts. The update runbook records source revision and hashes, then directs the separately authorized installation owner to stop the one host, retain a private consistent state/configuration backup, replace program artifacts, keep the same owner/source/consumer configuration and reopen the existing store. Run the packaged synthetic check independently of live data. A fresh real start must recover an existing ambiguous session; Pixoo #34 owns that installed check.

An older binary can read the unchanged format but restores its older conservative behavior. Any operational rollback must stop the current owner first and preserve the latest store; this issue does not automate rollback or restore an obsolete database copy. No live installation is performed by source delivery.
