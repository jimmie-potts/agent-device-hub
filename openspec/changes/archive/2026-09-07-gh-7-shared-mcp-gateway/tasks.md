## 1. Package and validation foundation

- [x] 1.1 Add the MCP workspace, exact SDK/schema pins and package build/type/test commands to docs/development.md and configured Ubuntu/Windows CI; verify npm ci and existing workflow/contract checks still pass.
- [x] 1.2 Record the shipped SDK LICENSE, integrity, selected protocol versions and controller artifact provenance; verify the recorded hashes against the actual downloaded/packed files.
- [x] 1.3 Add a focused failing test for a default-bound status call against a fake owning service before implementing the module; record the meaningful red/green evidence in the delivery receipt.

## 2. Registry, typed tools and results

- [x] 2.1 Implement the immutable service registry, explicit device tools and default-device binding; verify duplicate/missing bindings, scoped discovery and hostile argument cases.
- [x] 2.2 Implement strict power/brightness inputs and snapshot/receipt result validation using controller API 1.0; verify integer/range/unknown-field failures, unsupported capability and unknown observation cases.
- [x] 2.3 Delegate unchanged request identity, revisions and generations to the owner; verify browser/MCP concurrency, in-flight join, exact replay, changed-payload conflict, expiry and stale revision/generation without a second execution.
- [x] 2.4 Preserve structured/text results, priorEffects and operation evidence; verify queued, partial, uncertain, cancelled, invalid-controller-output and post-dispatch timeout outcomes without automatic retry.

## 3. Transport and authentication

- [x] 3.1 Add the opt-in embeddable Node SDK handler with bounded principal-bound sessions and explicit supported versions; verify initialization, missing/expired/wrong-principal session, version rejection and disabled endpoint through real loopback HTTP.
- [x] 3.2 Add bearer verification, current scopes, exact Host/supplied-Origin and Fetch-Metadata checks; verify missing/browser/revoked credentials, cross-device access, malformed/duplicate headers and rotation before replay/discovery.
- [x] 3.3 Enforce input/output, session, authentication and outstanding-operation bounds; verify overload before dispatch, slow/chunked bodies, verifier/controller hangs and release after settlement.
- [x] 3.4 Implement explicit pre-dispatch cancellation and delivery-only teardown after dispatch; verify cancellation, socket close, session DELETE/expiry and module close leave admitted fake playback running with no retry.
- [x] 3.5 Publish conservative read/write annotations and evidence-limited descriptions; verify the full tool list and schemas against approved fixture expectations.

## 4. Protocol clients and distribution

- [x] 4.1 Add Codex-style and Claude-style synthetic HTTP client fixtures plus an independent SDK-client round trip; verify initialization, discovery, calls, errors and cancellation for every advertised protocol version.
- [x] 4.2 Build a private npm archive with the pinned private contracts bundled, manifest, fixture corpus and notices; verify all hashes, import it outside the checkout and run the fake protocol suite without private registry access.
- [x] 4.3 Document the exact downstream API and private-release/vendor adoption path for Pixoo #24 and Nanoleaf #33; verify example consumers typecheck and use no sibling path, credential provisioning or physical transport.
- [x] 4.4 Update README, architecture, development and compatibility documentation to reflect the delivered module and separate installed-client/physical acceptance; verify the specification inventory and workflow checks.

## 5. Source acceptance evidence

- [x] 5.1 Run build, typecheck, contracts in TypeScript/Python, contracts packaging, MCP unit/protocol/package checks and workflow checks under supported runtimes; retain all command results and fixture counts.
- [x] 5.2 Complete the source acceptance matrix and distributable candidate, recording installed-client and physical checks as separately owned gaps; verify every issue criterion has its test or artifact evidence.

After these source tasks, follow docs/sdlc.md for successful current OpenSpec lookups, synchronization/archive, independent fixed-commit Standards/Specification reviews, configured CI, guarded merge and main-CI readback. Publish the immutable private release and read back its checksum/import before closing Hub #7. Keep those revision-specific receipts outside this reviewed commit.

## Source validation evidence

The default-bound status and HTTP initialization fixtures failed before their
implementations and passed afterward. A malformed UTF-8 initialization fixture
then reproduced replacement decoding; fatal decoding rejected the same input.
Node 24 build/typecheck, all 63 MCP tool/protocol tests, 223 TypeScript contract
tests, Python contract fixtures, isolated contract and MCP package installs,
consumer examples, corruption rejection and 10 workflow fixtures passed locally.
The MCP package includes the unchanged verified contract release. Tests use fake
services and synthetic credentials. Installed Codex/Claude and physical-device
acceptance remain with the device repositories. Exact platform/revision receipts
and the temporary user-approved local-validation exception stay outside the
source commit in the delivery record and PR.

Review regressions cover cancellation and response-stream cleanup, current-principal
tool discovery, embedded output-schema references and complete JSON-RPC response
bounds. The pinned SDK JSON lifecycle adapter is isolated and documented.
