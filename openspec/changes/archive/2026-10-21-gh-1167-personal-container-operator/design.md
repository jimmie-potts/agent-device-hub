## Scope and reuse

One operator runs one selected core in Linux containers on either host. Reuse
the existing runtime, SDK authenticated transport, embedded stores and SQLite
lease; add no automatic service manager or host handoff. BUNNY_CONTROL defaults
to disabled. Enabling the shipped module list retains its existing configuration
and device authority requirements.

## Ownership and failure

The container entrypoint privately reads configuration, refuses a pending
restore, acquires the existing owner lease and binds it to the actual core
factory before runtime effects. CoreStore borrows that owner and cannot release
it on close. Existing non-bound callers retain their lease path. Canonical
path/inode tracking prevents an alias opener from dropping a held POSIX lock.
Pixoo decoding remains isolated, but only the parent writes staged frames and
the manifest; child close and outstanding parent I/O precede slot cleanup.

The operator verifies one exact selected container/image and distinct ordinary
local volumes. Maintenance requires stopped/PID-zero state, no restart actor
and the actual state lease. This excludes cooperating local writers, not another
host with its own volume or an arbitrary external writer. Manual cross-host
controller stop/verification remains necessary.

## Backup and restore

Archives retain private databases, WAL/assets and matching internal request keys.
External credentials are referenced and hashed, not exported. Config/reference
inode aliases to the held owner are refused before reads. Verify inventory,
integrity, private permissions and database/key pairing; synchronize writes.
Restore requires the exact revision/config/references and a separate empty state
volume. A durable .restore-pending marker blocks startup after interruption;
remove it only after successful synchronized restore. Failure preserves partial
output. Restore never starts the runtime or replaces the held owner inode.

## Evidence and limits

Use focused ownership/config/Pixoo and container/backup tests on the extracted
candidate, plus current CI and independent review. Earlier exact b7 amd64/arm64
operator evidence is historical until candidate applicability is established.
Use synthetic state only; no live secrets, devices, installed service changes,
cross-architecture archive-transfer claim or rollback/migration authority.
