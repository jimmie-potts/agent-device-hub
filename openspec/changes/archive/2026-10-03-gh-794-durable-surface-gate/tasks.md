## 1. Acceptance examples first

- [x] 1.1 Add a shared copied-release fixture and encode acceptance examples 1 to 5 in `install-compatibility.test.mjs`. Move the schema-newline negative control to `durable-v2.1.schema.json`. Evidence: the new examples fail against the whole-package fingerprint and the unextended probe.
- [x] 1.2 Add an operation test that feeds real qualification results for examples 1 to 5 into `executeOperation`. Evidence: example 1 succeeds; the others end `refused` with no service effect, and the evidence file records each qualification result.

## 2. Durable surface and probe

- [x] 2.1 Replace the whole-package fingerprint with the classified durable surface and fail-closed rules from the design, keeping reason codes and refusal before stop, and record the qualification result in evidence before the status check. Evidence: examples 1, 2, 3 and 5 pass, and unknown durable code is never executed.
- [x] 2.2 Extend the synthetic probe with title, project, project ID, agent label origin, metadata time and a known parent, and add `metadata` and `parents` to the qualification records. Evidence: example 4 and the full write/reopen test pass.

## 3. Documentation and validation

- [x] 3.1 Update the compatibility text in `apps/hub/SETUP.md` and `docs/install-contract.md`. Evidence: both name the durable surface rule and keep the no-force and reviewed-migration statements.
- [x] 3.2 Run build, typecheck, contract, Python contract, package, Hub, Hub package, setup and workflow checks from the worktree root. Evidence: every command exits zero with recorded counts.
- [x] 3.3 Synchronize `hub-runtime-upgrades` and archive this change on the delivery branch. Evidence: the main spec keeps its blank line after `## Purpose`, and workflow checks pass with the actual specification inventory.

## 4. Review round 1

- [x] 4.1 Make every lifecycle module durable with an initially empty non-durable list, and require the agent-state entrypoint to export the fingerprinted `validateExport` and `migrateExport` in both probe modes. Evidence: the loosened parent-rule counterexample and a poisoned lifecycle `index.js` refuse with `durable-implementation-unqualified`, a rebinding entrypoint fails with `durable-reopen-probe-failed`, and all three failed against the reviewed head.
- [x] 4.2 Pin the cross-source parent rejection in a Hub-owned test (`apps/hub/tests/durable-parent-rule.test.mjs`), leaving the published lifecycle 1.1.0 corpus unchanged, and correct the fail-closed and invariant wording in the design, spec, install contract and setup guide. Evidence: the Hub test, the unchanged lifecycle contract tests and the workflow checks pass.
