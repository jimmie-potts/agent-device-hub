## 1. Compatibility behavior

- [x] 1.1 Add and run a failing regression in which a newer Desktop version performs the same native read sequence; retain the failure evidence.
- [x] 1.2 Replace exact launch and handshake version gates with selected-bundle and per-action protocol checks; verify old and new labels, native forwarding and unchanged enrollment.
- [x] 1.3 Exercise compatible extra fields and incompatible essential evidence, stale/replayed actions and collection failures with the focused receipt suites.

## 2. Qualification and delivery preparation

- [x] 2.1 Exercise the actual bundled native executable against a disposable synthetic profile and core; retain exact artifact versions, matching receipt and unopened-control evidence privately.
- [x] 2.2 Update operator and validation guidance, including stable enrollment, inspection limits and the scoped host update; verify instructions against the built launcher.
- [x] 2.3 Complete applicable build/type/lint, contract, SDK, workflow and affected runtime checks; synchronize the two capability deltas and archive after successful current lookups, before final committed review. Track hosted CI, source review and installed operator acceptance in the owning issue and PR.

## Verification evidence

The newer-version regression failed before the change and passes afterwards.
The focused receipt suite passes all 36 tests on macOS. Linux passes 35 with the
Mac-only synthetic launcher case skipped. The actual updated bundled native
executable commits the exact receipt, leaves the unopened control untouched,
refuses a stale action and does not replay an action during disconnection.
That exercise passes against both the delivery core and a disposable copy of the
installed core revision. It is protocol evidence, not a Desktop UI action.

The shared build, typecheck, JavaScript lint, event, controller contract, Python
contract, package-consumer and workflow checks pass. All 396 SDK tests pass in
Linux. On macOS, the unrelated existing SDK oversized-request case reports
EPIPE in both the full suite and its focused rerun; no SDK implementation changed.
The Python checks use the repository's pinned dependencies and Python 3.14.
Original logs and synthetic native metadata remain in private task evidence.
The operator guide was read back against the built launcher's inspection result;
normal-launch settings and installed UI acceptance remain outside this source
verification and are tracked in the issue.
