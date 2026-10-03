# Validation evidence

Functional disposition: supported for practical source adoption, subject to independent reviews, CI and merge. Performance remains unqualified. See [the report](../../../../docs/observability-pilot.md) for run identities, measurements, retained failures and evidence limitations.

Source checks ran on Node 24.21.0 and Python 3.14.4. `npm ci`, build and typecheck passed on `dedbfcbf8f4f2c52a1fae1eb7a3fe2dbdeff58a6`. Nineteen subsequent commands passed: built Node/Python controller contracts and package checks; lifecycle and state Node/Python/package checks; MCP/protocol/package checks; Hub/package/MCP/setup checks; 185 pilot tests; workflow check and 18 workflow tests. Built aliases reuse that fresh build, as in Depot.

Integration with main `9bcdc295f807bb09fb4a0392dcbface2bee8a8d0` produced `8333a07448eb82960faf3e20474fe00c91d637f6`. Both immutable package sets and the upstream dependency-file inventory were retained. Build, typecheck, Hub/package/MCP/setup and all 185 pilot tests passed again. No pilot command, sink, propagation or backend profile changed in that merge; retained runtime evidence remains applicable. No live upgrade command was run.

Command receipts and full logs are in the main checkout's `.local/evidence/gh-706-observability/scope-reset/`: `final-source-checks.jsonl`, `integration-checks.jsonl`, and the named logs. Strict validation after spec synchronization found 36 specifications with zero failures. Post-archive workflow results are retained there as well.

Independent review and hosted CI are recorded on the PR for its final committed comparison. Artifact archival is not evidence those later gates passed.

Final round1 and hosted CI exposed two portability defects: four fixtures assumed the temporary path contained `.local`, and offline consumer installation required uncached registry metadata. F1 retains the supplied short `.local` temporary parent when available and otherwise uses the fixture-owned `.local` parent. F2 adds a consumer lock matching the root dependency versions/integrities and uses offline `npm ci`; a reserved uncached registry regression proves metadata is not needed. All 186 pilot tests pass locally. The failed hosted logs and independent full returns remain on PR #728; corrected hosted checks and renewed independent review are required before merge.
