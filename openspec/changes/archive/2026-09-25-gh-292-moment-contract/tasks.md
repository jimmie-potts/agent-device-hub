## 1. Contract 1.1 shapes

- [x] 1.1 Add the 1.1 definitions without changing any 1.0 definition. Evidence: the schema diff is additions only; Ajv strict mode and jsonschema compile every definition.
- [x] 1.2 Add 56 schema cases for the moment command, the `moments` capability, 1.1 requests, receipts, snapshots and feeds, including rejection by the 1.0 definitions. Evidence: `test:contracts:built`, `test:contracts:python`.

## 2. Reference decisions

- [x] 2.1 Add hand-authored semantic cases before the reference code: 21 moment sequences, 11 admission cases and 2 downgrade cases. Evidence: 31 cases failed before implementation. The three already green cases confirmed that 1.0 behavior is unchanged.
- [x] 2.2 Implement 1.1 admission with 1.0 overloads unchanged, the moment reducer and `downgradeSnapshot` in TypeScript. Evidence: all 324 cases pass; the runner also validates the emitted 1.1 receipts, moment state and 1.0 views; the Tidbyt and LIFX typechecks still pass.
- [x] 2.3 Mirror the same decisions in Python. Evidence: `test:contracts:python` passes the same 324 cases.
- [x] 2.4 Apply the first review round: lateness at the scheduled start, `coversStatus` as a writer-applied permission, read negotiation with a 1.0 default (`negotiateApiVersion`), and cases for a flourish superseding a scheduled flourish, the device duration limit, 1.0 `feed` rejection and a mixed batch. Evidence: 11 new or changed semantic cases failed before the fix; all 324 pass after it.

## 3. Artifact, consumers and documentation

- [x] 3.1 Bump the artifact to 1.1.0 with served API versions in the manifest. Move the workspace pins and the lockfile, and bump the hub to 0.3.5 because its archive bundles the new contract. Keep the MCP archive bundling 1.0.0 with byte-identical `package.json`. Evidence: `test:package:built`, `test:mcp:package:built`, `test:hub:package:built`.
- [x] 3.2 Document API 1.1 in `docs/controller-contract.md`, and update the counts and MCP packaging note in `docs/development.md`. Evidence: review of the rendered sections.
- [x] 3.3 Run the shared build/type, contract, package, MCP, hub, setup, Tidbyt, LIFX, agent-state, lifecycle, performance, dashboard and workflow checks from the worktree root, and keep the results outside the candidate. Evidence: the PR validation record.

Synchronize `controller-contracts` and archive this change before final independent review. Current-head CI, guarded merge, merged-main checks, the `controller-contracts-v1.1.0` release and the issue readback remain SDLC gates. Device adoption belongs to Nanoleaf #158 and Pixoo #92.
