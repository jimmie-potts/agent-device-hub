## 1. Current-turn contract and reducer

- [ ] 1.1 Obtain independent specification and quality inspection of this design against #137 and current source before accepting its dependent implementation.
- [ ] 1.2 Demonstrate the ordinary normalized start/stop/next-start regression failing, implement eligible current-turn selection and matching completion, and retain the same test passing.
- [ ] 1.3 Verify delayed/duplicate events, genuine ordering, missing identity, two sessions, independent attention/acknowledgment, differing consumer policies and 256-entry retirement eviction with focused reducer tests.
- [ ] 1.4 Verify recovery from a frozen old ambiguous export, restart/freshness, retained state and existing TypeScript/Python snapshot compatibility without a schema migration.

## 2. Hook, consumer and distribution integration

- [ ] 2.1 Exercise actual packaged hooks against the host for ordinary unordered lifecycle, duplicates, session isolation and privacy/authentication/deadlines; require the same behavior from the isolated new Hub archive.
- [ ] 2.2 Verify both pinned real consumer projections using disposable state and fake device transports, including selected activity and independent completion acknowledgment.
- [ ] 2.3 Publish candidate package versions in source, update exact build pins, and verify reproducible agent-state/Hub archives and external consumer imports with unchanged version 1.0 schemas.

## 3. Documentation and whole-candidate validation

- [ ] 3.1 Update state/architecture/development documentation and the installed-update runbook; inspect the stated evidence limits, version compatibility, hashes and no-reset procedure.
- [ ] 3.2 Refresh the maintained guide inputs and narrative, regenerate HTML, and pass maintenance, browser/print and no-drift checks while retaining concurrent deliveries.
- [ ] 3.3 Run all required build/type, controller/lifecycle/state/MCP, host/setup/package, workflow and applicable consumer checks; retain actual outcomes and the specification inventory outside the candidate commit.
- [ ] 3.4 Synchronize affected specifications and archive this completed source change before final independent Standards/Specification review and hosted CI.

## Acceptance mapping and ownership

The coordinator owns all source, Git and tracker writes. The design task reviewer returns independent specification/quality findings before task 1.2 implementation. Tasks 1.2 through 2.3 form one dependent behavior change, accepted at the whole-candidate integration boundary; passing isolated tests do not claim separate delivery. Final Standards and Specification reviewers inspect the same committed base/head. No explicit round/time/spend limit was supplied; retain failures and renew affected evidence after corrections.

| #137 criterion | Tasks and evidence |
| --- | --- |
| Start/stop selection and retained completion | 1.2, 2.1 ordinary normalizer and packaged-hook regressions |
| Consumer clearing and independent attention | 1.3, 2.2 scoped acknowledgment/attention and real consumer checks |
| Duplicates, superseded events and bounded identities | 1.3 eviction, reordered and duplicate transition checks |
| Missing/conflicting evidence, freshness and sessions | 1.3, 1.4 identity, genuine ordering, timeout and restart checks |
| Existing ambiguous session recovery | 1.4 old saved-format fixture plus preserved labels/notices/attention |
| Preserve evidence, distinguish diagnostics | 1.3 qualified envelope regressions and 3.1 documentation inspection |
| Two consumers and protected hooks/client compatibility | 2.1, 2.2 plus existing CLI/Claude, privacy, authentication and deadline suites |
| Reproducible release and update instructions | 2.3, 3.1 immutable version/hash/source receipts and runbook |

Hub #2/#3/#8 are delivered required inputs. PRs #135/#136 are shared-file coordination, not prerequisite functionality. Installed update and real Desktop/Pixoo retest remain Pixoo #34. Reset #138, history #139, public guide publication and physical operations are excluded.
