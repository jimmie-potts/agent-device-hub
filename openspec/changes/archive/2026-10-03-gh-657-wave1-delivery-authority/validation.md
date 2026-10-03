# Wave 1 source validation

The source change implements the independently actionable UI policy and the Hub
consumers of shared freshness/installation rules. It does not qualify unattended
execution, alter runtime APIs or installer algorithms, publish a package, or
operate an installed service or device.

## Focused regression

Before changing preflight, three focused cases failed as expected: a dashboard UI
change without approval was unresolved, a legacy UI declaration requested approval,
and the CLI rejected an ignored obsolete approval value. After the change, all
99 preflight tests pass, including new/non-Guide UI, absent approval, ignored legacy
inputs and retained independent review, CI and proof failures. Ignored values are
not fetched or echoed. The deleted tests exercised the obsolete approval parser
and path exemptions; the required verification gates remain tested.

## Instruction review

This is a static branch walkthrough, not a model experiment or fresh-host trial.
Codex reads root AGENTS.md; CLAUDE.md imports that same file. The root instructions
retain the procedure pointers, completion and authority boundaries.

| Task branch | Expected action and observed source coverage |
| --- | --- |
| Pick up an old issue after adjacent architecture changes | Read current issue/main, direction/ADRs/contracts, reusable components and new related work; record disposition in the existing assessment. AGENTS Start and scope and SDLC Scope defaults cover ordinary and skill-driven work. |
| Deliver within standing installation authority | After reviewed merge and main CI, review exact plan and complete included bundle, execute with its digest and verify identity/health/receipt. Root boundaries, SDLC, install contract and SETUP agree; no repeated approval prompt. |
| Explicit source-only request | Complete only that source scope with reason and installation owner/link; report overall installation pending. Read-only assessment performs no writes. |
| New host, changed ownership, unqualified migration or device operation | Existing standing authority does not expand; obtain missing authority or defer the dependent branch in unattended work. Digest drift, compatibility, recovery and physical-IP requirements remain. |
| Documentation and development-tool delivery | Verify the applicable installed instruction/tool readback; no service restart merely for prose. Source validation does not claim that later readback already occurred. |

## Existing checks

Node 24.21.0 and Python 3.14.4 were used. One fresh build precedes the documented
`:built` variants. Build/typecheck, preflight, workflow checks/tests, shared
controller contracts (TypeScript/Python and isolated package), lifecycle/state/MCP
suites and packages, Hub/setup/MCP suites and offline package, and dashboard unit
and browser suites passed before source archive. Workflow tests passed 18/18,
Hub tests 310/310 and dashboard unit tests 73/73. Full logs remain in the
coordinator’s private evidence directory.

The first Hub suite/package run used an overlong temporary path and failed three
Unix socket binds with EINVAL. Shortening the disposable external TMPDIR fixed
all 310 Hub tests and the extracted-package run without a source change. The
failed logs are retained with the successful retry. Temporary package identity
from the dirty source check is unknown, not a release or installation claim.

The specification inventory contains 38 capabilities. This change synchronizes
only unified-dashboard, runtime-install-contract and hub-runtime-upgrades.
Other specifications and archived historical approval evidence remain unchanged.
The dated system-design snapshot is retained, with its existing development
entrypoint pointing to the current UI policy.

Installed instruction/tool readback, independent fixed-comparison reviews, PR and
main CI, and tracker reconciliation belong to the coordinator’s post-commit
receipts. The broader Hub #657 planning/reviewer pilot is not delivered here.
