## Why

The owner needs private, reproducible Wispr usage history that remains useful when the source prunes records. A native Windows collector can preserve exact contributions and publish bounded aggregates without giving WSL access to either SQLite database.

Owning issue: https://github.com/jimmie-potts/agent-device-hub/issues/468. Parent: https://github.com/jimmie-potts/agent-device-hub/issues/467. The owner's October 2 decisions establish retain-until-clear and date-only source activity publication. Installation remains separately authorized under #472.

## What Changes

- Add a Node 24 Windows collector with explicit private configuration, native read-only SQLite snapshots, one writer lease, deadlines and input bounds.
- Store deduplicated numeric contributions in a private Windows database; retain archived contributions, replace late changes, and expose metric coverage.
- Publish a strict, versioned aggregate JSON format atomically, with independent status, reset generation, snapshot revision and exact collection freshness. Publish only the latest source activity date.
- Supply numeric reports/exports, bounded backup/restore and explicit clear/reset operations with capture boundaries and replay protection.
- Add a shared schema package, offline collector archive, synthetic native Windows qualification and Linux regression/package coverage. Declare optional language/dictionary sections without implementing #469.

## Capabilities

### New Capabilities

- `wispr-collector`: bounded native Windows reads, retained numeric analytics, aggregate publication and recovery.

### Modified Capabilities

None. Controller, lifecycle, shared history and MCP contracts are unchanged.

## Impact

New `apps/wispr-collector` and `packages/wispr-contracts` workspaces; root build/type/test scripts, package lock, packaging script, Depot coverage and owning documentation. The Hub will consume the pure aggregate validator in #470. No new listener, source database write, installation, recurring task, personal-data read or device action is included.
