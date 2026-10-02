# Source validation

This change is linked to https://github.com/jimmie-potts/agent-device-hub/issues/470. Validation uses synthetic data only. Installation and personal-data qualification remain separate.

## Acceptance evidence

| Boundary | Executable evidence |
| --- | --- |
| Real collector contract and consistent numeric projections | `tests/wispr_hub_producer.test.mjs` regenerates the bundled collector fixture; `apps/hub/tests/wispr.test.mjs` serves it through real HTTP and checks summary, series, app, heatmap and export math, coverage, timezone and identity. |
| Source authorization | No credential, generic and wrong-source tokens, disallowed Origin, retired sessions and pending credential revocation reject; launcher exposure and unchanged device grants are checked. |
| File and cache safety | Missing, malformed, oversized, unsupported schema, old revision, clear-generation, symlink and hardlink fixtures exercise last-good numeric retention, text suppression and sanitized errors. Sharing violations follow the same caught file-read failure path; native filesystem lock behavior is not claimed by these Linux tests. |
| Bounded processing | Twelve simultaneous clients retain independent health responses; an actual worker stalled for ten seconds is retired at the 2500 ms response deadline. Row and response limits reject without truncation. |
| Language and export permissions | Both opt-ins, exact presets/subgroups, unknown algorithms, expiry, collection opt-out and in-flight Hub sharing opt-out are covered. Numeric exports omit text; CSV formula prefixes are neutralized. JSON remains inert data for a separately tested dashboard consumer. |
| Offline delivery | `scripts/package-hub.mjs --test` builds twice, verifies reproducibility, extracts without network access and runs Hub tests including the producer contract fixture and stalled worker case. |

## Local checks

Node 24 and Python 3.14 were used. The following completed successfully: build, typecheck, controller contracts (TypeScript and Python), lifecycle (TypeScript, Python and package), agent-state (TypeScript, Python and package), MCP (service, protocol and package), Hub (HTTP, MCP and package), shared setup, workflow validation/tests and controller package checks. These existing CI jobs invoke the changed Hub test command and offline archive tests.

The final focused run passed 17 tests: 16 Hub Wispr cases plus producer-fixture agreement. The full Hub run before the added stalled-worker case passed 242 tests. The updated offline archive passed isolated tests and reproducibility; its precommit manifest truthfully records an unknown source revision. The frozen revision's final archive receipt is retained outside Git to avoid a revision/hash cycle.

One unchanged agent-state hook test exceeded its 250 ms deadline while an independent package job was running. Its three isolated tests passed, then the full 191-test agent-state suite passed without the concurrent package job. No unrelated source or assertions were changed. The failed run is retained alongside successful reruns.

Raw logs and receipts are retained in the coordinating checkout's `.local/evidence/wispr-source-goal/`, including `470-focused-final.log`, `470-hub-1.log`, `470-package-2.log`, `470-serial-checks.json`, build/typecheck and individual shared-check logs. Pre-implementation failures for authorization/query, health, algorithm compatibility and the deadline seam are retained there too.

## Remaining delivery gates

The first independent Standards round found two defects: worker replacement
forgot accepted identity/clear fences, and the cloud-path filter missed the
unspaced `iCloudDrive` component. Regression tests reproduced both before the
corrections and then passed. The focused suite now has 19 passing tests, including
real worker replacement with restored old text, namespace replacement and recovery
to the accepted generation. Both configured paths reject cloud-folder spellings.
These corrections require independent review of the new committed candidate.

Independent Standards and Specification reviews must assess the same committed base/head, including authorization and the private-file boundary. Required PR CI, guarded merge, merged-revision CI and tracker reconciliation remain coordinator gates. This source candidate does not establish installed Windows ACLs, live Wispr field meanings, recurring collection or dashboard acceptance.
