## 1. Acceptance examples first

- [ ] 1.1 Add a shared copied-release fixture and encode acceptance examples 1 to 5 in `install-compatibility.test.mjs`. Move the schema-newline negative control to `durable-v2.1.schema.json`. Evidence: the new examples fail against the whole-package fingerprint and the unextended probe.
- [ ] 1.2 Add an operation test that feeds real qualification results for examples 1 to 5 into `executeOperation`. Evidence: example 1 succeeds; the others end `refused` with no service effect.

## 2. Durable surface and probe

- [ ] 2.1 Replace the whole-package fingerprint with the classified durable surface and fail-closed rules from the design, keeping reason codes, evidence shape and refusal before stop. Evidence: examples 1, 2, 3 and 5 pass, and unknown durable code is never executed.
- [ ] 2.2 Extend the synthetic probe with title, project, project ID, agent label origin, metadata time and a known parent, and add `metadata` and `parents` to the qualification records. Evidence: example 4 and the full write/reopen test pass.

## 3. Documentation and validation

- [ ] 3.1 Update the compatibility text in `apps/hub/SETUP.md` and `docs/install-contract.md`. Evidence: both name the durable surface rule and keep the no-force and reviewed-migration statements.
- [ ] 3.2 Run build, typecheck, contract, Python contract, package, Hub, Hub package, setup and workflow checks from the worktree root. Evidence: every command exits zero with recorded counts.
- [ ] 3.3 Synchronize `hub-runtime-upgrades` and archive this change on the delivery branch. Evidence: the main spec keeps its blank line after `## Purpose`, and workflow checks pass with the actual specification inventory.
