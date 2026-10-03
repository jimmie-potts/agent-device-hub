# Source validation

The native Windows synthetic regression rejects the extra source reader on collector 1.1.0 with `unsafe-private-path`, then passes with 1.1.1. Database/WAL bytes and every source/sidecar ACL are preserved; SQLite SHM read-mark/lock bookkeeping is excluded from byte comparison. Collector config, state directory, analytics child, managed backup and export extra-reader cases reject before retained data or publication changes. Existing reparse, Git, hard-link/short-name alias, lease, reader, language opt-out, clear/restore, locked-output and capacity checks pass.

Native Windows Node 24.21.0 / SQLite 3.53.4 verifies the offline manifest inventory and runs `native.mjs`, `native-privacy.mjs`, `native-cli.mjs`, `native-locked-output.mjs`, `native-capacity.mjs` and `package-smoke.mjs` on synthetic local-drive fixtures. This supplies the five native scripts from `test:wispr:native:built` and the extracted offline smoke check.

From the assigned worktree under Node 24, `npm ci`, `npm run build`, `npm run typecheck`, `npm run test:wispr`, `npm run test:wispr:package`, `npm run test:contracts`, `npm run test:contracts:python`, `npm run test:package`, `npm run check:workflow` and `npm run test:workflow` exit zero. The affected Hub HTTP consumer and real collector-producer fixture tests pass 20/20. Linux temporary fixtures use an owned directory outside Git: another session's `/tmp/.git` makes default-path fixtures fail, and is preserved.

The runbook documents accepted existing vendor-source grants and the retained private-output boundary. Collector package, manifest and lock metadata agree on 1.1.1; shared aggregate schemas remain compatible. Final immutable package/check identities, independent review and hosted CI receipts are retained outside the reviewed commit in the PR/private task evidence.

This archives only the source-permission correction. Issue #472 remains open for refreshed installation inputs, explicitly authorized live collection, separate installed language/Hub sharing choices and one-day observed acceptance. No Wispr source ACL, record, settings, service or scheduled task changed during this source qualification.
