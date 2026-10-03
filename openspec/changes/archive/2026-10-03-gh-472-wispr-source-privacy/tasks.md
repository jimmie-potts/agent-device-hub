## 1. Separate source permissions

- [x] 1.1 Add a native synthetic selected-source/sidecar extra-reader scenario and retain its before-fix ACL rejection.
- [x] 1.2 Relax only source ACL grants and verify native collection preserves source bytes/ACLs while config, state, backup and export extra-reader cases still reject.

## 2. Package and document

- [x] 2.1 Publish distinct collector 1.1.1 metadata, manifest and archive; verify offline extraction and native Windows qualification against its digest.
- [x] 2.2 Document accepted vendor-source permissions and retained private-output restrictions; inspect the runbook against the owner-approved scope and recovery procedure.

## 3. Validate and synchronize

- [x] 3.1 Run required shared build/type, Wispr, package, controller-contract/Python and workflow checks plus affected Hub producer/consumer checks; retain actual results.
- [x] 3.2 Synchronize the affected collector specification and archive this source change after complete source evidence. Keep #472's installed/live/day acceptance pending separately.
