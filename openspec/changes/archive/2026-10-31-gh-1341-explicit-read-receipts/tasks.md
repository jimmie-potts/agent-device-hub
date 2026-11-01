## 1. Opt-in contract

- [x] 1.1 Add the closed lifecycle/2.1 receipt variant, typed opt-in registration and package export; verify valid Codex/Claude fixtures, existing lifecycle compatibility, malformed metadata refusal and unchanged default registration.
- [x] 1.2 Add the pure receipt reference decision; verify source/feed/kind qualification, identity/generation/turn/notice binding, finished-state checks, independent freshness and immutable inputs, including a failing negative control.

## 2. Evidence and documentation

- [x] 2.1 Continue disposable native Codex tests for a successful final response and separate observer delivery; retain sanitized results and identify the actual-UI gap without bypassing the tool restriction.
- [x] 2.2 Document the contract's source-only adoption boundary and Claude applicability; check the public source citations, declared metadata and remaining runtime/projection qualification work.

## 3. Validation

- [x] 3.1 Run the required build, type, lint, event/lifecycle/controller compatibility, SDK consumer and workflow checks; verify the focused tests detect omitted registration or a stale-target guard, and record the actual specification inventory before synchronization and archive.

Validation: build, typecheck and lint passed on Node 24.22.0. Event tests passed
204/204, controller tests 410/410 and lifecycle tests 140/140. Python 3.14
event/controller/lifecycle checks and both retained package-consumer checks
passed. Removing the generation guard made the delayed-receipt test fail;
restoring it passed the receipt suite. The native initial-revision test failed
before the provider-token correction; all nine receipt tests then passed. Workflow validation reported 83
valid specs and one valid active change, and all 241 workflow tests passed.

The existing SDK oversized-request test failed with `EPIPE` on macOS, including
in isolation. The complete unchanged SDK suite passed 396/396 in a disposable
offline Linux Node 24.22.1 container, using the lockfile-pinned Linux esbuild
binary. No SDK repair was included. The initial Linux setup had the Mac esbuild
binary and was corrected before the passing run. Both installed Codex versions
passed successful-turn, stale-receipt and separate-observer experiments; the
research note records their evidence limits. Review and hosted CI belong in the
PR, separately from these local source checks.
