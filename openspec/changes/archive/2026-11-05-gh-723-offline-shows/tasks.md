## 1. Private immutable library

- [x] 1.1 Add meaningful failing storage tests, then implement guarded immutable versions, exact encoded-byte/count bounds and canonical recipes; verify earlier versions, conflicts and capacity through reopen tests.
- [x] 1.2 Initialize additive tables without altering prior data; verify existing favorites, configuration and control state survive repeated initialization and injected transaction failure preserves the complete prior state.

## 2. Owned module boundary

- [x] 2.1 Add registered profile-2.0 show catalog/save schemas, atomic metadata-only command outcomes and bounded immutable content reads; verify real module SDK tests for invalid input, mixed-family sync, recovery, trace/ack and no device-state or writer changes.
- [x] 2.2 Verify malformed identities, unknown/corrupt versions, aborted reads and full-storage refusal with fixed registry errors and unchanged private data.

## 3. Offline editor

- [x] 3.1 Add module-owned starter drafts, cue editing, version selection and labelled semantic storyboard; verify pure draft/preview behavior and no server dependencies in the browser bundle.
- [x] 3.2 Add guarded explicit saves through the retained shared command attempt and a catalog-qualified Audio link; verify read-only/stale/conflict/uncertain states keep drafts without automatic resend.
- [x] 3.3 Extend the existing disposable Nanoleaf browser journey for create/edit/save/version preview, no device commands, keyboard, light/dark and 320/390px accessibility; keep private screenshots and actual results.

## 4. Delivery evidence

- [x] 4.1 Update owning guides and validation coverage, run build/type/lint, affected contract and Nanoleaf/runtime/dashboard checks plus full applicable browser/smoke and workflow checks; record actual results and unrelated failures.
- [x] 4.2 Complete current OpenSpec lookups, synchronize and archive the implemented capability; validate the final specification inventory and freeze the committed comparison for independent Standards/Specification and storage-focused review. Revision-specific review/CI receipts remain outside the reviewed commit.

## Implemented evidence

- Storage and module admission were first exercised with failing tests, then passed with immutable versions, exact byte/count limits, stale guards and rollback. The focused storage/module/migration run passed 30 tests. Full Nanoleaf passed 600 tests with one declared macOS `/proc` skip.
- A delayed initial sync result failed the freshness regression before the fix. The current focused show storage/module/model/feed/timeline run passes 32 tests. Browser bundling and root typecheck verify that the editor does not import server dependencies.
- The disposable real gateway/core/module browser journey passes create/edit/save, immutable version inspection, cancelled and failed reads retaining drafts, late-result fencing, stale 409, read-credential and Origin 403, malformed 400, uncertain retention and no resend. It verifies unchanged device output, write count, command history and wall configuration. Normal observation reads may continue.
- A separate private browser acceptance sends one synthetic save to the owner, replaces its HTTP reply with `uncertain-result` and verifies that the actual observed completion unlocks the confirmed version, reload sends nothing and device writes remain zero.
- All six light/dark desktop, 390 px and 320 px accessibility/overflow checks pass. Synthetic desktop and phone screenshots were inspected. The full local dashboard browser command and local smoke command exit zero. These runs establish no hosted CI, installation or physical output evidence.
- Root build, typecheck and lint exit zero. Dashboard units pass 173/173, profile-2.0 event tests 238/238 and retained Node contract consumers 410/410. Workflow prechecks pass with 280/280 executable workflow tests.
- macOS SDK and runtime failures remain recorded separately for platform qualification. The SDK result was 397/398 with one `EPIPE`; runtime was 871 passing, 35 failing and seven skipped. Shared failing files are unchanged by this comparison. On the unchanged product snapshot, Linux build and all 398 SDK tests pass. The first full Linux runtime run had one failure and one cancelled timeout in unchanged tests. Both exact cases passed on recheck, followed by the full unchanged runtime suite at 1,019 passing, six declared environment skips, zero failures/cancellations. Focused show storage/module/migration tests also pass 30/30 on Linux. Original failures and successful recheck are retained privately; no unrelated repair was made.
- Current status, archive, specs and apply lookups succeeded. The four new library requirements are synchronized into the main specification; the existing timeline requirements remain unchanged. At the initial source checkpoint, strict workflow validation passed 94 specifications, zero active changes and 264 archived changes; executable workflow tests passed 280/280. Revision-specific independent reviews and hosted CI remain outside this artifact.

- Hosted scenario validation caught an exact health-family assertion that still expected the pre-library family list. The assertion now includes `nanoleaf-shows` while retaining exact equality. Both Nanoleaf wall scenarios pass over in-process and remote transports after the correction; root build and lint pass. The original hosted failure remains recorded in the PR. No product behavior changed.

- Integration onto renderer source `48605348b49f726eb2a67f9fb43b948e4e117b70` resolved only adjacent README sections, preserving both complete sections. Exact comparisons preserve all 36 other changed files and all 20 incoming-only files. Renewed build, typecheck, lint, 617 Nanoleaf tests with one declared platform skip, the complete wall/show browser journey and 280 workflow tests pass. The integrated inventory is 94 specifications, zero active changes and 265 archives. This evidence establishes source behavior only.
