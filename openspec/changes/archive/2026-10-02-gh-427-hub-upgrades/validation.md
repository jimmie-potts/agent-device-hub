# Source acceptance

The implementation is for Hub #427. Installed acceptance remains in that issue and requires the owner checkpoint after merge and merged-main CI. No installed service, hook, credential, host configuration or device was changed by this source work.

## Executable evidence

At `d1f84471a4727c083b19103fc98ef817f9b4b1d7`, all 20 required commands exited zero under Node 24 and Python 3.14: build, typecheck, controller contract tests in both languages and package, lifecycle tests in both languages and package, agent-state tests in both languages and package, MCP unit/protocol/package, Hub unit/package/MCP, setup and both workflow checks.

The subsequent installer correction passed all 29 updater tests: protected executables use a bounded streaming hash, and planning uses the existing read-only running-build observation. Final affected checks are recorded in the PR on its committed candidate.

Meaningful red/green cases cover provenance and archive validation, changed approval inputs, unknown compatibility before stop, operation ownership, first-adoption interruptions, failed health/recovery, final receipt failure, safe retention and source comparison. A recovery regression demonstrated that a candidate could lose original records yet report verified rollback; recovery now checks both original and newer records. A sparse fixture matching the installed Node binary size demonstrated the old file-read limit and passes with streamed hashing.

The two-process synthetic compatibility probe writes and reopens owner/source identity, revisions, labels, notices, acknowledgments, retirement and deduplication records, automation rules/settings and event history. Fake effects run once before reopening and do not repeat afterward. Operation fixtures cover full-provenance and hash-only first adoption, legacy health without build metadata, both shared-runtime adoption orders, rollback and re-upgrade with newer records, and inspection barriers. These tests never read live state.

Pinned consumer checks passed against Pixoo `47c0fb2681ee27807f88a3a07bd713ab05bcdc81` and Nanoleaf `f3c13843f1e5431b01ddca344a91cd7484348f59`: shared monitoring, Pixoo handoff/renderer and Nanoleaf HTTP settings. They use disposable state and suppressed physical writers. The shared harness requires its small temporary state under `/tmp/hub-shared-*`; an initial run using a different TMPDIR failed that existing assertion, then the canonical-path run passed. Source archives and builds remained on disk.

## Instruction discovery

Fresh read-only Claude Code and Codex sessions started at the worktree root with the exact request `upgrade the installed hub to main`. Both read the root instructions and setup procedure, proposed `plan main` and required approval of its exact inputs before `upgrade`. Neither ran plan, installation or service commands. Hooks were disabled for these sessions. Both sessions exited zero. The Codex probe could not refresh GitHub issue/CI state and reported that limitation; instruction discovery was still observed. Requested models/effort were advisory and runtime reasoning stayed unknown.

Inspection covered the ordinary delivery completion condition, source-only batching exception, direct upgrade/rollback trigger, unchanged CLAUDE import and the SDLC link to the single authoritative procedure. The later added/removed-commit wording did not change those instruction routes.

## Acceptance boundary

The source plan is archived after synchronization. PR review and CI evidence are revision-specific and remain on the PR. Actual migration, upgrade, rollback and re-upgrade, with private receipts, running identity and latest-state preservation, remain pending; source and synthetic checks do not satisfy them.

## Review corrections in progress

The first independent review found a live SQLite reader/writer conflict, overly
strict comparisons of mutable and retained state, incomplete recovery sequences
in the shared-layout fixtures, and a stale setup link. The correction pauses the
owner around an isolated bounded read and checks health after resumption. A real
synthetic owner accepts a queued write afterward without faulting. State tests
exercise label, settings, rule and interrupt-set edits, rule deletion and normal
session/journal/retirement expiry. Both shared-layout fixtures now include failed
candidate health, recovery and re-upgrade with other-owner path checks.

Focused checks have passed; complete affected checks and fresh independent review
are pending for the corrected candidate. The earlier instruction-discovery runs
prove routing to the procedure; they did not inspect the new pause wording.
