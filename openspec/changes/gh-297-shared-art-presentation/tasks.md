## 1. Contracts and coverage

- [x] 1.1 Refresh the exact prerequisite interfaces, ADR 0012 and affected guides; record any design changes and verify all three deltas with strict OpenSpec validation.
- [x] 1.2 Add the new build/type/contract/browser/runtime checks to development guidance and CI before product implementation; verify workflow checks and current inventory.
- [ ] 1.3 Add closed art-auto/2.1 and art/2.1 schemas and shared types while retaining 2.0 definitions; observe focused contract refusals before implementation and pass TypeScript/Python contract consumers afterwards.

## 2. Art owner

- [ ] 2.1 Implement durable saved-art preparation with a linked tracked stage and terminal outcome; prove pending admission differs from success, target failure is independent, and no provider call or display effect occurs.
- [ ] 2.2 Preserve exact-request deduplication and mark pending preparation uncertain after restart; demonstrate no stage resend, receipt conflict refusal and storage rollback with real stores.
- [ ] 2.3 Commit browser selection and publish versioned state; prove older selected art survives pruning and restart, explicit deletion clears selection atomically and failed selection preserves the previous reference.

## 3. Core automation and widget

- [ ] 3.1 Extend the existing automation owner with current configured art targets and per-device plans; prove noncanonical identities, stale/absent/held capability refusal, distinct durations and independent common-start hand-offs.
- [ ] 3.2 Refuse art-bearing moment requests from any non-core requester at the tracker; observe the regression fail before the guard and pass afterwards without changing ordinary moments.
- [ ] 3.3 Follow authoritative browser selection through existing authenticated content and decoded presentation; verify older-page selection, slow/obsolete/failed decoding and zero provider or device calls from browsing.
- [ ] 3.4 Bind the complete plan identity before dispatch; prove late preparation cannot revive changed timing before or after reopening the store, failed storage sends nothing, and post-policy deadlines still refuse.

## 4. Assembled evidence and delivery

- [ ] 4.1 Exercise the same saved idea through the real producer, core tracker, Pixoo, Tidbyt and browser with synthetic providers/devices; verify independent results, no replay and no additional generation.
- [ ] 4.2 Capture and inspect a labelled disposable browser journey, including unavailable-target evidence and actual selected art; verify all artifacts and cleanup, without claiming physical display accuracy.
- [ ] 4.3 Run build then lint, type, required shared contract/package/Python/workflow checks, affected owner tests and dashboard browser checks; preserve any initial failures with their disposition.
- [ ] 4.4 Obtain independent Standards, Specification, focused safety and acceptance on one committed comparison; resolve findings and confirm applicable hosted CI before merge.
- [ ] 4.5 Refresh successful OpenSpec lookups, synchronize all affected specs and archive the change before final review; reconcile the accepted slice and #684 prerequisite while keeping #297 open for lighting.
