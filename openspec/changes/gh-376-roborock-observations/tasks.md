## 1. Contracts and check wiring

- [ ] 1.1 Add the registered module package and browser entry, root build/type/workspace wiring, `test:roborock`/`:built`, consumer/browser checks and development/CI commands before product implementation; verify setup, registration loading and the workflow inventory without removing existing suites (AC5).
- [ ] 1.2 Define the complete `roborock-vacuum/2.0` status and bounded history/sample documents using shared blocks; exercise valid fixtures and invalid identity, time, unknown-field, unit/range and size cases in message and standalone consumer validators before downstream consumers (AC3).

## 2. Normalization and private persistence

- [ ] 2.1 Implement explicit object/positional normalizers from the pinned source; use red-green cases for absent/null/invalid values, unfamiliar codes, exact units, separate areas and totals, and rejected heuristic layouts; retain qualification provenance in the module guide (AC1–3).
- [ ] 2.2 Implement the module-owned archive, projections, robot identity and reconciliation queue; prove original synthetic values survive normalization, conflicting identifiers stay unassociated, summary subsets preserve old runs and restart deduplicates canonical records (AC2).
- [ ] 2.3 Qualify interrupted/full-disk transactions, exclusive ownership and private backup/recovery using real synthetic SQLite; show failed writes preserve the prior committed projection and stable observation IDs avoid duplicate recovery (AC2).

## 3. Collector and association evidence

- [ ] 3.1 Implement lazy private-secret loading, the injected transport seam, serialized cadence/backoff and stop fencing; prove inert startup, 60/15-second policy, no overlap, bounded failure/retry and no post-stop delivery with a fake transport/manual clock (AC2).
- [ ] 3.2 Implement observed episodes, bounded startup/end backfill, samples and gaps; prove docked counters, pause/charge/offline input, overlapping/mismatched records and downtime never invent completion or battery evidence (AC2).
- [ ] 3.3 Implement private run-end map BLOB/provenance retention after the run record commits; cover candidate success, failed/late/gap/newer-run conflicts, no startup historical capture and invariant unverified coverage (AC2).
- [ ] 3.4 Integrate projection and state publication with the Outbox; prove repeated publication refusal retains original observations with at most one queued state batch, then recovery/restart publishes the latest committed projection without repeating collection (AC2–3).

## 4. Runtime read boundaries

- [ ] 4.1 Serve complete device/status sync and bounded paged content reads with validated queries/cancellation; test both SDK transports, revision/evidence time, missing/unavailable input, bad cursors and message-size limits (AC3).
- [ ] 4.2 Add the read-scoped `status` tool and current document; exercise the real runtime MCP/gateway, output-schema admission, same-record results, unconfigured catalog and authentication/Origin/control refusals with zero vacuum controls (AC3–4).

## 5. Page and synthetic journey

- [ ] 5.1 Implement the React status/history/detail page using the shell API and synced copy; verify late-response retirement, cleanup, truthful age, paged selection and battery segments/text alternatives with focused frontend checks (AC4).
- [ ] 5.2 Add the browser journey for navigation, current status, run paging/detail, missing samples, stale/offline input, reconnect/re-entry, keyboard, narrow viewport, reduced motion and applicable accessibility; verify against the actual synthetic runtime and retain sanitized evidence (AC4).
- [ ] 5.3 Register the synthetic device and Roborock catalog scenario through existing module seams; pass it over both in-memory transports and in a disposable runtime, including page/content/MCP agreement, history/restart and permission refusals (AC3–5).

## 6. Source qualification

- [ ] 6.1 Complete the module guide's privacy, credential, source/firmware/clock/map limitations and private manual recovery instructions; verify synthetic personal fields are retained privately and excluded from publication examples (AC1–2, AC5).
- [ ] 6.2 Run fresh build/typecheck/strict lint, module/consumer/browser and affected SDK/event/runtime/MCP/dashboard/workflow checks, focused disposable scenarios and useful negative controls; retain the actual commands, inventory and limits outside the candidate, then synchronize/archive all affected specs after current lookups (AC5).

Independent Standards, Specification and Acceptance review, PR/main CI, tracker closeout, and any separately authorized installation/real-run comparison remain coordinator delivery gates. Checking these source tasks does not establish those stages or AC6.
