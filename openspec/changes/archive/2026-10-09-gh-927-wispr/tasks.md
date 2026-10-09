## 1. Backend port

- [x] 1.1 Implement fresh manual configuration and safe settings projection; demonstrate invalid inputs and off-by-default sharing in focused red/green tests.
- [x] 1.2 Copy bounded reader/worker/query behavior with provenance; verify synthetic missing/stale/malformed input, numeric math, clear fences and text permissions without a database or collector change.
- [x] 1.3 Implement privacy epoch, cancellation and module stop fencing; verify an outstanding reply cannot survive opt-out, cancellation or stop.
- [x] 1.4 Expose the module lifecycle and typed read adapter for coordinator integration; verify lazy startup, safe registry refusals, host-owned worker shutdown and no analytics publication or persistence.

## 2. Coordinator integration

- [x] 2.1 Attach the read adapter to the coordinator-owned API1.3 content/exposure contract and workspace/CI; verify read-scoped access, browser-off deep-link refusal and late HTTP revocation using synthetic files.
- [x] 2.2 Port the module-owned React page and preserved numeric widget into the shared shell; verify filters, freshness, text retirement, numeric downloads, browser and accessibility checks.
- [x] 2.3 Update shared ADR/setup/contract documentation and add Tier 1 catalog cases; verify workflow, strict specs and existing in-memory scenarios.

## 3. Qualification and closeout

- [x] 3.1 Run applicable final build/type/lint and direct consumer checks on the integrated source; retain command exits and exact source binding.
- [x] 3.2 Obtain independent disposable Acceptance on the exact clean head with synthetic files, including outstanding revocation/opt-out, and preserve run/artifact binding and cleanup.
- [x] 3.3 Synchronize every affected spec and archive after Acceptance to prepare the final source-review candidate. Independent Standards/Specification review and PR/main CI remain required delivery gates after this archive; installation remains at #840.
